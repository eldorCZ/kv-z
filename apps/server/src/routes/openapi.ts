import { createGameSchema, questionPatchSchema, questionSchema, quizSchema } from '@kvizhub/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Services } from '../app.js';

const errorSchema = {
  type: 'object',
  properties: {
    errors: {
      type: 'array',
      items: { type: 'object', properties: { path: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' } }, required: ['path', 'code', 'message'] },
    },
  },
};
const simpleError = { type: 'object', properties: { error: { type: 'string' }, code: { type: 'string' } } };

const json = (schema: object) => ({ content: { 'application/json': { schema } } });

export function buildOpenApi(publicUrl: string) {
  const toSchema = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });
  const quizCreated = {
    type: 'object',
    properties: {
      quizId: { type: 'string' },
      reviewUrl: { type: 'string' },
      stats: { type: 'object', properties: { total: { type: 'integer' }, ok: { type: 'integer' }, flagged: { type: 'integer' } } },
    },
  };
  const std = { 401: { description: 'Chybí nebo je neplatný token', ...json(simpleError) }, 403: { description: 'Chybí oprávnění', ...json(simpleError) }, 429: { description: 'Rate limit', ...json(simpleError) } };
  const idParam = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string' } });
  return {
    openapi: '3.1.0',
    info: {
      title: 'KvizHub API',
      version: '1.0.0',
      description: 'API pro vkládání kvízů agentem a spouštění her. Autentizace: Authorization: Bearer <token>. Chyby validace vrací 422 {errors:[{path,code,message}]} s českými zprávami.',
    },
    servers: [{ url: `${publicUrl}/api/v1` }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Quiz: toSchema(quizSchema),
        Question: toSchema(questionSchema),
        QuestionPatch: toSchema(questionPatchSchema),
        CreateGame: toSchema(createGameSchema),
        ValidationErrors: errorSchema,
        Error: simpleError,
      },
    },
    paths: {
      '/quizzes': {
        get: { summary: 'Seznam kvízů (quizzes:read)', responses: { 200: { description: 'OK' }, ...std } },
        post: {
          summary: 'Vložit kvíz (quizzes:write)',
          parameters: [
            { name: 'dry_run', in: 'query', schema: { type: 'string', enum: ['1'] }, description: 'Jen validace, nic se neuloží (200 {valid, stats}).' },
            { name: 'Idempotency-Key', in: 'header', schema: { type: 'string' }, description: 'Doporučeno. Stejný klíč + obsah vrátí původní odpověď, jiný obsah 409.' },
          ],
          requestBody: { required: true, ...json({ $ref: '#/components/schemas/Quiz' }) },
          responses: {
            201: { description: 'Vytvořeno', ...json(quizCreated) },
            200: { description: 'dry_run: platné' },
            409: { description: 'Idempotency-Key s jiným obsahem', ...json(simpleError) },
            413: { description: 'Tělo větší než 2 MB' },
            422: { description: 'Neplatný kvíz', ...json({ $ref: '#/components/schemas/ValidationErrors' }) },
            ...std,
          },
        },
      },
      '/quizzes/{id}': {
        get: {
          summary: 'Kvíz nebo export (quizzes:read). Hlavička X-Export-Summary obsahuje JSON souhrn exportu.',
          parameters: [
            idParam('id'),
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'kahoot', 'gift'] } },
            { name: 'includeFlagged', in: 'query', schema: { type: 'string', enum: ['1'] } },
            { name: 'download', in: 'query', schema: { type: 'string', enum: ['1'] }, description: 'format=json: čistý kontrakt ke stažení' },
          ],
          responses: { 200: { description: 'OK' }, 404: { description: 'Nenalezeno' }, ...std },
        },
      },
      '/quizzes/{id}/questions': {
        post: {
          summary: 'Přidat otázku (quizzes:write)',
          parameters: [idParam('id')],
          requestBody: { required: true, ...json({ $ref: '#/components/schemas/Question' }) },
          responses: { 201: { description: 'Vytvořeno' }, 422: { description: 'Neplatná otázka', ...json({ $ref: '#/components/schemas/ValidationErrors' }) }, ...std },
        },
      },
      '/quizzes/{id}/questions/{qid}': {
        patch: {
          summary: 'Částečná změna otázky (quizzes:write). Flagged otázka zůstává flagged, dokud ji neschválí učitel.',
          parameters: [idParam('id'), idParam('qid')],
          requestBody: { required: true, ...json({ $ref: '#/components/schemas/QuestionPatch' }) },
          responses: { 200: { description: 'OK' }, 422: { description: 'Neplatná otázka', ...json({ $ref: '#/components/schemas/ValidationErrors' }) }, ...std },
        },
        delete: { summary: 'Smazat otázku (quizzes:write)', parameters: [idParam('id'), idParam('qid')], responses: { 204: { description: 'Smazáno' }, ...std } },
      },
      '/quizzes/{id}/games': {
        post: {
          summary: 'Vytvořit hru (games:write)',
          parameters: [idParam('id')],
          requestBody: { ...json({ $ref: '#/components/schemas/CreateGame' }) },
          responses: {
            201: {
              description: 'Hra vytvořena',
              ...json({ type: 'object', properties: { gameId: { type: 'string' }, pin: { type: 'string' }, joinUrl: { type: 'string' }, hostUrl: { type: 'string' } } }),
            },
            409: { description: 'Kvíz nemá hratelnou otázku (všechny flagged)', ...json(simpleError) },
            ...std,
          },
        },
      },
      '/games/{id}': { get: { summary: 'Stav hry (games:read)', parameters: [idParam('id')], responses: { 200: { description: '{status, playerCount, currentQuestion}' }, ...std } } },
      '/games/{id}/results': {
        get: { summary: 'Výsledky hry (games:read)', parameters: [idParam('id')], responses: { 200: { description: '{ranking:[{nickname, score}], perQuestion:[{questionId, successRate, avgTimeMs}]}' }, ...std } },
      },
    },
  };
}

export const openapiRoutes =
  (s: Services): FastifyPluginAsync =>
  async (app) => {
    const doc = buildOpenApi(s.cfg.publicUrl);
    app.get('/openapi.json', { config: { public: true } }, async () => doc);
  };
