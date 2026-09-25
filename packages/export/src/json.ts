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
    })),
  };
  return { data, summary: buildSummary('json', quiz.questions.length, {}, []) };
}
