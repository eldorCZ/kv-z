import { LEAVE_GUARD_DEFAULTS, isCountedLeave, type LeaveGuardSettings, type LeaveReason } from '@kvizhub/core';
import type { Db } from '../db/index.js';
import type { Attempt, AttemptRepo } from '../repo/attempts.js';
import type { GameRow } from '../repo/games.js';

const REASONS: readonly LeaveReason[] = ['hidden', 'blur', 'fullscreen_exit'];

export interface ClientEvent {
  type: 'leave_start' | 'leave_end';
  reason?: string;
  clientTs?: number;
  seq: number;
}

export interface EventRow {
  id: number;
  attemptId: string;
  type: 'leave_start' | 'leave_end' | 'gap';
  reason: LeaveReason | null;
  source: 'client' | 'server';
  at: number;
  clientTs: number | null;
  durationMs: number | null;
  counted: boolean;
  seq: number | null;
}

export function guardOf(g: GameRow): LeaveGuardSettings {
  return (g.settings as { test?: { leaveGuard?: LeaveGuardSettings } }).test?.leaveGuard ?? LEAVE_GUARD_DEFAULTS;
}

/**
 * Leave guard on the server (Dodatek 2, G4). Only page events of the test window and their times are stored.
 * Durations are measured with SERVER receive times; clientTs is only recorded.
 */
export class LeaveGuardService {
  constructor(
    private readonly db: Db,
    private readonly attempts: AttemptRepo,
    private readonly heartbeatGapMs: number,
  ) {}

  private get sql() {
    return this.db.$client;
  }

  /** Is the guard active for this attempt? */
  active(g: GameRow, a: Attempt) {
    return guardOf(g).mode !== 'off' && !a.guardExempt && a.status === 'in_progress';
  }

  events(attemptId: string): EventRow[] {
    return (
      this.sql
        .prepare('SELECT id, attempt_id, type, reason, source, at, client_ts, duration_ms, counted, seq FROM attempt_events WHERE attempt_id = ? ORDER BY at, id')
        .all(attemptId) as Record<string, unknown>[]
    ).map((r) => ({
      id: r.id as number,
      attemptId: r.attempt_id as string,
      type: r.type as EventRow['type'],
      reason: (r.reason as LeaveReason | null) ?? null,
      source: r.source as EventRow['source'],
      at: r.at as number,
      clientTs: (r.client_ts as number | null) ?? null,
      durationMs: (r.duration_ms as number | null) ?? null,
      counted: r.counted === 1,
      seq: (r.seq as number | null) ?? null,
    }));
  }

  private openLeave(attemptId: string): EventRow | undefined {
    return this.events(attemptId)
      .filter((e) => e.type === 'leave_start' && e.durationMs === null)
      .at(-1);
  }

  /** Count a leave (G4.3) and apply the reaction when (maxLeaves + 1) is reached (G4.5). */
  private count(g: GameRow, a: Attempt, now: number) {
    const guard = guardOf(g);
    const leaveCount = a.leaveCount + 1;
    const patch: Parameters<AttemptRepo['update']>[1] = { leaveCount, leaveTotal: a.leaveTotal + 1 };
    if (guard.mode === 'warn' && guard.onExceed === 'lock' && leaveCount > guard.maxLeaves && a.lockedAt === null) patch.lockedAt = now;
    this.attempts.update(a.id, patch);
  }

  /** Lazy evaluation: an open leave counts as soon as it lasts minLeaveMs by server time. */
  evaluateOpen(g: GameRow, a: Attempt, now: number): Attempt {
    if (!this.active(g, a)) return a;
    const open = this.openLeave(a.id);
    if (open && !open.counted && isCountedLeave(now - open.at, guardOf(g).minLeaveMs)) {
      this.sql.prepare('UPDATE attempt_events SET counted = 1 WHERE id = ?').run(open.id);
      this.count(g, a, now);
      return this.attempts.get(a.id)!;
    }
    return a;
  }

