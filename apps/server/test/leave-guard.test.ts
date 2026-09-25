import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiToken, startApp, teacher, type TestApp } from './helpers.js';

const clock = { t: Date.parse('2026-11-02T08:00:00Z') };
let t: TestApp;
let session: { cookie: string; csrf: string };
let auth: { authorization: string };
let seq = 0;

const quiz = {
  schemaVersion: 1,
  title: 'Hlídání okna',
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'A?', options: ['ano', 'ne', 'možná'], correctIndices: [0] },
    { type: 'truefalse', prompt: 'B?', correctIndices: [0] },
  ],
};

async function createTest(leaveGuard: Record<string, unknown> = {}, test: Record<string, unknown> = {}) {
  const quizId = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz)).body.quizId as string;
  const r = await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(auth).send({ mode: 'test', settings: { test: { timeLimitMin: 30, leaveGuard, ...test } } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { gameId: string; pin: string };
}

async function student(pin: string, name = `Žák ${Math.random().toString(36).slice(2, 8)}`) {
  const j = await t.http.post('/play/test/join').send({ pin, name: `Test ${name}` });
  const token = j.body.playerToken as string;
  const st = await t.http.post('/play/test/start').set('x-player-token', token);
  return { token, questions: st.body.questions as { id: string; options: string[] }[] };
}

const ev = (token: string, events: object[]) => t.http.post('/play/test/events').set('x-player-token', token).send({ events });
const leaveStart = (token: string, reason = 'hidden') => ev(token, [{ type: 'leave_start', reason, clientTs: 1, seq: ++seq }]);
const leaveEnd = (token: string) => ev(token, [{ type: 'leave_end', clientTs: 2, seq: ++seq }]);
const hb = (token: string, body: object = { visible: true, focused: true, fullscreen: false }) => t.http.post('/play/test/heartbeat').set('x-player-token', token).send(body);
async function leave(token: string, ms: number) {
  await leaveStart(token);
  clock.t += ms;
  await leaveEnd(token);
}
const dashboard = async (gameId: string) => (await t.http.get(`/api/v1/games/${gameId}/dashboard`).set('cookie', session.cookie)).body;
const teacherPost = (path: string, body: object = {}) => t.http.post(path).set('cookie', session.cookie).set('x-csrf-token', session.csrf).send(body);

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000, joinRateLimit: 10_000, heartbeatGapSec: 25 }, { now: () => clock.t });
  session = await teacher(t);
  auth = { authorization: `Bearer ${(await apiToken(t, session)).token}` };
});
afterAll(async () => t.close());

describe('counting by server time (G4.3)', () => {
  it('counts leaves >= minLeaveMs using server receive times, ignores shorter ones', async () => {
    const g = await createTest({ minLeaveMs: 1000 });
    const s = await student(g.pin);
    await leave(s.token, 400); // too short
    await leave(s.token, 2500);
    const h = await hb(s.token);
    expect(h.body).toMatchObject({ leaveCount: 1, maxLeaves: 2, locked: false, guardExempt: false });
    const row = (await dashboard(g.gameId)).students[0];
    expect(row).toMatchObject({ leaveCount: 1, leaveTotal: 1, awaySec: 3, locked: false });
    // clientTs is recorded but never used for the duration
    const d = await t.http.get(`/api/v1/games/${g.gameId}/attempts/${row.attemptId}`).set('cookie', session.cookie);
    expect(d.body.events).toEqual([
      expect.objectContaining({ type: 'leave', reason: 'hidden', durationSec: 0.4, counted: false }),
      expect.objectContaining({ type: 'leave', reason: 'hidden', durationSec: 2.5, counted: true }),
    ]);
  });

  it('an open leave counts as soon as it lasts minLeaveMs (lazy and by the 5 s job)', async () => {
    const g = await createTest({ minLeaveMs: 1000 });
    const s = await student(g.pin);
    await leaveStart(s.token, 'blur');
    clock.t += 1500;
    t.services.testService.tick();
    expect((await dashboard(g.gameId)).students[0].leaveCount).toBe(1);
    clock.t += 1500;
    await leaveEnd(s.token);
    const row = (await dashboard(g.gameId)).students[0];
    expect(row).toMatchObject({ leaveCount: 1, awaySec: 3 }); // counted once, duration added at the end
  });

  it('is idempotent by seq and treats overlapping starts as one leave', async () => {
    const g = await createTest();
    const s = await student(g.pin);
    const start = { type: 'leave_start', reason: 'blur', clientTs: 5, seq: 1000 };
    await ev(s.token, [start]);
    await ev(s.token, [start]); // duplicate delivery
    await ev(s.token, [{ type: 'leave_start', reason: 'hidden', clientTs: 6, seq: 1001 }]); // overlapping reason
    clock.t += 2000;
    const end = { type: 'leave_end', clientTs: 7, seq: 1002 };
    await ev(s.token, [end]);
    await ev(s.token, [end]);
    const row = (await dashboard(g.gameId)).students[0];
    expect(row.leaveCount).toBe(1);
    const d = await t.http.get(`/api/v1/games/${g.gameId}/attempts/${row.attemptId}`).set('cookie', session.cookie);
    expect(d.body.events).toHaveLength(1);
    expect(d.body.events[0].reason).toBe('blur');
  });

  it('accepts sendBeacon with playerToken in the body', async () => {
    const g = await createTest();
    const s = await student(g.pin);
    const r = await t.http.post('/play/test/events').send({ playerToken: s.token, events: [{ type: 'leave_start', reason: 'hidden', clientTs: 1, seq: ++seq }] });
    expect(r.status).toBe(204);
    clock.t += 1500;
    await leaveEnd(s.token);
    expect((await dashboard(g.gameId)).students[0].leaveCount).toBe(1);
  });
});

