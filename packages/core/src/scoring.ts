import type { Question } from './schema.js';
import { levenshtein, normalizeText, parseLocaleNumber, stripDiacritics } from './text.js';

export const BASE_POINTS = 1000;
export const STREAK_STEP = 100;
export const STREAK_MAX = 500;
/** Grace period after the time limit to compensate for network latency. */
export const LATENCY_GRACE_MS = 300;

/**
 * Answer payload in ORIGINAL option indices (the game engine maps displayed indices back).
 * - single / multi / truefalse: { indices }
 * - order: { order } – original indices in the order chosen by the player
 * - short: { text }
 * - numeric: { value }
 */
export type AnswerPayload =
  | { indices: number[] }
  | { order: number[] }
  | { text: string }
  | { value: string | number };

export interface CheckOptions {
  /** Multi: give partial credit instead of all-or-nothing. */
  partialMulti?: boolean;
  /** Short: compare without diacritics. */
  ignoreDiacritics?: boolean;
}

export interface CheckResult {
  correct: boolean;
  /** 0..1 share of points (1 for fully correct answers). */
  fraction: number;
}

type Checkable = Pick<Question, 'type' | 'options' | 'correctIndices' | 'acceptedAnswers' | 'numericAnswer' | 'numericTolerance'>;

const WRONG: CheckResult = { correct: false, fraction: 0 };
const RIGHT: CheckResult = { correct: true, fraction: 1 };

export function normalizeShortAnswer(s: string, ignoreDiacritics = true): string {
  const n = normalizeText(s).replace(/[.!?,;:"'„“”]+$/g, '').trim();
  return ignoreDiacritics ? stripDiacritics(n) : n;
}

/** Short answer: exact after normalization, or 1 typo tolerated for answers longer than 5 characters. */
export function matchShortAnswer(given: string, accepted: string[], ignoreDiacritics = true): boolean {
  const g = normalizeShortAnswer(given, ignoreDiacritics);
  if (!g) return false;
  return accepted.some((a) => {
    const n = normalizeShortAnswer(a, ignoreDiacritics);
    if (n === g) return true;
    return n.length > 5 && levenshtein(n, g, 1) <= 1;
  });
}

function isIntArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => Number.isInteger(x));
}

export function checkAnswer(q: Checkable, payload: unknown, opts: CheckOptions = {}): CheckResult {
  if (!payload || typeof payload !== 'object') return WRONG;
  const p = payload as Record<string, unknown>;
  switch (q.type) {
    case 'single':
    case 'truefalse': {
      if (!isIntArray(p.indices) || p.indices.length !== 1) return WRONG;
      return p.indices[0] === q.correctIndices[0] ? RIGHT : WRONG;
    }
    case 'multi': {
      if (!isIntArray(p.indices)) return WRONG;
      const chosen = new Set(p.indices.filter((i) => i >= 0 && i < q.options.length));
      const correct = new Set(q.correctIndices);
      const hits = [...chosen].filter((i) => correct.has(i)).length;
      const misses = chosen.size - hits;
      if (hits === correct.size && misses === 0) return RIGHT;
      if (!opts.partialMulti) return WRONG;
      const fraction = Math.max(0, (hits - misses) / correct.size);
      return { correct: false, fraction };
    }
    case 'order': {
      if (!isIntArray(p.order) || p.order.length !== q.options.length) return WRONG;
      return p.order.every((v, i) => v === i) ? RIGHT : WRONG;
    }
    case 'short': {
      if (typeof p.text !== 'string') return WRONG;
      return matchShortAnswer(p.text, q.acceptedAnswers, opts.ignoreDiacritics ?? true) ? RIGHT : WRONG;
    }
    case 'numeric': {
      if (typeof p.value !== 'string' && typeof p.value !== 'number') return WRONG;
      const v = parseLocaleNumber(p.value);
      if (v === null || q.numericAnswer === null) return WRONG;
      const tol = q.numericTolerance ?? 0;
      // small epsilon so that 0.1 + 0.2 style float noise does not matter
      return Math.abs(v - q.numericAnswer) <= tol + 1e-9 ? RIGHT : WRONG;
    }
  }
}

export interface ScoreInput {
  fraction: number;
  elapsedMs: number;
  timeLimitSec: number;
  pointsMode: 'standard' | 'double' | 'none';
  /** Number of consecutive fully correct answers INCLUDING this one. */
  streak?: number;
  streakBonus?: boolean;
}

export interface ScoreResult {
  base: number;
  bonus: number;
  total: number;
}

/** points = round(1000 * (1 - 0.5 * t/T)) for a correct answer, i.e. 500..1000. */
export function computePoints(input: ScoreInput): ScoreResult {
  if (input.fraction <= 0 || input.pointsMode === 'none') return { base: 0, bonus: 0, total: 0 };
  const T = input.timeLimitSec * 1000;
  const t = Math.min(Math.max(input.elapsedMs, 0), T);
  let base = Math.round(BASE_POINTS * (1 - 0.5 * (t / T)) * Math.min(input.fraction, 1));
  if (input.pointsMode === 'double') base *= 2;
  let bonus = 0;
  if (input.streakBonus && input.fraction >= 1 && (input.streak ?? 0) > 1) {
    bonus = Math.min(STREAK_STEP * ((input.streak ?? 1) - 1), STREAK_MAX);
  }
  return { base, bonus, total: base + bonus };
}

/** Recommended time limit: 5 s reading + 2 s per option, rounded UP to an allowed value (>= 10). */
export function recommendedTimeLimit(optionCount: number): number {
  const raw = 5 + 2 * optionCount;
  return [10, 20, 30, 60, 120].find((v) => v >= raw) ?? 120;
}
