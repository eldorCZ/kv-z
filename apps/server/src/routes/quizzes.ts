import {
  LIMITS,
  normalizeTheme,
  questionPatchSchema,
  quizMetaPatchSchema,
  quizStats,
  themeCatalog,
  validateQuestion,
  validateQuiz,
  validateWith,
  type ContractError,
} from '@kvizhub/core';
import { giftExport, jsonExport, kahootExport, type ExportSummary } from '@kvizhub/export';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sendError, type Services } from '../app.js';
import { APPROVE_SCOPE } from '../repo/accounts.js';
import type { StoredQuestion, StoredQuiz } from '../repo/quizzes.js';
import { ownImageOnly } from '../theme.js';
import { canonicalJson, sha256 } from '../util.js';

type QuizParams = { Params: { id: string } };
type QuestionParams = { Params: { id: string; qid: string } };

function unprocessable(reply: FastifyReply, errors: ContractError[]) {
  return reply.code(422).send({ errors: errors.slice(0, LIMITS.maxErrors) });
}

/** Content-Disposition with an ASCII fallback and a UTF-8 filename. */
function attachment(title: string, ext: string) {
  const base = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'kviz';
  return `attachment; filename="${base}.${ext}"; filename*=UTF-8''${encodeURIComponent(title.slice(0, 80))}.${ext}`;
}

function publicQuestion(q: StoredQuestion) {
  const { position: _p, ...rest } = q;
  return rest;
}

