import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECRET_KEYS } from '@kvizhub/core';
import { runRetention } from '../src/retention.js';
import { apiToken, startApp, teacher, type TestApp } from './helpers.js';

const MIN = 60_000;
const clock = { t: Date.parse('2026-10-01T08:00:00Z') };
let t: TestApp;
let session: { cookie: string; csrf: string };
let auth: { authorization: string };

const quiz = {
  schemaVersion: 1,
  title: 'Test: hlavní města',
  settings: { shuffleQuestions: true, shuffleOptions: true },
  questions: [
    { type: 'single', prompt: 'Hlavní město ČR?', options: ['Praha', 'Brno', 'Ostrava'], correctIndices: [0], explanation: 'VYSVETLENI_1' },
    { type: 'short', prompt: 'Hlavní město Rakouska?', acceptedAnswers: ['Vídeň'], points: 'double' },
    { type: 'truefalse', prompt: 'Bratislava je na Dunaji.', correctIndices: [0] },
    { type: 'single', prompt: 'Neschválená', options: ['A', 'B', 'C'], correctIndices: [0], qa: { status: 'flagged', notes: 'Ke kontrole.' } },
  ],
};

async function createTest(test: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const quizId = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz)).body.quizId as string;
  const r = await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(auth).send({ mode: 'test', settings: { test, ...extra } });
  expect(r.status).toBe(201);
  return r.body as { gameId: string; pin: string; questionCount: number; dashboardUrl: string };
}

async function join(pin: string, name: string) {
  const r = await t.http.post('/play/test/join').send({ pin, name });
  return r;
}
const as = (token: string) => ({ 'x-player-token': token });

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000, joinRateLimit: 10_000 }, { now: () => clock.t });
  session = await teacher(t);
  auth = { authorization: `Bearer ${(await apiToken(t, session)).token}` };
});
afterAll(async () => t.close());

describe('create', () => {
  it('creates a test with PIN and dashboard URL; flagged questions are excluded', async () => {
    const g = await createTest({ timeLimitMin: 10 });
    expect(g.pin).toMatch(/^\d{6}$/);
    expect(g.questionCount).toBe(3);
    expect(g.dashboardUrl).toBe(`${t.url}/tests/${g.gameId}`);
    const st = await t.http.get(`/api/v1/games/${g.gameId}`).set(auth);
    expect(st.body).toMatchObject({ mode: 'test', status: 'running', counts: { joined: 0, inProgress: 0, submitted: 0, notStarted: 0 } });
  });

  it('validates settings with Czech 422 errors', async () => {
    const quizId = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz)).body.quizId;
    const r = await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(auth).send({ mode: 'test', settings: { test: { timeLimitMin: 999 } } });
    expect(r.status).toBe(422);
    expect(r.body.errors[0]).toMatchObject({ path: 'settings.test.timeLimitMin', code: 'too_big' });
    const past = await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(auth).send({ mode: 'test', settings: { test: { closesAt: '2020-01-01T00:00:00Z' } } });
    expect(past.status).toBe(422);
  });
});

