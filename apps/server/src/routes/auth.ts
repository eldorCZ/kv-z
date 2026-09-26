import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sanitizeUiPrefs } from '@kvizhub/core';
import { csrfToken, sendError, type Services } from '../app.js';
import { RegistrationError } from '../auth/provider.js';
import { SESSION_COOKIE } from '../game/socket.js';
import { SESSION_TTL_MS } from '../repo/accounts.js';
import { classesEnabled } from '../config.js';
import { seedSampleQuiz } from '../seed.js';

const credentials = z.object({ email: z.string().max(200), password: z.string().max(200) });

export const authRoutes =
  (s: Services): FastifyPluginAsync =>
  async (app) => {
    const cookieOpts = {
      path: '/',
      httpOnly: true,
      sameSite: 'lax' as const, // lax: links from Telegram (reviewUrl) must keep the teacher logged in; CSRF token protects mutations
      secure: s.cfg.publicUrl.startsWith('https://'),
      maxAge: SESSION_TTL_MS / 1000,
    };

    const startSession = (teacherId: string) => {
      const sid = randomBytes(32).toString('base64url');
      s.accounts.createSession(teacherId, sid);
      return sid;
    };

    const limited = (ip: string) => s.loginLimiter.hit(ip);

    app.get('/config', { config: { public: true } }, async () => ({
      provider: s.auth.name,
      allowRegistration: s.cfg.allowRegistration && s.auth.supportsPassword,
      classesEnabled: classesEnabled(s.cfg),
      appName: s.cfg.appName,
      designPage: s.cfg.designPage,
    }));

    app.post('/register', { config: { public: true } }, async (req, reply) => {
      if (!s.cfg.allowRegistration || !s.auth.register) return sendError(reply, 403, 'Registrace je vypnutá. Požádejte správce o účet.', 'registration_disabled');
      const wait = limited(req.ip);
      if (wait) return sendError(reply, 429, `Příliš mnoho pokusů. Zkuste to za ${wait} s.`, 'rate_limited');
      const body = credentials.safeParse(req.body);
      if (!body.success) return sendError(reply, 400, 'Vyplňte e-mail a heslo.', 'invalid');
      try {
        const t = await s.auth.register(body.data.email, body.data.password);
        if (s.cfg.seedSampleQuiz) seedSampleQuiz(s.quizzes, t.id);
        const sid = startSession(t.id);
        reply.setCookie(SESSION_COOKIE, sid, cookieOpts);
        return { teacher: t, csrfToken: csrfToken(s.cfg, sid), uiPrefs: s.accounts.uiPrefs(t.id) };
      } catch (e) {
        if (e instanceof RegistrationError) return sendError(reply, 400, e.message, 'invalid');
        throw e;
      }
    });

    app.post('/login', { config: { public: true } }, async (req, reply) => {
      const wait = limited(req.ip);
      if (wait) return sendError(reply, 429, `Příliš mnoho pokusů o přihlášení. Zkuste to za ${wait} s.`, 'rate_limited');
      const body = credentials.safeParse(req.body);
      if (!body.success || !s.auth.login) return sendError(reply, 400, 'Vyplňte e-mail a heslo.', 'invalid');
      const t = await s.auth.login(body.data.email, body.data.password);
      if (!t) return sendError(reply, 401, 'Nesprávný e-mail nebo heslo.', 'invalid_credentials');
      const sid = startSession(t.id);
      reply.setCookie(SESSION_COOKIE, sid, cookieOpts);
      return { teacher: t, csrfToken: csrfToken(s.cfg, sid), uiPrefs: s.accounts.uiPrefs(t.id) };
    });

    app.post('/logout', { config: { public: true } }, async (req, reply) => {
      const sid = req.cookies[SESSION_COOKIE];
      if (sid) s.accounts.deleteSession(sid);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    });

    app.get('/me', { config: { public: true } }, async (req, reply) => {
      if (req.auth?.kind !== 'session') return sendError(reply, 401, 'Nejste přihlášeni.', 'unauthorized');
      const t = s.accounts.getTeacher(req.auth.teacherId);
      if (!t) return sendError(reply, 401, 'Nejste přihlášeni.', 'unauthorized');
      return { teacher: { id: t.id, email: t.email }, csrfToken: csrfToken(s.cfg, req.auth.sessionId!), uiPrefs: s.accounts.uiPrefs(t.id) };
    });

    /** Appearance preferences of the teacher (V5.3); unknown values are replaced by defaults. */
    app.put('/prefs', { config: { sessionOnly: true } }, async (req) => {
      const prefs = sanitizeUiPrefs(req.body);
      s.accounts.setUiPrefs(req.auth!.teacherId, prefs);
      return { uiPrefs: prefs };
    });
  };
