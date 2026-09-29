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
      title: 'Lore API',
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
        get: { summary: 'Seznam kvízů (quizzes:read). Každá položka: id, title, questionCount, flaggedCount, updatedAt, theme, tags, avgSuccess (průměrná úspěšnost dokončených her a testů v %, nebo null) a classes ({id, name} tříd, ve kterých se hrál).', responses: { 200: { description: 'OK' }, ...std } },
        post: {
          summary:
            'Vložit kvíz (quizzes:write). Volitelný vzhled "theme": {"motive", "accent"} (id z GET /themes a akcenty fialova, modra, azurova, zelena, jantarova, koralova, ruzova, grafitova). Neznámé id se ignoruje a odpověď obsahuje "warnings" (nikdy 422); vlastní obrázek (imageId) přes API nastavit nelze. Bez "theme" dostane kvíz výchozí vzhled učitele. Otázka může mít "imageId" už nahraného obrázku; samotné nahrání jde jen z přihlášeného prohlížeče (POST /api/theme-images), ne tokenem. Typ "image-label" vyžaduje "imageId" a 1–10 položek "imageLabels" {text, x, y, radius} se souřadnicemi jako podíl šířky/výšky 0..1.',
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
          summary: 'Vytvořit živou hru (mode "live") nebo test (mode "test", nastavení v settings.test) (games:write). Třídní hra: settings.classId (+ classes:read), label, allowGuests, countInStats; audience je vždy celá třída. settings.theme {motive, accent} změní vzhled jen této hry; vzhled se při vytvoření hry zmrazí.',
          parameters: [idParam('id')],
          requestBody: { ...json({ $ref: '#/components/schemas/CreateGame' }) },
          responses: {
            201: {
              description: 'Hra vytvořena',
              ...json({ type: 'object', properties: { gameId: { type: 'string' }, pin: { type: 'string' }, joinUrl: { type: 'string' }, hostUrl: { type: 'string' } } }),
            },
            404: { description: 'Neznámý kvíz nebo nepřístupná třída', ...json(simpleError) },
            409: { description: 'Kvíz nemá hratelnou otázku (všechny flagged) nebo je třída archivovaná', ...json(simpleError) },
            ...std,
          },
        },
      },
      '/games/{id}/end': { post: { summary: 'Ukončit hru nebo test (games:write). U testu se rozpracované pokusy odevzdají.', parameters: [idParam('id')], responses: { 200: { description: 'OK' }, ...std } } },
      '/games/{id}': { get: { summary: 'Stav hry (games:read). Test: {mode:"test", status, counts:{joined, notStarted, inProgress, submitted}, closesAt}', parameters: [idParam('id')], responses: { 200: { description: '{status, playerCount, currentQuestion}' }, ...std } } },
      '/games/{id}/results': {
        get: { summary: 'Výsledky hry (games:read)', parameters: [idParam('id')], responses: { 200: { description: 'Živá hra: {ranking:[{nickname, score}], perQuestion:[{questionId, successRate, avgTimeMs}]}. Test: {mode:"test", summary:{students, submitted, avgPercent, medianPercent}, students:[{student, percent, status}], perQuestion}. Jména žáků jen s oprávněním results:pii, jinak „Žák N“. U třídní hry (živé i testu) platí totéž: bez results:pii „Žák N“, s ním příjmení a jméno.' }, ...std } },
      },
      '/themes': {
        get: {
          summary: 'Vestavěné motivy pozadí (quizzes:read). Agent motiv volí jen na výslovné přání učitele.',
          responses: {
            200: {
              description: 'Pole motivů',
              ...json({ type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, category: { type: 'string' }, calm: { type: 'boolean', description: 'vhodný pro testy' } } } }),
            },
            ...std,
          },
        },
      },
      '/topics': { get: { summary: 'Dosud použitá témata otázek učitele, pro jednotné pojmenování (quizzes:read). {topics: string[]}', responses: { 200: { description: 'OK' }, ...std } } },
      '/classes': {
        get: {
          summary: 'Třídy, kde je učitel tokenu vlastník nebo editor (classes:read). Bez jmen žáků.',
          responses: { 200: { description: '{classes:[{id, name, schoolYear, subject, status, activeStudents}]}' }, ...std },
        },
      },
      '/classes/{id}/summary': {
        get: {
          summary: 'Souhrn třídy za období (classes:read): jen agregace, žádná jména, kódy ani výsledky jednotlivců. Endpoint pro jednotlivé žáky v API neexistuje.',
          parameters: [idParam('id'), { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } }],
          responses: {
            200: {
              description:
                '{period, activeStudents, activities:[{activityId, label, kind, playedAt, n, participationRate, avgPercent, medianPercent}], testAvg, quizAvg, participationRate, weakTopics:[{topic, successRate, items}], weakQuestions:[{quizId, questionId, prompt, successRate, answers}], notes}. Pod MIN_AGGREGATE_STUDENTS aktivních žáků (nebo výsledků u aktivity) jsou hodnoty null s poznámkou „malá skupina“.',
            },
            404: { description: 'Třída neexistuje nebo k ní token nemá přístup', ...json(simpleError) },
            ...std,
          },
        },
      },
      '/classes/{id}/activities/{activityId}/makeup': {
        post: {
          summary: 'Náhradní termín testu pro nepřítomné žáky (games:write + classes:read, idempotentní). Audience určí server.',
          parameters: [idParam('id'), idParam('activityId')],
          responses: {
            200: { description: 'Existující náhradní termín se stejnou audiencí {gameId, pin, joinUrl, hostUrl, resultsUrl, audienceSize, reused:true}' },
            201: { description: 'Vytvořen {gameId, pin, joinUrl, hostUrl, resultsUrl, audienceSize, reused:false}' },
            404: { description: 'Třída nebo aktivita nenalezena', ...json(simpleError) },
            409: { description: 'Archivovaná třída, aktivita není test, nikdo nechybí', ...json(simpleError) },
            ...std,
          },
        },
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
