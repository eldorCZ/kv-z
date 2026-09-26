import type { Question, Quiz } from '@kvizhub/core';

export type ExportQuestion = Question & { id?: string };
export type ExportQuiz = Omit<Quiz, 'questions'> & { questions: ExportQuestion[] };

export interface TooLongItem {
  /** 1-based question number in the quiz */
  number: number;
  field: 'prompt' | 'option';
  length: number;
  limit: number;
}

export interface ExportSummary {
  format: 'kahoot' | 'gift' | 'json';
  total: number;
  exported: number;
  /** skipped question counts by reason */
  skipped: Record<string, number>;
  /** 1-based numbers of skipped questions by reason */
  skippedNumbers: Record<string, number[]>;
  tooLong: TooLongItem[];
  message: string;
}

const REASON_LABELS: Record<string, [string, string, string]> = {
  flagged: ['ke kontrole', 'ke kontrole', 'ke kontrole'],
  short: ['otevřená', 'otevřené', 'otevřených'],
  numeric: ['číselná', 'číselné', 'číselných'],
  order: ['řazení', 'řazení', 'řazení'],
  too_many_options: ['s více než 4 možnostmi', 's více než 4 možnostmi', 's více než 4 možnostmi'],
  too_long: ['příliš dlouhá', 'příliš dlouhé', 'příliš dlouhých'],
};

function plural(n: number, forms: [string, string, string]) {
  return n === 1 ? forms[0] : n >= 2 && n <= 4 ? forms[1] : forms[2];
}

export function buildSummary(
  format: ExportSummary['format'],
  total: number,
  skippedNumbers: Record<string, number[]>,
  tooLong: TooLongItem[],
): ExportSummary {
  const skipped: Record<string, number> = {};
  for (const [k, v] of Object.entries(skippedNumbers)) if (v.length) skipped[k] = v.length;
  const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
  const exported = total - skippedTotal;
  const parts = Object.entries(skipped)
    .filter(([k]) => k !== 'too_long')
    .map(([k, n]) => `${n} ${plural(n, REASON_LABELS[k] ?? [k, k, k])}`);
  const tooLongQuestions = new Set(tooLong.map((t) => t.number)).size;
  let message = `Exportováno ${exported} z ${total} otázek.`;
  if (parts.length) message += ` Vynecháno: ${parts.join(', ')}.`;
  if (format === 'kahoot') message += ` Zkráceno/odmítnuto pro délku: ${tooLongQuestions}.`;
  return { format, total, exported, skipped, skippedNumbers, tooLong, message };
}
