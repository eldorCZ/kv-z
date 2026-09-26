import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { sendError, type Services } from '../app.js';
import type { ClassRole } from '../classes/service.js';
import { classesEnabled } from '../config.js';

type ClassParams = { Params: { id: string } };
type StudentParams = { Params: { id: string; sid: string } };

/** Classes and roster (Dodatek 3, C4). Everything except the class list is available only to a logged-in teacher. */
export const classRoutes =
  (s: Services): FastifyPluginAsync =>
  async (app) => {
    app.addHook('preHandler', async (_req, reply) => {
      if (!classesEnabled(s.cfg)) return sendError(reply, 404, 'Třídy nejsou zapnuté (chybí CODE_PEPPER v konfiguraci).', 'classes_disabled');
    });

    const access = (req: FastifyRequest<ClassParams>, role: ClassRole) => s.classes.assertClassAccess(req.auth!.teacherId, req.params.id, role);
    const pub = (st: ReturnType<Services['classes']['students']>[number]) => st;

    // token (classes:read) sees only classes where the teacher is owner/editor, without names (C10.3)
    app.get('/classes', { config: { scope: 'classes:read' } }, async (req) => {
      const session = req.auth!.kind === 'session';
      const list = s.classes.list(req.auth!.teacherId, session ? 'viewer' : 'editor');
      return {
        classes: list.map((c) => ({
          id: c.id,
          name: c.name,
          schoolYear: c.schoolYear,
          subject: c.subject,
          status: c.status,
          activeStudents: s.classes.students(c.id).filter((x) => x.active).length,
          ...(session ? { role: c.role, ...s.evidence.classCard(c.id) } : {}),
        })),
      };
    });

    app.post('/classes', { config: { sessionOnly: true } }, async (req, reply) => {
      const c = s.classes.create(req.auth!.teacherId, req.body);
      return reply.code(201).send(c);
    });

    app.get<ClassParams>('/classes/:id', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req, 'viewer');
      const students = s.classes.students(c.id);
      s.classes.log(req.auth!.teacherId, 'roster_view', c.id, null, students.length);
      return { ...c, anonymizeAt: s.classes.anonymizeAt(c), students: students.map(pub) };
    });

    app.patch<ClassParams>('/classes/:id', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req, 'editor');
      s.classes.update(c, req.body);
      return access(req, 'viewer');
    });

    app.post<ClassParams>('/classes/:id/archive', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req, 'owner');
      s.classes.archive(c);
      return access(req, 'viewer');
    });

    app.delete<ClassParams>('/classes/:id', { config: { sessionOnly: true } }, async (req, reply) => {
      const c = access(req, 'owner');
      s.classes.delete(c, (req.body as { confirmName?: unknown } | undefined)?.confirmName);
      return reply.code(204).send();
    });

    app.post<ClassParams>('/classes/:id/anonymize', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req, 'owner');
      if ((req.body as { confirmName?: unknown } | undefined)?.confirmName !== c.name) return { ok: false, error: 'Pro anonymizaci opište přesný název třídy.' };
      s.classes.anonymize(c.id);
      s.classes.log(req.auth!.teacherId, 'anonymize', c.id);
      return { ok: true };
    });

    app.get<ClassParams>('/classes/:id/access-log', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req, 'owner');
      return { entries: s.classes.accessLog(c.id) };
    });

    // ---------------- agent API (C10.3): aggregates only; tokens need owner/editor
    app.get<ClassParams & { Querystring: { from?: string; to?: string } }>('/classes/:id/summary', { config: { scope: 'classes:read' } }, async (req) => {
      const c = access(req, req.auth!.kind === 'session' ? 'viewer' : 'editor');
      return s.overview.summary(c, req.query);
    });

    // ---------------- overviews (C8)
    type Q = { period?: string; from?: string; to?: string; kind?: string };
    const sepOf = (q: { sep?: string }) => (q.sep === ',' ? ',' : ';');

    app.get<ClassParams & { Querystring: Q }>('/classes/:id/matrix', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req, 'viewer');
      const m = s.overview.matrix(c, req.query);
      s.classes.log(req.auth!.teacherId, 'matrix_view', c.id, null, m.students.length);
      return m;
    });

    app.get<ClassParams>('/classes/:id/activities', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req, 'viewer');
      return { activities: s.overview.activities(c) };
    });

    app.patch<{ Params: { id: string; aid: string } }>('/classes/:id/activities/:aid', { config: { sessionOnly: true } }, async (req, reply) => {
      const c = access(req as unknown as FastifyRequest<ClassParams>, 'editor');
      const count = (req.body as { countInStats?: unknown } | undefined)?.countInStats;
      if (typeof count !== 'boolean') return sendError(reply, 400, 'Chybí countInStats.', 'invalid');
      s.overview.setCountInStats(c, req.params.aid, count);
      return { ok: true };
    });

    app.get<ClassParams & { Querystring: Q }>('/classes/:id/topics', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req, 'viewer');
      return s.overview.topics(c, req.query);
    });

    app.post<ClassParams>('/classes/:id/topics/rename', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req, 'editor');
      const b = (req.body ?? {}) as { from?: unknown; to?: unknown; dryRun?: unknown };
      return s.overview.renameTopic(c, req.auth!.teacherId, String(b.from ?? ''), String(b.to ?? ''), b.dryRun === true);
    });

    app.get<StudentParams>('/classes/:id/students/:sid/profile', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req as unknown as FastifyRequest<ClassParams>, 'viewer');
      const p = s.overview.profile(c, req.params.sid);
      s.classes.log(req.auth!.teacherId, 'profile_view', c.id, req.params.sid, 1);
      return p;
    });

    app.patch<{ Params: { id: string; rid: string } }>('/classes/:id/results/:rid', { config: { sessionOnly: true } }, async (req, reply) => {
      const c = access(req as unknown as FastifyRequest<ClassParams>, 'editor');
      const b = (req.body ?? {}) as { excluded?: unknown; reason?: unknown };
      if (typeof b.excluded !== 'boolean') return sendError(reply, 400, 'Chybí excluded.', 'invalid');
      s.overview.setExcluded(c, req.params.rid, b.excluded, typeof b.reason === 'string' ? b.reason : null);
      return { ok: true };
    });

    app.get<ClassParams & { Querystring: { sep?: string } }>('/classes/:id/export.csv', { config: { sessionOnly: true } }, async (req, reply) => {
      const c = access(req, 'viewer');
      const csv = s.overview.classCsv(c, sepOf(req.query));
      s.classes.log(req.auth!.teacherId, 'export', c.id, null, s.classes.students(c.id).length);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('cache-control', 'no-store')
        .header('content-disposition', `attachment; filename="trida-${c.id.slice(0, 8)}.csv"`)
        .send(csv);
    });

    app.get<StudentParams & { Querystring: { sep?: string } }>('/classes/:id/students/:sid/export.csv', { config: { sessionOnly: true } }, async (req, reply) => {
      const c = access(req as unknown as FastifyRequest<ClassParams>, 'viewer');
      const csv = s.overview.studentCsv(c, req.params.sid, sepOf(req.query));
      s.classes.log(req.auth!.teacherId, 'export', c.id, req.params.sid, 1);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('cache-control', 'no-store')
        .header('content-disposition', `attachment; filename="zak-${req.params.sid.slice(0, 8)}.csv"`)
        .send(csv);
    });

    // ---------------- makeup test (C6.4, C10.3): games:write + classes:read, idempotent
    app.post<{ Params: { id: string; aid: string } }>('/classes/:id/activities/:aid/makeup', { config: { scope: 'games:write' } }, async (req, reply) => {
      if (!req.auth!.scopes.has('classes:read')) return sendError(reply, 403, 'API token nemá oprávnění classes:read.', 'forbidden');
      const r = s.classAdmin.makeup(req.auth!.teacherId, req.params.id, req.params.aid);
      return reply.code(r.reused ? 200 : 201).send(r);
    });

    // ---------------- roster
    app.post<ClassParams>('/classes/:id/students', { config: { sessionOnly: true } }, async (req, reply) => {
      const c = access(req, 'editor');
      // the roster file is parsed in the browser; only accountName and rosterNo arrive here (C4.3)
      const list = (req.body as { students?: unknown } | undefined)?.students;
      if (!Array.isArray(list) || list.length === 0) return sendError(reply, 400, 'Pošlete alespoň jednoho žáka.', 'invalid');
      const created = s.classes.addStudents(c, list);
      s.classes.log(req.auth!.teacherId, 'students_add', c.id, null, created.length);
      // the plain codes are in this response only (C4.4)
      return reply.header('cache-control', 'no-store').code(201).send({ created });
    });

    app.patch<StudentParams>('/classes/:id/students/:sid', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req as unknown as FastifyRequest<ClassParams>, 'editor');
      return s.classes.updateStudent(c, req.params.sid, req.body);
    });

    app.post<StudentParams>('/classes/:id/students/:sid/rotate', { config: { sessionOnly: true } }, async (req, reply) => {
      const c = access(req as unknown as FastifyRequest<ClassParams>, 'editor');
      const out = s.classes.rotate(c, [req.params.sid]);
      s.classes.log(req.auth!.teacherId, 'code_rotate', c.id, req.params.sid, 1);
      return reply.header('cache-control', 'no-store').send({ created: out });
    });

    app.post<ClassParams>('/classes/:id/rotate-all', { config: { sessionOnly: true } }, async (req, reply) => {
      const c = access(req, 'editor');
      const ids = s.classes.students(c.id).filter((x) => x.active).map((x) => x.id);
      const out = s.classes.rotate(c, ids);
      s.classes.log(req.auth!.teacherId, 'code_rotate_all', c.id, null, out.length);
      return reply.header('cache-control', 'no-store').send({ created: out });
    });

    app.post<StudentParams>('/classes/:id/students/:sid/leave', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req as unknown as FastifyRequest<ClassParams>, 'editor');
      return s.classes.setActive(c, req.params.sid, false);
    });

    app.post<StudentParams>('/classes/:id/students/:sid/reactivate', { config: { sessionOnly: true } }, async (req) => {
      const c = access(req as unknown as FastifyRequest<ClassParams>, 'editor');
      return s.classes.setActive(c, req.params.sid, true);
    });

    app.delete<StudentParams>('/classes/:id/students/:sid', { config: { sessionOnly: true } }, async (req, reply) => {
      const c = access(req as unknown as FastifyRequest<ClassParams>, 'owner');
      s.classes.eraseStudent(c, req.params.sid);
      // logged without the name (the student row no longer exists)
      s.classes.log(req.auth!.teacherId, 'student_erase', c.id, null, 1);
      return reply.code(204).send();
    });

    /** The client reports printing cards so that it appears in the access log (C4.8). */
    app.post<ClassParams>('/classes/:id/log', { config: { sessionOnly: true } }, async (req, reply) => {
      const c = access(req, 'viewer');
      const action = (req.body as { action?: unknown } | undefined)?.action;
      if (action !== 'cards_print' && action !== 'overview_print') return sendError(reply, 400, 'Neznámá akce.', 'invalid');
      s.classes.log(req.auth!.teacherId, action, c.id, null, Number((req.body as { count?: unknown }).count) || null);
      return { ok: true };
    });
  };
