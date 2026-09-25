import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import type { ClientToServerEvents, ServerToClientEvents } from '@kvizhub/core';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Server } from 'socket.io';
import { createAuthProvider, type AuthProvider } from './auth/provider.js';
import type { Config } from './config.js';
import { openDb, type Db } from './db/index.js';
import { GameManager, type LiveGame } from './game/engine.js';
import { GameService, HttpError } from './game/service.js';
import { SESSION_COOKIE, setupSockets } from './game/socket.js';
import { AccountRepo, APPROVE_SCOPE, TOKEN_SCOPES, type Scope } from './repo/accounts.js';
import { GameRepo } from './repo/games.js';
import { QuizRepo } from './repo/quizzes.js';
import { AttemptRepo } from './repo/attempts.js';
import { ClassService } from './classes/service.js';
import { EvidenceService } from './classes/evidence.js';
import { ClassOverview } from './classes/overview.js';
import { ClassGameAdmin, ClassGames } from './classes/class-games.js';
import { rosterRoutes } from './routes/roster.js';
import { classRoutes } from './routes/classes.js';
import { TestService } from './test-mode/service.js';
import { LeaveGuardService } from './test-mode/leave-guard.js';
import { playTestRoutes } from './routes/play-test.js';
import { authRoutes } from './routes/auth.js';
import { gameRoutes } from './routes/games.js';
import { openapiRoutes } from './routes/openapi.js';
import { quizRoutes } from './routes/quizzes.js';
import { tokenRoutes } from './routes/tokens.js';
import { hmac, RateLimiter } from './util.js';

export interface AuthContext {
  kind: 'session' | 'token';
  teacherId: string;
  scopes: Set<Scope>;
  tokenId?: string;
  sessionId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
  interface FastifyContextConfig {
    /** required scope; session auth holds every scope */
    scope?: Scope;
    /** only a logged-in teacher (cookie session) may call this route */
    sessionOnly?: boolean;
    /** route handles authentication itself (public) */
    public?: boolean;
  }
}

export interface Services {
  cfg: Config;
  db: Db;
  accounts: AccountRepo;
  quizzes: QuizRepo;
  gameRepo: GameRepo;
  games: GameManager;
  gameService: GameService;
  auth: AuthProvider;
  loginLimiter: RateLimiter;
  kahootTemplate: () => Buffer;
  attempts: AttemptRepo;
  classes: ClassService;
  evidence: EvidenceService;
  overview: ClassOverview;
  classGames: ClassGames;
  classAdmin: ClassGameAdmin;
  testService: TestService;
  now: () => number;
}

