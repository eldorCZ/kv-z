import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertActivity } from '../src/classes/seed.js';
import { runRetention } from '../src/retention.js';
import { classWithStudents, startApp, teacher, ui, type TestApp } from './helpers.js';

const quiz = {
  schemaVersion: 1,
  title: 'Soukromí',
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'Otázka 1', options: ['a', 'b', 'c'], correctIndices: [0], topic: 'Téma' },
    { type: 'truefalse', prompt: 'Otázka 2', correctIndices: [0], topic: 'Téma' },
  ],
};

let log = '';
let t: TestApp;
let sess: { cookie: string; csrf: string };
const silent = { info: () => undefined } as unknown as Parameters<typeof runRetention>[1];

beforeAll(async () => {
  const stream = new Writable({
    write(chunk, _enc, cb) {
      log += String(chunk);
      cb();
    },
  });
  t = await startApp({ logLevel: 'debug', apiRateLimit: 10_000, joinRateLimit: 10_000 }, { logStream: stream });
  sess = await teacher(t);
});
afterAll(async () => t.close());

const db = () => t.services.db.$client;
const count = (sql: string, ...args: unknown[]) => (db().prepare(sql).get(...args) as { n: number }).n;

async function classTest(names: string[], name: string) {
  const cls = await classWithStudents(t, sess, names, name);
  const quizId = (await t.http.post('/api/v1/quizzes').set(ui(sess)).send(quiz)).body.quizId;
  const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(ui(sess)).send({ mode: 'test', settings: { classId: cls.classId, label: 'Písemka' } })).body;
  for (const c of cls.created) {
    const ticket = (await t.http.post('/play/roster/identify').send({ pin: g.pin, code: c.code })).body.ticket;
    const token = (await t.http.post('/play/test/join').send({ pin: g.pin, ticket })).body.playerToken;
    const qs = (await t.http.post('/play/test/start').set('x-player-token', token)).body.questions;
    await t.http.put(`/play/test/answers/${qs[0].id}`).set('x-player-token', token).send({ payload: { indices: [0] } });
    await t.http.post('/play/test/submit').set('x-player-token', token);
  }
  return { ...cls, gameId: g.gameId as string, pin: g.pin as string, activityId: t.services.gameRepo.get(g.gameId)!.activityId! };
}

