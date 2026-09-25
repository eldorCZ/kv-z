import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { buildApp, type BuildOptions } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';

export const root = join(import.meta.dirname, '../../..');
export const fixture = (p: string) => JSON.parse(readFileSync(join(root, 'fixtures/quizzes', p), 'utf8'));

export async function startApp(overrides: Partial<Config> = {}, opts: BuildOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kvizhub-test-'));
  const cfg = loadConfig({ LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv, { dbPath: join(dir, 'test.db'), webDist: join(dir, 'nodist'), logLevel: 'silent', seedSampleQuiz: false, codePepper: 'test-pepper-0123456789abcdef0123456789abcdef', ...overrides });
  const built = await buildApp(cfg, opts);
  await built.app.listen({ host: '127.0.0.1', port: 0 });
  const port = (built.app.server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  built.services.cfg.publicUrl = url;
  return { ...built, url, http: request(built.app.server), close: () => built.app.close() };
}

export type TestApp = Awaited<ReturnType<typeof startApp>>;

/** Registers a teacher and returns a cookie + CSRF token pair for UI style requests. */
export async function teacher(t: TestApp, email = `ucitel${Math.random().toString(36).slice(2)}@skola.cz`) {
  const res = await t.http.post('/api/auth/register').send({ email, password: 'tajneheslo123' });
  if (res.status !== 200) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  return { cookie, csrf: res.body.csrfToken as string, email };
}

export async function apiToken(t: TestApp, s: { cookie: string; csrf: string }, scopes?: string[]) {
  const res = await t.http.post('/api/tokens').set('cookie', s.cookie).set('x-csrf-token', s.csrf).send({ name: 'agent', ...(scopes ? { scopes } : {}) });
  if (res.status !== 201) throw new Error(`token failed ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, id: res.body.id as string };
}

export const ui = (sess: { cookie: string; csrf: string }) => ({ cookie: sess.cookie, 'x-csrf-token': sess.csrf });

export async function teacherId(t: TestApp, sess: { cookie: string }) {
  return (await t.http.get('/api/auth/me').set('cookie', sess.cookie)).body.teacher.id as string;
}

/** Creates a class with students; returns ids and the one-time plain codes. */
export async function classWithStudents(t: TestApp, sess: { cookie: string; csrf: string }, names: string[], name = '8.A') {
  const c = await t.http.post('/api/v1/classes').set(ui(sess)).send({ name, subject: 'Fyzika' });
  if (c.status !== 201) throw new Error(`class ${c.status} ${JSON.stringify(c.body)}`);
  const students = names.map((n) => {
    const [familyName, ...given] = n.split(' ');
    return { familyName, givenName: given.join(' ') };
  });
  const r = await t.http.post(`/api/v1/classes/${c.body.id}/students`).set(ui(sess)).send({ students });
  if (r.status !== 201) throw new Error(`students ${r.status} ${JSON.stringify(r.body)}`);
  return { classId: c.body.id as string, created: r.body.created as { student: { id: string; publicName: string; familyName: string; givenName: string }; code: string }[] };
}
