import { describe, expect, it } from 'vitest';
import { LeaveTracker, createGameSchema, isCountedLeave, validateWith } from '../src/index.js';

const init = (requireFullscreen = false) => {
  const t = new LeaveTracker({ requireFullscreen });
  t.reset({ visible: true, focused: true, fullscreen: true }, 0);
  return t;
};

describe('LeaveTracker (G3.2)', () => {
  it('hidden page -> leave_start immediately, visible + focused -> leave_end', () => {
    const t = init();
    expect(t.update({ visible: false }, 1000)).toEqual([{ type: 'leave_start', reason: 'hidden', clientTs: 1000 }]);
    expect(t.update({ visible: true }, 3000)).toEqual([{ type: 'leave_end', clientTs: 3000 }]);
  });

  it('blur counts only after 300 ms', () => {
    const t = init();
    expect(t.update({ focused: false }, 1000)).toEqual([]);
    expect(t.tick(1200)).toEqual([]);
    expect(t.update({ focused: true }, 1250)).toEqual([]); // short blur (e.g. keyboard) is ignored
    t.update({ focused: false }, 2000);
    expect(t.tick(2300)).toEqual([{ type: 'leave_start', reason: 'blur', clientTs: 2300 }]);
    expect(t.update({ focused: true }, 4000)).toEqual([{ type: 'leave_end', clientTs: 4000 }]);
  });

  it('overlapping reasons form one leave with the first reason', () => {
    const t = init();
    expect(t.update({ focused: false }, 1000)).toEqual([]);
    const start = t.update({ visible: false }, 1100);
    expect(start).toEqual([{ type: 'leave_start', reason: 'blur', clientTs: 1100 }]);
    expect(t.update({ visible: true }, 5000)).toEqual([]); // still without focus -> still away
    expect(t.update({ focused: true }, 5100)).toEqual([{ type: 'leave_end', clientTs: 5100 }]);
  });

  it('hidden then blur keeps reason hidden and returns only when visible AND focused', () => {
    const t = init();
    expect(t.update({ visible: false }, 100)[0]).toMatchObject({ reason: 'hidden' });
    expect(t.update({ focused: false }, 150)).toEqual([]);
    expect(t.update({ visible: true }, 900)).toEqual([]);
    expect(t.tick(2000)).toEqual([]);
    expect(t.update({ focused: true }, 2100)).toEqual([{ type: 'leave_end', clientTs: 2100 }]);
  });

  it('fullscreen exit is a leave only when fullscreen is required', () => {
    const off = init(false);
    expect(off.update({ fullscreen: false }, 100)).toEqual([]);
    const on = init(true);
    expect(on.update({ fullscreen: false }, 100)).toEqual([{ type: 'leave_start', reason: 'fullscreen_exit', clientTs: 100 }]);
    expect(on.update({ fullscreen: true }, 900)).toEqual([{ type: 'leave_end', clientTs: 900 }]);
  });

  it('short leaves are not counted', () => {
    expect(isCountedLeave(999, 1000)).toBe(false);
    expect(isCountedLeave(1000, 1000)).toBe(true);
  });
});

describe('leaveGuard settings (G2)', () => {
  it('defaults and validation', () => {
    const r = validateWith(createGameSchema, { mode: 'test', settings: { test: {} } });
    if (!r.ok) throw new Error('invalid');
    expect(r.data.settings.test!.leaveGuard).toEqual({ mode: 'warn', maxLeaves: 2, onExceed: 'notify', requireFullscreen: false, minLeaveMs: 1000 });
    const bad = validateWith(createGameSchema, { mode: 'test', settings: { test: { leaveGuard: { mode: 'spy', maxLeaves: 11, minLeaveMs: 100 } } } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.path)).toEqual(['settings.test.leaveGuard.mode', 'settings.test.leaveGuard.maxLeaves', 'settings.test.leaveGuard.minLeaveMs']);
  });
});
