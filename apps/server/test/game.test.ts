import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECRET_KEYS, type GameOverEvent, type QuestionEvent, type RevealEvent } from '@kvizhub/core';
import { apiToken, startApp, teacher, type TestApp } from './helpers.js';
import { connect, emit, once, sleep, type Client } from './socket-helpers.js';

let t: TestApp;
let auth: { authorization: string };

const quiz = {
  schemaVersion: 1,
  title: 'Hra test',
  settings: { shuffleQuestions: false, shuffleOptions: true },
  questions: [
    { type: 'single', prompt: 'Hlavní město ČR?', options: ['Praha', 'Brno', 'Ostrava', 'Plzeň'], correctIndices: [0], explanation: 'Praha je hlavní město.', timeLimitSec: 10 },
    { type: 'flagged-placeholder' },
    { type: 'short', prompt: 'Jak se nazývá ohnisko?', acceptedAnswers: ['ohnisko'], explanation: 'TAJNE_VYSVETLENI', timeLimitSec: 10 },
    { type: 'numeric', prompt: 'Kolik je 2,5 + 2,5?', numericAnswer: 5, numericTolerance: 0, timeLimitSec: 5 },
  ],
};
quiz.questions[1] = { type: 'single', prompt: 'Zakázaná otázka', options: ['A1', 'B1', 'C1'], correctIndices: [1], qa: { status: 'flagged', notes: 'Ke kontrole.' } } as never;

async function createGame(settings: Record<string, unknown> = {}) {
  const quizId = (await t.http.post('/api/v1/quizzes').set(auth).send(quiz)).body.quizId;
  const g = await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(auth).send({ mode: 'live', settings });
  expect(g.status).toBe(201);
  const hostKey = new URL(g.body.hostUrl).hash.replace('#key=', '');
  return { ...g.body, hostKey, quizId } as { gameId: string; pin: string; hostKey: string; quizId: string };
}

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000, joinRateLimit: 1000, hostTimeoutMs: 400 });
  const s = await teacher(t);
  auth = { authorization: `Bearer ${(await apiToken(t, s)).token}` };
});
afterAll(async () => t.close());