  /** POST /play/test/events. Idempotent by seq; ignored when the guard is off/exempt or the attempt is not running. */
  record(g: GameRow, a: Attempt, events: ClientEvent[], now: number): Attempt {
    if (!this.active(g, a)) return a;
    const guard = guardOf(g);
    const insert = this.sql.prepare(
      'INSERT OR IGNORE INTO attempt_events (attempt_id, type, reason, source, at, client_ts, duration_ms, counted, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    let cur = a;
    for (const e of [...events].sort((x, y) => x.seq - y.seq)) {
      if (!Number.isInteger(e.seq) || e.seq < 0) continue;
      const exists = this.sql.prepare('SELECT 1 FROM attempt_events WHERE attempt_id = ? AND seq = ?').get(cur.id, e.seq);
      if (exists) continue;
      const clientTs = Number.isFinite(e.clientTs) ? Math.round(e.clientTs!) : null;
      if (e.type === 'leave_start') {
        if (this.openLeave(cur.id)) {
          // already away: keep the first reason, remember the seq for idempotency
          insert.run(cur.id, 'leave_start_dup', null, 'client', now, clientTs, 0, 0, e.seq);
          continue;
        }
        const reason = REASONS.includes(e.reason as LeaveReason) ? e.reason! : 'hidden';
        insert.run(cur.id, 'leave_start', reason, 'client', now, clientTs, null, 0, e.seq);
      } else if (e.type === 'leave_end') {
        const open = this.openLeave(cur.id);
        insert.run(cur.id, 'leave_end', null, 'client', now, clientTs, open ? now - open.at : null, 0, e.seq);
        if (!open) continue;
        const duration = now - open.at;
        const counted = open.counted || isCountedLeave(duration, guard.minLeaveMs);
        this.sql.prepare('UPDATE attempt_events SET duration_ms = ?, counted = ? WHERE id = ?').run(duration, counted ? 1 : 0, open.id);
        if (counted) {
          if (!open.counted) this.count(g, cur, now);
          cur = this.attempts.get(cur.id)!;
          this.attempts.update(cur.id, { awayTotalMs: cur.awayTotalMs + duration });
        }
      }
      cur = this.attempts.get(cur.id)!;
    }
    return this.evaluateOpen(g, this.attempts.get(cur.id)!, now);
  }

  /** POST /play/test/heartbeat (G3.4, G4.4). */
  heartbeat(g: GameRow, a: Attempt, body: { fullscreenSupported?: unknown }, now: number): Attempt {
    const patch: Parameters<AttemptRepo['update']>[1] = { lastHeartbeatAt: now };
    if (typeof body.fullscreenSupported === 'boolean') patch.fullscreenSupported = body.fullscreenSupported;
    if (this.active(g, a) && a.lastHeartbeatAt !== null && now - a.lastHeartbeatAt > this.heartbeatGapMs) {
      // a gap is shown only when the client did not report a leave for the same period (overlap)
      const overlapping = this.events(a.id).some(
        (e) => e.type === 'leave_start' && e.at <= now && (e.durationMs === null || e.at + e.durationMs >= a.lastHeartbeatAt!),
      );
      if (!overlapping) {
        this.sql
          .prepare("INSERT INTO attempt_events (attempt_id, type, reason, source, at, client_ts, duration_ms, counted, seq) VALUES (?, 'gap', NULL, 'server', ?, NULL, ?, 0, NULL)")
          .run(a.id, a.lastHeartbeatAt, now - a.lastHeartbeatAt);
      }
    }
    this.attempts.update(a.id, patch);
    return this.evaluateOpen(g, this.attempts.get(a.id)!, now);
  }

  unlock(a: Attempt, extraMinutes: number) {
    this.attempts.update(a.id, {
      lockedAt: null,
      leaveCount: 0,
      ...(a.status === 'in_progress' && a.deadlineAt !== null && extraMinutes > 0 ? { deadlineAt: a.deadlineAt + extraMinutes * 60_000 } : {}),
    });
  }

  setExempt(a: Attempt, exempt: boolean) {
    this.attempts.update(a.id, { guardExempt: exempt });
  }

  hasGap(attemptId: string) {
    return !!this.sql.prepare("SELECT 1 FROM attempt_events WHERE attempt_id = ? AND type = 'gap'").get(attemptId);
  }

  /** Attempts with an open leave (for the 5 s job). */
  withOpenLeaves(): string[] {
    return (
      this.sql
        .prepare(
          "SELECT DISTINCT e.attempt_id AS id FROM attempt_events e JOIN attempts a ON a.id = e.attempt_id WHERE e.type = 'leave_start' AND e.duration_ms IS NULL AND e.counted = 0 AND a.status = 'in_progress'",
        )
        .all() as { id: string }[]
    ).map((r) => r.id);
  }

  /** Timeline for the teacher (G6): leaves and gaps relative to the start of the attempt. */
  timeline(a: Attempt) {
    const start = a.startedAt ?? a.createdAt;
    return this.events(a.id)
      .filter((e) => e.type === 'leave_start' || e.type === 'gap')
      .map((e) => ({
        type: e.type === 'gap' ? 'gap' : 'leave',
        reason: e.reason,
        offsetSec: Math.round((e.at - start) / 1000),
        durationSec: e.durationMs === null ? null : Math.round(e.durationMs / 100) / 10,
        counted: e.counted,
      }));
  }
}
