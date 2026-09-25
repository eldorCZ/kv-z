import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { runRetention } from '../src/retention.js';
import { apiToken, fixture, startApp, teacher } from './helpers.js';
import { connect, emit, once } from './socket-helpers.js';

describe('webhook', () => {
  it('posts {gameId, quizId, status} with an HMAC-SHA256 signature after the game ends', async () => {
    const received: { body: string; sig: string }[] = [];
    const hook = createServer((req: IncomingMessage, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ body, sig: String(req.headers['x-kvizhub-signature']) });
        res.end('ok');
      });
    });
    await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
    const hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`;
    const t = await startApp({ webhookUrl: hookUrl, webhookSecret: 'tajemstvi' });
    try {
      const s = await teacher(t);
      const auth = { authorization: `Bearer ${(await apiToken(t, s)).token}` };
      const quizId = (await t.http.post('/api/v1/quizzes').set(auth).send(fixture('valid/minimal.json'))).body.quizId;
      const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(auth).send({})).body;
      await t.http.post(`/api/v1/games/${g.gameId}/end`).set(auth).send({});
      for (let i = 0; i < 50 && !received.length; i++) await new Promise((r) => setTimeout(r, 20));
      expect(received).toHaveLength(1);
      const { body, sig } = received[0]!;
      expect(JSON.parse(body)).toEqual({ gameId: g.gameId, quizId, status: 'finished' });
      expect(sig).toBe(`sha256=${createHmac('sha256', 'tajemstvi').update(body).digest('hex')}`);
    } finally {
      await t.close();
      hook.close();
    }
  });
});

describe('retention', () => {
  it('deletes old games with players and answers, keeps quizzes', async () => {
    const t = await startApp({ retentionDays: 30 });
    try {
      const s = await teacher(t);
      const auth = { authorization: `Bearer ${(await apiToken(t, s)).token}` };
      const quizId = (await t.http.post('/api/v1/quizzes').set(auth).send(fixture('valid/minimal.json'))).body.quizId;
      const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(auth).send({})).body;
      const p = await connect(t.url);
      await emit(p, 'join', { pin: g.pin, nickname: 'Stará' });
      p.disconnect();
      const db = t.services.db.$client;
      expect(db.prepare('select count(*) n from players').get()).toEqual({ n: 1 });
      // nothing is old yet
      expect(runRetention(t.services, t.app.log).games).toBe(0);
      const res = runRetention(t.services, t.app.log, Date.now() + 31 * 86400_000);
      expect(res.games).toBe(1);
      expect(db.prepare('select count(*) n from players').get()).toEqual({ n: 0 });
      expect(db.prepare('select count(*) n from games').get()).toEqual({ n: 0 });
      expect(db.prepare('select count(*) n from quizzes').get()).toEqual({ n: 1 });
    } finally {
      await t.close();
    }
  });
});

describe('join rate limit and privacy', () => {
  it('limits join attempts per IP and stores only nickname + answers', async () => {
    const t = await startApp({ joinRateLimit: 3 });
    try {
      const s = await teacher(t);
      const auth = { authorization: `Bearer ${(await apiToken(t, s)).token}` };
      const quizId = (await t.http.post('/api/v1/quizzes').set(auth).send(fixture('valid/minimal.json'))).body.quizId;
      const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(auth).send({})).body;
      const results = [];
      for (let i = 0; i < 4; i++) {
        const c = await connect(t.url);
        results.push(await emit(c, 'join', { pin: '999999', nickname: `Hráč${i}` }));
        c.disconnect();
      }
      expect(results[3]).toMatchObject({ ok: false, error: expect.stringMatching(/Příliš mnoho/) });
      // player table has no IP or user agent columns
      const cols = (t.services.db.$client.prepare('pragma table_info(players)').all() as { name: string }[]).map((c) => c.name);
      expect(cols.sort()).toEqual(['game_id', 'id', 'joined_at', 'nickname', 'token_hash']);
      void g;
    } finally {
      await t.close();
    }
  });

  it('nickname is never interpreted as HTML (sent as plain text)', async () => {
    const t = await startApp();
    try {
      const s = await teacher(t);
      const auth = { authorization: `Bearer ${(await apiToken(t, s)).token}` };
      const quizId = (await t.http.post('/api/v1/quizzes').set(auth).send(fixture('valid/minimal.json'))).body.quizId;
      const g = (await t.http.post(`/api/v1/quizzes/${quizId}/games`).set(auth).send({})).body;
      const host = await connect(t.url);
      await emit(host, 'host_attach', { gameId: g.gameId, hostKey: new URL(g.hostUrl).hash.slice(5) });
      const lobby = once<{ players: { nickname: string }[] }>(host, 'lobby_update');
      const p = await connect(t.url);
      await emit(p, 'join', { pin: g.pin, nickname: '<img src=x>' });
      expect((await lobby).players[0]!.nickname).toBe('<img src=x>'); // React renders it as text
      host.disconnect();
      p.disconnect();
    } finally {
      await t.close();
    }
  });
});

describe('seed', () => {
  it('a new teacher gets the sample quiz', async () => {
    const t = await startApp({ seedSampleQuiz: true });
    try {
      const s = await teacher(t);
      const r = await t.http.get('/api/v1/quizzes').set('cookie', s.cookie);
      expect(r.body.quizzes).toHaveLength(1);
      expect(r.body.quizzes[0].title).toBe('Ukázka: Optika: lom světla');
    } finally {
      await t.close();
    }
  });
});
