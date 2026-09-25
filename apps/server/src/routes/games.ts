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
      const res = input.data.mode === 'test' ? s.testService.create(quiz, input.data) : s.gameService.create(quiz, input.data);
      return reply.code(201).send(res);
    });

    app.get<{ Querystring: { quizId?: string } }>('/games', { config: { scope: 'games:read' } }, async (req) => ({
      games: s.gameRepo.list(req.auth!.teacherId, req.query.quizId),
    }));

    app.get<GameParams>('/games/:id', { config: { scope: 'games:read' } }, async (req, reply) => {
      const g = ownedGame(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      return g.mode === 'test' ? s.testService.status(g) : s.gameService.status(g);
    });

    app.get<GameParams>('/games/:id/results', { config: { scope: 'games:read' } }, async (req, reply) => {
      const g = ownedGame(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      if (g.mode === 'test') return s.testService.results(g, req.auth!.scopes.has('results:pii'));
      return s.gameService.results(g);
    });

    app.get<GameParams>('/games/:id/results.csv', { config: { scope: 'games:read' } }, async (req, reply) => {
      const g = ownedGame(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="vysledky-${g.id}.csv"`)
        .send(g.mode === 'test' ? s.testService.resultsCsv(g) : s.gameService.resultsCsv(g));
    });

    // ---------- test mode: teacher dashboard (D8), only in the app (not for API tokens) ----------
    const ownedTest = (id: string, teacherId: string, reply: FastifyReply) => {
      const g = ownedGame(id, teacherId, reply);
      if (g && g.mode !== 'test') {
        void sendError(reply, 409, 'Tato hra není test.', 'not_a_test');
        return undefined;
      }
      return g;
    };
    type AttemptParams = { Params: { id: string; aid: string } };

    app.get<GameParams>('/games/:id/dashboard', { config: { sessionOnly: true } }, async (req, reply) => {
      const g = ownedTest(req.params.id, req.auth!.teacherId, reply);
      if (g) return s.testService.dashboard(g);
    });

    app.get<AttemptParams>('/games/:id/attempts/:aid', { config: { sessionOnly: true } }, async (req, reply) => {
      const g = ownedTest(req.params.id, req.auth!.teacherId, reply);
      if (g) return s.testService.detail(g, req.params.aid);
    });

    app.post<AttemptParams>('/games/:id/attempts/:aid/reopen', { config: { sessionOnly: true } }, async (req, reply) => {
      const g = ownedTest(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      const minutes = Number((req.body as { minutes?: unknown } | undefined)?.minutes ?? 10);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) return sendError(reply, 400, 'Počet minut musí být 1–60.', 'invalid');
      s.testService.reopen(g, req.params.aid, minutes);
      return s.testService.dashboard(g);
    });

    app.post<AttemptParams>('/games/:id/attempts/:aid/allow-return', { config: { sessionOnly: true } }, async (req, reply) => {
      const g = ownedTest(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      s.testService.allowReturn(g, req.params.aid);
      return s.testService.dashboard(g);
    });

    app.post<GameParams>('/games/:id/end', { config: { scope: 'games:write' } }, async (req, reply) => {
      const g = ownedGame(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      if (g.mode === 'test') {
        if (g.status === 'running') s.testService.end(g);
        return s.testService.status(s.gameRepo.get(g.id)!);
      }
      const live = s.games.get(g.id);
      if (live && !live.finished) live.end();
      return s.gameService.status(s.gameRepo.get(g.id)!);
    });
  };
