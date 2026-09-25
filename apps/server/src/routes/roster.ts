import type { FastifyPluginAsync } from 'fastify';
import { sendError, type Services } from '../app.js';
import { classesEnabled } from '../config.js';
import { RateLimiter } from '../util.js';

/** Student identification by personal code (Dodatek 3, C5). The code travels only in the request body. */
export const rosterRoutes =
  (s: Services): FastifyPluginAsync =>
  async (app) => {
    const limiter = new RateLimiter(s.cfg.joinRateLimit * 3, 60_000);
    app.addHook('onRequest', async (_req, reply) => {
      reply.header('cache-control', 'no-store');
    });

    /** Which identity a PIN needs – never names, counts or the roster. */
    app.get<{ Querystring: { pin?: string } }>('/lookup', { config: { public: true } }, async (req, reply) => {
      if (limiter.hit(`l:${req.ip}`)) return sendError(reply, 429, 'Příliš mnoho pokusů. Zkuste to za minutu.', 'rate_limited');
      const info = s.classGames.lookup(String(req.query.pin ?? '').replace(/\D/g, ''));
      if (!info) return sendError(reply, 404, 'Hra s tímto PINem neexistuje.', 'not_found');
      return info;
    });

    app.post('/identify', { config: { public: true } }, async (req, reply) => {
      if (!classesEnabled(s.cfg)) return sendError(reply, 404, 'Hra s tímto PINem neexistuje.', 'not_found');
      if (limiter.hit(req.ip)) return sendError(reply, 429, 'Příliš mnoho pokusů. Zkuste to za minutu.', 'rate_limited');
      const body = (req.body ?? {}) as { pin?: unknown; code?: unknown };
      return s.classGames.identify(String(body.pin ?? '').replace(/\D/g, ''), body.code);
    });
  };
