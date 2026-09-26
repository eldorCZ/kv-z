import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QuestionEvent } from '@kvizhub/core';
import { apiToken, startApp, teacher, ui, type TestApp } from './helpers.js';
import { connect, emit, once, type Client } from './socket-helpers.js';

let t: TestApp;
let sess: { cookie: string; csrf: string };
let auth: { authorization: string };

const quiz = (theme?: unknown) => ({
  schemaVersion: 1,
  title: 'Vzhled',
  ...(theme === undefined ? {} : { theme }),
  questions: [{ type: 'single', prompt: 'Kolik je 1 + 1?', options: ['2', '3', '4'], correctIndices: [0], timeLimitSec: 10 }],
});

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000, joinRateLimit: 1000 });
  sess = await teacher(t);
  auth = { authorization: `Bearer ${(await apiToken(t, sess)).token}` };
});
afterAll(async () => t.close());

const getQuiz = async (id: string) => (await t.http.get(`/api/v1/quizzes/${id}`).set(auth)).body;

describe('theme contract (Dodatek 4, V7.4)', () => {
  it('GET /api/v1/themes lists built-in motives', async () => {
    const r = await t.http.get('/api/v1/themes').set(auth);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThanOrEqual(20);
    for (const m of r.body) expect(Object.keys(m).sort()).toEqual(['calm', 'category', 'id', 'name']);
    expect(r.body.find((m: { id: string }) => m.id === 'papir')).toMatchObject({ calm: true });
  });

  it('stores a valid theme and returns it; JSON export round-trips it', async () => {
    const r = await t.http.post('/api/v1/quizzes').set(auth).send(quiz({ motive: 'vesmir', accent: 'modra' }));
    expect(r.status).toBe(201);
    expect(r.body.warnings).toBeUndefined();
    const q = await getQuiz(r.body.quizId);
    expect(q.theme).toEqual({ motive: 'vesmir', accent: 'modra' });
    const exported = await t.http.get(`/api/v1/quizzes/${r.body.quizId}?download=1`).set(auth);
    const data = JSON.parse(exported.text);
    expect(data.theme).toEqual({ motive: 'vesmir', accent: 'modra' });
    const again = await t.http.post('/api/v1/quizzes').set(auth).send(data);
    expect((await getQuiz(again.body.quizId)).theme).toEqual({ motive: 'vesmir', accent: 'modra' });
  });

  it('unknown ids are ignored with a warning, never a 422', async () => {
    const r = await t.http.post('/api/v1/quizzes').set(auth).send(quiz({ motive: 'kahoot-blue', accent: 'modra', extra: 1 }));
    expect(r.status).toBe(201);
    expect(r.body.warnings.map((w: { code: string }) => w.code).sort()).toEqual(['unknown_field', 'unknown_motive']);
    expect(r.body.warnings[0].path).toMatch(/^theme\./);
    expect((await getQuiz(r.body.quizId)).theme).toEqual({ accent: 'modra' });
    const bad = await t.http.post('/api/v1/quizzes?dry_run=1').set(auth).send(quiz('neon'));
    expect(bad.status).toBe(200);
    expect(bad.body.warnings[0].code).toBe('theme_ignored');
  });

  it('a custom image cannot be set through the API', async () => {
    const r = await t.http.post('/api/v1/quizzes').set(auth).send(quiz({ motive: 'les', imageId: 'abc123' }));
    expect(r.body.warnings.map((w: { code: string }) => w.code)).toEqual(['image_app_only']);
    expect((await getQuiz(r.body.quizId)).theme).toEqual({ motive: 'les' });
    const p = await t.http.patch(`/api/v1/quizzes/${r.body.quizId}`).set(auth).send({ theme: { imageId: 'abc123' } });
    expect(p.body.warnings[0].code).toBe('image_app_only');
    expect(p.body.theme).toBeUndefined();
  });

  it('PATCH changes and clears the theme', async () => {
    const id = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz())).body.quizId;
    expect((await t.http.patch(`/api/v1/quizzes/${id}`).set(auth).send({ theme: { motive: 'more' } })).body.theme).toEqual({ motive: 'more' });
    expect((await t.http.patch(`/api/v1/quizzes/${id}`).set(auth).send({ title: 'Jiný' })).body.theme).toEqual({ motive: 'more' });
    expect((await t.http.patch(`/api/v1/quizzes/${id}`).set(auth).send({ theme: null })).body.theme).toBeUndefined();
  });

  it("new quizzes without a theme get the teacher's default; only the app can set it", async () => {
    const s2 = await teacher(t);
    const a2 = { authorization: `Bearer ${(await apiToken(t, s2)).token}` };
    expect((await t.http.put('/api/auth/default-theme').set(a2).send({ theme: { motive: 'les' } })).status).toBe(403);
    const put = await t.http.put('/api/auth/default-theme').set(ui(s2)).send({ theme: { motive: 'les', accent: 'zelena' } });
    expect(put.body.defaultTheme).toEqual({ motive: 'les', accent: 'zelena' });
    expect((await t.http.get('/api/auth/me').set('cookie', s2.cookie)).body.defaultTheme).toEqual({ motive: 'les', accent: 'zelena' });
    const plain = (await t.http.post('/api/v1/quizzes').set(a2).send(quiz())).body.quizId;
    expect((await t.http.get(`/api/v1/quizzes/${plain}`).set(a2)).body.theme).toEqual({ motive: 'les', accent: 'zelena' });
    // an explicit theme wins, an explicit null means "Jiskra default"
    const own = (await t.http.post('/api/v1/quizzes').set(a2).send(quiz({ motive: 'more' }))).body.quizId;
    expect((await t.http.get(`/api/v1/quizzes/${own}`).set(a2)).body.theme).toEqual({ motive: 'more' });
    const none = (await t.http.post('/api/v1/quizzes').set(a2).send(quiz(null))).body.quizId;
    expect((await t.http.get(`/api/v1/quizzes/${none}`).set(a2)).body.theme).toBeUndefined();
  });
});