export const quizRoutes =
  (s: Services): FastifyPluginAsync =>
  async (app) => {
    const reviewUrl = (id: string) => `${s.cfg.publicUrl}/quizzes/${id}`;

    const owned = (id: string, teacherId: string, reply: FastifyReply): StoredQuiz | undefined => {
      const q = s.quizzes.getOwned(id, teacherId);
      if (!q) void sendError(reply, 404, 'Kvíz nenalezen (nebo k němu nemáte přístup).', 'not_found');
      return q;
    };

    const quizResponse = (q: StoredQuiz) => ({
      id: q.id,
      reviewUrl: reviewUrl(q.id),
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
      stats: quizStats(q.questions),
      schemaVersion: 1,
      title: q.title,
      language: q.language,
      gradeLevel: q.gradeLevel,
      sourceFiles: q.sourceFiles,
      settings: q.settings,
      tags: q.tags ?? [],
      ...(q.theme ? { theme: q.theme } : {}),
      questions: q.questions.map(publicQuestion),
    });

    // ---------- built-in looks (V7.4) ----------
    app.get('/themes', { config: { scope: 'quizzes:read' } }, async () => themeCatalog());

    // ---------- list ----------
    /** Topics used in the teacher's questions so far, for consistent naming (C10.3). */
    app.get('/topics', { config: { scope: 'quizzes:read' } }, async (req) => ({ topics: s.overview.teacherTopics(req.auth!.teacherId) }));

    app.get<{ Querystring: { q?: string } }>('/quizzes', { config: { scope: 'quizzes:read' } }, async (req) => ({
      quizzes: s.quizzes.list(req.auth!.teacherId, (req.query.q ?? '').slice(0, 100)),
    }));

    // ---------- create ----------
    app.post<{ Querystring: { dry_run?: string } }>('/quizzes', { config: { scope: 'quizzes:write' } }, async (req, reply) => {
      const result = validateQuiz(req.body);
      if (!result.ok) return unprocessable(reply, result.errors);
      const stats = quizStats(result.data.questions);
      // the look never blocks an upload: unknown ids are dropped with a warning (V7.4)
      const own = (id: string) => s.themeImages.owns(req.auth!.teacherId, id);
      const { theme, warnings } = ownImageOnly(normalizeTheme(result.data.theme, ['theme'], req.auth!.kind === 'session'), own);
      const extra = warnings.length ? { warnings } : {};
      const dryRun = req.query.dry_run === '1' || req.query.dry_run === 'true';
      if (dryRun) return reply.code(200).send({ valid: true, stats, ...extra });

      const teacherId = req.auth!.teacherId;
      const keyHeader = req.headers['idempotency-key'];
      const key = typeof keyHeader === 'string' && keyHeader.trim() ? keyHeader.trim().slice(0, 200) : undefined;
      const hash = sha256(canonicalJson(req.body));
      if (key) {
        const existing = s.quizzes.findByIdempotencyKey(teacherId, key);
        if (existing) {
          if (existing.requestHash !== hash) {
            return sendError(reply, 409, 'Stejný Idempotency-Key už byl použit s jiným obsahem. Pro nový kvíz použijte nový klíč.', 'idempotency_conflict');
          }
          if (existing.response) return reply.code(201).header('idempotent-replayed', 'true').send(JSON.parse(existing.response));
        }
      }
      let quiz: StoredQuiz;
      try {
        // without an explicit look a new quiz gets the teacher's default (V7.3)
        const look = result.data.theme === undefined ? s.accounts.defaultTheme(teacherId) : theme;
        quiz = s.quizzes.create(teacherId, { ...result.data, theme: look }, key ? { key, hash } : undefined);
      } catch (e) {
        // concurrent request with the same key
        if (key && /UNIQUE/.test(String(e))) return sendError(reply, 409, 'Požadavek se stejným Idempotency-Key se právě zpracovává. Zkuste to znovu.', 'idempotency_conflict');
        throw e;
      }
      const body = { quizId: quiz.id, reviewUrl: reviewUrl(quiz.id), stats, ...extra };
      if (key) s.quizzes.setIdempotencyResponse(quiz.id, body);
      return reply.code(201).send(body);
    });

    // ---------- read / export ----------
    app.get<QuizParams & { Querystring: { format?: string; includeFlagged?: string; download?: string } }>(
      '/quizzes/:id',
      { config: { scope: 'quizzes:read' } },
      async (req, reply) => {
        const quiz = owned(req.params.id, req.auth!.teacherId, reply);
        if (!quiz) return;
        const format = req.query.format ?? 'json';
        const includeFlagged = req.query.includeFlagged === '1' || req.query.includeFlagged === 'true';
        const summaryHeader = (sum: ExportSummary) => reply.header('x-export-summary', encodeSummary(sum));
        switch (format) {
          case 'json': {
            if (req.query.download === '1') {
              const { data, summary } = jsonExport(quiz);
              summaryHeader(summary);
              return reply.header('content-disposition', attachment(quiz.title, 'json')).send(data);
            }
            const { summary } = jsonExport(quiz);
            summaryHeader(summary);
            return quizResponse(quiz);
          }
          case 'kahoot': {
            const { buffer, summary } = await kahootExport(quiz, {
              template: s.kahootTemplate(),
              includeFlagged,
              maxQuestionLength: s.cfg.kahootMaxQ,
              maxAnswerLength: s.cfg.kahootMaxA,
            });
            summaryHeader(summary);
            return reply
              .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
              .header('content-disposition', attachment(quiz.title, 'xlsx'))
              .send(buffer);
          }
          case 'gift': {
            const { text, summary } = giftExport(quiz, { includeFlagged });
            summaryHeader(summary);
            return reply.type('text/plain; charset=utf-8').header('content-disposition', attachment(quiz.title, 'gift.txt')).send(text);
          }
          default:
            return sendError(reply, 400, 'Neznámý formát. Povolené: json, kahoot, gift.', 'invalid_format');
        }
      },
    );

    /** Export preview for the UI – summary only. */
    app.get<QuizParams & { Querystring: { format?: string; includeFlagged?: string } }>(
      '/quizzes/:id/export-summary',
      { config: { scope: 'quizzes:read' } },
      async (req, reply) => {
        const quiz = owned(req.params.id, req.auth!.teacherId, reply);
        if (!quiz) return;
        const includeFlagged = req.query.includeFlagged === '1';
        if (req.query.format === 'kahoot') {
          const { summary } = await kahootExport(quiz, { template: s.kahootTemplate(), includeFlagged, maxQuestionLength: s.cfg.kahootMaxQ, maxAnswerLength: s.cfg.kahootMaxA });
          return summary;
        }
        if (req.query.format === 'gift') return giftExport(quiz, { includeFlagged }).summary;
        return jsonExport(quiz).summary;
      },
    );

    // ---------- quiz metadata ----------
    app.patch<QuizParams>('/quizzes/:id', { config: { scope: 'quizzes:write' } }, async (req, reply) => {
      const quiz = owned(req.params.id, req.auth!.teacherId, reply);
      if (!quiz) return;
      const r = validateWith(quizMetaPatchSchema, req.body);
      if (!r.ok) return unprocessable(reply, r.errors);
      const { theme: rawTheme, ...meta } = r.data;
      const own = (imageId: string) => s.themeImages.owns(req.auth!.teacherId, imageId);
      const look = rawTheme === undefined ? undefined : ownImageOnly(normalizeTheme(rawTheme, ['theme'], req.auth!.kind === 'session'), own);
      s.quizzes.updateMeta(quiz.id, { ...meta, settings: meta.settings ? { ...quiz.settings, ...meta.settings } : undefined, theme: look?.theme });
      const updated = quizResponse(s.quizzes.get(quiz.id)!);
      return look?.warnings.length ? { ...updated, warnings: look.warnings } : updated;
    });

    app.delete<QuizParams>('/quizzes/:id', { config: { scope: 'quizzes:write' } }, async (req, reply) => {
      const quiz = owned(req.params.id, req.auth!.teacherId, reply);
      if (!quiz) return;
      s.quizzes.delete(quiz.id);
      return reply.code(204).send();
    });

    app.post<QuizParams>('/quizzes/:id/clone', { config: { scope: 'quizzes:write' } }, async (req, reply) => {
      const quiz = owned(req.params.id, req.auth!.teacherId, reply);
      if (!quiz) return;
      const copy = s.quizzes.clone(quiz.id, req.auth!.teacherId);
      return reply.code(201).send({ quizId: copy.id, reviewUrl: reviewUrl(copy.id), stats: quizStats(copy.questions) });
    });

    app.put<QuizParams>('/quizzes/:id/order', { config: { scope: 'quizzes:write' } }, async (req, reply) => {
      const quiz = owned(req.params.id, req.auth!.teacherId, reply);
      if (!quiz) return;
      const body = z.object({ questionIds: z.array(z.string()) }).safeParse(req.body);
      const current = new Set(quiz.questions.map((q) => q.id));
      if (!body.success || body.data.questionIds.length !== current.size || !body.data.questionIds.every((id) => current.has(id)) || new Set(body.data.questionIds).size !== current.size) {
        return sendError(reply, 400, 'Pořadí musí obsahovat všechna ID otázek kvízu právě jednou.', 'invalid_order');
      }
      s.quizzes.reorder(quiz.id, body.data.questionIds);
      return quizResponse(s.quizzes.get(quiz.id)!);
    });

    // ---------- questions ----------
    app.post<QuizParams & { Querystring: { position?: string } }>('/quizzes/:id/questions', { config: { scope: 'quizzes:write' } }, async (req, reply) => {
      const quiz = owned(req.params.id, req.auth!.teacherId, reply);
      if (!quiz) return;
      if (quiz.questions.length >= LIMITS.questionsMax) return unprocessable(reply, [{ path: 'questions', code: 'too_many', message: `Kvíz může mít nejvýše ${LIMITS.questionsMax} otázek.` }]);
      const r = validateQuestion(req.body);
      if (!r.ok) return unprocessable(reply, r.errors);
      const pos = req.query.position !== undefined ? Number.parseInt(req.query.position, 10) : undefined;
      const q = s.quizzes.addQuestion(quiz.id, r.data, Number.isFinite(pos) ? pos : undefined);
      return reply.code(201).send({ question: publicQuestion(q), stats: quizStats(s.quizzes.get(quiz.id)!.questions) });
    });

    app.patch<QuestionParams>('/quizzes/:id/questions/:qid', { config: { scope: 'quizzes:write' } }, async (req, reply) => {
      const quiz = owned(req.params.id, req.auth!.teacherId, reply);
      if (!quiz) return;
      const existing = quiz.questions.find((q) => q.id === req.params.qid);
      if (!existing) return sendError(reply, 404, 'Otázka nenalezena.', 'not_found');
      const patch = validateWith(questionPatchSchema, req.body);
      if (!patch.ok) return unprocessable(reply, patch.errors);
      // Only keys that were actually sent are applied (zod defaults of the partial schema are ignored).
      const sent = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const applied = Object.fromEntries(Object.entries(patch.data).filter(([k]) => k in sent));
      const { id: _id, position: _pos, approvedAt, ...base } = existing;
      const merged: Record<string, unknown> = { ...base, ...applied };
      // changing the type resets type specific fields that were not sent
      if ('type' in applied && applied.type !== existing.type) {
        for (const k of ['options', 'correctIndices', 'acceptedAnswers', 'numericAnswer', 'numericTolerance'] as const) if (!(k in sent)) delete merged[k];
      }
      const r = validateQuestion(merged);
      if (!r.ok) return unprocessable(reply, r.errors);
      const next = r.data;
      let nextApproved = approvedAt;
      const canApprove = req.auth!.scopes.has(APPROVE_SCOPE);
      if (existing.qa.status === 'flagged' && next.qa.status === 'ok') {
        // contract 2.5: a flagged question stays flagged until the teacher approves it
        if (!canApprove) {
          return sendError(reply, 403, 'Otázku ve stavu flagged může schválit jen učitel v aplikaci. Po opravě zůstává ke kontrole.', 'forbidden');
        }
        nextApproved = Date.now();
      }
      if (next.qa.status === 'flagged') nextApproved = null;
      s.quizzes.replaceQuestion(quiz.id, existing.id, next, nextApproved);
      return { question: publicQuestion(s.quizzes.getQuestion(quiz.id, existing.id)!), stats: quizStats(s.quizzes.get(quiz.id)!.questions) };
    });

    app.delete<QuestionParams>('/quizzes/:id/questions/:qid', { config: { scope: 'quizzes:write' } }, async (req, reply) => {
      const quiz = owned(req.params.id, req.auth!.teacherId, reply);
      if (!quiz) return;
      if (!quiz.questions.some((q) => q.id === req.params.qid)) return sendError(reply, 404, 'Otázka nenalezena.', 'not_found');
      s.quizzes.deleteQuestion(quiz.id, req.params.qid);
      return reply.code(204).send();
    });

    app.post<QuestionParams>('/quizzes/:id/questions/:qid/duplicate', { config: { scope: 'quizzes:write' } }, async (req, reply) => {
      const quiz = owned(req.params.id, req.auth!.teacherId, reply);
      if (!quiz) return;
      const src = quiz.questions.find((q) => q.id === req.params.qid);
      if (!src) return sendError(reply, 404, 'Otázka nenalezena.', 'not_found');
      if (quiz.questions.length >= LIMITS.questionsMax) return sendError(reply, 422, `Kvíz může mít nejvýše ${LIMITS.questionsMax} otázek.`, 'too_many');
      const { id: _id, position, approvedAt: _a, ...rest } = src;
      const q = s.quizzes.addQuestion(quiz.id, rest, position + 1);
      return reply.code(201).send({ question: publicQuestion(q) });
    });

    // ---------- approval (teacher only) ----------
    app.post<QuestionParams>('/quizzes/:id/questions/:qid/approve', { config: { scope: APPROVE_SCOPE } }, async (req, reply) => {
      const quiz = owned(req.params.id, req.auth!.teacherId, reply);
      if (!quiz) return;
      if (!quiz.questions.some((q) => q.id === req.params.qid)) return sendError(reply, 404, 'Otázka nenalezena.', 'not_found');
      s.quizzes.approve(quiz.id, [req.params.qid]);
      return { question: publicQuestion(s.quizzes.getQuestion(quiz.id, req.params.qid)!), stats: quizStats(s.quizzes.get(quiz.id)!.questions) };
    });

    /** "Schválit všechny v pořádku": confirm every question in state ok that was not approved yet. */
    app.post<QuizParams>('/quizzes/:id/approve-ok', { config: { scope: APPROVE_SCOPE } }, async (req, reply) => {
      const quiz = owned(req.params.id, req.auth!.teacherId, reply);
      if (!quiz) return;
      const ids = quiz.questions.filter((q) => q.qa.status === 'ok' && !q.approvedAt).map((q) => q.id);
      s.quizzes.approve(quiz.id, ids);
      return { approved: ids.length, stats: quizStats(s.quizzes.get(quiz.id)!.questions) };
    });

  };

/** Header values must be ASCII – the JSON summary is sent with non-ASCII characters \u-escaped. */
export function encodeSummary(sum: ExportSummary): string {
  return JSON.stringify(sum).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
