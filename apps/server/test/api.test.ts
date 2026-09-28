import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiToken, fixture, root, startApp, teacher, type TestApp } from './helpers.js';

let t: TestApp;
let session: { cookie: string; csrf: string };
let token: string;
const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000 });
  session = await teacher(t);
  token = (await apiToken(t, session)).token;
});
afterAll(async () => t.close());

describe('health and openapi', () => {
  it('healthz', async () => {
    const r = await t.http.get('/healthz');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });
  it('openapi.json is generated from zod', async () => {
    const r = await t.http.get('/api/v1/openapi.json');
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe('3.1.0');
    expect(r.body.components.schemas.Quiz.properties.questions).toBeDefined();
    expect(r.body.paths['/quizzes'].post).toBeDefined();
  });
});

describe('POST /api/v1/quizzes', () => {
  it('requires a token', async () => {
    const r = await t.http.post('/api/v1/quizzes').send(fixture('valid/optika.json'));
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/token/i);
  });

  it('dry_run validates without saving', async () => {
    const before = (await t.http.get('/api/v1/quizzes').set(auth())).body.quizzes.length;
    const r = await t.http.post('/api/v1/quizzes?dry_run=1').set(auth()).send(fixture('valid/optika.json'));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ valid: true, stats: { total: 7, ok: 6, flagged: 1 } });
    const after = (await t.http.get('/api/v1/quizzes').set(auth())).body.quizzes.length;
    expect(after).toBe(before);
  });

  it('creates a quiz and returns quizId, reviewUrl and stats', async () => {
    const r = await t.http.post('/api/v1/quizzes').set(auth()).send(fixture('valid/optika.json'));
    expect(r.status).toBe(201);
    expect(r.body.quizId).toMatch(/^[\w-]+$/);
    expect(r.body.reviewUrl).toBe(`${t.url}/quizzes/${r.body.quizId}`);
    expect(r.body.stats).toEqual({ total: 7, ok: 6, flagged: 1 });
  });

  it('the quiz list counts questions and flagged questions of each quiz', async () => {
    const r = await t.http.post('/api/v1/quizzes').set(auth()).send({ ...fixture('valid/optika.json'), title: 'Počty v seznamu' });
    const list = await t.http.get('/api/v1/quizzes?q=Počty').set(auth());
    expect(list.body.quizzes).toEqual([expect.objectContaining({ id: r.body.quizId, questionCount: 7, flaggedCount: 1 })]);
  });

  it('returns 422 with Czech errors for invalid fixtures', async () => {
    const expected = fixture('invalid/_expected.json') as Record<string, { path: string; code: string }[]>;
    for (const [name, errs] of Object.entries(expected)) {
      const r = await t.http.post('/api/v1/quizzes').set(auth()).send(fixture(`invalid/${name}.json`));
      expect(r.status, name).toBe(422);
      for (const e of errs) expect(r.body.errors, name).toContainEqual(expect.objectContaining(e));
      expect(r.body.errors.length).toBeLessThanOrEqual(50);
    }
  });

  it('idempotency: same key + same content returns the original response, other content 409', async () => {
    const body = fixture('valid/minimal.json');
    const a = await t.http.post('/api/v1/quizzes').set(auth()).set('idempotency-key', 'job-1').send(body);
    const b = await t.http.post('/api/v1/quizzes').set(auth()).set('idempotency-key', 'job-1').send(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body).toEqual(a.body);
    const c = await t.http.post('/api/v1/quizzes').set(auth()).set('idempotency-key', 'job-1').send({ ...body, title: 'Jiný' });
    expect(c.status).toBe(409);
    expect(c.body.error).toMatch(/Idempotency-Key/);
  });

  it('rejects invalid JSON and bodies over 2 MB', async () => {
    const bad = await t.http.post('/api/v1/quizzes').set(auth()).set('content-type', 'application/json').send('{"x":');
    expect(bad.status).toBe(400);
    const huge = await t.http.post('/api/v1/quizzes').set(auth()).set('content-type', 'application/json').send(JSON.stringify({ title: 'x'.repeat(2.2 * 1024 * 1024) }));
    expect(huge.status).toBe(413);
  });
});

