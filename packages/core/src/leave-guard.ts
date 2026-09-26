import { z } from 'zod';

/** Leave guard settings (Dodatek 2, G2). */
export const leaveGuardSchema = z.object({
  mode: z.enum(['off', 'log', 'warn']).default('warn'),
  maxLeaves: z.number().int().min(0).max(10).default(2),
  onExceed: z.enum(['notify', 'lock']).default('notify'),
  requireFullscreen: z.boolean().default(false),
  minLeaveMs: z.number().int().min(500).max(5000).default(1000),
});
export type LeaveGuardSettings = z.output<typeof leaveGuardSchema>;
export const LEAVE_GUARD_DEFAULTS: LeaveGuardSettings = leaveGuardSchema.parse({});

export type LeaveReason = 'hidden' | 'blur' | 'fullscreen_exit';

export type LeaveEvent = { type: 'leave_start'; reason: LeaveReason; clientTs: number } | { type: 'leave_end'; clientTs: number };

export interface PageSignals {
  visible: boolean;
  focused: boolean;
  fullscreen: boolean;
}

/** Window without focus for longer than this counts as "away" (G3.2). */
export const BLUR_DELAY_MS = 300;

/**
 * Framework-free state machine "away from the test window" (G3.2).
 * Feed it page signals (visibility, focus, fullscreen) with timestamps; it returns leave_start / leave_end events.
 * Overlapping reasons (blur -> hidden -> visible -> focus) form ONE leave whose reason is the first one.
 */
export class LeaveTracker {
  private s: PageSignals = { visible: true, focused: true, fullscreen: true };
  private away = false;
  private blurSince: number | null = null;
  private fullscreenLostAt: number | null = null;
  private hiddenAt: number | null = null;

  constructor(private readonly opts: { requireFullscreen: boolean; blurDelayMs?: number } = { requireFullscreen: false }) {}

  get isAway() {
    return this.away;
  }

  /** Initial signals (no events). */
  reset(signals: PageSignals, now: number) {
    this.s = { ...signals };
    this.away = false;
    this.blurSince = signals.focused ? null : now;
    this.hiddenAt = signals.visible ? null : now;
    this.fullscreenLostAt = !this.opts.requireFullscreen || signals.fullscreen ? null : now;
  }

  update(changes: Partial<PageSignals>, now: number): LeaveEvent[] {
    const prev = this.s;
    this.s = { ...prev, ...changes };
    if (prev.focused && !this.s.focused) this.blurSince = now;
    if (this.s.focused) this.blurSince = null;
    if (prev.visible && !this.s.visible) this.hiddenAt = now;
    if (this.s.visible) this.hiddenAt = null;
    if (this.opts.requireFullscreen) {
      if (prev.fullscreen && !this.s.fullscreen) this.fullscreenLostAt = now;
      if (this.s.fullscreen) this.fullscreenLostAt = null;
    }
    return this.evaluate(now);
  }

  /** Call periodically (e.g. every 100 ms) so that a blur longer than 300 ms is detected. */
  tick(now: number): LeaveEvent[] {
    return this.evaluate(now);
  }

  private evaluate(now: number): LeaveEvent[] {
    const delay = this.opts.blurDelayMs ?? BLUR_DELAY_MS;
    const blurAway = this.blurSince !== null && now - this.blurSince >= delay;
    const candidates: [LeaveReason, number][] = [];
    if (this.hiddenAt !== null) candidates.push(['hidden', this.hiddenAt]);
    if (this.blurSince !== null && (blurAway || this.hiddenAt !== null || this.fullscreenLostAt !== null)) candidates.push(['blur', this.blurSince]);
    if (this.fullscreenLostAt !== null) candidates.push(['fullscreen_exit', this.fullscreenLostAt]);
    const shouldBeAway = this.hiddenAt !== null || blurAway || this.fullscreenLostAt !== null;
    if (!this.away && shouldBeAway) {
      this.away = true;
      // the earliest abnormal signal is the reason of the whole leave
      candidates.sort((a, b) => a[1] - b[1]);
      return [{ type: 'leave_start', reason: candidates[0]![0], clientTs: now }];
    }
    const back = this.s.visible && this.s.focused && (!this.opts.requireFullscreen || this.s.fullscreen);
    if (this.away && back) {
      this.away = false;
      return [{ type: 'leave_end', clientTs: now }];
    }
    return [];
  }
}

/** Duration of a leave that counts (G4.3); used by the server with server receive times. */
export function isCountedLeave(durationMs: number, minLeaveMs: number) {
  return durationMs >= minLeaveMs;
}
