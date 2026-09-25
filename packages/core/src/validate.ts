import { z } from 'zod';
import { LIMITS, questionSchema, quizSchema, type Question, type Quiz } from './schema.js';

export interface ContractError {
  path: string;
  code: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: ContractError[] };

/** ['questions', 3, 'correctIndices'] -> "questions[3].correctIndices" */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const p of path) {
    if (typeof p === 'number') out += `[${p}]`;
    else out += out ? `.${String(p)}` : String(p);
  }
  return out;
}

const typeNames: Record<string, string> = {
  string: 'text',
  number: 'číslo',
  boolean: 'true/false',
  array: 'pole',
  object: 'objekt',
  int: 'celé číslo',
};

/** Translate a zod issue into a contract error with a Czech message. */
export function issueToError(issue: z.core.$ZodIssue, prefix: readonly PropertyKey[] = []): ContractError {
  const path = formatPath([...prefix, ...issue.path]);
  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined) return { path, code: 'required', message: 'Povinné pole chybí.' };
      return { path, code: 'invalid_type', message: `Očekáván typ ${typeNames[issue.expected] ?? issue.expected}.` };
    }
    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.origin === 'string') {
        return min <= 1
          ? { path, code: 'empty', message: 'Text nesmí být prázdný.' }
          : { path, code: 'too_short', message: `Text je příliš krátký (min. ${min} znaků).` };
      }
      if (issue.origin === 'array') return { path, code: 'too_few', message: `Příliš málo položek (min. ${min}).` };
      return { path, code: 'too_small', message: `Hodnota musí být alespoň ${min}.` };
    }
    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.origin === 'string') {
        const len = typeof issue.input === 'string' ? issue.input.length : undefined;
        return { path, code: 'too_long', message: `Text je příliš dlouhý (max. ${max} znaků${len ? `, má ${len}` : ''}).` };
      }
      if (issue.origin === 'array') return { path, code: 'too_many', message: `Příliš mnoho položek (max. ${max}).` };
      return { path, code: 'too_big', message: `Hodnota může být nejvýše ${max}.` };
    }
    case 'invalid_value':
      return {
        path,
        code: 'invalid_value',
        message: `Neplatná hodnota. Povolené hodnoty: ${issue.values.map((v) => JSON.stringify(v)).join(', ')}.`,
      };
    case 'invalid_format':
      return { path, code: 'invalid_format', message: 'Neplatný formát hodnoty.' };
    case 'custom': {
      const code = (issue.params as { code?: string } | undefined)?.code ?? 'invalid';
      return { path, code, message: issue.message };
    }
    default:
      return { path, code: issue.code, message: 'Neplatná hodnota.' };
  }
}

function toResult<T>(r: z.ZodSafeParseResult<T>, prefix: readonly PropertyKey[] = []): ValidationResult<T> {
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, errors: r.error.issues.slice(0, LIMITS.maxErrors).map((i) => issueToError(i, prefix)) };
}

export function validateQuiz(input: unknown): ValidationResult<Quiz> {
  return toResult(quizSchema.safeParse(input));
}

export function validateQuestion(input: unknown, prefix: readonly PropertyKey[] = []): ValidationResult<Question> {
  return toResult(questionSchema.safeParse(input), prefix);
}

export function validateWith<S extends z.ZodType>(schema: S, input: unknown): ValidationResult<z.output<S>> {
  return toResult(schema.safeParse(input));
}

/** QA statistics used in API responses. */
export function quizStats(questions: Pick<Question, 'qa'>[]) {
  const flagged = questions.filter((q) => q.qa.status === 'flagged').length;
  return { total: questions.length, ok: questions.length - flagged, flagged };
}
