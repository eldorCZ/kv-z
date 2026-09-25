import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';

/** Year-long records of a class (Dodatek 3, C7, C8). */
export class EvidenceService {
  protected readonly sql: Database.Database;

  constructor(
    protected readonly cfg: Config,
    db: Db,
    protected readonly now: () => number,
  ) {
    this.sql = db.$client;
  }

  /** Card in the class list (C8.1): last activity and the average of the last test. */
  classCard(classId: string) {
    const last = this.sql
      .prepare('SELECT label, played_at AS playedAt FROM class_activities WHERE class_id = ? ORDER BY played_at DESC LIMIT 1')
      .get(classId) as { label: string; playedAt: number } | undefined;
    const lastTest = this.sql
      .prepare(
        "SELECT a.id, a.label, (SELECT avg(percent) FROM activity_results r JOIN class_activities x ON x.id = r.activity_id WHERE (x.id = a.id OR x.root_activity_id = a.id) AND r.excluded = 0) AS avg FROM class_activities a WHERE a.class_id = ? AND a.kind = 'test' AND a.root_activity_id IS NULL AND a.count_in_stats = 1 ORDER BY a.played_at DESC LIMIT 1",
      )
      .get(classId) as { label: string; avg: number | null } | undefined;
    return {
      lastActivity: last ?? null,
      lastTest: lastTest ? { label: lastTest.label, avgPercent: lastTest.avg === null ? null : Math.round(lastTest.avg) } : null,
    };
  }
}
