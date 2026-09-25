import { z } from 'zod';
import { normalizeText } from './text.js';

export const QUESTION_TYPES = ['single', 'multi', 'truefalse', 'short', 'numeric', 'order'] as const;
export const TIME_LIMITS = [5, 10, 20, 30, 60, 120] as const;
export const POINTS_MODES = ['standard', 'double', 'none'] as const;
export const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const QA_STATUSES = ['ok', 'flagged'] as const;
export const TRUEFALSE_OPTIONS = ['Pravda', 'Nepravda'] as const;

export const LIMITS = {
  title: 120,
  prompt: 300,
  option: 120,
  explanation: 300,
  quote: 300,
  locator: 60,
  acceptedAnswer: 60,
  questionsMax: 100,
  bodyBytes: 2 * 1024 * 1024,
  maxErrors: 50,
} as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Adds a contract rule violation with a stable machine code. */
function fail(ctx: z.RefinementCtx, path: (string | number)[], code: string, message: string) {
  ctx.addIssue({ code: 'custom', path, message, params: { code } });
}

const text = (max: number) => z.string().trim().min(1).max(max);

export const sourceRefSchema = z.object({
  file: z.string().trim().min(1).max(255),
  locator: z.string().trim().max(LIMITS.locator).default(''),
  quote: z.string().trim().max(LIMITS.quote).default(''),
});

export const qaSchema = z
  .object({
    status: z.enum(QA_STATUSES).default('ok'),
    notes: z.string().trim().max(500).default(''),
  })
  .superRefine((qa, ctx) => {
    if (qa.status === 'flagged' && qa.notes.length === 0) {
      fail(ctx, ['notes'], 'notes_required', 'Otázka ve stavu „flagged“ musí mít vyplněnou poznámku (qa.notes).');
    }
  });

const questionBase = z.object({
  id: z.string().optional(),
  type: z.enum(QUESTION_TYPES),
  prompt: text(LIMITS.prompt),
  options: z.array(text(LIMITS.option)).max(5).default([]),
  correctIndices: z.array(z.number().int()).default([]),
  acceptedAnswers: z.array(text(LIMITS.acceptedAnswer)).max(5).default([]),
  numericAnswer: z.number().finite().nullable().default(null),
  numericTolerance: z.number().finite().min(0).nullable().default(null),
  explanation: z.string().trim().max(LIMITS.explanation).default(''),
  timeLimitSec: z
    .number()
    .int()
    .default(20)
    .refine((v) => (TIME_LIMITS as readonly number[]).includes(v), {
      params: { code: 'invalid_time_limit' },
      message: `Časový limit musí být jedna z hodnot ${TIME_LIMITS.join(', ')} s.`,
    }),
  points: z.enum(POINTS_MODES).default('standard'),
  bloom: z.enum(BLOOM_LEVELS).nullable().optional(),
  difficulty: z.enum(DIFFICULTIES).nullable().optional(),
  sourceRef: sourceRefSchema.nullable().optional(),
  qa: qaSchema.default({ status: 'ok', notes: '' }),
});

type QuestionDraft = z.output<typeof questionBase>;

