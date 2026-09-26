import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiToken, classWithStudents, startApp, teacher, type TestApp } from './helpers.js';
import { connect, emit, once, sleep, type Client } from './socket-helpers.js';

let t: TestApp;
let sess: { cookie: string; csrf: string };
let agent: { authorization: string };
let quizId: string;
let cls: Awaited<ReturnType<typeof classWithStudents>>;

const N = 35;
const quiz = {
  schemaVersion: 1,
  title: 'Zátěž',
  settings: { shuffleQuestions: true, shuffleOptions: true },
  questions: Array.from({ length: 10 }, (_, i) => ({ type: 'single', prompt: `Otázka ${i + 1}?`, options: ['a', 'b', 'c', 'd'], correctIndices: [i % 4], topic: `Téma ${i % 3}` })),
};

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 100_000, joinRateLimit: 100_000 });
  sess = await teacher(t);
  agent = { authorization: `Bearer ${(await apiToken(t, sess)).token}` };
  quizId = (await t.http.post('/api/v1/quizzes').set(agent).send(quiz)).body.quizId;
  cls = await classWithStudents(
    t,
    sess,
    Array.from({ length: N }, (_, i) => `zak${String(i + 1).padStart(2, '0')}`),
    'Zátěž 35',
  );
});
afterAll(async () => t.close());

const results = (gameId: string) => t.services.db.$client.prepare('SELECT count(*) n FROM activity_results WHERE activity_id = ?').get(t.services.gameRepo.get(gameId)!.activityId) as { n: number };

describe(`load: a class of ${N} students (C11)`, () => {
  it('test: all log in by code at once; ending the test writes the records in < 2 s', async () => {
    const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(agent).send({ mode: 'test', settings: { classId: cls.classId } })).body;
    const tokens = await Promise.all(
      cls.created.map(async (c) => {
        const id = await t.http.post('/play/roster/identify').send({ pin: g.pin, code: c.code });
        expect(id.status).toBe(200);
        const j = await t.http.post('/play/test/join').send({ pin: g.pin, ticket: id.body.ticket });
        const token = j.body.playerToken as string;
        const st = await t.http.post('/play/test/start').set('x-player-token', token);
        for (const q of st.body.questions.slice(0, 6)) await t.http.put(`/play/test/answers/${q.id}`).set('x-player-token', token).send({ payload: { indices: [0] } });
        return token;
      }),
    );
    expect(tokens).toHaveLength(N);
    const t0 = performance.now();
    const end = await t.http.post(`/api/v1/games/${g.gameId}/end`).set(agent).send({});
    const ms = performance.now() - t0;
    expect(end.status).toBe(200);
    expect(results(g.gameId).n).toBe(N);
    expect(ms).toBeLessThan(2000);
    // idempotent re-materialisation is fast too
    const t1 = performance.now();
    t.services.evidence.materializeGame(g.gameId);
    expect(performance.now() - t1).toBeLessThan(2000);
  }, 60_000);

  it('live game: all join by code; ending writes the records in < 2 s', async () => {
    const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(agent).send({ mode: 'live', settings: { classId: cls.classId, showLeaderboard: false } })).body;
    const host = await connect(t.url);
    await emit(host, 'host_attach', { gameId: g.gameId, hostKey: new URL(g.hostUrl).hash.slice(5) });
    const players: Client[] = await Promise.all(
      cls.created.map(async (c) => {
        const id = await t.http.post('/play/roster/identify').send({ pin: g.pin, code: c.code });
        const p = await connect(t.url);
        const j = await emit(p, 'join', { pin: g.pin, ticket: id.body.ticket });
        expect(j.ok).toBe(true);
        return p;
      }),
    );
    for (let round = 0; round < 3; round++) {
      const qs = players.map((p) => once<{ question: { id: string } }>(p, 'question'));
      await emit(host, round === 0 ? 'start' : 'next');
      const evs = await Promise.all(qs);
      await Promise.all(players.map((p, i) => emit(p, 'answer', { questionId: evs[i]!.question.id, payload: { indices: [0] } })));
      await emit(host, 'reveal');
      await sleep(20);
    }
    const t0 = performance.now();
    await emit(host, 'end');
    const ms = performance.now() - t0;
    expect(results(g.gameId).n).toBe(N);
    expect(ms).toBeLessThan(2000);
    [host, ...players].forEach((s) => s.disconnect());
  }, 60_000);
});
