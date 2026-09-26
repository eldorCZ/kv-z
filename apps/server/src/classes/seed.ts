import type Database from 'better-sqlite3';
import { newId } from '../util.js';

export interface SeedItem {
  topic: string | null;
  prompt: string;
  questionId?: string | null;
  weight?: number;
  scoreMilli: number;
}

export interface SeedResult {
  studentId: string;
  percent: number;
  excluded?: boolean;
  items?: SeedItem[];
}

export interface SeedActivity {
  classId: string;
  kind: 'quiz' | 'test';
  label: string;
  playedAt: number;
  rosterSize: number;
  countInStats?: boolean;
  rootActivityId?: string | null;
  results: SeedResult[];
}

/**
 * Writes an activity with results straight into the records, without playing a game.
 * Used by the demo seed (pnpm seed:demo-class) and by tests of the overviews.
 */
export function insertActivity(db: Database.Database, a: SeedActivity): string {
  const id = newId();
  const now = a.playedAt;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO class_activities (id, class_id, game_id, kind, label, quiz_id, quiz_title, played_at, count_in_stats, root_activity_id, roster_size, created_at)
       VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(id, a.classId, a.kind, a.label, a.label, a.playedAt, a.countInStats === false ? 0 : 1, a.rootActivityId ?? null, a.rosterSize, now);
    const res = db.prepare(
      `INSERT INTO activity_results (id, activity_id, student_id, status, percent, points_centi, max_points_centi, answered_count, question_count, excluded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const item = db.prepare(
      'INSERT INTO result_items (activity_result_id, position, question_id, prompt_snapshot, topic, bloom, difficulty, weight, score_milli, answered) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1)',
    );
    for (const r of a.results) {
      const rid = newId();
      const n = r.items?.length ?? 0;
      res.run(rid, id, r.studentId, a.kind === 'test' ? 'submitted' : 'completed', r.percent, r.percent * 100, 10_000, n, n, r.excluded ? 1 : 0, now, now);
      r.items?.forEach((it, pos) => item.run(rid, pos, it.questionId ?? null, it.prompt, it.topic, it.weight ?? 1, it.scoreMilli));
    }
  })();
  return id;
}