describe('game snapshot and player payload (V7.2, V7.4)', () => {
  const sockets: Client[] = [];
  afterAll(() => sockets.forEach((s) => s.disconnect()));

  it('the game keeps the look from its start; players get exactly the theme object, never inside questions', async () => {
    const quizId = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz({ motive: 'aurora', accent: 'ruzova' }))).body.quizId;
    const g = await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(auth).send({ mode: 'live' });
    const hostKey = new URL(g.body.hostUrl).hash.replace('#key=', '');
    // the quiz changes after the start – the game does not
    await t.http.patch(`/api/v1/quizzes/${quizId}`).set(auth).send({ theme: { motive: 'papir' } });

    const host = await connect(t.url);
    sockets.push(host);
    const attach = await emit<{ ok: boolean; theme: Record<string, unknown> }>(host, 'host_attach', { gameId: g.body.gameId, hostKey });
    expect(attach.theme).toEqual({ motive: 'aurora', accent: 'ruzova', imageUrl: null, scrimHint: 'normal' });

    const p = await connect(t.url);
    sockets.push(p);
    const joined = await emit<{ ok: boolean; theme: Record<string, unknown> }>(p, 'join', { pin: g.body.pin, nickname: 'novak12' });
    expect(Object.keys(joined.theme).sort()).toEqual(['accent', 'imageUrl', 'motive', 'scrimHint']);
    expect(joined.theme.motive).toBe('aurora');
    const q = once<QuestionEvent>(p, 'question');
    await emit(host, 'start');
    const ev = await q;
    expect(JSON.stringify(ev)).not.toMatch(/theme|motive|accent/);
  });

  it('settings.theme overrides the quiz for one game only', async () => {
    const quizId = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz({ motive: 'aurora' }))).body.quizId;
    const g = await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(auth).send({ mode: 'test', settings: { theme: { motive: 'mlha', accent: 'nic' } } });
    expect(g.status).toBe(201);
    expect(g.body.warnings[0]).toMatchObject({ path: 'settings.theme.accent', code: 'unknown_accent' });
    const join = await t.http.post('/play/test/join').send({ pin: g.body.pin, name: 'Žák' });
    const view = await t.http.get('/play/test/attempt').set('x-player-token', join.body.playerToken);
    expect(view.body.theme).toEqual({ motive: 'mlha', accent: null, imageUrl: null, scrimHint: 'strong' });
    expect((await getQuiz(quizId)).theme).toEqual({ motive: 'aurora' });
    // the look is not stored among the game settings
    const row = t.services.db.$client.prepare('SELECT settings_json, theme_json FROM games WHERE id = ?').get(g.body.gameId) as { settings_json: string; theme_json: string };
    expect(JSON.parse(row.settings_json).theme).toBeUndefined();
    expect(JSON.parse(row.theme_json)).toEqual({ motive: 'mlha' });
  });
});
