import { createGameSchema, validateWith } from '@kvizhub/core';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { sendError, type Services } from '../app.js';
import type { GameRow } from '../repo/games.js';

type GameParams = { Params: { id: string } };

export const gameRoutes =
  (s: Services): FastifyPluginAsync =>
  async (app) => {
    const ownedGame = (id: string, teacherId: string, reply: FastifyReply): GameRow | undefined => {
      const g = s.gameRepo.get(id);
      if (!g || g.teacherId !== teacherId) {
        void sendError(reply, 404, 'Hra nenalezena.', 'not_found');
        return undefined;
      }
      return g;
    };

    app.post<GameParams>('/quizzes/:id/games', { config: { scope: 'games:write' } }, async (req, reply) => {
      const quiz = s.quizzes.getOwned(req.params.id, req.auth!.teacherId);
      if (!quiz) return sendError(reply, 404, 'Kvíz nenalezen (nebo k němu nemáte přístup).', 'not_found');
      const input = validateWith(createGameSchema, req.body ?? {});
      if (!input.ok) return reply.code(422).send({ errors: input.errors });
      const res = s.gameService.create(quiz, input.data);
      return reply.code(201).send(res);
    });

    app.get<{ Querystring: { quizId?: string } }>('/games', { config: { scope: 'games:read' } }, async (req) => ({
      games: s.gameRepo.list(req.auth!.teacherId, req.query.quizId),
    }));

    app.get<GameParams>('/games/:id', { config: { scope: 'games:read' } }, async (req, reply) => {
      const g = ownedGame(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      return s.gameService.status(g);
    });

    app.get<GameParams>('/games/:id/results', { config: { scope: 'games:read' } }, async (req, reply) => {
      const g = ownedGame(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      return s.gameService.results(g);
    });

    app.get<GameParams>('/games/:id/results.csv', { config: { scope: 'games:read' } }, async (req, reply) => {
      const g = ownedGame(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="vysledky-${g.id}.csv"`)
        .send(s.gameService.resultsCsv(g));
    });

    app.post<GameParams>('/games/:id/end', { config: { scope: 'games:write' } }, async (req, reply) => {
      const g = ownedGame(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      const live = s.games.get(g.id);
      if (live && !live.finished) live.end();
      return s.gameService.status(s.gameRepo.get(g.id)!);
    });
  };