export function csrfToken(cfg: Config, sessionId: string) {
  return hmac(cfg.sessionSecret, `csrf:${sessionId}`);
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function sendError(reply: FastifyReply, status: number, message: string, code = 'error') {
  return reply.code(status).send({ error: message, code });
}

export interface BuildOptions {
  /** injectable clock (tests use fake time) */
  now?: () => number;
}

export async function buildApp(cfg: Config, opts: BuildOptions = {}): Promise<{ app: FastifyInstance; io: Server; services: Services }> {
  const now = opts.now ?? Date.now;
  const app = Fastify({
    logger: {
      level: cfg.logLevel,
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'], remove: true },
      serializers: {
        req: (req: FastifyRequest) => ({ method: req.method, url: req.url.replace(/[?#].*$/, ''), length: req.headers['content-length'] }),
      },
    },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: cfg.trustProxy,
  });

  const db = openDb(cfg.dbPath);
  const accounts = new AccountRepo(db);
  const quizzes = new QuizRepo(db);
  const gameRepo = new GameRepo(db);
  gameRepo.abortUnfinished();

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    path: '/socket.io',
    serveClient: false,
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 10_000,
    pingTimeout: 10_000,
  });

  const hooks: { gameService?: GameService; onLiveFinished?: (g: LiveGame) => void } = {};
  const games = new GameManager({
    io,
    repo: gameRepo,
    log: app.log,
    hostTimeoutMs: cfg.hostTimeoutMs,
    pinLength: cfg.pinLength,
    onFinished: (g) => {
      hooks.onLiveFinished?.(g);
      void hooks.gameService?.notifyFinished(g);
    },
  });
  const attempts = new AttemptRepo(db);
  const leaveGuard = new LeaveGuardService(db, attempts, cfg.heartbeatGapSec * 1000);
  const testService = new TestService(cfg, gameRepo, attempts, quizzes, games, app.log, now, leaveGuard);
  const gameService = new GameService(cfg, gameRepo, quizzes, games, app.log, (p) => testService.isOpenPin(p));
  hooks.gameService = gameService;

  let templateCache: Buffer | undefined;
  const classes = new ClassService(cfg, db, now);
  const evidence = new EvidenceService(cfg, db, now, gameRepo);
  const classGames = new ClassGames(classes, evidence, gameRepo, games, () => testService, now);
  gameService.classGames = classGames;
  testService.classGames = classGames;
  // class records (C7.1): tests are written on every finalisation, live games when they end
  testService.onFinalize = (g) => evidence.materializeGame(g.id);
  hooks.onLiveFinished = (g) => {
    if (!g.row.classId) return;
    gameRepo.setPlayed(g.id, g.playedQuestionIds());
    evidence.materializeGame(g.id);
  };
  games.setHooks({
    onStarted: (g) => {
      if (g.row.activityId) evidence.setPlayedAt(g.row.activityId, now());
    },
    hostExtras: (g) => {
      if (!g.row.classId) return {};
      const joined = new Set([...g.players.values()].map((p) => p.studentId).filter((x): x is string => !!x));
      return { classGame: true, notJoined: classGames.notJoined(g.row, joined), codeAlert: classGames.codeAlert(g.id) };
    },
  });

  const services: Services = {
    cfg,
    db,
    accounts,
    quizzes,
    gameRepo,
    games,
    gameService,
    auth: createAuthProvider(cfg.authProvider, accounts),
    loginLimiter: new RateLimiter(10, 60_000),
    attempts,
    classes,
    evidence,
    overview: new ClassOverview(cfg, classes, evidence, gameRepo),
    classGames,
    classAdmin: new ClassGameAdmin(classGames, classes, evidence, gameRepo, quizzes, () => testService, cfg, now),
    testService,
    now,
    kahootTemplate: () => {
      if (!templateCache) {
        if (!existsSync(cfg.kahootTemplatePath)) throw new HttpError(500, 'Chybí šablona Kahoot (fixtures/kahoot-template.xlsx).', 'template_missing');
        templateCache = readFileSync(cfg.kahootTemplatePath);
      }
      return templateCache;
    },
  };

  setupSockets({ io, games, accounts, log: app.log, trustProxy: cfg.trustProxy, publicUrl: cfg.publicUrl, joinLimit: cfg.joinRateLimit, classGames });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
    hsts: cfg.publicUrl.startsWith('https://') ? undefined : false,
  });

  const apiLimiter = new RateLimiter(cfg.apiRateLimit, 60_000);

  // ---------- authentication ----------
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const authz = req.headers.authorization;
    if (authz) {
      const m = /^Bearer\s+(\S+)$/i.exec(authz);
      const token = m ? services.accounts.findToken(m[1]!) : undefined;
      const now = Date.now();
      if (!token || token.revokedAt || (token.expiresAt && token.expiresAt < now)) {
        return sendError(reply, 401, 'Neplatný, expirovaný nebo odvolaný API token. Vytvořte nový v Nastavení → API tokeny.', 'invalid_token');
      }
      const wait = apiLimiter.hit(`t:${token.id}`);
      if (wait) {
        reply.header('retry-after', String(wait));
        req.auth = { kind: 'token', teacherId: token.teacherId, scopes: new Set(), tokenId: token.id };
        return sendError(reply, 429, `Příliš mnoho požadavků (limit ${cfg.apiRateLimit} za minutu). Zkuste to za ${wait} s.`, 'rate_limited');
      }
      const scopes = (JSON.parse(token.scopesJson) as string[]).filter((s): s is Scope => (TOKEN_SCOPES as readonly string[]).includes(s));
      req.auth = { kind: 'token', teacherId: token.teacherId, scopes: new Set(scopes), tokenId: token.id };
      services.accounts.touchToken(token.id);
      return;
    }
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) {
      const s = services.accounts.getSession(sid);
      if (s) {
        req.auth = { kind: 'session', teacherId: s.teacherId, scopes: new Set<Scope>([...TOKEN_SCOPES, APPROVE_SCOPE]), sessionId: sid };
      }
    }
  });

  app.addHook('preHandler', async (req, reply) => {
    const rc = req.routeOptions.config;
    if (rc.public || !req.url.startsWith('/api/')) return;
    if (!req.auth) return sendError(reply, 401, 'Chybí přihlášení nebo API token (hlavička Authorization: Bearer ...).', 'unauthorized');
    if (rc.sessionOnly && req.auth.kind !== 'session') return sendError(reply, 403, 'Tuto akci může provést jen přihlášený učitel v aplikaci.', 'session_required');
    if (req.auth.kind === 'session' && MUTATING.has(req.method)) {
      const header = req.headers['x-csrf-token'];
      if (typeof header !== 'string' || header !== csrfToken(cfg, req.auth.sessionId!)) {
        return sendError(reply, 403, 'Neplatný CSRF token. Obnovte stránku a zkuste to znovu.', 'csrf');
      }
    }
    if (rc.scope && !req.auth.scopes.has(rc.scope)) {
      const msg =
        rc.scope === APPROVE_SCOPE
          ? 'Schvalovat otázky může jen učitel v aplikaci, API token toto oprávnění nemá.'
          : `API token nemá oprávnění ${rc.scope}.`;
      return sendError(reply, 403, msg, 'forbidden');
    }
  });

  // audit log: metadata only, never tokens or bodies
  app.addHook('onResponse', async (req, reply) => {
    if (req.auth?.kind === 'token') {
      services.accounts.audit(req.auth.tokenId ?? null, `${req.method} ${req.routeOptions.url ?? req.url.replace(/\?.*$/, '')}`, reply.statusCode);
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) {
      const errors = (err as HttpError & { errors?: unknown[] }).errors;
      if (err.status === 422 && errors) return reply.code(422).send({ errors });
      return sendError(reply, err.status, err.message, err.code);
    }
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return sendError(reply, 413, 'Tělo požadavku je příliš velké (max. 2 MB).', 'too_large');
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return sendError(reply, 415, 'Pošlete data jako JSON (Content-Type: application/json).', 'unsupported_media_type');
    if (err.statusCode === 400 || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      return sendError(reply, 400, 'Tělo požadavku není platný JSON.', 'invalid_json');
    }
    req.log.error({ err }, 'unhandled error');
    return sendError(reply, 500, 'Interní chyba serveru. Zkuste to prosím znovu.', 'internal');
  });

  app.get('/healthz', { config: { public: true }, logLevel: 'warn' }, async () => ({ status: 'ok', activeGames: games.activeCount() }));

  await app.register(authRoutes(services), { prefix: '/api/auth' });
  await app.register(tokenRoutes(services), { prefix: '/api/tokens' });
  await app.register(quizRoutes(services), { prefix: '/api/v1' });
  await app.register(gameRoutes(services), { prefix: '/api/v1' });
  await app.register(openapiRoutes(services), { prefix: '/api/v1' });
  await app.register(classRoutes(services), { prefix: '/api/v1' });
  await app.register(playTestRoutes(services), { prefix: '/play/test' });
  await app.register(rosterRoutes(services), { prefix: '/play/roster' });

  // D5.6: expire attempts after their deadline and close tests (every 5 s)
  const testTimer = setInterval(() => {
    try {
      testService.tick();
    } catch (err) {
      app.log.error({ err }, 'test tick failed');
    }
  }, 5000);
  testTimer.unref();

  // ---------- static web app (SPA) ----------
  const indexHtml = join(cfg.webDist, 'index.html');
  if (existsSync(indexHtml)) {
    await app.register(fastifyStatic, { root: cfg.webDist, wildcard: false, index: false, maxAge: '1h' });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/play/test/') && !req.url.startsWith('/play/roster/') && !req.url.startsWith('/socket.io') && existsSync(indexHtml)) {
      return reply.type('text/html').header('cache-control', 'no-cache').send(readFileSync(indexHtml));
    }
    return sendError(reply, 404, 'Nenalezeno.', 'not_found');
  });

  app.addHook('preClose', async () => {
    clearInterval(testTimer);
    games.shutdown();
    io.disconnectSockets(true);
  });
  app.addHook('onClose', async () => {
    db.$client.close();
  });

  return { app, io, services };
}