/** Type specific rules from contract section 2.3. Mutates truefalse options (server fills them in). */
function refineQuestion(q: QuestionDraft, ctx: z.RefinementCtx) {
  const n = q.options.length;
  const ci = q.correctIndices;
  const optionCount = (min: number, max: number) => {
    if (n < min || n > max) {
      fail(ctx, ['options'], 'option_count', `Typ „${q.type}“ vyžaduje ${min === max ? min : `${min}–${max}`} možnosti, zadáno ${n}.`);
      return false;
    }
    return true;
  };
  const noOptions = () => {
    if (n > 0) fail(ctx, ['options'], 'options_not_allowed', `Typ „${q.type}“ nesmí mít možnosti (options musí být prázdné).`);
  };
  const noCorrect = () => {
    if (ci.length > 0) fail(ctx, ['correctIndices'], 'correct_not_allowed', `Typ „${q.type}“ nepoužívá correctIndices, musí být prázdné.`);
  };
  const checkIndices = () => {
    const seen = new Set<number>();
    ci.forEach((idx, i) => {
      if (idx < 0 || idx >= n) fail(ctx, ['correctIndices', i], 'out_of_range', `Index ${idx} je mimo rozsah možností.`);
      if (seen.has(idx)) fail(ctx, ['correctIndices', i], 'duplicate_index', `Index ${idx} je uveden vícekrát.`);
      seen.add(idx);
    });
  };
  const noNumeric = () => {
    if (q.numericAnswer !== null || q.numericTolerance !== null) {
      fail(ctx, ['numericAnswer'], 'numeric_not_allowed', `Typ „${q.type}“ nesmí mít numericAnswer ani numericTolerance.`);
    }
  };
  const noAccepted = () => {
    if (q.acceptedAnswers.length > 0) fail(ctx, ['acceptedAnswers'], 'accepted_not_allowed', `Typ „${q.type}“ nesmí mít acceptedAnswers.`);
  };

  switch (q.type) {
    case 'single':
      if (optionCount(3, 4)) checkIndices();
      if (ci.length !== 1) fail(ctx, ['correctIndices'], 'correct_count', 'Typ „single“ musí mít právě 1 správnou odpověď.');
      noAccepted();
      noNumeric();
      break;
    case 'multi':
      if (optionCount(4, 5)) checkIndices();
      if (ci.length < 2) fail(ctx, ['correctIndices'], 'correct_count', 'Typ „multi“ musí mít alespoň 2 správné odpovědi.');
      else if (ci.length >= n && n > 0) fail(ctx, ['correctIndices'], 'correct_count', 'Typ „multi“ nesmí mít správné všechny možnosti.');
      noAccepted();
      noNumeric();
      break;
    case 'truefalse':
      if (n === 0) {
        q.options = [...TRUEFALSE_OPTIONS];
      } else if (n !== 2 || q.options[0] !== TRUEFALSE_OPTIONS[0] || q.options[1] !== TRUEFALSE_OPTIONS[1]) {
        fail(ctx, ['options'], 'truefalse_options', 'Typ „truefalse“ musí mít možnosti přesně ["Pravda","Nepravda"] (nebo je vynechte).');
      }
      if (ci.length !== 1 || (ci[0] !== 0 && ci[0] !== 1)) {
        fail(ctx, ['correctIndices'], 'correct_count', 'Typ „truefalse“ musí mít correctIndices [0] (Pravda) nebo [1] (Nepravda).');
      }
      noAccepted();
      noNumeric();
      break;
    case 'short':
      noOptions();
      noCorrect();
      noNumeric();
      if (q.acceptedAnswers.length < 1) fail(ctx, ['acceptedAnswers'], 'accepted_count', 'Typ „short“ vyžaduje 1–5 přijatelných odpovědí (acceptedAnswers).');
      break;
    case 'numeric':
      noOptions();
      noCorrect();
      noAccepted();
      if (q.numericAnswer === null) fail(ctx, ['numericAnswer'], 'required', 'Typ „numeric“ vyžaduje číselnou odpověď (numericAnswer).');
      if (q.numericTolerance === null) fail(ctx, ['numericTolerance'], 'required', 'Typ „numeric“ vyžaduje toleranci (numericTolerance >= 0).');
      break;
    case 'order':
      optionCount(3, 5);
      noCorrect();
      noAccepted();
      noNumeric();
      break;
  }

  const dupCheck = (list: string[], key: string, what: string) => {
    const seen = new Map<string, number>();
    list.forEach((v, i) => {
      const k = normalizeText(v);
      if (seen.has(k)) fail(ctx, [key, i], 'duplicate', `${what} „${v}“ je duplicitní s položkou ${seen.get(k)}.`);
      else seen.set(k, i);
    });
  };
  dupCheck(q.options, 'options', 'Možnost');
  dupCheck(q.acceptedAnswers, 'acceptedAnswers', 'Odpověď');
}

export const questionSchema = questionBase.superRefine(refineQuestion);

export const quizSettingsSchema = z.object({
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(true),
});

export const sourceFileSchema = z.object({
  name: z.string().trim().min(1).max(255),
  sha256: z.string().trim().max(64).default(''),
});

export const quizSchema = z.object({
  schemaVersion: z.literal(1),
  title: text(LIMITS.title),
  language: z.string().trim().min(2).max(10).default('cs'),
  gradeLevel: z.string().trim().max(60).default(''),
  sourceFiles: z.array(sourceFileSchema).max(20).default([]),
  settings: quizSettingsSchema.default({ shuffleQuestions: false, shuffleOptions: true }),
  questions: z.array(questionSchema).min(1).max(LIMITS.questionsMax),
});

/** Partial update of a question (PATCH). The merged result is validated with questionSchema. */
export const questionPatchSchema = questionBase.omit({ id: true }).partial();

export const quizMetaPatchSchema = z.object({
  title: text(LIMITS.title).optional(),
  language: z.string().trim().min(2).max(10).optional(),
  gradeLevel: z.string().trim().max(60).optional(),
  settings: quizSettingsSchema.partial().optional(),
});

export const gameSettingsSchema = z.object({
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  showLeaderboard: z.boolean().default(true),
  streakBonus: z.boolean().default(false),
  partialMulti: z.boolean().default(false),
  allowLateJoin: z.boolean().default(false),
  ignoreDiacritics: z.boolean().default(true),
});

export const createGameSchema = z.object({
  mode: z.enum(['live', 'selfpaced']).default('live'),
  settings: gameSettingsSchema.default({
    showLeaderboard: true,
    streakBonus: false,
    partialMulti: false,
    allowLateJoin: false,
    ignoreDiacritics: true,
  }),
  endsAt: z.string().datetime().optional(),
});

export type QuizInput = z.input<typeof quizSchema>;
export type Quiz = z.output<typeof quizSchema>;
export type Question = z.output<typeof questionSchema>;
export type QuestionInput = z.input<typeof questionSchema>;
export type QuestionPatch = z.output<typeof questionPatchSchema>;
export type QuizSettings = z.output<typeof quizSettingsSchema>;
export type GameSettings = z.output<typeof gameSettingsSchema>;
export type CreateGameInput = z.output<typeof createGameSchema>;
export type SourceRef = z.output<typeof sourceRefSchema>;