describe('personal data (C9)', () => {
  it('erasing a student removes the name and code; results stay only as class aggregates', async () => {
    const c = await classTest(['hruba1', 'kratochvil2', 'lizalova3'], 'Výmaz');
    const hana = c.created[0]!.student.id;
    expect(count('SELECT count(*) n FROM activity_results WHERE activity_id = ?', c.activityId)).toBe(3);
    const del = await t.http.delete(`/api/v1/classes/${c.classId}/students/${hana}`).set(ui(sess));
    expect(del.status).toBe(204);
    expect(count('SELECT count(*) n FROM students WHERE id = ?', hana)).toBe(0);
    // the result is kept but unlinked; the class average does not change
    expect(count('SELECT count(*) n FROM activity_results WHERE activity_id = ? AND student_id IS NULL', c.activityId)).toBe(1);
    const acts = (await t.http.get(`/api/v1/classes/${c.classId}/activities`).set('cookie', sess.cookie)).body.activities;
    expect(acts[0].stats.n).toBe(3);
    // the player name in the game results is replaced
    const players = db().prepare('SELECT nickname FROM players WHERE game_id = ? ORDER BY joined_at').all(c.gameId) as { nickname: string }[];
    expect(players.map((p) => p.nickname)).toEqual(['Žák 1', 'kratochvil2', 'lizalova3']);
    const dump = JSON.stringify(db().prepare('SELECT * FROM players').all()) + JSON.stringify(db().prepare('SELECT * FROM students').all());
    expect(dump).not.toContain('hruba1');
    // the old code no longer works
    const r = await t.http.post('/play/roster/identify').send({ pin: c.pin, code: c.created[0]!.code });
    expect(r.body.ticket).toBeUndefined();
    const logRows = (await t.http.get(`/api/v1/classes/${c.classId}/access-log`).set('cookie', sess.cookie)).body.entries as { action: string; studentId: string | null }[];
    expect(logRows.find((e) => e.action === 'student_erase')).toMatchObject({ studentId: null });
  });

  it('retention anonymises the class after the school year + CLASS_RETENTION_MONTHS and trims the access log', async () => {
    const c = await classTest(['malik1', 'nova2', 'oravcova3'], 'Retence');
    const cls = t.services.classes.assertClassAccess((await t.http.get('/api/auth/me').set('cookie', sess.cookie)).body.teacher.id, c.classId, 'viewer');
    const at = t.services.classes.anonymizeAt(cls);
    expect(new Date(at).toISOString().slice(0, 7)).toBe(`${Number(cls.schoolYearEnd.slice(0, 4)) + 1}-08`);

    runRetention(t.services, silent, at - 1000);
    expect(count('SELECT count(*) n FROM students WHERE class_id = ?', c.classId)).toBe(3);

    runRetention(t.services, silent, at + 1000);
    expect(count('SELECT count(*) n FROM students WHERE class_id = ?', c.classId)).toBe(0);
    expect(count('SELECT count(*) n FROM activity_results WHERE activity_id = ? AND student_id IS NULL', c.activityId)).toBe(3);
    expect(count('SELECT count(*) n FROM result_items i JOIN activity_results r ON r.id = i.activity_result_id WHERE r.activity_id = ?', c.activityId)).toBeGreaterThan(0);
    const players = db().prepare('SELECT nickname FROM players WHERE game_id = ?').all(c.gameId) as { nickname: string }[];
    expect(players.every((p) => /^Žák \d+$/.test(p.nickname))).toBe(true);
    // aggregates stay usable
    const acts = (await t.http.get(`/api/v1/classes/${c.classId}/activities`).set('cookie', sess.cookie)).body.activities;
    expect(acts[0].stats).toMatchObject({ n: 3 });

    // access log older than ACCESS_LOG_RETENTION_MONTHS (24) is deleted
    const before = count('SELECT count(*) n FROM access_log WHERE class_id = ?', c.classId);
    expect(before).toBeGreaterThan(0);
    runRetention(t.services, silent, Date.now() + 25 * 31 * 86_400_000);
    expect(count('SELECT count(*) n FROM access_log WHERE class_id = ?', c.classId)).toBe(0);
  });

  it('deleting a class removes the records; games stay without names', async () => {
    const c = await classTest(['pesek1', 'rybova2', 'sokol3'], 'Smazat');
    insertActivity(db(), { classId: c.classId, kind: 'quiz', label: 'Navíc', playedAt: Date.now(), rosterSize: 3, results: [{ studentId: c.created[0]!.student.id, percent: 50 }] });
    const del = await t.http.delete(`/api/v1/classes/${c.classId}`).set(ui(sess)).send({ confirmName: 'Smazat' });
    expect(del.status).toBe(204);
    expect(count('SELECT count(*) n FROM class_activities WHERE class_id = ?', c.classId)).toBe(0);
    expect(count('SELECT count(*) n FROM activity_results WHERE activity_id = ?', c.activityId)).toBe(0);
    expect(count('SELECT count(*) n FROM access_log WHERE class_id = ?', c.classId)).toBe(0);
    expect(t.services.gameRepo.get(c.gameId)).toMatchObject({ classId: null });
    const players = db().prepare('SELECT nickname FROM players WHERE game_id = ?').all(c.gameId) as { nickname: string }[];
    expect(players.every((p) => /^Žák \d+$/.test(p.nickname))).toBe(true);
  });

  it('the server log contains no account names and no codes (C9.8)', async () => {
    log = '';
    const c = await classTest(['zelenkova77', 'vrba88', 'ulrichova99'], 'Logy');
    await t.http.post('/play/roster/identify').send({ pin: c.pin, code: 'AAAA-BBBB' });
    await t.http.get(`/api/v1/games/${c.gameId}/dashboard`).set('cookie', sess.cookie);
    await t.http.post('/play/roster/identify').send({ pin: c.pin, code: c.created[0]!.code });
    await t.http.get(`/api/v1/classes/${c.classId}/matrix`).set('cookie', sess.cookie);
    await t.http.get(`/api/v1/classes/${c.classId}/students/${c.created[0]!.student.id}/profile`).set('cookie', sess.cookie);
    await t.http.get(`/api/v1/classes/${c.classId}/export.csv`).set('cookie', sess.cookie);
    const rot = await t.http.post(`/api/v1/classes/${c.classId}/rotate-all`).set(ui(sess));
    expect(log.length).toBeGreaterThan(1000); // the log really was captured
    for (const word of ['zelenkova77', 'vrba88', 'ulrichova99', 'AAAA']) expect(log).not.toContain(word);
    for (const x of [...c.created, ...rot.body.created] as { code: string }[]) {
      expect(log).not.toContain(x.code);
      expect(log).not.toContain(x.code.replace('-', ''));
    }
  });
});
