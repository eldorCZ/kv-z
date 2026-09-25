import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertActivity, type SeedItem } from '../src/classes/seed.js';
import { apiToken, classWithStudents, startApp, teacher, ui, type TestApp } from './helpers.js';

let t: TestApp;
let sess: { cookie: string; csrf: string };
let classId: string;
let A: string, B: string, C: string, D: string;
const acts: Record<string, string> = {};

const lom = (scores: number[], offset = 0): SeedItem[] => scores.map((s, i) => ({ topic: 'Lom', prompt: `Otázka ${i + 1 + offset}`, questionId: `q${i + 1 + offset}`, scoreMilli: s }));

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000, minTopicItems: 3 });
  sess = await teacher(t);
  const cls = await classWithStudents(t, sess, ['Adámek Aleš', 'Bílá Běla', 'Cibulka Cyril', 'Dlouhý David'], 'Přehledy');
  classId = cls.classId;
  [A, B, C, D] = cls.created.map((x) => x.student.id) as [string, string, string, string];
  // D joined the class later than every activity -> "–" everywhere
  t.services.db.$client.prepare("UPDATE students SET since = '2099-01-01' WHERE id = ?").run(D);

  const db = t.services.db.$client;
  const base = Date.now();
  const at = (i: number) => base + i * 60_000;
  acts.T1 = insertActivity(db, {
    classId,
    kind: 'test',
    label: 'Test 1',
    playedAt: at(1),
    rosterSize: 3,
    results: [
      { studentId: A, percent: 80, items: lom([1000, 1000, 1000, 1000, 1000]) },
      { studentId: B, percent: 40, items: lom([0, 0, 0, 0, 0]) },
      { studentId: C, percent: 100, items: lom([1000, 1000, 1000, 1000, 0]) },
    ],
  });
  acts.T2 = insertActivity(db, {
    classId,
    kind: 'test',
    label: 'Test 2',
    playedAt: at(2),
    rosterSize: 3,
    results: [
      { studentId: A, percent: 70 },
      { studentId: B, percent: 30, items: lom([0]) },
    ],
  });
  acts.T3 = insertActivity(db, { classId, kind: 'test', label: 'Test 3', playedAt: at(3), rosterSize: 3, results: [{ studentId: A, percent: 50 }, { studentId: C, percent: 100 }] });
  acts.T3m = insertActivity(db, { classId, kind: 'test', label: 'Test 3 – dopsání', playedAt: at(7), rosterSize: 1, rootActivityId: acts.T3, results: [{ studentId: B, percent: 45 }] });
  acts.T4 = insertActivity(db, {
    classId,
    kind: 'test',
    label: 'Test 4',
    playedAt: at(4),
    rosterSize: 3,
    results: [{ studentId: A, percent: 40 }, { studentId: B, percent: 90, excluded: true }, { studentId: C, percent: 100 }],
  });
  acts.Q1 = insertActivity(db, { classId, kind: 'quiz', label: 'Rozcvička', playedAt: at(5), rosterSize: 3, countInStats: false, results: [{ studentId: A, percent: 10 }] });
  acts.Q2 = insertActivity(db, { classId, kind: 'quiz', label: '=Kvíz 2', playedAt: at(6), rosterSize: 3, results: [{ studentId: A, percent: 60 }, { studentId: B, percent: 70 }] });
});
afterAll(async () => t.close());

const get = (path: string) => t.http.get(`/api/v1/classes/${classId}${path}`).set('cookie', sess.cookie);
type Row = { id: string; cells: Record<string, { state: string; percent?: number; makeup?: boolean }>; summary: { testAvg: number | null; quizAvg: number | null; participation: number | null; testTrend: { label: string; delta: number | null }; flags: { rule: string; text: string }[] } };

