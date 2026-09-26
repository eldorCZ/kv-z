import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRetention } from '../src/retention.js';
import { apiToken, classWithStudents, startApp, teacher, ui, type TestApp } from './helpers.js';
import { connect, emit, once } from './socket-helpers.js';

let t: TestApp;
let sess: { cookie: string; csrf: string };
let auth: { authorization: string };
let quizId: string;

const quiz = {
  schemaVersion: 1,
  title: 'Optika',
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'Lom?', options: ['Lom', 'Odraz', 'Ohyb'], correctIndices: [0], topic: 'Lom světla' },
    { type: 'truefalse', prompt: 'Zrcadlo odráží.', correctIndices: [0], topic: 'Zrcadla', points: 'double' },
    { type: 'single', prompt: 'Bez bodů', options: ['a', 'b', 'c'], correctIndices: [0], points: 'none' },
  ],
};

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000, joinRateLimit: 10_000 });
  sess = await teacher(t);
  auth = { authorization: `Bearer ${(await apiToken(t, sess)).token}` };
  quizId = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz)).body.quizId;
});
afterAll(async () => t.close());

const db = () => t.services.db.$client;
const results = (activityId: string) =>
  db().prepare('SELECT student_id AS studentId, status, percent, points_centi AS pts, max_points_centi AS max, answered_count AS answered, question_count AS qc FROM activity_results WHERE activity_id = ? ORDER BY student_id').all(activityId) as {
    studentId: string;
    status: string;
    percent: number;
    pts: number;
    max: number;
    answered: number;
    qc: number;
  }[];

async function joinTest(pin: string, code: string) {
  const tk = (await t.http.post('/play/roster/identify').send({ pin, code })).body.ticket;
  const j = await t.http.post('/play/test/join').send({ pin, ticket: tk });
  const token = j.body.playerToken as string;
  const st = await t.http.post('/play/test/start').set('x-player-token', token);
  return { token, questions: st.body.questions as { id: string; options: string[]; type: string }[] };
}
const answer = (token: string, qid: string, payload: unknown) => t.http.put(`/play/test/answers/${qid}`).set('x-player-token', token).send({ payload });

