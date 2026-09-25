import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';

export const root = join(import.meta.dirname, '../../..');
export const fixture = (p: string) => JSON.parse(readFileSync(join(root, 'fixtures/quizzes', p), 'utf8'));

export async function startApp(overrides: Partial<Config> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kvizhub-test-'));
  const cfg = loadConfig({ LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv, { dbPath: join(dir, 'test.db'), webDist: join(dir, 'nodist'), logLevel: 'silent', seedSampleQuiz: false, ...overrides });
  const built = await buildApp(cfg);
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
