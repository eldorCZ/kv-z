import { buildResultItems, type ItemQuestion } from '@kvizhub/core';
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import type { GameRepo } from '../repo/games.js';
import { newId } from '../util.js';

export interface ActivityRow {
  id: string;
  classId: string;
  gameId: string | null;
  kind: 'quiz' | 'test';
  label: string;
  quizId: string | null;
  quizTitle: string;
  playedAt: number;
  countInStats: boolean;
  rootActivityId: string | null;
  rosterSize: number;
}

function toActivity(r: Record<string, unknown>): ActivityRow {
  return {
    id: r.id as string,
    classId: r.class_id as string,
    gameId: (r.game_id as string | null) ?? null,
    kind: r.kind as ActivityRow['kind'],
    label: r.label as string,
    quizId: (r.quiz_id as string | null) ?? null,
    quizTitle: r.quiz_title as string,
    playedAt: r.played_at as number,
    countInStats: r.count_in_stats === 1,
    rootActivityId: (r.root_activity_id as string | null) ?? null,
    rosterSize: r.roster_size as number,
  };
}

/** since/left_at are dates (YYYY-MM-DD, local school day): eligible when played between them (C7.2). */
export function dayStart(date: string): number {
  return Date.parse(`${date}T00:00:00`);
}
export function dayEnd(date: string): number {
  return Date.parse(`${date}T23:59:59.999`);
}
export function studentEligible(s: { since: string; leftAt: string | null }, playedAt: number): boolean {
  return playedAt >= dayStart(s.since) && (s.leftAt === null || playedAt <= dayEnd(s.leftAt));
}

export interface NewActivity {
  classId: string;
  gameId: string;
  kind: 'quiz' | 'test';
  label: string;
  quizId: string;
  quizTitle: string;
  playedAt: number;
  countInStats: boolean;
  rootActivityId: string | null;
  rosterSize: number;
}

/** Year-long records of a class (Dodatek 3, C7, C8). */
export class EvidenceService {
  readonly db: Database.Database;
  protected get sql() {
    return this.db;
  }

  constructor(
    protected readonly cfg: Config,
    db: Db,
    protected readonly now: () => number,
    protected readonly games: GameRepo,
  ) {
    this.db = db.$client;
  }

