import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiToken, classWithStudents, startApp, teacher, ui, type TestApp } from './helpers.js';
import { connect, emit } from './socket-helpers.js';

const clock = { t: Date.now() };
let t: TestApp;
let sess: { cookie: string; csrf: string };
let auth: { authorization: string };
let quizId: string;

const quiz = {
  schemaVersion: 1,
  title: 'Třídní kvíz',
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'Hlavní město?', options: ['Praha', 'Brno', 'Ostrava'], correctIndices: [0], topic: 'Města' },
    { type: 'truefalse', prompt: 'Dunaj je řeka.', correctIndices: [0], topic: 'Řeky', points: 'double' },
  ],
};

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000, joinRateLimit: 10_000 }, { now: () => clock.t });
  sess = await teacher(t);
  auth = { authorization: `Bearer ${(await apiToken(t, sess)).token}` };
  quizId = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz)).body.quizId;
});
afterAll(async () => t.close());

async function classGame(mode: 'test' | 'live', extra: Record<string, unknown> = {}, names = ['novak12', 'svoboda7', 'dvorak3']) {
  const cls = await classWithStudents(t, sess, names, `Třída ${Math.random().toString(36).slice(2, 7)}`);
  const r = await t.http
    .post(`/api/v1/quizzes/${quizId}/games`)
    .set(ui(sess))
    .send({ mode, settings: { classId: cls.classId, label: 'Písemka', ...(mode === 'test' ? { test: { timeLimitMin: 20 } } : {}), ...extra } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { ...cls, game: r.body as { gameId: string; pin: string; hostUrl?: string } };
}

const identify = (pin: string, code: unknown) => t.http.post('/play/roster/identify').send({ pin, code });

describe('identify (C5.1, C5.2)', () => {
  it('lookup tells the identity mode, never names or counts', async () => {
    const { game } = await classGame('test');
    const l = await t.http.get(`/play/roster/lookup?pin=${game.pin}`);
    expect(l.body).toEqual({ mode: 'test', identity: 'roster', allowGuests: false });
    const tl = await t.http.get(`/play/test/lookup?pin=${game.pin}`);
    expect(tl.body.identity).toBe('roster');
    expect(JSON.stringify(tl.body)).not.toMatch(/novak12|svoboda7|students|count(?!.*questionCount)/);
  });

  it('valid code -> account name + ticket only; wrong, inactive and foreign codes get one generic message', async () => {
    const { game, created, classId } = await classGame('test');
    const ok = await identify(game.pin, created[0]!.code.toLowerCase());
    expect(Object.keys(ok.body).sort()).toEqual(['accountName', 'ticket']);
    expect(ok.body.accountName).toBe('novak12');
    const wrong = await identify(game.pin, 'AAAA-BBBB');
    expect(wrong.status).toBe(404);
    const other = await classWithStudents(t, sess, ['cizi1'], 'Jiná');
    const foreign = await identify(game.pin, other.created[0]!.code);
    expect(foreign.body.error).toBe(wrong.body.error);
    await t.http.post(`/api/v1/classes/${classId}/students/${created[1]!.student.id}/leave`).set(ui(sess));
    const inactive = await identify(game.pin, created[1]!.code);
    expect(inactive.body.error).toBe(wrong.body.error);
    expect(wrong.body.error).toBe('Tento kód nepatří žádnému žákovi v této hře. Zkontroluj ho, nebo požádej učitele.');
  });

  it('audience: only selected students', async () => {
    const cls = await classWithStudents(t, sess, ['anna1', 'bara2'], 'Audience');
    const g = await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(ui(sess)).send({ mode: 'test', settings: { classId: cls.classId, audience: [cls.created[0]!.student.id] } });
    expect((await identify(g.body.pin, cls.created[0]!.code)).status).toBe(200);
    const no = await identify(g.body.pin, cls.created[1]!.code);
    expect(no.status).toBe(403);
    expect(no.body.error).toBe('Tento test je určen jen vybraným žákům.');
    // API tokens cannot select students
    expect((await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(auth).send({ mode: 'test', settings: { classId: cls.classId, audience: [cls.created[0]!.student.id] } })).status).toBe(422);
  });
});

describe('tickets and joining a test', () => {
  it('ticket is single-use and expires after 2 minutes', async () => {
    const { game, created } = await classGame('test');
    const tk = (await identify(game.pin, created[0]!.code)).body.ticket;
    const j = await t.http.post('/play/test/join').send({ pin: game.pin, ticket: tk });
    expect(j.status).toBe(201);
    expect(j.body.name).toBe('novak12');
    expect((await t.http.post('/play/test/join').send({ pin: game.pin, ticket: tk })).status).toBe(401);
    const tk2 = (await identify(game.pin, created[1]!.code)).body.ticket;
    clock.t += 2 * 60_000 + 1000;
    expect((await t.http.post('/play/test/join').send({ pin: game.pin, ticket: tk2 })).status).toBe(401);
  });

  it('a student already joined is refused until the teacher allows a return', async () => {
    const { game, created } = await classGame('test');
    const first = await t.http.post('/play/test/join').send({ pin: game.pin, ticket: (await identify(game.pin, created[0]!.code)).body.ticket });
    const again = await t.http.post('/play/test/join').send({ pin: game.pin, ticket: (await identify(game.pin, created[0]!.code)).body.ticket });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('Tento žák už je ve hře připojen. Požádej učitele o obnovení.');
    const dash = await t.http.get(`/api/v1/games/${game.gameId}/dashboard`).set('cookie', sess.cookie);
    await t.http.post(`/api/v1/games/${game.gameId}/attempts/${dash.body.students[0].attemptId}/allow-return`).set(ui(sess));
    const back = await t.http.post('/play/test/join').send({ pin: game.pin, ticket: (await identify(game.pin, created[0]!.code)).body.ticket });
    expect(back.status).toBe(201);
    expect(back.body.returned).toBe(true);
    expect((await t.http.get('/play/test/attempt').set('x-player-token', first.body.playerToken)).status).toBe(401);
  });

  it('guests: refused by default, allowed with allowGuests, cannot use a student account name', async () => {
    const { game } = await classGame('test');
    const no = await t.http.post('/play/test/join').send({ pin: game.pin, name: 'Host' });
    expect(no.status).toBe(403);
    const withGuests = await classGame('test', { allowGuests: true });
    expect((await t.http.get(`/play/roster/lookup?pin=${withGuests.game.pin}`)).body.allowGuests).toBe(true);
    expect((await t.http.post('/play/test/join').send({ pin: withGuests.game.pin, name: 'Host Karel' })).status).toBe(201);
    expect((await t.http.post('/play/test/join').send({ pin: withGuests.game.pin, name: 'Novak12' })).status).toBe(409);
  });

  it('throttles after 20 wrong codes in 5 minutes and alerts the teacher', async () => {
    const { game, created } = await classGame('test');
    for (let i = 0; i < 20; i++) await identify(game.pin, 'ZZZZ-ZZZZ');
    const blocked = await identify(game.pin, created[0]!.code);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Příliš mnoho chybných kódů/);
    const dash = await t.http.get(`/api/v1/games/${game.gameId}/dashboard`).set('cookie', sess.cookie);
    expect(dash.body.codeAlert).toBe(true);
    clock.t += 61_000;
    expect((await identify(game.pin, created[0]!.code)).status).toBe(200);
  });
});

describe('live class game', () => {
  it('students join with a ticket, the host sees who has not joined', async () => {
    // výchozí je od 28. 9. 2026 „number", takže projektor ukazuje „Žák <číslo>";
    // přihlašovací jména vidí učitel ve výsledcích, ne celá třída
    const { game, created } = await classGame('live');
    const host = await connect(t.url);
    const att = await emit<{ ok: boolean; state: { notJoined: { name: string }[]; classGame: boolean } }>(host, 'host_attach', {
      gameId: game.gameId,
      hostKey: new URL(game.hostUrl!).hash.slice(5),
    });
    expect(att.state.classGame).toBe(true);
    expect(att.state.notJoined.map((x) => x.name)).toEqual(['Žák 1', 'Žák 2', 'Žák 3']);
    const p = await connect(t.url);
    const tk = (await identify(game.pin, created[0]!.code)).body.ticket;
    const j = await emit<{ ok: boolean; nickname: string }>(p, 'join', { pin: game.pin, ticket: tk });
    expect(j).toMatchObject({ ok: true, nickname: 'Žák 2' }); // novak12 je v abecedě druhý
    // nickname join without allowGuests is refused, second connection of the same student too
    const guest = await connect(t.url);
    expect(await emit(guest, 'join', { pin: game.pin, nickname: 'Host' })).toMatchObject({ ok: false });
    const dup = await connect(t.url);
    expect(await emit(dup, 'join', { pin: game.pin, ticket: (await identify(game.pin, created[0]!.code)).body.ticket })).toMatchObject({
      ok: false,
      error: 'Tento žák už je ve hře připojen. Požádej učitele o obnovení.',
    });
    [host, p, guest, dup].forEach((x) => x.disconnect());
  });

  it('leaderboardNames = "number": classmates and the projector see "Žák <číslo>" (C5.6)', async () => {
    const cls = await classWithStudents(t, sess, ['novak12', 'dvorak3'], 'Čísla');
    await t.http.patch(`/api/v1/classes/${cls.classId}`).set(ui(sess)).send({ settings: { supportThresholdPercent: 40 } });
    await t.http.patch(`/api/v1/classes/${cls.classId}`).set(ui(sess)).send({ settings: { leaderboardNames: 'number' } });
    // a partial update keeps the other settings
    expect((await t.http.get(`/api/v1/classes/${cls.classId}`).set('cookie', sess.cookie)).body.settings).toMatchObject({ supportThresholdPercent: 40, leaderboardNames: 'number' });
    await t.http.patch(`/api/v1/classes/${cls.classId}/students/${cls.created[0]!.student.id}`).set(ui(sess)).send({ rosterNo: 14 });
    const game = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(ui(sess)).send({ mode: 'live', settings: { classId: cls.classId } })).body;
    const host = await connect(t.url);
    const att = await emit<{ ok: boolean; state: { notJoined: { name: string }[] } }>(host, 'host_attach', { gameId: game.gameId, hostKey: new URL(game.hostUrl).hash.slice(5) });
    // sorted by number, then account name: novak12 has number 14, dvorak3 is second without a number
    expect(att.state.notJoined.map((x) => x.name)).toEqual(['Žák 14', 'Žák 2']);
    // the student still confirms their own account name
    const id = await identify(game.pin, cls.created[0]!.code);
    expect(id.body.accountName).toBe('novak12');
    const p = await connect(t.url);
    expect(await emit(p, 'join', { pin: game.pin, ticket: id.body.ticket })).toMatchObject({ ok: true, nickname: 'Žák 14' });
    expect(host.frames.join('')).not.toContain('novak12');
    [host, p].forEach((x) => x.disconnect());
  });
});
