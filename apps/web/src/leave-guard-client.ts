import { LeaveTracker, type LeaveEvent, type PageSignals } from '@kvizhub/core/client';

/**
 * Browser side of the leave guard (Dodatek 2, G3). Knows only events of THIS page (visibility, focus,
 * fullscreen) and their times – never anything about other windows, the screen, camera, microphone or clipboard.
 */
export interface HeartbeatStatus {
  status: string;
  locked: boolean;
  remainingSec: number | null;
  serverTimeMs: number;
  leaveCount: number;
  maxLeaves: number;
  guardExempt: boolean;
}

export interface GuardOptions {
  token: string;
  /** track page signals (false when mode "off" or the student is exempt) */
  track: boolean;
  requireFullscreen: boolean;
  fullscreenSupported: boolean;
  onStatus: (s: HeartbeatStatus) => void;
  /** called after a leave ended and the server state was refreshed */
  onReturn?: (s: HeartbeatStatus) => void;
  onAwayChange?: (away: boolean, reason?: string) => void;
  heartbeatMs?: number;
}

type QueuedEvent = LeaveEvent & { seq: number };

export function readSignals(): PageSignals {
  return {
    visible: document.visibilityState === 'visible',
    focused: document.hasFocus(),
    fullscreen: !!document.fullscreenElement,
  };
}

export class GuardController {
  private tracker: LeaveTracker;
  private queue: QueuedEvent[] = [];
  // seq must be unique per attempt even after a reload -> start from the current time
  private seq = Date.now();
  private timers: ReturnType<typeof setInterval>[] = [];
  private flushing = false;
  private stopped = false;
  private readonly listeners: [EventTarget, string, EventListener][] = [];

  constructor(private readonly o: GuardOptions) {
    this.tracker = new LeaveTracker({ requireFullscreen: o.requireFullscreen && o.fullscreenSupported });
  }

  start() {
    this.timers.push(setInterval(() => void this.heartbeat(), this.o.heartbeatMs ?? 5000));
    void this.heartbeat();
    if (!this.o.track) return;
    const initial = readSignals();
    this.tracker.reset(initial, Date.now());
    // after a reload the previous page may have left an open leave on the server: close it (ignored when none is open)
    if (initial.visible && initial.focused) this.queue.push({ type: 'leave_end', clientTs: Date.now(), seq: this.seq++ });
    const on = (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn);
      this.listeners.push([target, type, fn]);
    };
    on(document, 'visibilitychange', () => this.signal({ visible: document.visibilityState === 'visible' }));
    on(window, 'blur', () => this.signal({ focused: false }));
    on(window, 'focus', () => this.signal({ focused: true }));
    on(document, 'fullscreenchange', () => this.signal({ fullscreen: !!document.fullscreenElement }));
    on(window, 'pagehide', () => this.signal({ visible: false }));
    // blur counts only after 300 ms -> poll the state machine
    this.timers.push(setInterval(() => this.push(this.tracker.tick(Date.now())), 100));
    // retry queued events (lost connection)
    this.timers.push(setInterval(() => void this.flush(), 3000));
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    for (const [target, type, fn] of this.listeners) target.removeEventListener(type, fn);
    this.timers = [];
  }

  /** Feed a signal change (also used by tests). */
  signal(changes: Partial<PageSignals>) {
    this.push(this.tracker.update({ ...readSignals(), ...changes }, Date.now()));
  }

  private push(events: LeaveEvent[]) {
    for (const e of events) {
      this.queue.push({ ...e, seq: this.seq++ });
      this.o.onAwayChange?.(e.type === 'leave_start', e.type === 'leave_start' ? e.reason : undefined);
      if (e.type === 'leave_start' && e.reason === 'hidden') this.beacon();
      else
        void this.flush().then(async () => {
          if (e.type === 'leave_end') {
            const s = await this.heartbeat();
            if (s) this.o.onReturn?.(s);
          }
        });
    }
  }

  /** A hidden page may be frozen at any moment: sendBeacon survives that, fetch may not (G3.3). */
  private beacon() {
    if (!this.queue.length) return;
    const events = this.queue.map(({ type, seq, clientTs, ...rest }) => ({ type, seq, clientTs, ...('reason' in rest ? { reason: rest.reason } : {}) }));
    const blob = new Blob([JSON.stringify({ playerToken: this.o.token, events })], { type: 'application/json' });
    if (navigator.sendBeacon?.('/play/test/events', blob)) {
      // the server is idempotent by seq, so keep the events queued until a normal flush confirms them
      return;
    }
    void this.flush();
  }

  async flush() {
    if (this.flushing || !this.queue.length || this.stopped) return;
    this.flushing = true;
    const batch = [...this.queue];
    try {
      const res = await fetch('/play/test/events', {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json', 'x-player-token': this.o.token },
        body: JSON.stringify({ events: batch }),
      });
      if (res.ok || res.status === 401 || res.status === 400) this.queue = this.queue.filter((e) => !batch.includes(e));
    } catch {
      /* offline – retried every 3 s */
    } finally {
      this.flushing = false;
    }
  }

  async heartbeat(): Promise<HeartbeatStatus | null> {
    if (this.stopped) return null;
    try {
      const s = readSignals();
      const res = await fetch('/play/test/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-player-token': this.o.token },
        body: JSON.stringify({ ...s, fullscreenSupported: this.o.fullscreenSupported }),
      });
      if (!res.ok) return null;
      const status = (await res.json()) as HeartbeatStatus;
      this.o.onStatus(status);
      return status;
    } catch {
      return null;
    }
  }
}
