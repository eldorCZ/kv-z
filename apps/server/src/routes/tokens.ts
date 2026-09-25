import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sendError, type Services } from '../app.js';
import { DEFAULT_TOKEN_SCOPES, TOKEN_SCOPES } from '../repo/accounts.js';

const createToken = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1).default([...DEFAULT_TOKEN_SCOPES]),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

export const tokenRoutes =
  (s: Services): FastifyPluginAsync =>
  async (app) => {
    app.get('/', { config: { sessionOnly: true } }, async (req) => ({ tokens: s.accounts.listTokens(req.auth!.teacherId), availableScopes: TOKEN_SCOPES }));

    app.post('/', { config: { sessionOnly: true } }, async (req, reply) => {
      const body = createToken.safeParse(req.body);
      if (!body.success) return sendError(reply, 400, 'Zadejte název tokenu (1–80 znaků) a alespoň jedno oprávnění.', 'invalid');
      const token = `khp_${randomBytes(32).toString('base64url')}`;
      const expiresAt = body.data.expiresInDays ? Date.now() + body.data.expiresInDays * 86400_000 : null;
      const id = s.accounts.createToken(req.auth!.teacherId, body.data.name, [...new Set(body.data.scopes)], expiresAt, token);
      // the plain token is returned exactly once and never stored
      return reply.code(201).send({ id, token, name: body.data.name, scopes: body.data.scopes, expiresAt });
    });

    app.delete<{ Params: { id: string } }>('/:id', { config: { sessionOnly: true } }, async (req, reply) => {
      if (!s.accounts.revokeToken(req.auth!.teacherId, req.params.id)) return sendError(reply, 404, 'Token nenalezen.', 'not_found');
      return { ok: true };
    });
  };