describe('reactions (G4.5)', () => {
  it('notify: over the limit only highlights the row, the attempt keeps running', async () => {
    const g = await createTest({ maxLeaves: 1, onExceed: 'notify' });
    const s = await student(g.pin);
    await leave(s.token, 1500);
    expect((await dashboard(g.gameId)).students[0].overLimit).toBe(false);
    await leave(s.token, 1500);
    const row = (await dashboard(g.gameId)).students[0];
    expect(row).toMatchObject({ overLimit: true, locked: false });
    expect((await t.http.put(`/play/test/answers/${s.questions[0]!.id}`).set('x-player-token', s.token).send({ payload: { indices: [0] } })).status).toBe(200);
  });

  it('lock: (maxLeaves+1). leave locks, server enforces 423, deadline unchanged; unlock with compensation resets leave_count', async () => {
    const g = await createTest({ maxLeaves: 1, onExceed: 'lock' });
    const s = await student(g.pin);
    const before = (await hb(s.token)).body.remainingSec as number;
    await t.http.put(`/play/test/answers/${s.questions[0]!.id}`).set('x-player-token', s.token).send({ payload: { indices: [0] } });
    await leave(s.token, 1500);
    expect((await hb(s.token)).body.locked).toBe(false);
    await leave(s.token, 1500);
    const h = await hb(s.token);
    expect(h.body.locked).toBe(true);
    expect(h.body.remainingSec).toBe(before - 3); // time keeps running, no extra time
    const get = await t.http.get('/play/test/attempt').set('x-player-token', s.token);
    expect(get.status).toBe(423);
    expect(get.body.error).toMatch(/zamčený/);
    expect(JSON.stringify(get.body)).not.toContain('questions');
    expect((await t.http.put(`/play/test/answers/${s.questions[1]!.id}`).set('x-player-token', s.token).send({ payload: { indices: [0] } })).status).toBe(423);
    expect((await t.http.post('/play/test/submit').set('x-player-token', s.token)).status).toBe(423);
    const dash = await dashboard(g.gameId);
    expect(dash.counts.locked).toBe(1);
    expect((await t.http.get(`/api/v1/games/${g.gameId}`).set(auth)).body.counts.locked).toBe(1);
    const aid = dash.students[0].attemptId;
    // API tokens cannot unlock (G7)
    expect((await t.http.post(`/api/v1/games/${g.gameId}/attempts/${aid}/unlock`).set(auth).send({})).status).toBe(403);
    expect((await teacherPost(`/api/v1/games/${g.gameId}/attempts/${aid}/unlock`, { extraMinutes: 5 })).status).toBe(200);
    const after = await hb(s.token);
    expect(after.body).toMatchObject({ locked: false, leaveCount: 0 });
    expect(after.body.remainingSec).toBe(before - 3 + 300);
    const row = (await dashboard(g.gameId)).students[0];
    expect(row).toMatchObject({ leaveTotal: 2, awaySec: 3 }); // totals and events stay
    expect((await t.http.get('/play/test/attempt').set('x-player-token', s.token)).status).toBe(200);
    // maxLeaves applies again from zero
    await leave(s.token, 1500);
    expect((await hb(s.token)).body.locked).toBe(false);
  });

  it('log mode records without locking; off mode records nothing', async () => {
    const g = await createTest({ mode: 'log', maxLeaves: 0, onExceed: 'lock' });
    const s = await student(g.pin);
    await leave(s.token, 1500);
    expect((await hb(s.token)).body).toMatchObject({ leaveCount: 1, locked: false });
    const off = await createTest({ mode: 'off' });
    const s2 = await student(off.pin);
    await leave(s2.token, 1500);
    expect((await dashboard(off.gameId)).students[0]).toMatchObject({ leaveTotal: 0 });
  });
});

