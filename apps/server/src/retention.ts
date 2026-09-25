import type { FastifyBaseLogger } from 'fastify';
import type { Services } from './app.js';

const DAY = 24 * 3600 * 1000;

/** Daily job: delete game results and players older than RETENTION_DAYS (quizzes stay), expired sessions and old audit rows. */
export function runRetention(s: Services, log: FastifyBaseLogger, now = Date.now()) {
  const cutoff = now - s.cfg.retentionDays * DAY;
  const games = s.gameRepo.deleteOlderThan(cutoff);
  const names = s.attempts.anonymizeNames(now - s.cfg.testNameRetentionDays * DAY);
  const classes = s.classes.runRetention(now);
  s.accounts.purgeSessions();
  const audit = s.db.$client.prepare('DELETE FROM audit_log WHERE at < ?').run(cutoff).changes;
  log.info({ games, audit, names, classes, retentionDays: s.cfg.retentionDays }, 'retention job finished');
  return { games, audit, names, classes };
}

export function startRetention(s: Services, log: FastifyBaseLogger): () => void {
  runRetention(s, log);
  const t = setInterval(() => runRetention(s, log), DAY);
  t.unref();
  return () => clearInterval(t);
}