  createActivity(a: NewActivity): string {
    const id = newId();
    this.sql
      .prepare(
        'INSERT INTO class_activities (id, class_id, game_id, kind, label, quiz_id, quiz_title, played_at, count_in_stats, root_activity_id, roster_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, a.classId, a.gameId, a.kind, a.label, a.quizId, a.quizTitle, a.playedAt, a.countInStats ? 1 : 0, a.rootActivityId, a.rosterSize, this.now());
    return id;
  }

  activity(id: string): ActivityRow | undefined {
    const r = this.sql.prepare('SELECT * FROM class_activities WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? toActivity(r) : undefined;
  }

  activities(classId: string): ActivityRow[] {
    return (this.sql.prepare('SELECT * FROM class_activities WHERE class_id = ? ORDER BY played_at, id').all(classId) as Record<string, unknown>[]).map(toActivity);
  }

  /** The original activity and all its makeups. */
  chain(rootId: string): ActivityRow[] {
    return (this.sql.prepare('SELECT * FROM class_activities WHERE id = ? OR root_activity_id = ? ORDER BY played_at').all(rootId, rootId) as Record<string, unknown>[]).map(toActivity);
  }

  resultStudentIds(activityId: string): string[] {
    return (this.sql.prepare('SELECT student_id AS s FROM activity_results WHERE activity_id = ? AND student_id IS NOT NULL').all(activityId) as { s: string }[]).map((r) => r.s);
  }

  /** Active students eligible for the root activity (C7.2) without a result in it or its makeups. */
  missingStudents<S extends { id: string; active: boolean; since: string; leftAt: string | null }>(root: ActivityRow, students: S[]): S[] {
    const ids = this.chain(root.id).map((a) => a.id);
    const have = new Set(ids.flatMap((id) => this.resultStudentIds(id)));
    return students.filter((s) => s.active && !have.has(s.id) && studentEligible(s, root.playedAt));
  }

  setPlayedAt(activityId: string, at: number) {
    this.sql.prepare('UPDATE class_activities SET played_at = ? WHERE id = ?').run(at, activityId);
  }

  /**
   * Write the results of a class game into the records (C7.1). Idempotent: upsert by (activity, student),
   * items are replaced. Only players with a student_id (no guests). Speed points are never used.
   */
  materializeGame(gameId: string): number {
    const g = this.games.get(gameId);
    if (!g || !g.classId || !g.activityId || !g.snapshot) return 0;
    const snapshot = new Map((g.snapshot as ItemQuestion[]).map((q) => [q.id, q]));
    const opts = { partialMulti: g.settings.partialMulti, ignoreDiacritics: g.settings.ignoreDiacritics };
    const entries: { studentId: string; status: string; questionIds: string[]; playerId: string }[] = [];
    if (g.mode === 'test') {
      const rows = this.sql
        .prepare(
          "SELECT a.status, a.question_ids_json AS q, p.student_id AS studentId, p.id AS playerId FROM attempts a JOIN players p ON p.id = a.player_id WHERE a.game_id = ? AND p.student_id IS NOT NULL AND a.status IN ('submitted', 'expired')",
        )
        .all(gameId) as { status: string; q: string; studentId: string; playerId: string }[];
      for (const r of rows) entries.push({ studentId: r.studentId, playerId: r.playerId, status: r.status === 'expired' ? 'auto_submitted' : 'submitted', questionIds: JSON.parse(r.q) });
    } else {
      if (!g.played) return 0; // live game not finished yet
      const rows = this.sql.prepare('SELECT id AS playerId, student_id AS studentId FROM players WHERE game_id = ? AND student_id IS NOT NULL').all(gameId) as { playerId: string; studentId: string }[];
      for (const r of rows) entries.push({ ...r, status: 'completed', questionIds: g.played });
    }
    const now = this.now();
    const upsert = this.sql.prepare(
      `INSERT INTO activity_results (id, activity_id, student_id, status, percent, points_centi, max_points_centi, answered_count, question_count, excluded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(activity_id, student_id) DO UPDATE SET status = excluded.status, percent = excluded.percent, points_centi = excluded.points_centi,
         max_points_centi = excluded.max_points_centi, answered_count = excluded.answered_count, question_count = excluded.question_count, updated_at = excluded.updated_at`,
    );
    const insertItem = this.sql.prepare(
      'INSERT INTO result_items (activity_result_id, position, question_id, prompt_snapshot, topic, bloom, difficulty, weight, score_milli, answered) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const answersOf = this.sql.prepare('SELECT question_id AS q, payload_json AS p FROM answers WHERE player_id = ?');
    this.sql.transaction(() => {
      for (const e of entries) {
        const questions = e.questionIds.map((id) => snapshot.get(id)).filter((q): q is ItemQuestion => !!q);
        const answers = new Map((answersOf.all(e.playerId) as { q: string; p: string }[]).map((a) => [a.q, JSON.parse(a.p)]));
        const b = buildResultItems({ questions, answers, opts });
        upsert.run(newId(), g.activityId, e.studentId, e.status, b.percent, b.pointsCenti, b.maxPointsCenti, b.answeredCount, b.questionCount, now, now);
        const { id } = this.sql.prepare('SELECT id FROM activity_results WHERE activity_id = ? AND student_id = ?').get(g.activityId, e.studentId) as { id: string };
        this.sql.prepare('DELETE FROM result_items WHERE activity_result_id = ?').run(id);
        for (const it of b.items) insertItem.run(id, it.position, it.questionId, it.promptSnapshot, it.topic, it.bloom, it.difficulty, it.weight, it.scoreMilli, it.answered ? 1 : 0);
      }
    })();
    return entries.length;
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