describe('student flow', () => {
  it('join -> start -> answer -> submit, questions never contain the key', async () => {
    const g = await createTest({ timeLimitMin: 10, showResultsToStudent: 'full' });
    const lookup = await t.http.get(`/play/test/lookup?pin=${g.pin}`);
    expect(lookup.body).toMatchObject({ mode: 'test', title: 'Test: hlavní města', questionCount: 3, timeLimitMin: 10, requireName: true });
    expect((await join(g.pin, 'X')).status).toBe(422);
    const j = await join(g.pin, 'Jana Nováková');
    expect(j.status).toBe(201);
    const token = j.body.playerToken as string;

    const intro = await t.http.get('/play/test/attempt').set(as(token));
    expect(intro.body).toMatchObject({ status: 'not_started', questionCount: 3, name: 'Jana Nováková' });
    expect(intro.body.questions).toBeUndefined();

    const started = await t.http.post('/play/test/start').set(as(token));
    expect(started.body.status).toBe('in_progress');
    expect(started.body.remainingSec).toBe(600);
    const body = JSON.stringify(started.body);
    for (const k of SECRET_KEYS) expect(body).not.toContain(`"${k}"`);
    expect(body).not.toContain('VYSVETLENI_1');
    expect(body).not.toContain('Neschválená');
    const qs = started.body.questions as { id: string; type: string; options: string[] }[];
    expect(qs).toHaveLength(3);

    const single = qs.find((q) => q.type === 'single')!;
    const short = qs.find((q) => q.type === 'short')!;
    clock.t += MIN;
    expect((await t.http.put(`/play/test/answers/${single.id}`).set(as(token)).send({ payload: { indices: [single.options.indexOf('Brno')] } })).status).toBe(200);
    // answers can be changed until submit
    expect((await t.http.put(`/play/test/answers/${single.id}`).set(as(token)).send({ payload: { indices: [single.options.indexOf('Praha')] } })).status).toBe(200);
    await t.http.put(`/play/test/answers/${short.id}`).set(as(token)).send({ payload: { text: 'Viden' } });
    // saved answers come back in displayed positions after reload
    const again = await t.http.get('/play/test/attempt').set(as(token));
    expect(again.body.answers[single.id]).toEqual({ indices: [single.options.indexOf('Praha')] });
    expect(again.body.remainingSec).toBe(540);

    const sub = await t.http.post('/play/test/submit').set(as(token));
    // single 1 + short 2 (double) of 4 -> 75 %
    expect(sub.body.status).toBe('submitted');
    expect(sub.body.result).toMatchObject({ shown: 'full', percent: 75 });
    expect(sub.body.result.questions.find((q: { prompt: string }) => q.prompt === 'Hlavní město ČR?').explanation).toBe('VYSVETLENI_1');
    // submitted attempt is immutable
    expect((await t.http.put(`/play/test/answers/${single.id}`).set(as(token)).send({ payload: { indices: [0] } })).status).toBe(409);

    const res = await t.http.get(`/api/v1/games/${g.gameId}/results`).set(auth);
    expect(res.body.summary).toMatchObject({ students: 1, submitted: 1, avgPercent: 75, medianPercent: 75 });
    // API token without results:pii never sees names (D3.5)
    expect(res.body.students[0].student).toBe('Žák 1');
    const resSession = await t.http.get(`/api/v1/games/${g.gameId}/results`).set('cookie', session.cookie);
    expect(resSession.body.students[0].student).toBe('Jana Nováková');
    const csv = await t.http.get(`/api/v1/games/${g.gameId}/results.csv`).set('cookie', session.cookie);
    expect(csv.text).toContain('Jana Nováková;75;odevzdáno');
  });

  it('showResultsToStudent score / none', async () => {
    for (const [mode, expected] of [['score', { shown: 'score', percent: 0 }], ['none', { shown: 'none' }]] as const) {
      const g = await createTest({ showResultsToStudent: mode });
      const tok = (await join(g.pin, `Žák Pokus ${mode}`)).body.playerToken;
      await t.http.post('/play/test/start').set(as(tok));
      const r = await t.http.post('/play/test/submit').set(as(tok));
      expect(r.body.result).toEqual(expected);
    }
  });

  it('nickname mode when requireName is false', async () => {
    const g = await createTest({ requireName: false });
    expect((await join(g.pin, 'Ab')).status).toBe(201);
  });

  it('name is taken until the teacher allows a return (D5.7)', async () => {
    const g = await createTest();
    const first = await join(g.pin, 'Petr Svoboda');
    await t.http.post('/play/test/start').set(as(first.body.playerToken));
    const dup = await join(g.pin, 'petr  svoboda');
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/Povolit návrat/);
    const dash = await t.http.get(`/api/v1/games/${g.gameId}/dashboard`).set('cookie', session.cookie);
    const aid = dash.body.students[0].attemptId;
    // API tokens cannot use the dashboard actions
    expect((await t.http.post(`/api/v1/games/${g.gameId}/attempts/${aid}/allow-return`).set(auth)).status).toBe(403);
    const ok = await t.http.post(`/api/v1/games/${g.gameId}/attempts/${aid}/allow-return`).set('cookie', session.cookie).set('x-csrf-token', session.csrf);
    expect(ok.status).toBe(200);
    const back = await join(g.pin, 'Petr Svoboda');
    expect(back.status).toBe(201);
    expect(back.body.returned).toBe(true);
    // the old token no longer works, the new one continues the same attempt
    expect((await t.http.get('/play/test/attempt').set(as(first.body.playerToken))).status).toBe(401);
    expect((await t.http.get('/play/test/attempt').set(as(back.body.playerToken))).body.status).toBe('in_progress');
    // allowing a return is single use
    expect((await join(g.pin, 'Petr Svoboda')).status).toBe(409);
  });
});

