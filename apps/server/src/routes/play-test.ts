import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { sendError, type Services } from '../app.js';
import type { StudentCtx } from '../test-mode/service.js';
import { RateLimiter } from '../util.js';

/** Student endpoints of the test mode (D5). Auth: header X-Player-Token (technical token of the attempt). */
export const playTestRoutes =
  (s: Services): FastifyPluginAsync =>
  async (app) => {
    const joinLimiter = new RateLimiter(s.cfg.joinRateLimit, 60_000);
    const tokenLimiter = new RateLimiter(20, 1000);
    const guardLimiter = new RateLimiter(10, 1000);

    app.addHook('onRequest', async (_req, reply) => {
      reply.header('cache-control', 'no-store');
    });

    const student = (req: FastifyRequest, reply: FastifyReply, token?: unknown): StudentCtx | undefined => {
      const t = token ?? req.headers['x-player-token'];
      if (typeof t === 'string' && tokenLimiter.hit(t)) {
        void sendError(reply, 429, 'Příliš mnoho požadavků, zpomalte prosím.', 'rate_limited');
        return undefined;
      }
      return s.testService.resolve(t);
    };

    app.get<{ Querystring: { pin?: string } }>('/lookup', { config: { public: true } }, async (req, reply) => {
      if (joinLimiter.hit(`l:${req.ip}`)) return sendError(reply, 429, 'Příliš mnoho pokusů. Zkuste to za minutu.', 'rate_limited');
      const found = s.testService.lookup(String(req.query.pin ?? '').replace(/\D/g, ''));
      if (!found) return sendError(reply, 404, 'Test s tímto PINem neexistuje.', 'not_found');
      // class tests: identity by personal code, never names or counts (C5.1)
      return { ...found.info, identity: found.g.classId ? 'roster' : 'name', allowGuests: !!found.g.classId && found.g.allowGuests };
    });

    app.post<{ Body: { pin?: string; name?: string } }>('/join', { config: { public: true } }, async (req, reply) => {
      if (joinLimiter.hit(req.ip)) return sendError(reply, 429, 'Příliš mnoho pokusů o připojení. Zkuste to za minutu.', 'rate_limited');
      const body = (req.body ?? {}) as { pin?: unknown; name?: unknown; ticket?: unknown };
      return reply.code(201).send(s.testService.join(String(body.pin ?? '').replace(/\D/g, ''), body.name, body.ticket));
    });

    app.post('/start', { config: { public: true } }, async (req, reply) => {
      const ctx = student(req, reply);
      if (ctx) return s.testService.start(ctx);
    });

    app.get('/attempt', { config: { public: true } }, async (req, reply) => {
      const ctx = student(req, reply);
      if (ctx) return s.testService.view(ctx);
    });

    app.put<{ Params: { qid: string } }>('/answers/:qid', { config: { public: true } }, async (req, reply) => {
      const ctx = student(req, reply);
      if (!ctx) return;
      const body = (req.body ?? {}) as { payload?: unknown };
      return s.testService.saveAnswer(ctx, req.params.qid, body.payload);
    });

    // ---------- leave guard (Dodatek 2, G4.2) ----------
    /** sendBeacon cannot set headers, so this endpoint also accepts playerToken in the body (G3.3). */
    app.post('/events', { config: { public: true } }, async (req, reply) => {
      const body = (req.body ?? {}) as { events?: unknown; playerToken?: unknown };
      const token = req.headers['x-player-token'] ?? body.playerToken;
      if (typeof token === 'string' && guardLimiter.hit(`e:${token}`)) return sendError(reply, 429, 'Příliš mnoho požadavků.', 'rate_limited');
      const ctx = s.testService.resolve(token);
      const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
      s.testService.events(
        ctx,
        events.filter((e): e is { type: 'leave_start' | 'leave_end'; reason?: string; clientTs?: number; seq: number } => !!e && typeof e === 'object' && (e.type === 'leave_start' || e.type === 'leave_end')),
      );
      return reply.code(204).send();
    });

    app.post('/heartbeat', { config: { public: true } }, async (req, reply) => {
      const token = req.headers['x-player-token'];
      if (typeof token === 'string' && guardLimiter.hit(`h:${token}`)) return sendError(reply, 429, 'Příliš mnoho požadavků.', 'rate_limited');
      const ctx = s.testService.resolve(token);
      return s.testService.heartbeat(ctx, (req.body ?? {}) as { fullscreenSupported?: unknown });
    });

    app.post('/submit', { config: { public: true } }, async (req, reply) => {
      const ctx = student(req, reply);
      if (ctx) return s.testService.submit(ctx);
    });

  };