describe('class test -> records (C7.1)', () => {
  it('writes results on submit, same percent as the test, idempotent, recomputed after reopen', async () => {
    const cls = await classWithStudents(t, sess, ['novak12', 'svoboda7', 'dvorak3'], 'Záznamy');
    const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(ui(sess)).send({ mode: 'test', settings: { classId: cls.classId, label: 'Písemka 1', test: { timeLimitMin: 20 } } })).body;
    const activityId = t.services.gameRepo.get(g.gameId)!.activityId!;
    expect(t.services.evidence.activity(activityId)).toMatchObject({ kind: 'test', label: 'Písemka 1', rosterSize: 3, countInStats: true });

    const jana = await joinTest(g.pin, cls.created[0]!.code);
    const [q1, q2] = jana.questions;
    expect(jana.questions).toHaveLength(3);
    await answer(jana.token, q1!.id, { indices: [0] });
    await answer(jana.token, q2!.id, { indices: [1] }); // wrong, weight 2
    const sub = await t.http.post('/play/test/submit').set('x-player-token', jana.token);
    const r = results(activityId);
    expect(r).toHaveLength(1);
    // speed does not matter: 1 of weight 3 -> 33 %, same as the test result
    expect(r[0]).toMatchObject({ studentId: cls.created[0]!.student.id, status: 'submitted', percent: 33, pts: 100, max: 300, answered: 2, qc: 2 });
    expect(sub.body.result.percent).toBe(33);
    const items = db().prepare('SELECT position, topic, weight, score_milli AS s, answered, prompt_snapshot AS p FROM result_items ORDER BY position').all();
    expect(items).toEqual([
      { position: 0, topic: 'Lom světla', weight: 1, s: 1000, answered: 1, p: 'Lom?' },
      { position: 1, topic: 'Zrcadla', weight: 2, s: 0, answered: 1, p: 'Zrcadlo odráží.' },
    ]);

    // idempotent
    t.services.evidence.materializeGame(g.gameId);
    t.services.evidence.materializeGame(g.gameId);
    expect(results(activityId)).toHaveLength(1);
    expect(db().prepare('SELECT count(*) n FROM result_items').get()).toEqual({ n: 2 });

    // D5.8 reopen -> fix -> submit again -> recomputed
    const dash = await t.http.get(`/api/v1/games/${g.gameId}/dashboard`).set('cookie', sess.cookie);
    await t.http.post(`/api/v1/games/${g.gameId}/attempts/${dash.body.students[0].attemptId}/reopen`).set(ui(sess)).send({ minutes: 5 });
    await answer(jana.token, q2!.id, { indices: [0] });
    await t.http.post('/play/test/submit').set('x-player-token', jana.token);
    expect(results(activityId)[0]).toMatchObject({ percent: 100 });

    // ending the test submits running attempts as 'submitted'
    const petr = await joinTest(g.pin, cls.created[1]!.code);
    await answer(petr.token, q1!.id, { indices: [1] });
    await t.http.post(`/api/v1/games/${g.gameId}/end`).set(auth).send({});
    expect(results(activityId).find((x) => x.studentId === cls.created[1]!.student.id)).toMatchObject({ percent: 0, answered: 1 });
  });

  it('expired attempts are auto_submitted; guests are not written until assigned', async () => {
    const cls = await classWithStudents(t, sess, ['mala4', 'velky5'], 'Hosté');
    const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(ui(sess)).send({ mode: 'test', settings: { classId: cls.classId, allowGuests: true } })).body;
    const activityId = t.services.gameRepo.get(g.gameId)!.activityId!;
    const guest = await t.http.post('/play/test/join').send({ pin: g.pin, name: 'Neznámý host' });
    const gt = guest.body.playerToken as string;
    const gq = (await t.http.post('/play/test/start').set('x-player-token', gt)).body.questions;
    await answer(gt, gq[0].id, { indices: [0] });
    await t.http.post('/play/test/submit').set('x-player-token', gt);
    expect(results(activityId)).toHaveLength(0);
    const gl = await t.http.get(`/api/v1/games/${g.gameId}/guests`).set('cookie', sess.cookie);
    expect(gl.body.guests).toHaveLength(1);
    expect(gl.body.candidates.map((c: { accountName: string }) => c.accountName).sort()).toEqual(['mala4', 'velky5']);
    const as = await t.http.post(`/api/v1/games/${g.gameId}/guests/${gl.body.guests[0].playerId}/assign`).set(ui(sess)).send({ studentId: cls.created[0]!.student.id });
    expect(as.status).toBe(200);
    expect(results(activityId)).toEqual([expect.objectContaining({ studentId: cls.created[0]!.student.id, percent: 33 })]);
    // the same student cannot be assigned twice
    expect(as.body.candidates.map((c: { accountName: string }) => c.accountName)).toEqual(['velky5']);

    // expiry
    const jan = await joinTest(g.pin, cls.created[1]!.code);
    db().prepare("UPDATE attempts SET deadline_at = ? WHERE status = 'in_progress'").run(Date.now() - 10_000);
    t.services.testService.tick();
    expect(results(activityId).find((x) => x.studentId === cls.created[1]!.student.id)?.status).toBe('auto_submitted');
    void jan;
  });
});

describe('live class game -> records', () => {
  it('writes correctness only (no speed points), skipped questions left out, on game end', async () => {
    const cls = await classWithStudents(t, sess, ['rychla1', 'pomaly2'], 'Živá');
    const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(ui(sess)).send({ mode: 'live', settings: { classId: cls.classId, showLeaderboard: false } })).body;
    const activityId = t.services.gameRepo.get(g.gameId)!.activityId!;
    expect(t.services.evidence.activity(activityId)!.kind).toBe('quiz');
    const host = await connect(t.url);
    await emit(host, 'host_attach', { gameId: g.gameId, hostKey: new URL(g.hostUrl).hash.slice(5) });
    const ps = [];
    for (const c of cls.created) {
      const p = await connect(t.url);
      const tk = (await t.http.post('/play/roster/identify').send({ pin: g.pin, code: c.code })).body.ticket;
      expect(await emit(p, 'join', { pin: g.pin, ticket: tk })).toMatchObject({ ok: true });
      ps.push(p);
    }
    const q1 = ps.map((p) => once<{ question: { id: string } }>(p, 'question'));
    await emit(host, 'start');
    const qe = (await Promise.all(q1))[0]!.question;
    const rev = once(ps[0]!, 'reveal');
    await emit(ps[0]!, 'answer', { questionId: qe.id, payload: { indices: [0] } });
    await emit(ps[1]!, 'answer', { questionId: qe.id, payload: { indices: [0] } });
    await rev;
    const q2 = once<{ question: { id: string } }>(ps[0]!, 'question');
    await emit(host, 'next');
    await q2;
    await emit(host, 'skip'); // question 2 skipped -> not written
    const over = once(ps[0]!, 'game_over', 8000);
    await emit(host, 'end');
    await over;
    await new Promise((r) => setTimeout(r, 100));
    const r = results(activityId);
    expect(r).toHaveLength(2);
    // both correct on q1: 100 % regardless of speed; q3 (points none) and skipped q2 left out
    expect(r.every((x) => x.percent === 100 && x.qc === 1 && x.status === 'completed')).toBe(true);
    [host, ...ps].forEach((s) => s.disconnect());
  });
});

