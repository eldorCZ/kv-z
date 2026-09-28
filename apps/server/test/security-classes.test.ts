import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiToken, classWithStudents, startApp, teacher, type TestApp } from './helpers.js';
import { connect, emit, once, sleep, type Client } from './socket-helpers.js';

let t: TestApp;
let sess: { cookie: string; csrf: string };
let agent: { authorization: string };
let quizId: string;

const quiz = {
  schemaVersion: 1,
  title: 'Bezpečnost',
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'Otázka?', options: ['a', 'b', 'c'], correctIndices: [0], topic: 'T' },
    { type: 'truefalse', prompt: 'Pravda?', correctIndices: [0], topic: 'T' },
  ],
};
// distinctive names so that any leak is easy to find
const NAMES = ['kvasnicka1', 'popelkova2', 'stovicek3'];

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000, joinRateLimit: 10_000 });
  sess = await teacher(t);
  agent = { authorization: `Bearer ${(await apiToken(t, sess)).token}` };
  quizId = (await t.http.post('/api/v1/quizzes').set(agent).send(quiz)).body.quizId;
});
afterAll(async () => t.close());

/** every key and string value, recursively */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      strings(x, out);
    }
  return out;
}

/** codes must never travel to students, the host key, the projector or the agent */
function forbidden(created: { code: string }[]) {
  return created.flatMap((c) => [c.code, c.code.replace('-', '')]);
}
const leaks = (payload: unknown, words: string[]) => strings(payload).filter((s) => words.some((w) => s.includes(w)));

describe('student, host key and projector payloads contain account names only, never codes (C11)', () => {
  it('live class game: every socket frame and HTTP response', async () => {
    const cls = await classWithStudents(t, sess, NAMES, 'Bezpečnost live');
    const bad = forbidden(cls.created);
    const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(agent).send({ mode: 'live', settings: { classId: cls.classId } })).body;
    const bodies: unknown[] = [g];
    const host = await connect(t.url);
    const att = await emit(host, 'host_attach', { gameId: g.gameId, hostKey: new URL(g.hostUrl).hash.slice(5) });
    bodies.push(att);
    const players: Client[] = [];
    for (const c of cls.created) {
      bodies.push((await t.http.post('/play/roster/lookup').send({ pin: g.pin })).body, (await t.http.get(`/play/test/lookup?pin=${g.pin}`)).body);
      const id = await t.http.post('/play/roster/identify').send({ pin: g.pin, code: c.code });
      // whitelist of the identify response
      expect(Object.keys(id.body).sort()).toEqual(['accountName', 'ticket']);
      const p = await connect(t.url);
      bodies.push(await emit(p, 'join', { pin: g.pin, ticket: id.body.ticket }));
      players.push(p);
    }
    const q = once<{ question: { id: string } }>(players[0]!, 'question');
    await emit(host, 'start');
    const { question } = await q;
    for (const p of players) await emit(p, 'answer', { questionId: question.id, payload: { indices: [0] } });
    await emit(host, 'reveal');
    await sleep(100);
    await emit(host, 'end');
    await sleep(200);
    for (const s of [host, ...players]) {
      expect(leaks(s.frames.join('\n'), bad)).toEqual([]);
    }
    // Od 28. 9. 2026 je výchozí „number": projektor ani spolužáci nevidí
    // přihlašovací jména, jen „Žák <číslo>". Že rámce opravdu něco nesly,
    // ověřujeme právě tímhle označením.
    expect(host.frames.join('\n')).toContain('Žák 1');
    expect(host.frames.join('\n')).not.toContain('kvasnicka1');
    expect(leaks(bodies, bad)).toEqual([]);
    // agent: status and results without names
    expect(leaks((await t.http.get(`/api/v1/games/${g.gameId}`).set(agent)).body, bad)).toEqual([]);
    const res = (await t.http.get(`/api/v1/games/${g.gameId}/results`).set(agent)).body;
    expect(leaks(res, [...bad, ...NAMES])).toEqual([]);
    [host, ...players].forEach((s) => s.disconnect());
  });

  it('class test: join, start, answers, submit and result for the student', async () => {
    const cls = await classWithStudents(t, sess, NAMES, 'Bezpečnost test');
    const bad = forbidden(cls.created);
    const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(agent).send({ mode: 'test', settings: { classId: cls.classId, test: { showResultsToStudent: 'full' } } })).body;
    const bodies: unknown[] = [];
    for (const c of cls.created) {
      const id = await t.http.post('/play/roster/identify').send({ pin: g.pin, code: c.code });
      const j = await t.http.post('/play/test/join').send({ pin: g.pin, ticket: id.body.ticket });
      const token = j.body.playerToken as string;
      const st = await t.http.post('/play/test/start').set('x-player-token', token);
      const a = await t.http.put(`/play/test/answers/${st.body.questions[0].id}`).set('x-player-token', token).send({ payload: { indices: [0] } });
      const sub = await t.http.post('/play/test/submit').set('x-player-token', token);
      const me = await t.http.get('/play/test/attempt').set('x-player-token', token);
      expect(me.status).toBe(200);
      bodies.push(j.body, st.body, a.body, sub.body, me.body);
      // the student sees only their own account name
      expect(strings(bodies).some((s) => s === c.student.accountName)).toBe(true);
    }
    expect(leaks(bodies, bad)).toEqual([]);
    const others = cls.created.slice(1).map((c) => c.student.accountName);
    const first = bodies.slice(0, 5);
    expect(leaks(first, others)).toEqual([]);
  });

  it('the code is accepted only in the request body, never in the URL or a header', async () => {
    const cls = await classWithStudents(t, sess, NAMES.slice(0, 1), 'Bezpečnost kód');
    const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(agent).send({ mode: 'live', settings: { classId: cls.classId } })).body;
    const code = cls.created[0]!.code;
    const q = await t.http.post(`/play/roster/identify?code=${code}`).send({ pin: g.pin });
    expect(q.body.ticket).toBeUndefined();
    const h = await t.http.post('/play/roster/identify').set('x-code', code).set('x-personal-code', code).send({ pin: g.pin });
    expect(h.body.ticket).toBeUndefined();
    const ok = await t.http.post('/play/roster/identify').send({ pin: g.pin, code });
    expect(ok.body.ticket).toBeTruthy();
  });
});
