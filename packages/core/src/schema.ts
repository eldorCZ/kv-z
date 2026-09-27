import { z } from 'zod';
import { leaveGuardSchema } from './leave-guard.js';
import { normalizeText } from './text.js';

export const QUESTION_TYPES = ['single', 'multi', 'truefalse', 'short', 'numeric', 'order', 'image-label'] as const;
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
  imageLabel: 60,
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

export const imageLabelSchema = z.object({
  text: text(LIMITS.imageLabel),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  radius: z.number().min(0.03).max(0.3).default(0.12),
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
  /** id of uploaded question image served from /media/theme/<id>/... */
  imageId: z.string().regex(/^[0-9a-f]{32}$/).nullable().default(null),
  /** draggable labels and their target positions, normalized 0..1 inside the image */
  imageLabels: z.array(imageLabelSchema).max(5).default([]),
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
  // Dodatek 3 (C10.1): optional topic for tracking mastery over the school year
  topic: z.string().trim().min(1).max(60).nullable().optional(),
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
  const noImageLabels = () => {
    if (q.imageLabels.length > 0) fail(ctx, ['imageLabels'], 'image_labels_not_allowed', `Typ „${q.type}“ nepoužívá popisky obrázku.`);
  };

  switch (q.type) {
    case 'single':
      if (optionCount(3, 4)) checkIndices();
      if (ci.length !== 1) fail(ctx, ['correctIndices'], 'correct_count', 'Typ „single“ musí mít právě 1 správnou odpověď.');
      noAccepted();
      noNumeric();
      noImageLabels();
      break;
    case 'multi':
      if (optionCount(4, 5)) checkIndices();
      if (ci.length < 2) fail(ctx, ['correctIndices'], 'correct_count', 'Typ „multi“ musí mít alespoň 2 správné odpovědi.');
      else if (ci.length >= n && n > 0) fail(ctx, ['correctIndices'], 'correct_count', 'Typ „multi“ nesmí mít správné všechny možnosti.');
      noAccepted();
      noNumeric();
      noImageLabels();
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
      noImageLabels();
      break;
    case 'short':
      noOptions();
      noCorrect();
      noNumeric();
      if (q.acceptedAnswers.length < 1) fail(ctx, ['acceptedAnswers'], 'accepted_count', 'Typ „short“ vyžaduje 1–5 přijatelných odpovědí (acceptedAnswers).');
      noImageLabels();
      break;
    case 'numeric':
      noOptions();
      noCorrect();
      noAccepted();
      if (q.numericAnswer === null) fail(ctx, ['numericAnswer'], 'required', 'Typ „numeric“ vyžaduje číselnou odpověď (numericAnswer).');
      if (q.numericTolerance === null) fail(ctx, ['numericTolerance'], 'required', 'Typ „numeric“ vyžaduje toleranci (numericTolerance >= 0).');
      noImageLabels();
      break;
    case 'order':
      optionCount(3, 5);
      noCorrect();
      noAccepted();
      noNumeric();
      noImageLabels();
      break;
    case 'image-label':
      noOptions();
      noCorrect();
      noAccepted();
      noNumeric();
      if (!q.imageId) fail(ctx, ['imageId'], 'required', 'Typ „image-label“ vyžaduje nahraný obrázek otázky.');
      if (q.imageLabels.length < 1) fail(ctx, ['imageLabels'], 'image_label_count', 'Přiřazování do obrázku vyžaduje alespoň 1 popisek.');
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
  dupCheck(q.imageLabels.map((l) => l.text), 'imageLabels', 'Popisek');
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
  tags: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
  settings: quizSettingsSchema.default({ shuffleQuestions: false, shuffleOptions: true }),
  /** optional look {"motive", "accent"} (Dodatek 4, V7.4); checked leniently by normalizeTheme, never a 422 */
  theme: z.unknown().optional(),
  questions: z.array(questionSchema).min(1).max(LIMITS.questionsMax),
});

/** Partial update of a question (PATCH). The merged result is validated with questionSchema. */
export const questionPatchSchema = questionBase.omit({ id: true }).partial();

export const quizMetaPatchSchema = z.object({
  title: text(LIMITS.title).optional(),
  language: z.string().trim().min(2).max(10).optional(),
  gradeLevel: z.string().trim().max(60).optional(),
  settings: quizSettingsSchema.partial().optional(),
  /** null clears the look; ids are checked by normalizeTheme */
  theme: z.unknown().optional(),
});


export const SHOW_RESULTS = ['none', 'score', 'full'] as const;

/** Test mode settings (docs/TESTOVACI-REZIM.md, D2). */
export const testSettingsSchema = z
  .object({
    timeLimitMin: z.number().int().min(1).max(240).nullable().default(20),
    opensAt: z.string().datetime({ offset: true }).nullable().default(null),
    closesAt: z.string().datetime({ offset: true }).nullable().default(null),
    requireName: z.boolean().default(true),
    allowBackNavigation: z.boolean().default(true),
    showResultsToStudent: z.enum(SHOW_RESULTS).default('score'),
    leaveGuard: leaveGuardSchema.default({ mode: 'warn', maxLeaves: 2, onExceed: 'notify', requireFullscreen: false, minLeaveMs: 1000 }),
  })
  .superRefine((t, ctx) => {
    if (t.opensAt && t.closesAt && Date.parse(t.closesAt) <= Date.parse(t.opensAt)) {
      fail(ctx, ['closesAt'], 'invalid_range', 'Termín uzavření musí být po začátku testu.');
    }
  });

export const gameSettingsSchema = z.object({
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  showLeaderboard: z.boolean().default(true),
  streakBonus: z.boolean().default(false),
  partialMulti: z.boolean().default(false),
  allowLateJoin: z.boolean().default(false),
  ignoreDiacritics: z.boolean().default(true),
  test: testSettingsSchema.optional(),
  // Dodatek 3 (C6.1, C10.3): class game
  classId: z.string().min(1).max(40).optional(),
  label: z.string().trim().min(1).max(60).optional(),
  allowGuests: z.boolean().default(false),
  countInStats: z.boolean().default(true),
  /** selected students (UI only); omitted = all active students of the class */
  audience: z.array(z.string().min(1).max(40)).max(200).optional(),
  /** look of this game only (V7.2); overrides the quiz, checked by normalizeTheme */
  theme: z.unknown().optional(),
});

export const createGameSchema = z.object({
  // "selfpaced" (original contract) is accepted as a synonym of "test"
  mode: z
    .enum(['live', 'test', 'selfpaced'])
    .default('live')
    .transform((m) => (m === 'selfpaced' ? 'test' : m)),
  settings: gameSettingsSchema.default({
    showLeaderboard: true,
    streakBonus: false,
    partialMulti: false,
    allowLateJoin: false,
    ignoreDiacritics: true,
    allowGuests: false,
    countInStats: true,
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
export type TestSettings = z.output<typeof testSettingsSchema>;
export type SourceRef = z.output<typeof sourceRefSchema>;
