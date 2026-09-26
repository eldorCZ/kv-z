import type { PublicQuestion } from './events.js';
import type { Question } from './schema.js';
import type { ShuffledOptions } from './shuffle.js';

type Stored = Pick<Question, 'type' | 'prompt' | 'timeLimitSec' | 'points'> & { id: string };

/** Build the client-safe question payload. Only whitelisted fields are copied. */
export function toPublicQuestion(q: Stored, shuffled: ShuffledOptions, index: number, total: number): PublicQuestion {
  return {
    id: q.id,
    index,
    total,
    type: q.type,
    prompt: q.prompt,
    options: q.type === 'short' || q.type === 'numeric' ? [] : [...shuffled.options],
    timeLimitSec: q.timeLimitSec,
    points: q.points,
  };
}

function formatNumber(n: number): string {
  return String(n).replace('.', ',');
}

/** Human readable key shown at reveal. */
export function correctText(q: Pick<Question, 'type' | 'options' | 'correctIndices' | 'acceptedAnswers' | 'numericAnswer' | 'numericTolerance'>): string[] {
  switch (q.type) {
    case 'short':
      return [...q.acceptedAnswers];
    case 'numeric':
      return [q.numericTolerance ? `${formatNumber(q.numericAnswer ?? 0)} ± ${formatNumber(q.numericTolerance)}` : formatNumber(q.numericAnswer ?? 0)];
    case 'order':
      return [...q.options];
    default:
      return q.correctIndices.map((i) => q.options[i] ?? '');
  }
}