describe('class overviews (C8)', () => {
  it('matrix: cells, makeups, exclusions, averages, trend, participation and flags', async () => {
    const res = await get('/matrix');
    expect(res.status).toBe(200);
    const m = res.body as { activities: { id: string; counted: boolean; stats: { avg: number | null; n: number } }[]; students: Row[]; classSummary: object };
    expect(m.activities.map((a) => a.id)).toEqual([acts.T1, acts.T2, acts.T3, acts.T4, acts.Q1, acts.Q2]);
    expect(m.activities.find((a) => a.id === acts.Q1)!.counted).toBe(false);
    // makeup counts into the original activity
    expect(m.activities.find((a) => a.id === acts.T3)!.stats).toMatchObject({ n: 3, avg: 65 });
    const row = (id: string) => m.students.find((s) => s.id === id)!;

    expect(row(A).cells[acts.T1!]).toEqual({ state: 'result', percent: 80, makeup: false });
    expect(row(A).summary).toMatchObject({ testAvg: 60, quizAvg: 60, participation: 100, testTrend: { label: 'falling', delta: -30 } });
    expect(row(A).summary.flags.map((f) => f.rule)).toEqual(['falling']);

    expect(row(B).cells[acts.T3!]).toEqual({ state: 'result', percent: 45, makeup: true });
    expect(row(B).cells[acts.T4!]).toMatchObject({ state: 'excluded', percent: 90 });
    expect(row(B).summary).toMatchObject({ testAvg: 38, participation: 100, testTrend: { label: 'little_data' } });
    expect(row(B).summary.flags.map((f) => f.rule)).toEqual(['low_average']);
    expect(row(B).summary.flags[0]!.text).toContain('pod 50 %');

    expect(row(C).cells[acts.T2!]).toEqual({ state: 'missing' });
    expect(row(C).summary).toMatchObject({ testAvg: 100, quizAvg: null, participation: 60 });
    expect(row(C).summary.flags.map((f) => f.rule)).toEqual(['low_participation']);

    expect(Object.values(row(D).cells).every((c) => c.state === 'na')).toBe(true);
    expect(row(D).summary.participation).toBeNull();
    expect(m.classSummary).toEqual({ testAvg: 66, quizAvg: 65, participation: 87 });
  });

  it('filters by kind and period', async () => {
    const q = await get('/matrix?kind=quiz');
    expect(q.body.activities.map((a: { id: string }) => a.id)).toEqual([acts.Q1, acts.Q2]);
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const f = await get(`/matrix?from=${future}`);
    expect(f.body.activities).toEqual([]);
    expect(f.body.period.key).toBe('custom');
    expect((await get('/matrix?from=nesmysl')).status).toBe(400);
  });

  it('activity list, count toggle and result exclusion change the numbers', async () => {
    const list = await get('/activities');
    const t3 = list.body.activities.find((a: { id: string }) => a.id === acts.T3);
    expect(t3.makeups).toHaveLength(1);
    expect(t3.missing).toBe(0);
    expect(t3.gameStatus).toBe('deleted');

    const tog = await t.http.patch(`/api/v1/classes/${classId}/activities/${acts.Q2}`).set(ui(sess)).send({ countInStats: false });
    expect(tog.status).toBe(200);
    const rowA = async () => ((await get('/matrix')).body.students as Row[]).find((s) => s.id === A)!.summary;
    expect((await rowA()).quizAvg).toBeNull();
    await t.http.patch(`/api/v1/classes/${classId}/activities/${acts.Q2}`).set(ui(sess)).send({ countInStats: true });

    const prof = await get(`/students/${A}/profile`);
    const r1 = prof.body.results.find((r: { activityId: string }) => r.activityId === acts.T1);
    await t.http.patch(`/api/v1/classes/${classId}/results/${r1.resultId}`).set(ui(sess)).send({ excluded: true, reason: 'technical' });
    expect((await rowA()).testAvg).toBe(53);
    await t.http.patch(`/api/v1/classes/${classId}/results/${r1.resultId}`).set(ui(sess)).send({ excluded: false });
    expect((await rowA()).testAvg).toBe(60);
  });

  it('topics and weakest questions need enough data', async () => {
    const res = await get('/topics');
    expect(res.body.topics).toEqual([{ topic: 'Lom', items: 16, students: 3, percent: 56 }]);
    expect(res.body.weakQuestions.map((q: { questionId: string; successRate: number }) => [q.questionId, q.successRate])).toEqual([
      ['q5', 33],
      ['q1', 50],
      ['q2', 67],
      ['q3', 67],
      ['q4', 67],
    ]);
  });

  it('student profile: series with class median, topics, repeated mistakes', async () => {
    const res = await get(`/students/${B}/profile`);
    expect(res.status).toBe(200);
    expect(res.body.tests.map((x: { percent: number | null; classMedian: number | null }) => [x.percent, x.classMedian])).toEqual([
      [40, 80],
      [30, 50],
      [45, 50],
      [null, 70],
    ]);
    expect(res.body.topics).toEqual([{ topic: 'Lom', percent: 0, items: 6 }]);
    expect(res.body.mistakes).toEqual([{ prompt: 'Otázka 1', count: 2, topic: 'Lom' }]);
    expect(res.body.results.find((r: { activityId: string }) => r.activityId === acts.T3m)).toMatchObject({ makeup: true, percent: 45 });
  });

  it('topic rename: dry run counts, then renames in records', async () => {
    const dry = await t.http.post(`/api/v1/classes/${classId}/topics/rename`).set(ui(sess)).send({ from: 'Lom', to: 'Optika', dryRun: true });
    expect(dry.body).toEqual({ questions: 0, items: 16 });
    expect((await get('/topics')).body.topics[0].topic).toBe('Lom');
    await t.http.post(`/api/v1/classes/${classId}/topics/rename`).set(ui(sess)).send({ from: 'Lom', to: 'Optika' });
    expect((await get('/topics')).body.topics[0].topic).toBe('Optika');
  });

  it('CSV export: BOM, separator, missing marks and injection guard', async () => {
    const res = await get('/export.csv?sep=;').buffer(true).parse((r, cb) => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (d += c));
      r.on('end', () => cb(null, d));
    });
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['cache-control']).toBe('no-store');
    const text = res.body as string;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines[0]).toMatch(/^Příjmení;Jméno;Číslo;Test 1 /);
    expect(lines[0]).toContain(";'=Kvíz 2");
    const cyril = lines.find((l) => l.startsWith('Cibulka'))!;
    expect(cyril.split(';')[4]).toBe('chybí');
    const student = await get(`/students/${B}/export.csv?sep=,`);
    expect(student.status).toBe(200);
  });

  it('logs access to personal data and keeps overviews session-only', async () => {
    const log = await get('/access-log');
    const actions = (log.body.entries as { action: string }[]).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['matrix_view', 'profile_view', 'export']));
    const token = (await apiToken(t, sess, ['classes:read'])).token;
    expect((await t.http.get(`/api/v1/classes/${classId}/matrix`).set('authorization', `Bearer ${token}`)).status).toBe(403);
    const other = await teacher(t);
    expect((await t.http.get(`/api/v1/classes/${classId}/matrix`).set('cookie', other.cookie)).status).toBe(404);
    expect((await t.http.get(`/api/v1/classes/${classId}/students/${A}/profile`).set('cookie', other.cookie)).status).toBe(404);
  });
});
