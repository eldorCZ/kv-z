import type { Question } from './schema.js';

export type Rng = () => number;

/** Deterministic PRNG (mulberry32) – handy for tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates permutation of 0..n-1. perm[displayed] = original index. */
export function permutation(n: number, rng: Rng = Math.random): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return p;
}

export function isIdentity(perm: number[]): boolean {
  return perm.every((v, i) => v === i);
}

export interface ShuffledOptions {
  /** perm[displayed] = original */
  perm: number[];
  options: string[];
  /** correct indices expressed in displayed positions */
  correctDisplayed: number[];
}

/**
 * Shuffle the options of a question for play, recomputing the key.
 * truefalse keeps its fixed order; order questions are never shown in the correct order.
 */
export function shuffleOptions(
  q: Pick<Question, 'type' | 'options' | 'correctIndices'> & Partial<Pick<Question, 'imageLabels'>>,
  enabled: boolean,
  rng: Rng = Math.random,
): ShuffledOptions {
  const sourceOptions = q.type === 'image-label' ? (q.imageLabels ?? []).map((l) => l.text) : q.options;
  const n = sourceOptions.length;
  let perm = Array.from({ length: n }, (_, i) => i);
  if (q.type === 'order') {
    // items are stored in the correct order – always shuffle, and never show the solution
    if (n > 1) {
      for (let tries = 0; tries < 20 && isIdentity(perm); tries++) perm = permutation(n, rng);
      if (isIdentity(perm)) perm = [...perm.slice(1), perm[0]!];
    }
  } else if (enabled && q.type !== 'truefalse' && n > 1) {
    perm = permutation(n, rng);
  }
  const inverse = new Map(perm.map((orig, disp) => [orig, disp]));
  return {
    perm,
    options: perm.map((i) => sourceOptions[i]!),
    correctDisplayed: q.correctIndices.map((c) => inverse.get(c)!).sort((a, b) => a - b),
  };
}

/** Map displayed indices chosen by a player back to original indices. Invalid indices become -1. */
export function toOriginal(perm: number[], displayed: number[]): number[] {
  return displayed.map((d) => (Number.isInteger(d) && d >= 0 && d < perm.length ? perm[d]! : -1));
}
