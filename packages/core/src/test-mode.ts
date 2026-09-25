import { checkAnswer, type CheckOptions } from './scoring.js';
import type { Question } from './schema.js';

type Scorable = Pick<Question, 'type' | 'options' | 'correctIndices' | 'acceptedAnswers' | 'numericAnswer' | 'numericTolerance' | 'points'> & { id: string };

export const pointsWeight = (mode: Question['points']) => (mode === 'double' ? 2 : mode === 'none' ? 0 : 1);

export interface TestScore {
  /** Σ fraction · weight */
  score: number;
  /** Σ weight */
  maxScore: number;
  /** 0..100, rounded */
  percent: number;
  perQuestion: { questionId: string; fraction: number; correct: boolean; answered: boolean }[];
}

/**
 * Test mode grading (D6): every question gives 0..1 (partial credit for multi when enabled),
 * weighted standard = 1, double = 2, none = 0. Speed does not matter.
 * `answers` holds payloads in ORIGINAL indices, keyed by question id.
 */
export function scoreTest(questions: Scorable[], answers: Map<string, unknown>, opts: CheckOptions = {}): TestScore {
  let score = 0;
  let maxScore = 0;
  const perQuestion = questions.map((q) => {
    const w = pointsWeight(q.points);
    maxScore += w;
    const payload = answers.get(q.id);
    const r = payload === undefined ? { correct: false, fraction: 0 } : checkAnswer(q, payload, opts);
    score += r.fraction * w;
    return { questionId: q.id, fraction: r.fraction, correct: r.correct, answered: payload !== undefined };
  });
  const percent = maxScore > 0 ? Math.round((100 * score) / maxScore) : 0;
  return { score: Math.round(score * 1000) / 1000, maxScore, percent, perQuestion };
}

/** Map a stored payload (original indices) back to displayed indices for the student's UI. */
export function toDisplayedPayload(perm: number[], payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const p = payload as Record<string, unknown>;
  const inverse = new Map(perm.map((orig, disp) => [orig, disp]));
  const back = (arr: unknown) => (Array.isArray(arr) ? arr.map((o) => inverse.get(o as number) ?? -1) : []);
  if ('indices' in p) return { indices: back(p.indices) };
  if ('order' in p) return { order: back(p.order) };
  return p;
}

/**
 * Map a client payload (DISPLAYED indices) to ORIGINAL indices, dropping anything unexpected.
 * Returns the original payload and the displayed choice indices (for answer distributions).
 */
export function mapDisplayedPayload(type: Question['type'], perm: number[], payload: unknown): { original: unknown; displayed: number[] | null } {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const ints = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)).slice(0, 10) : []);
  const toOrig = (d: number[]) => d.map((x) => (x >= 0 && x < perm.length ? perm[x]! : -1));
  switch (type) {
    case 'single':
    case 'truefalse':
    case 'multi': {
      const displayed = [...new Set(ints(p.indices))];
      return { original: { indices: toOrig(displayed) }, displayed };
    }
    case 'order':
      return { original: { order: toOrig(ints(p.order)) }, displayed: null };
    case 'short':
      return { original: { text: typeof p.text === 'string' ? p.text.slice(0, 100) : '' }, displayed: null };
    case 'numeric':
      return { original: { value: typeof p.value === 'string' || typeof p.value === 'number' ? String(p.value).slice(0, 40) : '' }, displayed: null };
  }
}
