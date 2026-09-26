import { validateQuiz } from '@kvizhub/core';
import sample from '../../../fixtures/quizzes/valid/optika.json' with { type: 'json' };
import type { QuizRepo } from './repo/quizzes.js';

/** Every new teacher starts with the sample quiz, so the review screen, a game and exports can be tried at once. */
export function seedSampleQuiz(quizzes: QuizRepo, teacherId: string) {
  const r = validateQuiz({ ...sample, title: `Ukázka: ${sample.title}` });
  if (r.ok) quizzes.create(teacherId, { ...r.data, theme: null });
}
