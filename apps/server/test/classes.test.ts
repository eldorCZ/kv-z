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

const NAMES = Array.from({ length: 25 }, (_, i) => `zak${String(i + 1).padStart(2, '0')}`);

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
    const { created } = await classWithStudents(t, sess, ['novak12', 'dvorak3'], 'DB test');
    t.services.db.$client.pragma('wal_checkpoint(TRUNCATE)');
    const bytes = readFileSync(t.services.cfg.dbPath).toString('latin1');
    for (const c of created) {
      expect(bytes).not.toContain(c.code);
      expect(bytes).not.toContain(c.code.replace('-', ''));
    }
  });

  it('rotation invalidates the old code', async () => {
    const { classId, created } = await classWithStudents(t, sess, ['svoboda7'], 'Rotace');
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

  it('only account name and number are stored; extra fields from an import are dropped (C4.3)', async () => {
    const c = (await t.http.post('/api/v1/classes').set(ui(sess)).send({ name: 'Import' })).body;
    const r = await t.http
      .post(`/api/v1/classes/${c.id}/students`)
      .set(ui(sess))
      .send({ students: [{ accountName: 'Novak12@zs-hornidolni.cz', rosterNo: 3, familyName: 'Nováková', givenName: 'Jarmila', domain: 'zs-hornidolni.cz', email: 'novak12@zs-hornidolni.cz' }] });
    expect(r.status).toBe(201);
    expect(r.body.created[0].student).toMatchObject({ accountName: 'novak12', rosterNo: 3 });
    t.services.db.$client.pragma('wal_checkpoint(TRUNCATE)');
    const row = t.services.db.$client.prepare('SELECT * FROM students WHERE class_id = ?').get(c.id) as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['account_name', 'active', 'class_id', 'code_lookup', 'code_rotated_at', 'created_at', 'id', 'left_at', 'roster_no', 'since']);
    const bytes = readFileSync(t.services.cfg.dbPath).toString('utf8');
    for (const w of ['Nováková', 'Jarmila', 'hornidolni']) expect(bytes).not.toContain(w);
    // duplicates are refused (case-insensitive)
    expect((await t.http.post(`/api/v1/classes/${c.id}/students`).set(ui(sess)).send({ students: [{ accountName: 'NOVAK12' }] })).status).toBe(409);
    const two = await t.http.post(`/api/v1/classes/${c.id}/students`).set(ui(sess)).send({ students: [{ accountName: 'mala4' }] });
    expect((await t.http.patch(`/api/v1/classes/${c.id}/students/${two.body.created[0].student.id}`).set(ui(sess)).send({ accountName: 'novak12' })).status).toBe(409);
    const ren = await t.http.patch(`/api/v1/classes/${c.id}/students/${two.body.created[0].student.id}`).set(ui(sess)).send({ accountName: 'Mala5' });
    expect(ren.body.accountName).toBe('mala5');
  });

  it('validates account names and the class size limit', async () => {
    const c = (await t.http.post('/api/v1/classes').set(ui(sess)).send({ name: 'Limity' })).body;
    for (const bad of ['x<script>', 'Jana Nováková', 'a', '']) {
      expect((await t.http.post(`/api/v1/classes/${c.id}/students`).set(ui(sess)).send({ students: [{ accountName: bad }] })).status).toBe(422);
    }
    const many = await t.http.post(`/api/v1/classes/${c.id}/students`).set(ui(sess)).send({ students: Array.from({ length: 61 }, (_, i) => ({ accountName: `zak${i}` })) });
    expect(many.status).toBe(422);
  });

  it('roles: viewer reads only, a foreign teacher gets 404, owner-only actions', async () => {
    const { classId, created } = await classWithStudents(t, sess, ['mala4'], 'Role');
    const other = await teacher(t);
    expect((await t.http.get(`/api/v1/classes/${classId}`).set('cookie', other.cookie)).status).toBe(404);
    t.services.db.$client.prepare("INSERT INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, 'viewer')").run(classId, await teacherId(t, other));
    expect((await t.http.get(`/api/v1/classes/${classId}`).set('cookie', other.cookie)).status).toBe(200);
    expect((await t.http.post(`/api/v1/classes/${classId}/students`).set(ui(other)).send({ students: [{ accountName: 'xx1' }] })).status).toBe(403);
    expect((await t.http.post(`/api/v1/classes/${classId}/students/${created[0]!.student.id}/rotate`).set(ui(other))).status).toBe(403);
    t.services.db.$client.prepare("UPDATE class_teachers SET role = 'editor' WHERE class_id = ? AND teacher_id = ?").run(classId, await teacherId(t, other));
    expect((await t.http.delete(`/api/v1/classes/${classId}/students/${created[0]!.student.id}`).set(ui(other))).status).toBe(403);
    expect((await t.http.delete(`/api/v1/classes/${classId}`).set(ui(other)).send({ confirmName: 'Role' })).status).toBe(403);
    expect((await t.http.get(`/api/v1/classes/${classId}/access-log`).set('cookie', other.cookie)).status).toBe(403);
  });

  it('API tokens only list classes (no names), roster endpoints are UI only', async () => {
    const { classId } = await classWithStudents(t, sess, ['vesely5'], 'Token');
    const tok = (await apiToken(t, sess)).token;
    const list = await t.http.get('/api/v1/classes').set('authorization', `Bearer ${tok}`);
    expect(list.status).toBe(200);
    expect(list.body.classes.find((c: { id: string }) => c.id === classId)).toMatchObject({ name: 'Token', activeStudents: 1 });
    expect(JSON.stringify(list.body)).not.toContain('vesely5');
    expect((await t.http.get(`/api/v1/classes/${classId}`).set('authorization', `Bearer ${tok}`)).status).toBe(403);
    const noScope = (await apiToken(t, sess, ['quizzes:read'])).token;
    expect((await t.http.get('/api/v1/classes').set('authorization', `Bearer ${noScope}`)).status).toBe(403);
  });

  it('access log records roster views, rotations and erasure without names', async () => {
    const { classId, created } = await classWithStudents(t, sess, ['logova1', 'druhy2'], 'Log');
    await t.http.get(`/api/v1/classes/${classId}`).set('cookie', sess.cookie);
    await t.http.post(`/api/v1/classes/${classId}/students/${created[0]!.student.id}/rotate`).set(ui(sess));
    await t.http.post(`/api/v1/classes/${classId}/log`).set(ui(sess)).send({ action: 'cards_print', count: 2 });
    await t.http.delete(`/api/v1/classes/${classId}/students/${created[1]!.student.id}`).set(ui(sess));
    const log = (await t.http.get(`/api/v1/classes/${classId}/access-log`).set('cookie', sess.cookie)).body.entries as { action: string }[];
    expect(log.map((e) => e.action)).toEqual(['student_erase', 'cards_print', 'code_rotate', 'roster_view', 'students_add']);
    expect(JSON.stringify(log)).not.toMatch(/logova1|druhy2/);
  });

  it('archive and delete (owner, name confirmation)', async () => {
    const { classId, created } = await classWithStudents(t, sess, ['konecny9'], 'Konec');
    await t.http.post(`/api/v1/classes/${classId}/archive`).set(ui(sess));
    expect(t.services.classes.findByCode(classId, created[0]!.code)).toBeUndefined(); // codes stop working
    expect((await t.http.post(`/api/v1/classes/${classId}/students`).set(ui(sess)).send({ students: [{ accountName: 'xx1' }] })).status).toBe(409);
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