describe('tokens and scopes', () => {
  it('read-only token cannot write, cannot approve', async () => {
    const ro = (await apiToken(t, session, ['quizzes:read'])).token;
    const r = await t.http.post('/api/v1/quizzes').set('authorization', `Bearer ${ro}`).send(fixture('valid/minimal.json'));
    expect(r.status).toBe(403);
    expect(r.body.error).toContain('quizzes:write');
    const created = await t.http.post('/api/v1/quizzes').set(auth()).send(fixture('valid/optika.json'));
    const quiz = (await t.http.get(`/api/v1/quizzes/${created.body.quizId}`).set(auth())).body;
    const flagged = quiz.questions.find((q: { qa: { status: string } }) => q.qa.status === 'flagged');
    const ap = await t.http.post(`/api/v1/quizzes/${quiz.id}/questions/${flagged.id}/approve`).set(auth());
    expect(ap.status).toBe(403);
    expect(ap.body.error).toMatch(/učitel/);
  });

  it('token creation cannot grant quizzes:approve', async () => {
    const r = await t.http.post('/api/tokens').set('cookie', session.cookie).set('x-csrf-token', session.csrf).send({ name: 'x', scopes: ['quizzes:approve'] });
    expect(r.status).toBe(400);
  });

  it('revoked token is rejected', async () => {
    const tk = await apiToken(t, session);
    expect((await t.http.get('/api/v1/quizzes').set('authorization', `Bearer ${tk.token}`)).status).toBe(200);
    const rv = await t.http.delete(`/api/tokens/${tk.id}`).set('cookie', session.cookie).set('x-csrf-token', session.csrf);
    expect(rv.status).toBe(200);
    const r = await t.http.get('/api/v1/quizzes').set('authorization', `Bearer ${tk.token}`);
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/odvolaný/);
  });

  it('token list never contains the token or its hash, records last use', async () => {
    const r = await t.http.get('/api/tokens').set('cookie', session.cookie);
    expect(JSON.stringify(r.body)).not.toContain(token);
    expect(JSON.stringify(r.body)).not.toMatch(/hash/i);
    expect(r.body.tokens.some((x: { lastUsedAt: number | null }) => x.lastUsedAt)).toBe(true);
  });

  it('tokens cannot manage tokens', async () => {
    const r = await t.http.get('/api/tokens').set(auth());
    expect(r.status).toBe(403);
  });

  it('session mutations require CSRF token', async () => {
    const r = await t.http.post('/api/v1/quizzes').set('cookie', session.cookie).send(fixture('valid/minimal.json'));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('csrf');
    const ok = await t.http.post('/api/v1/quizzes').set('cookie', session.cookie).set('x-csrf-token', session.csrf).send(fixture('valid/minimal.json'));
    expect(ok.status).toBe(201);
  });

  it('another teacher cannot see the quiz', async () => {
    const created = await t.http.post('/api/v1/quizzes').set(auth()).send(fixture('valid/minimal.json'));
    const other = await teacher(t);
    const otherToken = (await apiToken(t, other)).token;
    const r = await t.http.get(`/api/v1/quizzes/${created.body.quizId}`).set('authorization', `Bearer ${otherToken}`);
    expect(r.status).toBe(404);
  });

  it('audit log stores metadata only', async () => {
    const rows = t.services.accounts.listAudit(500);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toEqual({ id: expect.any(Number), at: expect.any(Number), tokenId: expect.any(String), endpoint: expect.stringMatching(/^(GET|POST|PATCH|DELETE|PUT) \//), status: expect.any(Number) });
  });
});

describe('rate limit', () => {
  it('limits requests per token', async () => {
    const t2 = await startApp({ apiRateLimit: 5 });
    try {
      const s = await teacher(t2);
      const tk = (await apiToken(t2, s)).token;
      const codes = [];
      for (let i = 0; i < 7; i++) codes.push((await t2.http.get('/api/v1/quizzes').set('authorization', `Bearer ${tk}`)).status);
      expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(codes[5]).toBe(429);
    } finally {
      await t2.close();
    }
  });
});

describe('questions', () => {
  let quizId: string;
  let quiz: { questions: { id: string; qa: { status: string }; type: string; prompt: string }[] };
  beforeAll(async () => {
    quizId = (await t.http.post('/api/v1/quizzes').set(auth()).send(fixture('valid/optika.json'))).body.quizId;
    quiz = (await t.http.get(`/api/v1/quizzes/${quizId}`).set(auth())).body;
  });

  it('adds a question with the same validation', async () => {
    const bad = await t.http.post(`/api/v1/quizzes/${quizId}/questions`).set(auth()).send({ type: 'single', prompt: 'x', options: ['a', 'b', 'c'], correctIndices: [3] });
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0]).toMatchObject({ path: 'correctIndices[0]', code: 'out_of_range' });
    const good = await t.http.post(`/api/v1/quizzes/${quizId}/questions`).set(auth()).send({ type: 'truefalse', prompt: 'Světlo je vlnění.', correctIndices: [0] });
    expect(good.status).toBe(201);
    expect(good.body.question.options).toEqual(['Pravda', 'Nepravda']);
  });

  it('patches a question partially', async () => {
    const q = quiz.questions[0]!;
    const r = await t.http.patch(`/api/v1/quizzes/${quizId}/questions/${q.id}`).set(auth()).send({ prompt: 'Nové znění otázky?' });
    expect(r.status).toBe(200);
    expect(r.body.question.prompt).toBe('Nové znění otázky?');
    expect(r.body.question.options).toHaveLength(4);
    const bad = await t.http.patch(`/api/v1/quizzes/${quizId}/questions/${q.id}`).set(auth()).send({ correctIndices: [9] });
    expect(bad.status).toBe(422);
  });

  it('agent can fix a flagged question but it stays flagged', async () => {
    const f = quiz.questions.find((q) => q.qa.status === 'flagged')!;
    const r = await t.http.patch(`/api/v1/quizzes/${quizId}/questions/${f.id}`).set(auth()).send({ prompt: 'Opravené znění?' });
    expect(r.status).toBe(200);
    expect(r.body.question.qa.status).toBe('flagged');
    const r2 = await t.http.patch(`/api/v1/quizzes/${quizId}/questions/${f.id}`).set(auth()).send({ qa: { status: 'ok', notes: '' } });
    expect(r2.status).toBe(403);
  });

  it('teacher approves a flagged question', async () => {
    const f = quiz.questions.find((q) => q.qa.status === 'flagged')!;
    const r = await t.http.post(`/api/v1/quizzes/${quizId}/questions/${f.id}/approve`).set('cookie', session.cookie).set('x-csrf-token', session.csrf);
    expect(r.status).toBe(200);
    expect(r.body.question.qa.status).toBe('ok');
    expect(r.body.question.approvedAt).toEqual(expect.any(Number));
  });

  it('deletes a question', async () => {
    const q = quiz.questions[1]!;
    expect((await t.http.delete(`/api/v1/quizzes/${quizId}/questions/${q.id}`).set(auth())).status).toBe(204);
    const after = (await t.http.get(`/api/v1/quizzes/${quizId}`).set(auth())).body;
    expect(after.questions.find((x: { id: string }) => x.id === q.id)).toBeUndefined();
  });

  it('reorders and duplicates', async () => {
    const cur = (await t.http.get(`/api/v1/quizzes/${quizId}`).set(auth())).body.questions.map((q: { id: string }) => q.id);
    const rev = [...cur].reverse();
    const r = await t.http.put(`/api/v1/quizzes/${quizId}/order`).set(auth()).send({ questionIds: rev });
    expect(r.status).toBe(200);
    expect(r.body.questions.map((q: { id: string }) => q.id)).toEqual(rev);
    const d = await t.http.post(`/api/v1/quizzes/${quizId}/questions/${rev[0]}/duplicate`).set(auth());
    expect(d.status).toBe(201);
    const after = (await t.http.get(`/api/v1/quizzes/${quizId}`).set(auth())).body.questions;
    expect(after[1].prompt).toBe(after[0].prompt);
  });
});

