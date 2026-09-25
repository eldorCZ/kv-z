import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export interface Config {
  publicUrl: string;
  sessionSecret: string;
  bindAddr: string;
  port: number;
  pinLength: number;
  retentionDays: number;
  /** test mode: student names are replaced by "Žák N" after this many days (D9) */
  testNameRetentionDays: number;
  /** leave guard: missing heartbeats longer than this are stored as unconfirmed gaps (G4.4) */
  heartbeatGapSec: number;
  // Dodatek 3 (C9.4): classes are enabled only with a CODE_PEPPER of >= 32 characters
  codePepper: string;
  classRetentionMonths: number;
  accessLogRetentionMonths: number;
  minTopicItems: number;
  minAggregateStudents: number;
  maxStudentsPerClass: number;
  webhookUrl: string;
  webhookSecret: string;
  kahootMaxQ: number;
  kahootMaxA: number;
  dbPath: string;
  webDist: string;
  kahootTemplatePath: string;
  trustProxy: boolean;
  logLevel: string;
  /** host disconnect grace period before the game is ended */
  hostTimeoutMs: number;
  apiRateLimit: number;
  /** join attempts per IP per minute */
  joinRateLimit: number;
  authProvider: 'local' | 'oidc';
  allowRegistration: boolean;
  seedSampleQuiz: boolean;
}

const repoRoot = join(import.meta.dirname, '../../..');

function int(v: string | undefined, d: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  let sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    if (env.NODE_ENV === 'production') throw new Error('SESSION_SECRET musí mít alespoň 32 znaků (vygenerujte: openssl rand -hex 32).');
    sessionSecret = randomBytes(32).toString('hex');
  }
  const cfg: Config = {
    publicUrl: (env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    sessionSecret,
    bindAddr: env.BIND_ADDR ?? '127.0.0.1',
    port: int(env.APP_PORT, 3000),
    pinLength: int(env.GAME_PIN_LENGTH, 6),
    retentionDays: int(env.RETENTION_DAYS, 365),
    testNameRetentionDays: int(env.TEST_NAME_RETENTION_DAYS, 30),
    heartbeatGapSec: int(env.HEARTBEAT_GAP_SEC, 25),
    codePepper: env.CODE_PEPPER ?? '',
    classRetentionMonths: int(env.CLASS_RETENTION_MONTHS, 12),
    accessLogRetentionMonths: int(env.ACCESS_LOG_RETENTION_MONTHS, 24),
    minTopicItems: int(env.MIN_TOPIC_ITEMS, 5),
    minAggregateStudents: int(env.MIN_AGGREGATE_STUDENTS, 5),
    maxStudentsPerClass: int(env.MAX_STUDENTS_PER_CLASS, 60),
    webhookUrl: env.API_WEBHOOK_URL ?? '',
    webhookSecret: env.API_WEBHOOK_SECRET ?? '',
    kahootMaxQ: int(env.EXPORT_KAHOOT_MAX_Q, 95),
    kahootMaxA: int(env.EXPORT_KAHOOT_MAX_A, 60),
    dbPath: env.DB_PATH ?? join(repoRoot, 'data/kvizhub.db'),
    webDist: env.WEB_DIST ?? join(repoRoot, 'apps/web/dist'),
    kahootTemplatePath: env.KAHOOT_TEMPLATE_PATH ?? join(repoRoot, 'fixtures/kahoot-template.xlsx'),
    trustProxy: (env.TRUST_PROXY ?? '1') !== '0',
    logLevel: env.LOG_LEVEL ?? 'info',
    hostTimeoutMs: int(env.HOST_TIMEOUT_MS, 120_000),
    apiRateLimit: int(env.API_RATE_LIMIT, 60),
    joinRateLimit: int(env.JOIN_RATE_LIMIT, 10),
    authProvider: env.AUTH_PROVIDER === 'oidc' ? 'oidc' : 'local',
    allowRegistration: (env.ALLOW_REGISTRATION ?? '1') !== '0',
    seedSampleQuiz: (env.SEED_SAMPLE_QUIZ ?? '1') !== '0',
    ...overrides,
  };
  return cfg;
}

export const classesEnabled = (cfg: Config) => cfg.codePepper.length >= 32;
