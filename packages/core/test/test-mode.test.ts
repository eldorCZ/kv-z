import { describe, expect, it } from 'vitest';
import { createGameSchema, scoreTest, shuffleOptions, seededRng, toDisplayedPayload, toOriginal, validateWith } from '../src/index.js';

const base = { acceptedAnswers: [], numericAnswer: null, numericTolerance: null, correctIndices: [], options: [], points: 'standard' as const };
const qs = [
  { ...base, id: 'a', type: 'single' as const, options: ['x', 'y', 'z'], correctIndices: [1] },
  { ...base, id: 'b', type: 'multi' as const, options: ['1', '2', '3', '4'], correctIndices: [0, 1] },
  { ...base, id: 'c', type: 'short' as const, acceptedAnswers: ['ohnisko'], points: 'double' as const },
  { ...base, id: 'd', type: 'truefalse' as const, options: ['Pravda', 'Nepravda'], correctIndices: [0], points: 'none' as const },
];

describe('scoreTest (D6)', () => {
  it('weights and percent', () => {
    const r = scoreTest(qs, new Map<string, unknown>([['a', { indices: [1] }], ['c', { text: 'Ohnisko' }], ['d', { indices: [1] }]]));
    // a=1*1, b=0 (unanswered), c=1*2, d weight 0 -> 3/4
    expect(r.maxScore).toBe(4);
    expect(r.score).toBe(3);
    expect(r.percent).toBe(75);
    expect(r.perQuestion.map((p) => p.answered)).toEqual([true, false, true, true]);
  });
  it('partial multi only when enabled', () => {
    const m = new Map<string, unknown>([['b', { indices: [0] }]]);
    expect(scoreTest(qs, m).percent).toBe(0);
    expect(scoreTest(qs, m, { partialMulti: true }).score).toBe(0.5);
    expect(scoreTest(qs, m, { partialMulti: true }).percent).toBe(13);
  });
  it('empty test', () => {
    expect(scoreTest([], new Map()).percent).toBe(0);
  });
});

describe('payload mapping', () => {
  it('stored original payload maps back to the displayed positions', () => {
    const q = { type: 'single' as const, options: ['a', 'b', 'c', 'd'], correctIndices: [2] };
    const s = shuffleOptions(q, true, seededRng(7));
    const displayed = { indices: [3] };
    const original = { indices: toOriginal(s.perm, displayed.indices) };
    expect(toDisplayedPayload(s.perm, original)).toEqual(displayed);
    expect(toDisplayedPayload(s.perm, { text: 'x' })).toEqual({ text: 'x' });
  });
});

describe('createGameSchema test mode', () => {
  it('accepts test settings and the selfpaced synonym', () => {
    const r = validateWith(createGameSchema, { mode: 'selfpaced', settings: { test: { timeLimitMin: 30 } } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.mode).toBe('test');
      expect(r.data.settings.test).toMatchObject({ timeLimitMin: 30, requireName: true, showResultsToStudent: 'score' });
    }
  });
  it('rejects bad values in Czech', () => {
    const r = validateWith(createGameSchema, { mode: 'test', settings: { test: { timeLimitMin: 0, showResultsToStudent: 'all' } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path)).toEqual(['settings.test.timeLimitMin', 'settings.test.showResultsToStudent']);
  });
});
