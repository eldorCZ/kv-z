import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classWithStudents, startApp, teacher, teacherId, ui, apiToken, type TestApp } from './helpers.js';

let t: TestApp;
let sess: { cookie: string; csrf: string };

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000 });
  sess = await teacher(t);
});
afterAll(async () => t.close());

const NAMES = Array.from({ length: 25 }, (_, i) => `Příjmení${String.fromCharCode(65 + (i % 26))} Jméno${i}`);

describe('classes and roster (C-M1)', () => {
  it('creates a class with the current school year and 25 students; codes are shown once', async () => {
    const { classId, created } = await classWithStudents(t, sess, NAMES);
    expect(created).toHaveLength(25);
    for (const c of created) expect(c.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(new Set(created.map((c) => c.code)).size).toBe(25);
    const detail = await t.http.get(`/api/v1/classes/${classId}`).set('cookie', sess.cookie);
    expect(detail.body.schoolYear).toMatch(/^\d{4}\/\d{4}$/);
    expect(detail.body.students).toHaveLength(25);
    // after the creation response no endpoint returns codes or their hashes
    expect(JSON.stringify(detail.body)).not.toMatch(/code_lookup|codeLookup|"code"/);
    for (const c of created.slice(0, 3)) expect(JSON.stringify(detail.body)).not.toContain(c.code);
  });

  it('the database never contains a plain code (byte search)', async () => {
    const { created } = await classWithStudents(t, sess, ['Novák Petr', 'Dvořák Jan'], 'DB test');
    t.services.db.$client.pragma('wal_checkpoint(TRUNCATE)');
    const bytes = readFileSync(t.services.cfg.dbPath).toString('latin1');
    for (const c of created) {
      expect(bytes).not.toContain(c.code);
      expect(bytes).not.toContain(c.code.replace('-', ''));
    }
  });

  it('rotation invalidates the old code', async () => {
    const { classId, created } = await classWithStudents(t, sess, ['Svoboda Karel'], 'Rotace');
    const sid = created[0]!.student.id;
    expect(t.services.classes.findByCode(classId, created[0]!.code)?.id).toBe(sid);
    const r = await t.http.post(`/api/v1/classes/${classId}/students/${sid}/rotate`).set(ui(sess));
    const fresh = r.body.created[0].code as string;
    expect(fresh).not.toBe(created[0]!.code);
    expect(t.services.classes.findByCode(classId, created[0]!.code)).toBeUndefined();
    expect(t.services.classes.findByCode(classId, fresh.toLowerCase().replace('-', ' '))?.id).toBe(sid);
    // student left -> code refused
    await t.http.post(`/api/v1/classes/${classId}/students/${sid}/leave`).set(ui(sess));
    expect(t.services.classes.findByCode(classId, fresh)).toBeUndefined();
    await t.http.post(`/api/v1/classes/${classId}/students/${sid}/reactivate`).set(ui(sess));
    expect(t.services.classes.findByCode(classId, fresh)?.id).toBe(sid);
  });

  it('preview parses pasted lines and CSV with warnings before anything is written', async () => {
    const c = (await t.http.post('/api/v1/classes').set(ui(sess)).send({ name: 'Náhled' })).body;
    const p = await t.http.post(`/api/v1/classes/${c.id}/students/preview`).set(ui(sess)).send({ text: '1. Nováková Jana\n2. Nováková Jana\nNosková Jana', format: 'lines' });
    expect(p.body.rows.map((r: { publicName: string }) => r.publicName)).toEqual(['Jana N.', 'Jana N. 2', 'Jana N. 3']);
    expect(p.body.warnings[0]).toMatch(/duplicitní/);
    const csv = await t.http.post(`/api/v1/classes/${c.id}/students/preview`).set(ui(sess)).send({ text: 'prijmeni;jmeno;cislo\nČermák;Šimon;4', format: 'csv' });
    expect(csv.body.rows[0]).toMatchObject({ familyName: 'Čermák', givenName: 'Šimon', rosterNo: 4 });
    expect((await t.http.get(`/api/v1/classes/${c.id}`).set('cookie', sess.cookie)).body.students).toHaveLength(0);
  });

  it('validates names and the class size limit', async () => {
    const c = (await t.http.post('/api/v1/classes').set(ui(sess)).send({ name: 'Limity' })).body;
    const bad = await t.http.post(`/api/v1/classes/${c.id}/students`).set(ui(sess)).send({ students: [{ familyName: 'X<script>' }] });
    expect(bad.status).toBe(422);
    const many = await t.http.post(`/api/v1/classes/${c.id}/students`).set(ui(sess)).send({ students: Array.from({ length: 61 }, (_, i) => ({ familyName: `Žák${i}` })) });
    expect(many.status).toBe(422);
  });

  it('roles: viewer reads only, a foreign teacher gets 404, owner-only actions', async () => {
    const { classId, created } = await classWithStudents(t, sess, ['Malá Eva'], 'Role');
    const other = await teacher(t);
    expect((await t.http.get(`/api/v1/classes/${classId}`).set('cookie', other.cookie)).status).toBe(404);
    t.services.db.$client.prepare("INSERT INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, 'viewer')").run(classId, await teacherId(t, other));
    expect((await t.http.get(`/api/v1/classes/${classId}`).set('cookie', other.cookie)).status).toBe(200);
    expect((await t.http.post(`/api/v1/classes/${classId}/students`).set(ui(other)).send({ students: [{ familyName: 'X' }] })).status).toBe(403);
    expect((await t.http.post(`/api/v1/classes/${classId}/students/${created[0]!.student.id}/rotate`).set(ui(other))).status).toBe(403);
    t.services.db.$client.prepare("UPDATE class_teachers SET role = 'editor' WHERE class_id = ? AND teacher_id = ?").run(classId, await teacherId(t, other));
    expect((await t.http.delete(`/api/v1/classes/${classId}/students/${created[0]!.student.id}`).set(ui(other))).status).toBe(403);
    expect((await t.http.delete(`/api/v1/classes/${classId}`).set(ui(other)).send({ confirmName: 'Role' })).status).toBe(403);
    expect((await t.http.get(`/api/v1/classes/${classId}/access-log`).set('cookie', other.cookie)).status).toBe(403);
  });

  it('API tokens only list classes (no names), roster endpoints are UI only', async () => {
    const { classId } = await classWithStudents(t, sess, ['Veselý Adam'], 'Token');
    const tok = (await apiToken(t, sess)).token;
    const list = await t.http.get('/api/v1/classes').set('authorization', `Bearer ${tok}`);
    expect(list.status).toBe(200);
    expect(list.body.classes.find((c: { id: string }) => c.id === classId)).toMatchObject({ name: 'Token', activeStudents: 1 });
    expect(JSON.stringify(list.body)).not.toContain('Veselý');
    expect((await t.http.get(`/api/v1/classes/${classId}`).set('authorization', `Bearer ${tok}`)).status).toBe(403);
    const noScope = (await apiToken(t, sess, ['quizzes:read'])).token;
    expect((await t.http.get('/api/v1/classes').set('authorization', `Bearer ${noScope}`)).status).toBe(403);
  });

  it('access log records roster views, rotations and erasure without names', async () => {
    const { classId, created } = await classWithStudents(t, sess, ['Logová Lenka', 'Druhý Dan'], 'Log');
    await t.http.get(`/api/v1/classes/${classId}`).set('cookie', sess.cookie);
    await t.http.post(`/api/v1/classes/${classId}/students/${created[0]!.student.id}/rotate`).set(ui(sess));
    await t.http.post(`/api/v1/classes/${classId}/log`).set(ui(sess)).send({ action: 'cards_print', count: 2 });
    await t.http.delete(`/api/v1/classes/${classId}/students/${created[1]!.student.id}`).set(ui(sess));
    const log = (await t.http.get(`/api/v1/classes/${classId}/access-log`).set('cookie', sess.cookie)).body.entries as { action: string }[];
    expect(log.map((e) => e.action)).toEqual(['student_erase', 'cards_print', 'code_rotate', 'roster_view', 'students_add']);
    expect(JSON.stringify(log)).not.toMatch(/Logová|Druhý/);
  });

  it('archive and delete (owner, name confirmation)', async () => {
    const { classId, created } = await classWithStudents(t, sess, ['Konečný Tomáš'], 'Konec');
    await t.http.post(`/api/v1/classes/${classId}/archive`).set(ui(sess));
    expect(t.services.classes.findByCode(classId, created[0]!.code)).toBeUndefined(); // codes stop working
    expect((await t.http.post(`/api/v1/classes/${classId}/students`).set(ui(sess)).send({ students: [{ familyName: 'X' }] })).status).toBe(409);
    expect((await t.http.delete(`/api/v1/classes/${classId}`).set(ui(sess)).send({ confirmName: 'jiný' })).status).toBe(400);
    expect((await t.http.delete(`/api/v1/classes/${classId}`).set(ui(sess)).send({ confirmName: 'Konec' })).status).toBe(204);
    expect((await t.http.get(`/api/v1/classes/${classId}`).set('cookie', sess.cookie)).status).toBe(404);
  });
});

describe('classes disabled without CODE_PEPPER', () => {
  it('returns 404 and the UI config says disabled', async () => {
    const t2 = await startApp({ codePepper: '' });
    try {
      const s2 = await teacher(t2);
      expect((await t2.http.get('/api/v1/classes').set('cookie', s2.cookie)).status).toBe(404);
      expect((await t2.http.get('/api/auth/config')).body.classesEnabled).toBe(false);
    } finally {
      await t2.close();
    }
  });
});