describe('exports', () => {
  let quizId: string;
  beforeAll(async () => {
    quizId = (await t.http.post('/api/v1/quizzes').set(auth()).send(fixture('valid/optika.json'))).body.quizId;
  });

  it('kahoot xlsx with X-Export-Summary', async () => {
    const r = await t.http.get(`/api/v1/quizzes/${quizId}?format=kahoot`).set(auth()).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    const summary = JSON.parse(r.headers['x-export-summary']!);
    expect(summary).toMatchObject({ format: 'kahoot', total: 7, exported: 2 });
    expect(summary.message).toContain('Exportováno 2 z 7 otázek.');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    const tpl = new ExcelJS.Workbook();
    await tpl.xlsx.load(readFileSync(join(root, 'fixtures/kahoot-template.xlsx')) as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.getRow(8).values).toEqual(tpl.worksheets[0]!.getRow(8).values);
    const withFlagged = await t.http.get(`/api/v1/quizzes/${quizId}?format=kahoot&includeFlagged=1`).set(auth());
    expect(JSON.parse(withFlagged.headers['x-export-summary']!).exported).toBe(3);
  });

  it('gift', async () => {
    const r = await t.http.get(`/api/v1/quizzes/${quizId}?format=gift`).set(auth());
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/plain');
    expect(r.text).toContain('::Q1::');
    expect(r.headers['x-export-summary']).toBeDefined();
  });

  it('json roundtrip: export -> POST -> identical quiz', async () => {
    const exp = await t.http.get(`/api/v1/quizzes/${quizId}?format=json&download=1`).set(auth());
    expect(exp.status).toBe(200);
    expect(exp.headers['content-disposition']).toContain('attachment');
    const again = await t.http.post('/api/v1/quizzes').set(auth()).send(exp.body);
    expect(again.status).toBe(201);
    const exp2 = await t.http.get(`/api/v1/quizzes/${again.body.quizId}?format=json&download=1`).set(auth());
    expect(exp2.body).toEqual(exp.body);
    expect(exp.body).toEqual(expect.objectContaining({ schemaVersion: 1, title: 'Optika: lom světla' }));
  });

  it('unknown format is rejected', async () => {
    expect((await t.http.get(`/api/v1/quizzes/${quizId}?format=pdf`).set(auth())).status).toBe(400);
  });
});

