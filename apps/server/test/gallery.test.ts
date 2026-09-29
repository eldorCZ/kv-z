import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiToken, classWithStudents, startApp, teacher, ui, type TestApp } from './helpers.js';

/** Gallery data in GET /api/v1/quizzes (Dodatek 5): tags, mean success of finished games, classes. */
let t: TestApp;
let sess: { cookie: string; csrf: string };
let auth: { authorization: string };

const quiz = {
  schemaVersion: 1,
  title: 'Galerie',
  tags: ['Fyzika', 'Optika'],
  questions: [
    { type: 'single', prompt: 'Kolik je 1 + 1?', options: ['2', '3', '4'], correctIndices: [0] },
    { type: 'single', prompt: 'Kolik je 2 + 2?', options: ['3', '4', '5'], correctIndices: [1] },
  ],
};

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000, joinRateLimit: 10_000 });
  sess = await teacher(t);
  auth = { authorization: `Bearer ${(await apiToken(t, sess)).token}` };
});
afterAll(async () => t.close());

const item = async (id: string) => ((await t.http.get('/api/v1/quizzes').set(auth)).body.quizzes as { id: string }[]).find((q) => q.id === id) as Record<string, unknown>;

describe('quiz list for the gallery', () => {
  it('a new quiz has its tags, no success and no classes', async () => {
    const id = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz)).body.quizId;
    expect(await item(id)).toMatchObject({ tags: ['Fyzika', 'Optika'], avgSuccess: null, classes: [] });
  });

  it('a finished test counts the mean percent; running games do not count', async () => {
    const id = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz)).body.quizId;
    const g = (await t.http.post(`/api/v1/quizzes/${id}/games`).set(auth).send({ mode: 'test', settings: { test: { timeLimitMin: 10 } } })).body;
    for (const [name, right] of [
      ['Anna', 2],
      ['Bob', 1],
    ] as const) {
      const token = (await t.http.post('/play/test/join').send({ pin: g.pin, name })).body.playerToken;
      const view = (await t.http.post('/play/test/start').set('x-player-token', token)).body;
      for (const [i, q] of (view.questions as { id: string; options: string[] }[]).entries()) {
        const want = q.options.indexOf(i === 0 ? '2' : '4');
        const pick = i < right ? want : (want + 1) % 3;
        await t.http.put(`/play/test/answers/${q.id}`).set('x-player-token', token).send({ payload: { indices: [pick] } });
      }
      await t.http.post('/play/test/submit').set('x-player-token', token);
    }
    expect((await item(id)).avgSuccess).toBeNull();
    await t.http.post(`/api/v1/games/${g.gameId}/end`).set(auth);
    expect((await item(id)).avgSuccess).toBe(75);
  });

  it('a finished live game counts correct answers out of players × played questions', async () => {
    const id = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz)).body.quizId;
    const db = t.services.db.$client;
    const tid = (await t.http.get('/api/auth/me').set('cookie', sess.cookie)).body.teacher.id;
    const row = db.prepare('SELECT id FROM questions WHERE quiz_id = ? ORDER BY position').all(id) as { id: string }[];
    db.prepare(
      `INSERT INTO games (id, quiz_id, teacher_id, mode, pin, host_key_hash, status, settings_json, question_ids_json, created_at, played_json)
       VALUES ('live1', ?, ?, 'live', '000001', 'x', 'finished', '{}', ?, 0, ?)`,
    ).run(id, tid, JSON.stringify(row.map((r) => r.id)), JSON.stringify(row.map((r) => r.id)));
    for (const p of ['p1', 'p2']) db.prepare(`INSERT INTO players (id, game_id, nickname, token_hash, joined_at) VALUES (?, 'live1', ?, ?, 0)`).run(p, p, p);
    // 3 of 4 possible answers correct, one missing
    const ins = db.prepare(`INSERT INTO answers (id, game_id, player_id, question_id, payload_json, correct, points, elapsed_ms) VALUES (?, 'live1', ?, ?, '{}', ?, 0, 0)`);
    ins.run('a1', 'p1', row[0]!.id, 1);
    ins.run('a2', 'p1', row[1]!.id, 1);
    ins.run('a3', 'p2', row[0]!.id, 1);
    expect((await item(id)).avgSuccess).toBe(75);
  });

  it('lists the classes the quiz was played in', async () => {
    const id = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz)).body.quizId;
    const cls = await classWithStudents(t, sess, ['novak12'], '8.A Fyzika');
    const r = await t.http.post(`/api/v1/quizzes/${id}/games`).set(ui(sess)).send({ mode: 'live', settings: { classId: cls.classId } });
    expect(r.status).toBe(201);
    expect((await item(id)).classes).toEqual([{ id: cls.classId, name: '8.A Fyzika' }]);
  });
});
