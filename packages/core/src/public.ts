import type { PublicQuestion, RevealEvent } from './events.js';
import type { Question } from './schema.js';
import type { ShuffledOptions } from './shuffle.js';

type Stored = Pick<Question, 'type' | 'prompt' | 'timeLimitSec' | 'points'> & Partial<Pick<Question, 'imageId' | 'imageLabels'>> & { id: string };

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
    ...(q.imageId ? { imageUrl: `/media/theme/${q.imageId}/1280.webp` } : {}),
    ...(q.type === 'image-label' ? { imageLabels: shuffled.options } : {}),
  };
}

function formatNumber(n: number): string {
  return String(n).replace('.', ',');
}

/**
 * Where the labels belong (image-label only), for the reveal screen. Coordinates stay
 * secret until then — `toPublicQuestion` sends the label texts alone.
 */
export function correctPins(q: Pick<Question, 'type'> & Partial<Pick<Question, 'imageLabels'>>): RevealEvent['correctPins'] {
  if (q.type !== 'image-label') return undefined;
  return (q.imageLabels ?? []).map((l) => ({ text: l.text, x: l.x, y: l.y, radius: l.radius }));
}

/** Human readable key shown at reveal. */
export function correctText(q: Pick<Question, 'type' | 'options' | 'correctIndices' | 'acceptedAnswers' | 'numericAnswer' | 'numericTolerance'> & Partial<Pick<Question, 'imageLabels'>>): string[] {
  switch (q.type) {
    case 'short':
      return [...q.acceptedAnswers];
    case 'numeric':
      return [q.numericTolerance ? `${formatNumber(q.numericAnswer ?? 0)} ± ${formatNumber(q.numericTolerance)}` : formatNumber(q.numericAnswer ?? 0)];
    case 'order':
      return [...q.options];
    case 'image-label':
      return (q.imageLabels ?? []).map((l) => l.text);
    default:
      return q.correctIndices.map((i) => q.options[i] ?? '');
  }
}