describe('games via API', () => {
  it('409 when every question is flagged', async () => {
    const quiz = fixture('valid/minimal.json');
    quiz.questions[0].qa = { status: 'flagged', notes: 'Nejasné.' };
    const id = (await t.http.post('/api/v1/quizzes').set(auth()).send(quiz)).body.quizId;
    const r = await t.http.post(`/api/v1/quizzes/${id}/games`).set(auth()).send({ mode: 'live' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/flagged/);
  });

  it('creates a game with pin, joinUrl, hostUrl and reports status', async () => {
    const id = (await t.http.post('/api/v1/quizzes').set(auth()).send(fixture('valid/optika.json'))).body.quizId;
    const r = await t.http.post(`/api/v1/quizzes/${id}/games`).set(auth()).send({ mode: 'live', settings: { showLeaderboard: true } });
    expect(r.status).toBe(201);
    expect(r.body.pin).toMatch(/^\d{6}$/);
    expect(r.body.joinUrl).toBe(`${t.url}/play`);
    expect(r.body.hostUrl).toMatch(new RegExp(`^${t.url}/host/${r.body.gameId}#key=[\\w-]{43,}$`));
    expect(r.body.questionCount).toBe(6);
    const st = await t.http.get(`/api/v1/games/${r.body.gameId}`).set(auth());
    expect(st.body).toMatchObject({ status: 'lobby', playerCount: 0, currentQuestion: null });
    const res = await t.http.get(`/api/v1/games/${r.body.gameId}/results`).set(auth());
    expect(res.body).toMatchObject({ ranking: [], perQuestion: expect.any(Array) });
  });

  it('smaže doběhlou hru, běžící odmítne a cizí nenajde', async () => {
    const id = (await t.http.post('/api/v1/quizzes').set(auth()).send(fixture('valid/optika.json'))).body.quizId;
    const gameId = (await t.http.post(`/api/v1/quizzes/${id}/games`).set(auth()).send({ mode: 'live' })).body.gameId;

    // dokud hra běží (čeká v lobby), smazat nejde
    const bezici = await t.http.delete(`/api/v1/games/${gameId}`).set(auth());
    expect(bezici.status).toBe(409);
    expect(bezici.body.code).toBe('game_running');

    await t.http.post(`/api/v1/games/${gameId}/end`).set(auth());

    // cizí učitel ji nesmí ani vidět, natož smazat
    const cizi = await teacher(t);
    const ciziToken = (await apiToken(t, cizi)).token;
    const pokus = await t.http.delete(`/api/v1/games/${gameId}`).set({ authorization: `Bearer ${ciziToken}` });
    expect(pokus.status).toBe(404);
    expect((await t.http.get(`/api/v1/games/${gameId}`).set(auth())).status).toBe(200);

    const smazano = await t.http.delete(`/api/v1/games/${gameId}`).set(auth());
    expect(smazano.status).toBe(204);
    expect((await t.http.get(`/api/v1/games/${gameId}`).set(auth())).status).toBe(404);
    expect((await t.http.get('/api/v1/games').set(auth())).body.games.some((g: { id: string }) => g.id === gameId)).toBe(false);
  });
});

describe('topic and tags roundtrip (C10.1)', () => {
  it('keeps topic and tags through export and re-import; Kahoot ignores them', async () => {
    const quiz = { ...fixture('valid/minimal.json'), tags: ['Fyzika'] };
    quiz.questions[0].topic = 'Tvar Země';
    const id = (await t.http.post('/api/v1/quizzes').set(auth()).send(quiz)).body.quizId;
    const exp = await t.http.get(`/api/v1/quizzes/${id}?format=json&download=1`).set(auth());
    expect(exp.body.tags).toEqual(['Fyzika']);
    expect(exp.body.questions[0].topic).toBe('Tvar Země');
    const again = (await t.http.post('/api/v1/quizzes').set(auth()).send(exp.body)).body.quizId;
    expect((await t.http.get(`/api/v1/quizzes/${again}?format=json&download=1`).set(auth())).body).toEqual(exp.body);
  });
});