describe('makeup test (C6.4) and retention', () => {
  it('same snapshot, only missing students, merged column; RETENTION_DAYS keeps the records', async () => {
    const cls = await classWithStudents(t, sess, ['anna1', 'bara2', 'cyril3'], 'Dopisování');
    const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(ui(sess)).send({ mode: 'test', settings: { classId: cls.classId, label: 'Test 3' } })).body;
    const activityId = t.services.gameRepo.get(g.gameId)!.activityId!;
    const anna = await joinTest(g.pin, cls.created[0]!.code);
    await t.http.post('/play/test/submit').set('x-player-token', anna.token);
    // the quiz changes afterwards – the makeup must use the original questions
    const current = (await t.http.get(`/api/v1/quizzes/${quizId}`).set(auth)).body;
    await t.http.patch(`/api/v1/quizzes/${quizId}/questions/${current.questions[0].id}`).set(auth).send({ prompt: 'ZMĚNĚNO?' });

    const mk = await t.http.post(`/api/v1/classes/${cls.classId}/activities/${activityId}/makeup`).set(auth);
    expect(mk.status).toBe(201);
    expect(mk.body).toMatchObject({ audienceSize: 2, reused: false, pin: expect.stringMatching(/^\d{6}$/) });
    expect(Object.keys(mk.body).sort()).toEqual(['audienceSize', 'gameId', 'hostUrl', 'joinUrl', 'pin', 'resultsUrl', 'reused']);
    // idempotent
    const again = await t.http.post(`/api/v1/classes/${cls.classId}/activities/${activityId}/makeup`).set(auth);
    expect(again.status).toBe(200);
    expect(again.body.gameId).toBe(mk.body.gameId);
    // Anna already has a result -> not in the audience
    const annaTry = await t.http.post('/play/roster/identify').send({ pin: mk.body.pin, code: cls.created[0]!.code });
    expect(annaTry.status).toBe(403);
    const bara = await joinTest(mk.body.pin, cls.created[1]!.code);
    expect(bara.questions.map((q) => q.id)).toEqual(anna.questions.map((q) => q.id));
    const view = await t.http.get('/play/test/attempt').set('x-player-token', bara.token);
    expect(JSON.stringify(view.body)).not.toContain('ZMĚNĚNO');
    await t.http.post('/play/test/submit').set('x-player-token', bara.token);
    const mkAct = t.services.gameRepo.get(mk.body.gameId)!.activityId!;
    expect(t.services.evidence.activity(mkAct)).toMatchObject({ rootActivityId: activityId, label: 'Test 3' });
    // Cyril still missing -> a further makeup contains only him
    const mk2 = await t.http.post(`/api/v1/classes/${cls.classId}/activities/${activityId}/makeup`).set(auth);
    expect(mk2.body).toMatchObject({ audienceSize: 1, reused: false });
    // live quizzes have no makeup
    const live = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(ui(sess)).send({ mode: 'live', settings: { classId: cls.classId } })).body;
    const liveAct = t.services.gameRepo.get(live.gameId)!.activityId!;
    expect((await t.http.post(`/api/v1/classes/${cls.classId}/activities/${liveAct}/makeup`).set(auth)).status).toBe(409);

    // RETENTION_DAYS deletes games, players and attempts, but not the records
    const before = results(activityId).length + results(mkAct).length;
    runRetention(t.services, t.app.log, Date.now() + (t.services.cfg.retentionDays + 1) * 86_400_000);
    expect(t.services.gameRepo.get(g.gameId)).toBeUndefined();
    expect(results(activityId).length + results(mkAct).length).toBe(before);
    expect(t.services.evidence.activity(activityId)).toMatchObject({ gameId: null, label: 'Test 3' });
  });
});
