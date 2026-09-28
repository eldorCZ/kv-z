import { createGameSchema, normalizeTheme, validateWith } from '@kvizhub/core';
import { ownImageOnly } from '../theme.js';
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
      // look of this game only (V7.2); unknown ids are ignored with a warning, a custom image only from the app
      const look = ownImageOnly(
        normalizeTheme(input.data.settings.theme, ['settings', 'theme'], req.auth!.kind === 'session'),
        (id) => s.themeImages.owns(req.auth!.teacherId, id),
        'settings.theme',
      );
      input.data.settings.theme = look.theme ?? undefined;
      let classInfo = null;
      if (input.data.settings.classId) {
        if (!req.auth!.scopes.has('classes:read')) return sendError(reply, 403, 'API token nemá oprávnění classes:read.', 'forbidden');
        if (req.auth!.kind === 'token' && input.data.settings.audience) return sendError(reply, 422, 'Výběr žáků je možný jen v aplikaci.', 'audience_ui_only');
        classInfo = s.classGames.prepare(req.auth!.teacherId, input.data);
      }
      const res = input.data.mode === 'test' ? s.testService.create(quiz, input.data, classInfo) : s.gameService.create(quiz, input.data, classInfo);
      return reply.code(201).send(look.warnings.length ? { ...res, warnings: look.warnings } : res);
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
      const pii = req.auth!.scopes.has('results:pii');
      const naming = s.classGames.naming(g, pii);
      if (g.mode === 'test') return s.testService.results(g, pii, naming);
      return s.gameService.results(g, naming, s.classGames.rosterNumbers(g));
    });

    app.get<GameParams>('/games/:id/results.csv', { config: { scope: 'games:read' } }, async (req, reply) => {
      const g = ownedGame(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      const naming = s.classGames.naming(g, req.auth!.scopes.has('results:pii'));
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="vysledky-${g.id}.csv"`)
        .send(g.mode === 'test' ? s.testService.resultsCsv(g, naming) : s.gameService.resultsCsv(g, naming, s.classGames.rosterNumbers(g)));
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
      if (!g) return;
      return s.testService.dashboard(g);
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

    // leave guard (Dodatek 2, G4.5, G4.6) – teacher only, not available to API tokens (G7)
    app.post<AttemptParams>('/games/:id/attempts/:aid/unlock', { config: { sessionOnly: true } }, async (req, reply) => {
      const g = ownedTest(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      const extra = Number((req.body as { extraMinutes?: unknown } | undefined)?.extraMinutes ?? 0);
      if (!Number.isInteger(extra) || extra < 0 || extra > 30) return sendError(reply, 400, 'Kompenzace musí být 0–30 minut.', 'invalid');
      s.testService.unlock(g, req.params.aid, extra);
      return s.testService.dashboard(g);
    });

    app.post<AttemptParams>('/games/:id/attempts/:aid/exempt', { config: { sessionOnly: true } }, async (req, reply) => {
      const g = ownedTest(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      s.testService.setExempt(g, req.params.aid, (req.body as { exempt?: unknown } | undefined)?.exempt !== false);
      return s.testService.dashboard(g);
    });

    // ---------- class games (Dodatek 3): guests (C6.3) ----------
    app.get<GameParams>('/games/:id/guests', { config: { sessionOnly: true } }, async (req, reply) => {
      const g = ownedGame(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      if (!g.classId) return { guests: [], candidates: [] };
      s.classes.assertClassAccess(req.auth!.teacherId, g.classId, 'editor');
      return s.classAdmin.guests(g);
    });

    app.post<{ Params: { id: string; pid: string } }>('/games/:id/guests/:pid/assign', { config: { sessionOnly: true } }, async (req, reply) => {
      const g = ownedGame(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      if (!g.classId) return sendError(reply, 409, 'Hra není třídní.', 'not_class_game');
      s.classes.assertClassAccess(req.auth!.teacherId, g.classId, 'editor');
      s.classAdmin.assignGuest(g, req.params.pid, String((req.body as { studentId?: unknown } | undefined)?.studentId ?? ''));
      return s.classAdmin.guests(g);
    });

    app.delete<GameParams>('/games/:id', { config: { scope: 'games:write' } }, async (req, reply) => {
      const g = ownedGame(req.params.id, req.auth!.teacherId, reply);
      if (!g) return;
      // Rozehranou hru nemažeme pod rukama žákům – ať ji učitel nejdřív ukončí.
      const live = s.games.get(g.id);
      const bezi = g.mode === 'test' ? g.status === 'running' : !!live && !live.finished;
      if (bezi) return sendError(reply, 409, 'Hra ještě běží. Nejdřív ji ukončete, pak půjde smazat.', 'game_running');
      if (live) s.games.remove(g.id);
      s.gameRepo.delete(g.id);
      return reply.code(204).send();
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