describe('live game: 1 host + 3 players', () => {
  const sockets: Client[] = [];
  afterAll(() => sockets.forEach((s) => s.disconnect()));

  it('plays through the playable questions and never leaks the key before reveal', async () => {
    const game = await createGame({ showLeaderboard: true });
    const host = await connect(t.url);
    sockets.push(host);
    const bad = await emit(host, 'host_attach', { gameId: game.gameId, hostKey: 'wrong' });
    expect(bad).toMatchObject({ ok: false });
    const att = await emit<{ ok: boolean; state: { total: number } }>(host, 'host_attach', { gameId: game.gameId, hostKey: game.hostKey });
    expect(att.ok).toBe(true);
    expect(att.state.total).toBe(3); // flagged question skipped

    const players: Client[] = [];
    const tokens: string[] = [];
    for (const nick of ['Anna', 'Bára', 'Cyril']) {
      const p = await connect(t.url);
      sockets.push(p);
      const r = await emit<{ ok: boolean; token: string }>(p, 'join', { pin: game.pin, nickname: nick });
      expect(r.ok).toBe(true);
      players.push(p);
      tokens.push(r.token);
    }
    // duplicate / profane nickname and bad pin
    const dup = await connect(t.url);
    sockets.push(dup);
    expect(await emit(dup, 'join', { pin: game.pin, nickname: 'anna' })).toMatchObject({ ok: false, error: expect.stringMatching(/přezdívku/) });
    expect(await emit(dup, 'join', { pin: game.pin, nickname: 'kurva' })).toMatchObject({ ok: false });
    expect(await emit(dup, 'join', { pin: '000000', nickname: 'Dan' })).toMatchObject({ ok: false, error: expect.stringMatching(/PIN/) });

    // ---------- question 1 (single) ----------
    const q1p = players.map((p) => once<QuestionEvent>(p, 'question'));
    expect(await emit(host, 'start')).toMatchObject({ ok: true });
    const q1 = await Promise.all(q1p);
    const pub = q1[0]!.question;
    expect(Object.keys(pub).sort()).toEqual(['id', 'index', 'options', 'points', 'prompt', 'timeLimitSec', 'total', 'type']);
    const correctPos = pub.options.indexOf('Praha');
    const wrongPos = (correctPos + 1) % 4;
    const reveals = players.map((p) => once<RevealEvent>(p, 'reveal'));
    expect(await emit(players[0]!, 'answer', { questionId: pub.id, payload: { indices: [correctPos] } })).toMatchObject({ ok: true });
    // second answer from the same player is ignored
    expect(await emit(players[0]!, 'answer', { questionId: pub.id, payload: { indices: [wrongPos] } })).toMatchObject({ ok: false });
    await emit(players[1]!, 'answer', { questionId: pub.id, payload: { indices: [wrongPos] } });
    await sleep(300);
    await emit(players[2]!, 'answer', { questionId: pub.id, payload: { indices: [correctPos] } });
    const r1 = await Promise.all(reveals); // auto reveal once everybody answered
    expect(r1[0]!.correctDisplayed).toEqual([correctPos]);
    expect(r1[0]!.explanation).toBe('Praha je hlavní město.');
    expect(r1[0]!.you).toMatchObject({ correct: true, answered: true });
    expect(r1[0]!.you!.points).toBeGreaterThan(950);
    expect(r1[1]!.you).toMatchObject({ correct: false, points: 0 });
    expect(r1[2]!.you!.points).toBeLessThan(r1[0]!.you!.points);
    expect(r1[0]!.stats).toMatchObject({ answered: 3, correct: 2, playerCount: 3 });

    // ---------- leaderboard ----------
    const lb = once<{ top: { nickname: string }[]; you: { rank: number } }>(players[0]!, 'leaderboard');
    await emit(host, 'next');
    const lbe = await lb;
    expect(lbe.top[0]!.nickname).toBe('Anna');
    expect(lbe.you.rank).toBe(1);

    // ---------- question 2 (short) + reconnect ----------
    const q2p = once<QuestionEvent>(players[0]!, 'question');
    await emit(host, 'next');
    const q2 = (await q2p).question;
    expect(q2.type).toBe('short');
    expect(q2.prompt).not.toBe('Zakázaná otázka');
    expect(q2.options).toEqual([]);

    // Bára loses Wi-Fi and reconnects with her token
    players[1]!.disconnect();
    const again = await connect(t.url);
    sockets.push(again);
    const qAgain = once<QuestionEvent>(again, 'question');
    const rec = await emit<{ ok: boolean; nickname: string; score: number }>(again, 'reconnect_player', { token: tokens[1] });
    expect(rec).toMatchObject({ ok: true, nickname: 'Bára', score: 0 });
    expect((await qAgain).question.id).toBe(q2.id);
    players[1] = again;

    const r2 = players.map((p) => once<RevealEvent>(p, 'reveal'));
    await emit(players[0]!, 'answer', { questionId: q2.id, payload: { text: 'Ohnysko' } }); // 1 typo tolerated
    await emit(players[1]!, 'answer', { questionId: q2.id, payload: { text: 'ohnisko' } });
    await emit(players[2]!, 'answer', { questionId: q2.id, payload: { text: 'čočka' } });
    const rv2 = await Promise.all(r2);
    expect(rv2[0]!.correctText).toEqual(['ohnisko']);
    expect(rv2[0]!.you!.correct).toBe(true);
    expect(rv2[1]!.you!.correct).toBe(true);
    expect(rv2[2]!.you!.correct).toBe(false);

    // ---------- question 3 (numeric): host reveals early with Enter ----------
    await emit(host, 'next'); // leaderboard
    const q3p = once<QuestionEvent>(players[0]!, 'question');
    await emit(host, 'next');
    const q3 = (await q3p).question;
    await emit(players[0]!, 'answer', { questionId: q3.id, payload: { value: '5,0' } });
    const r3 = once<RevealEvent>(players[0]!, 'reveal');
    expect(await emit(host, 'reveal')).toMatchObject({ ok: true });
    expect((await r3).you!.correct).toBe(true);
    // answering after reveal is rejected
    expect(await emit(players[1]!, 'answer', { questionId: q3.id, payload: { value: '5' } })).toMatchObject({ ok: false });

    // ---------- game over ----------
    const over = players.map((p) => once<GameOverEvent>(p, 'game_over'));
    await emit(host, 'next'); // last question -> no leaderboard, straight to the podium
    const go = await Promise.all(over);
    expect(go[0]!.podium.map((p) => p.nickname)).toEqual(['Anna', 'Bára', 'Cyril']);
    expect(go[0]!.you!.rank).toBe(1);

    // ---------- secrets never travelled to players before the reveal ----------
    for (const p of [...players, again]) {
      let revealed = new Set<string>();
      for (const f of p.frames) {
        const m = /^\d*\["(\w+)",(.*)\]$/s.exec(f);
        if (!m) continue;
        const [, ev, data] = m;
        if (ev === 'reveal') revealed = new Set([...revealed, JSON.parse(data!).questionId]);
        if (ev === 'question') {
          for (const k of SECRET_KEYS) expect(data).not.toContain(`"${k}"`);
          expect(data).not.toContain('TAJNE_VYSVETLENI');
          expect(data).not.toContain('Praha je hlavní město');
        }
        if (ev !== 'reveal' && ev !== 'game_over') {
          expect(data).not.toContain('correctDisplayed');
          expect(data).not.toContain('"ohnisko"');
        }
      }
      expect(p.frames.some((f) => f.includes('Zakázaná otázka'))).toBe(false);
    }

    // ---------- results API ----------
    const res = await t.http.get(`/api/v1/games/${game.gameId}/results`).set(auth);
    expect(res.body.ranking.map((r: { nickname: string }) => r.nickname)).toEqual(['Anna', 'Bára', 'Cyril']);
    expect(res.body.perQuestion).toHaveLength(3);
    expect(res.body.perQuestion[0]).toMatchObject({ successRate: 0.667, avgTimeMs: expect.any(Number) });
    const st = await t.http.get(`/api/v1/games/${game.gameId}`).set(auth);
    expect(st.body.status).toBe('finished');
    const csv = await t.http.get(`/api/v1/games/${game.gameId}/results.csv`).set(auth);
    expect(csv.text).toContain('Přezdívka;Skóre');
    expect(csv.text).toContain('Anna');
    expect(csv.text).toContain('Praha');
  });
});