describe('time', () => {
  it('deadline = start + limit; answers after deadline + grace are rejected; tick expires and grades', async () => {
    const g = await createTest({ timeLimitMin: 5 });
    const tok = (await join(g.pin, 'Eva Malá')).body.playerToken;
    const st = await t.http.post('/play/test/start').set(as(tok));
    const q = (st.body.questions as { id: string; type: string; options: string[] }[]).find((x) => x.type === 'truefalse')!;
    clock.t += 5 * MIN + 3000; // within grace
    expect((await t.http.put(`/play/test/answers/${q.id}`).set(as(tok)).send({ payload: { indices: [0] } })).status).toBe(200);
    clock.t += 3000; // past grace
    expect(t.services.testService.tick()).toBe(1);
    const view = await t.http.get('/play/test/attempt').set(as(tok));
    expect(view.body.status).toBe('expired');
    expect(view.body.result.percent).toBe(25); // truefalse 1 of weight 4
  });

  it('deadline never exceeds closesAt; lazy expiry on the next request', async () => {
    const closesAt = new Date(clock.t + 2 * MIN).toISOString();
    const g = await createTest({ timeLimitMin: 30, closesAt });
    const tok = (await join(g.pin, 'Karel Veliký')).body.playerToken;
    const st = await t.http.post('/play/test/start').set(as(tok));
    expect(st.body.remainingSec).toBe(120);
    clock.t += 2 * MIN + 6000;
    const v = await t.http.get('/play/test/attempt').set(as(tok));
    expect(v.body.status).toBe('expired');
    // joining after the deadline is refused; tick closes the test
    t.services.testService.tick();
    expect((await t.http.get(`/api/v1/games/${g.gameId}`).set(auth)).body.status).toBe('finished');
    expect((await join(g.pin, 'Nový Žák')).status).toBe(404);
  });

  it('opensAt in the future blocks joining', async () => {
    const g = await createTest({ opensAt: new Date(clock.t + 60 * MIN).toISOString(), closesAt: new Date(clock.t + 120 * MIN).toISOString() });
    const r = await join(g.pin, 'Brzký Ptáček');
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/ještě nezačal/);
  });

  it('teacher reopens a submitted attempt with extra minutes (D5.8)', async () => {
    const g = await createTest({ timeLimitMin: 10 });
    const tok = (await join(g.pin, 'Olga Nová')).body.playerToken;
    await t.http.post('/play/test/start').set(as(tok));
    await t.http.post('/play/test/submit').set(as(tok));
    const dash = await t.http.get(`/api/v1/games/${g.gameId}/dashboard`).set('cookie', session.cookie);
    const aid = dash.body.students[0].attemptId;
    const r = await t.http.post(`/api/v1/games/${g.gameId}/attempts/${aid}/reopen`).set('cookie', session.cookie).set('x-csrf-token', session.csrf).send({ minutes: 7 });
    expect(r.status).toBe(200);
    const v = await t.http.get('/play/test/attempt').set(as(tok));
    expect(v.body.status).toBe('in_progress');
    expect(v.body.remainingSec).toBe(420);
  });

  it('ending the test submits running attempts', async () => {
    const g = await createTest();
    const tok = (await join(g.pin, 'Rudolf Rychlý')).body.playerToken;
    await t.http.post('/play/test/start').set(as(tok));
    const e = await t.http.post(`/api/v1/games/${g.gameId}/end`).set(auth).send({});
    expect(e.body).toMatchObject({ status: 'finished', counts: { submitted: 1 } });
    expect((await t.http.get('/play/test/attempt').set(as(tok))).body.status).toBe('submitted');
  });
});

describe('isolation and privacy', () => {
  it('invalid token 401, live games unaffected, detail for teacher only', async () => {
    expect((await t.http.get('/play/test/attempt').set(as('nope'))).status).toBe(401);
    expect((await t.http.get('/play/test/attempt')).status).toBe(401);
    const g = await createTest();
    const tok = (await join(g.pin, 'Tereza Tichá')).body.playerToken;
    await t.http.post('/play/test/start').set(as(tok));
    const dash = await t.http.get(`/api/v1/games/${g.gameId}/dashboard`).set('cookie', session.cookie);
    expect(dash.body.students[0]).toMatchObject({ student: 'Tereza Tichá', status: 'in_progress', answered: 0, total: 3 });
    const d = await t.http.get(`/api/v1/games/${g.gameId}/attempts/${dash.body.students[0].attemptId}`).set('cookie', session.cookie);
    expect(d.body.questions).toHaveLength(3);
    const other = await teacher(t);
    expect((await t.http.get(`/api/v1/games/${g.gameId}/dashboard`).set('cookie', other.cookie)).status).toBe(404);
  });

  it('names are anonymised after TEST_NAME_RETENTION_DAYS', async () => {
    const g = await createTest();
    await join(g.pin, 'Anna Stará');
    const r = runRetention(t.services, t.app.log, clock.t + 31 * 86_400_000);
    expect(r.names).toBeGreaterThan(0);
    const res = await t.http.get(`/api/v1/games/${g.gameId}/results`).set('cookie', session.cookie);
    expect(res.body.students[0].student).toMatch(/^Žák \d+$/);
  });
});