describe('exemption, gaps, submitted attempts', () => {
  it('guard exemption: events are ignored, heartbeat says guardExempt', async () => {
    const g = await createTest({ maxLeaves: 0, onExceed: 'lock' });
    const s = await student(g.pin);
    const aid = (await dashboard(g.gameId)).students[0].attemptId;
    await teacherPost(`/api/v1/games/${g.gameId}/attempts/${aid}/exempt`, { exempt: true });
    await leave(s.token, 5000);
    expect((await hb(s.token)).body).toMatchObject({ guardExempt: true, locked: false, leaveCount: 0 });
    const d = await t.http.get(`/api/v1/games/${g.gameId}/attempts/${aid}`).set('cookie', session.cookie);
    expect(d.body.events).toEqual([]);
  });

  it('heartbeat gaps are stored as unconfirmed, never counted and never lock', async () => {
    const g = await createTest({ maxLeaves: 0, onExceed: 'lock' });
    const s = await student(g.pin);
    await hb(s.token);
    clock.t += 60_000;
    const h = await hb(s.token);
    expect(h.body).toMatchObject({ locked: false, leaveCount: 0 });
    const row = (await dashboard(g.gameId)).students[0];
    expect(row).toMatchObject({ unconfirmedGap: true, leaveCount: 0 });
    // a gap overlapping a reported leave is not shown separately
    const s2 = await student(g.pin);
    await hb(s2.token);
    await leaveStart(s2.token);
    clock.t += 60_000;
    await hb(s2.token);
    const row2 = (await dashboard(g.gameId)).students.find((x: { attemptId: string }) => x.attemptId !== row.attemptId);
    expect(row2.unconfirmedGap).toBe(false);
  });

  it('submitted attempts ignore events; percent is never reduced by leaving', async () => {
    const g = await createTest({ maxLeaves: 0, onExceed: 'notify' });
    const s = await student(g.pin);
    await t.http.put(`/play/test/answers/${s.questions[0]!.id}`).set('x-player-token', s.token).send({ payload: { indices: [0] } });
    await t.http.put(`/play/test/answers/${s.questions[1]!.id}`).set('x-player-token', s.token).send({ payload: { indices: [0] } });
    await leave(s.token, 10_000);
    await leave(s.token, 10_000);
    const sub = await t.http.post('/play/test/submit').set('x-player-token', s.token);
    expect(sub.body.result.percent).toBe(100);
    expect((await leaveStart(s.token)).status).toBe(204);
    const row = (await dashboard(g.gameId)).students[0];
    expect(row).toMatchObject({ leaveTotal: 2, percent: 100 });
    const res = await t.http.get(`/api/v1/games/${g.gameId}/results`).set(auth);
    expect(res.body.summary.leaveFlagged).toBe(1);
    expect(res.body.students[0]).toMatchObject({ leaveCount: 2, awaySec: 20, locked: false, percent: 100 });
    const csv = await t.http.get(`/api/v1/games/${g.gameId}/results.csv`).set('cookie', session.cookie);
    expect(csv.text).toContain('Počet opuštění okna;Doba mimo okno (s);Zamčeno');
    expect(csv.text).toMatch(/;100;odevzdáno;[^;]+;2;20;ne/);
  });

  it('reopening and allowing a return keep leave_count (G4.7)', async () => {
    const g = await createTest({ maxLeaves: 5 });
    const s = await student(g.pin);
    await leave(s.token, 1500);
    await t.http.post('/play/test/submit').set('x-player-token', s.token);
    const aid = (await dashboard(g.gameId)).students[0].attemptId;
    await teacherPost(`/api/v1/games/${g.gameId}/attempts/${aid}/reopen`, { minutes: 5 });
    await teacherPost(`/api/v1/games/${g.gameId}/attempts/${aid}/allow-return`);
    expect((await dashboard(g.gameId)).students[0].leaveCount).toBe(1);
  });

  it('student responses stay whitelisted (D11)', async () => {
    const g = await createTest();
    const s = await student(g.pin);
    const h = await hb(s.token);
    expect(Object.keys(h.body).sort()).toEqual(['guardExempt', 'leaveCount', 'locked', 'maxLeaves', 'remainingSec', 'serverTimeMs', 'status']);
    const view = await t.http.get('/play/test/attempt').set('x-player-token', s.token);
    expect(JSON.stringify(view.body)).not.toMatch(/correctIndices|acceptedAnswers|explanation|sourceRef|awayTotal|events/);
  });

  it('rate limits guard requests per token', async () => {
    const g = await createTest();
    const s = await student(g.pin);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await ev(s.token, [])).status);
    expect(codes).toContain(429);
  });
});