describe('game rules', () => {
  it('lobby is locked after start (late join disabled by default)', async () => {
    const game = await createGame();
    const host = await connect(t.url);
    await emit(host, 'host_attach', { gameId: game.gameId, hostKey: game.hostKey });
    const p = await connect(t.url);
    await emit(p, 'join', { pin: game.pin, nickname: 'Eva' });
    expect(await emit(host, 'start')).toMatchObject({ ok: true });
    const late = await connect(t.url);
    expect(await emit(late, 'join', { pin: game.pin, nickname: 'Pozdě' })).toMatchObject({ ok: false });
    [host, p, late].forEach((s) => s.disconnect());
  });

  it('start requires at least one player; host can kick a player', async () => {
    const game = await createGame();
    const host = await connect(t.url);
    await emit(host, 'host_attach', { gameId: game.gameId, hostKey: game.hostKey });
    expect(await emit(host, 'start')).toMatchObject({ ok: false });
    const p = await connect(t.url);
    const j = await emit<{ ok: boolean; playerId: string }>(p, 'join', { pin: game.pin, nickname: 'Filip' });
    const kicked = once(p, 'kicked');
    expect(await emit(host, 'kick_player', { playerId: j.playerId })).toMatchObject({ ok: true });
    await kicked;
    [host, p].forEach((s) => s.disconnect());
  });

  it('host disconnect pauses the game and ends it after the timeout', async () => {
    const game = await createGame();
    const host = await connect(t.url);
    await emit(host, 'host_attach', { gameId: game.gameId, hostKey: game.hostKey });
    const p = await connect(t.url);
    await emit(p, 'join', { pin: game.pin, nickname: 'Gustav' });
    const q = once<QuestionEvent>(p, 'question');
    await emit(host, 'start');
    const qe = await q;
    const paused = once<{ paused: boolean }>(p, 'paused');
    host.disconnect();
    expect((await paused).paused).toBe(true);
    expect(await emit(p, 'answer', { questionId: qe.question.id, payload: { indices: [0] } })).toMatchObject({ ok: false });
    const over = await once<GameOverEvent>(p, 'game_over', 3000);
    expect(over.podium[0]!.nickname).toBe('Gustav');
    p.disconnect();
  });

  it('host reconnect resumes the paused question', async () => {
    const game = await createGame();
    const host = await connect(t.url);
    await emit(host, 'host_attach', { gameId: game.gameId, hostKey: game.hostKey });
    const p = await connect(t.url);
    await emit(p, 'join', { pin: game.pin, nickname: 'Hana' });
    const q = once(p, 'question');
    await emit(host, 'start');
    await q;
    const paused = once<{ paused: boolean }>(p, 'paused');
    host.disconnect();
    await paused;
    const resumed = once<{ paused: boolean }>(p, 'paused');
    const host2 = await connect(t.url);
    expect(await emit(host2, 'host_attach', { gameId: game.gameId, hostKey: game.hostKey })).toMatchObject({ ok: true });
    expect((await resumed).paused).toBe(false);
    [host2, p].forEach((s) => s.disconnect());
  });

  it('teacher session cookie can attach as host without the key', async () => {
    const s = await teacher(t);
    const tk = (await apiToken(t, s)).token;
    const quizId = (await t.http.post('/api/v1/quizzes').set('authorization', `Bearer ${tk}`).send(quiz)).body.quizId;
    const g = await t.http.post(`/api/v1/quizzes/${quizId}/games`).set('authorization', `Bearer ${tk}`).send({});
    const host = await connect(t.url, { cookie: s.cookie });
    expect(await emit(host, 'host_attach', { gameId: g.body.gameId })).toMatchObject({ ok: true });
    const stranger = await connect(t.url);
    expect(await emit(stranger, 'host_attach', { gameId: g.body.gameId })).toMatchObject({ ok: false });
    [host, stranger].forEach((x) => x.disconnect());
  });
});
