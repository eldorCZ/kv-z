import { describe, expect, it } from 'vitest';
import { checkAnswer, computePoints, matchShortAnswer, recommendedTimeLimit, parseLocaleNumber, levenshtein } from '../src/index.js';

const base = { acceptedAnswers: [], numericAnswer: null, numericTolerance: null, correctIndices: [], options: [] };

describe('computePoints', () => {
  it('gives 1000 for an instant answer and 500 at the limit', () => {
    expect(computePoints({ fraction: 1, elapsedMs: 0, timeLimitSec: 20, pointsMode: 'standard' }).total).toBe(1000);
    expect(computePoints({ fraction: 1, elapsedMs: 20000, timeLimitSec: 20, pointsMode: 'standard' }).total).toBe(500);
    expect(computePoints({ fraction: 1, elapsedMs: 10000, timeLimitSec: 20, pointsMode: 'standard' }).total).toBe(750);
    expect(computePoints({ fraction: 1, elapsedMs: 20250, timeLimitSec: 20, pointsMode: 'standard' }).total).toBe(500);
  });
  it('rounds', () => {
    // 1000 * (1 - 0.5 * 3333/10000) = 833.35
    expect(computePoints({ fraction: 1, elapsedMs: 3333, timeLimitSec: 10, pointsMode: 'standard' }).total).toBe(833);
  });
  it('wrong answer gives 0, none mode gives 0, double doubles', () => {
    expect(computePoints({ fraction: 0, elapsedMs: 0, timeLimitSec: 20, pointsMode: 'standard' }).total).toBe(0);
    expect(computePoints({ fraction: 1, elapsedMs: 0, timeLimitSec: 20, pointsMode: 'none' }).total).toBe(0);
    expect(computePoints({ fraction: 1, elapsedMs: 0, timeLimitSec: 20, pointsMode: 'double' }).total).toBe(2000);
  });
  it('streak bonus +100 per consecutive answer, max +500, switchable', () => {
    const s = (streak: number, streakBonus = true) =>
      computePoints({ fraction: 1, elapsedMs: 0, timeLimitSec: 20, pointsMode: 'standard', streak, streakBonus }).bonus;
    expect(s(1)).toBe(0);
    expect(s(2)).toBe(100);
    expect(s(4)).toBe(300);
    expect(s(10)).toBe(500);
    expect(s(5, false)).toBe(0);
  });
  it('partial fraction scales', () => {
    expect(computePoints({ fraction: 0.5, elapsedMs: 0, timeLimitSec: 20, pointsMode: 'standard' }).total).toBe(500);
  });
});

describe('checkAnswer', () => {
  it('single / truefalse', () => {
    const q = { ...base, type: 'single' as const, options: ['a', 'b', 'c'], correctIndices: [1] };
    expect(checkAnswer(q, { indices: [1] }).correct).toBe(true);
    expect(checkAnswer(q, { indices: [0] }).correct).toBe(false);
    expect(checkAnswer(q, { indices: [1, 0] }).correct).toBe(false);
    expect(checkAnswer(q, null).correct).toBe(false);
    expect(checkAnswer(q, { indices: ['1'] }).correct).toBe(false);
  });
  it('multi all-or-nothing and partial', () => {
    const q = { ...base, type: 'multi' as const, options: ['a', 'b', 'c', 'd'], correctIndices: [0, 2] };
    expect(checkAnswer(q, { indices: [2, 0] }).correct).toBe(true);
    expect(checkAnswer(q, { indices: [0] })).toEqual({ correct: false, fraction: 0 });
    expect(checkAnswer(q, { indices: [0] }, { partialMulti: true })).toEqual({ correct: false, fraction: 0.5 });
    expect(checkAnswer(q, { indices: [0, 1] }, { partialMulti: true }).fraction).toBe(0);
    expect(checkAnswer(q, { indices: [0, 2, 3] }, { partialMulti: true }).fraction).toBe(0.5);
  });
  it('order', () => {
    const q = { ...base, type: 'order' as const, options: ['a', 'b', 'c'] };
    expect(checkAnswer(q, { order: [0, 1, 2] }).correct).toBe(true);
    expect(checkAnswer(q, { order: [1, 0, 2] }).correct).toBe(false);
    expect(checkAnswer(q, { order: [0, 1] }).correct).toBe(false);
  });
  it('short with normalization, diacritics and 1 typo for > 5 chars', () => {
    const q = { ...base, type: 'short' as const, acceptedAnswers: ['Ohnisko', 'Lom'] };
    expect(checkAnswer(q, { text: '  ohnisko ' }).correct).toBe(true);
    expect(checkAnswer(q, { text: 'OHNISKO.' }).correct).toBe(true);
    expect(checkAnswer(q, { text: 'ohnysko' }).correct).toBe(true);
    expect(checkAnswer(q, { text: 'ohnyskoo' }).correct).toBe(false);
    expect(checkAnswer(q, { text: 'lim' }).correct).toBe(false);
    const d = { ...base, type: 'short' as const, acceptedAnswers: ['čočka'] };
    expect(checkAnswer(d, { text: 'cocka' }).correct).toBe(true);
    expect(checkAnswer(d, { text: 'cocka' }, { ignoreDiacritics: false }).correct).toBe(false);
    expect(matchShortAnswer('', ['x'])).toBe(false);
  });
  it('numeric with comma and tolerance', () => {
    const q = { ...base, type: 'numeric' as const, numericAnswer: 1.33, numericTolerance: 0.01 };
    expect(checkAnswer(q, { value: '1,33' }).correct).toBe(true);
    expect(checkAnswer(q, { value: '1.34' }).correct).toBe(true);
    expect(checkAnswer(q, { value: 1.35 }).correct).toBe(false);
    expect(checkAnswer(q, { value: 'abc' }).correct).toBe(false);
  });
});

describe('helpers', () => {
  it('parseLocaleNumber', () => {
    expect(parseLocaleNumber('3,5')).toBe(3.5);
    expect(parseLocaleNumber(' -2 ')).toBe(-2);
    expect(parseLocaleNumber('1 000')).toBe(1000);
    expect(parseLocaleNumber('1,2,3')).toBeNull();
    expect(parseLocaleNumber('')).toBeNull();
  });
  it('levenshtein', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
  });
  it('recommendedTimeLimit rounds up', () => {
    expect(recommendedTimeLimit(2)).toBe(10);
    expect(recommendedTimeLimit(4)).toBe(20);
  });
});
