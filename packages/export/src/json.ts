import { buildSummary, type ExportQuiz, type ExportSummary } from './types.js';

/** JSON export: identical to the contract (section 2.2), including explanations, sources and QA status. */
export function jsonExport(quiz: ExportQuiz, opts: { includeIds?: boolean } = {}): { data: unknown; summary: ExportSummary } {
  const data = {
    schemaVersion: 1,
    title: quiz.title,
    language: quiz.language,
    gradeLevel: quiz.gradeLevel,
    sourceFiles: quiz.sourceFiles,
    settings: quiz.settings,
    ...(quiz.tags?.length ? { tags: quiz.tags } : {}),
    ...themeOf(quiz.theme),
    questions: quiz.questions.map((q) => ({
      ...(opts.includeIds && q.id ? { id: q.id } : {}),
      type: q.type,
      prompt: q.prompt,
      options: q.options,
      correctIndices: q.correctIndices,
      acceptedAnswers: q.acceptedAnswers,
      numericAnswer: q.numericAnswer,
      numericTolerance: q.numericTolerance,
      explanation: q.explanation,
      timeLimitSec: q.timeLimitSec,
      points: q.points,
      bloom: q.bloom ?? null,
      difficulty: q.difficulty ?? null,
      sourceRef: q.sourceRef ?? null,
      qa: q.qa,
      ...(q.topic ? { topic: q.topic } : {}),
    })),
  };
  return { data, summary: buildSummary('json', quiz.questions.length, {}, []) };
}

/** Only the portable part of the look: a custom image belongs to one server and is not exported (V7.4). */
function themeOf(theme: unknown): { theme?: { motive?: string; accent?: string } } {
  if (!theme || typeof theme !== 'object') return {};
  const { motive, accent } = theme as { motive?: unknown; accent?: unknown };
  const out = { ...(typeof motive === 'string' ? { motive } : {}), ...(typeof accent === 'string' ? { accent } : {}) };
  return Object.keys(out).length ? { theme: out } : {};
}
