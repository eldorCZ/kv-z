import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertActivity, type SeedItem } from '../src/classes/seed.js';
import { apiToken, classWithStudents, startApp, teacher, type TestApp } from './helpers.js';

let t: TestApp;
let sess: { cookie: string; csrf: string };
let agent: { authorization: string };
let pii: { authorization: string };

const quiz = {
  schemaVersion: 1,
  title: 'Agent',
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'Q1', options: ['a', 'b', 'c'], correctIndices: [0], topic: 'Lom světla' },
    { type: 'truefalse', prompt: 'Q2', correctIndices: [0], topic: 'Zrcadla' },
  ],
};

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000, joinRateLimit: 10_000 });
  sess = await teacher(t);
  agent = { authorization: `Bearer ${(await apiToken(t, sess)).token}` };
  pii = { authorization: `Bearer ${(await apiToken(t, sess, ['games:read', 'results:pii'])).token}` };
});
afterAll(async () => t.close());

const NAMES = ['Adámek Aleš', 'Bílá Běla', 'Cibulka Cyril', 'Dušková Dana', 'Egerová Eva', 'Fousek František'];

/** Recursively collects every key and string value. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      strings(x, out);
    }
  return out;
}
const leaks = (body: unknown, words: string[]) => strings(body).filter((s) => words.some((w) => s.includes(w)));

describe('agent API for classes (C10.3)', () => {
  it('summary: aggregates only, small groups are null', async () => {
    const cls = await classWithStudents(t, sess, NAMES, '9.B');
    const ids = cls.created.map((c) => c.student.id);
    const db = t.services.db.$client;
    const items = (ok: number): SeedItem[] => [0, 1, 2, 3, 4].map((i) => ({ topic: i < 3 ? 'Lom světla' : 'Zrcadla', prompt: `Otázka ${i}`, questionId: `x${i}`, scoreMilli: i < ok ? 1000 : 0 }));
    const base = Date.now();
    insertActivity(db, { classId: cls.classId, kind: 'test', label: 'Test A', playedAt: base + 1000, rosterSize: 6, results: ids.map((id, i) => ({ studentId: id, percent: 50 + i * 10, items: items(i % 5) })) });
    insertActivity(db, { classId: cls.classId, kind: 'quiz', label: 'Kvíz B', playedAt: base + 2000, rosterSize: 6, results: ids.slice(0, 2).map((id) => ({ studentId: id, percent: 80 })) });

    const res = await t.http.get(`/api/v1/classes/${cls.classId}/summary`).set(agent);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ className: '9.B', activeStudents: 6, testAvg: 75, participationRate: expect.any(Number), notes: [] });
    expect(res.body.activities[0]).toMatchObject({ label: 'Test A', kind: 'test', n: 6, avgPercent: 75, medianPercent: 75, participationRate: 100 });
    // only 2 results -> small group
    expect(res.body.activities[1]).toMatchObject({ label: 'Kvíz B', n: 2, avgPercent: null, medianPercent: null, note: 'malá skupina' });
    expect(res.body.quizAvg).toBeNull(); // only 2 students have a quiz average
    // Zrcadla has only 12 answers (< 3 * MIN_TOPIC_ITEMS) and is left out
    expect(res.body.weakTopics.map((x: { topic: string }) => x.topic)).toEqual(['Lom světla']);
    expect(res.body.weakQuestions[0]).toMatchObject({ questionId: 'x4', successRate: 0, answers: 6 });
    // nothing personal
    expect(leaks(res.body, [...NAMES.flatMap((n) => n.split(' ')), ...ids, ...cls.created.map((c) => c.code)])).toEqual([]);

    // a period without activities
    const empty = await t.http.get(`/api/v1/classes/${cls.classId}/summary?from=2099-01-01`).set(agent);
    expect(empty.body.activities).toEqual([]);
    expect((await t.http.get(`/api/v1/classes/${cls.classId}/summary?from=bad`).set(agent)).status).toBe(400);
  });

  it('a class below MIN_AGGREGATE_STUDENTS returns nulls with a note', async () => {
    const cls = await classWithStudents(t, sess, NAMES.slice(0, 3), 'Malá');
    insertActivity(t.services.db.$client, { classId: cls.classId, kind: 'test', label: 'T', playedAt: Date.now() + 1000, rosterSize: 3, results: cls.created.map((c) => ({ studentId: c.student.id, percent: 90 })) });
    const res = await t.http.get(`/api/v1/classes/${cls.classId}/summary`).set(agent);
    expect(res.body).toMatchObject({ testAvg: null, quizAvg: null, participationRate: null, weakTopics: [], weakQuestions: [] });
    expect(res.body.activities[0]).toMatchObject({ n: 3, avgPercent: null, participationRate: null });
    expect(res.body.notes[0]).toContain('malá skupina');
  });

  it('permissions: scope, foreign teacher, no individual endpoints for tokens', async () => {
    const cls = await classWithStudents(t, sess, NAMES.slice(0, 2), 'Práva');
    const noClasses = { authorization: `Bearer ${(await apiToken(t, sess, ['quizzes:read'])).token}` };
    expect((await t.http.get(`/api/v1/classes/${cls.classId}/summary`).set(noClasses)).status).toBe(403);
    const other = await teacher(t);
    const otherToken = { authorization: `Bearer ${(await apiToken(t, other)).token}` };
    expect((await t.http.get(`/api/v1/classes/${cls.classId}/summary`).set(otherToken)).status).toBe(404);
    const sid = cls.created[0]!.student.id;
    for (const path of [``, `/matrix`, `/students/${sid}/profile`, `/students/${sid}/export.csv`, `/export.csv`, `/topics`, `/activities`, `/access-log`]) {
      expect((await t.http.get(`/api/v1/classes/${cls.classId}${path}`).set(agent)).status, path).toBe(403);
    }
    const list = await t.http.get('/api/v1/classes').set(agent);
    expect(leaks(list.body, NAMES.flatMap((n) => n.split(' ')))).toEqual([]);
  });

  it('GET /topics lists the teacher topics', async () => {
    await t.http.post('/api/v1/quizzes').set(agent).send(quiz);
    const r = await t.http.get('/api/v1/topics').set(agent);
    expect(r.body.topics).toEqual(['Lom světla', 'Zrcadla']);
  });

  it('class game results: "Žák N" without results:pii, full names with it, CSV too', async () => {
    const cls = await classWithStudents(t, sess, ['Horák Hugo', 'Ivanová Iva'], 'Výsledky');
    const quizId = (await t.http.post('/api/v1/quizzes').set(agent).send(quiz)).body.quizId;
    const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(agent).send({ mode: 'test', settings: { classId: cls.classId } })).body;
    expect(g.gameId).toBeTruthy();
    for (const c of cls.created) {
      const ticket = (await t.http.post('/play/roster/identify').send({ pin: g.pin, code: c.code })).body.ticket;
      const token = (await t.http.post('/play/test/join').send({ pin: g.pin, ticket })).body.playerToken;
      await t.http.post('/play/test/start').set('x-player-token', token);
      await t.http.post('/play/test/submit').set('x-player-token', token);
    }
    const anon = await t.http.get(`/api/v1/games/${g.gameId}/results`).set(agent);
    expect(anon.body.students.map((s: { student: string }) => s.student)).toEqual(['Žák 1', 'Žák 2']);
    expect(leaks(anon.body, ['Horák', 'Hugo', 'Iva', 'Ivanová'])).toEqual([]);
    const csv = await t.http.get(`/api/v1/games/${g.gameId}/results.csv`).set(agent);
    expect(csv.text).not.toContain('Hugo');
    expect(csv.text).toContain('Žák 1');
    const named = await t.http.get(`/api/v1/games/${g.gameId}/results`).set(pii);
    expect(named.body.students.map((s: { student: string }) => s.student).sort()).toEqual(['Horák Hugo', 'Ivanová Iva']);

    // live class game: ranking without names for the agent
    const live = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(agent).send({ mode: 'live', settings: { classId: cls.classId } })).body;
    t.services.db.$client
      .prepare("INSERT INTO players (id, game_id, nickname, token_hash, joined_at, student_id, is_guest) VALUES ('pl1', ?, 'Hugo H.', 'x', ?, ?, 0)")
      .run(live.gameId, Date.now(), cls.created[0]!.student.id);
    const lr = await t.http.get(`/api/v1/games/${live.gameId}/results`).set(agent);
    expect(lr.body.ranking.map((r: { nickname: string }) => r.nickname)).toEqual(['Žák 1']);
    const ui1 = await t.http.get(`/api/v1/games/${live.gameId}/results`).set('cookie', sess.cookie);
    expect(ui1.body.ranking[0].nickname).toBe('Horák Hugo');
  });
});
