import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { Question, Quiz, QuizSettings, QuizTheme } from '@kvizhub/core';
import type { Db } from '../db/index.js';
import { questions, quizzes } from '../db/schema.js';
import { newId } from '../util.js';

export type StoredQuestion = Question & { id: string; position: number; approvedAt: number | null };
export type StoredQuiz = Omit<Quiz, 'questions' | 'theme'> & {
  theme?: QuizTheme;
  id: string;
  teacherId: string;
  createdAt: number;
  updatedAt: number;
  questions: StoredQuestion[];
};

type QuestionRow = typeof questions.$inferSelect;
type QuizRow = typeof quizzes.$inferSelect;

export function rowToQuestion(r: QuestionRow): StoredQuestion {
  return {
    id: r.id,
    position: r.position,
    type: r.type as Question['type'],
    prompt: r.prompt,
    options: JSON.parse(r.optionsJson),
    correctIndices: JSON.parse(r.correctJson),
    acceptedAnswers: JSON.parse(r.acceptedAnswersJson),
    numericAnswer: r.numericAnswer,
    numericTolerance: r.numericTolerance,
    explanation: r.explanation,
    timeLimitSec: r.timeLimitSec,
    points: r.pointsMode as Question['points'],
    bloom: (r.bloom as Question['bloom']) ?? null,
    difficulty: (r.difficulty as Question['difficulty']) ?? null,
    sourceRef: r.sourceRefJson ? JSON.parse(r.sourceRefJson) : null,
    qa: { status: r.qaStatus as 'ok' | 'flagged', notes: r.qaNotes },
    ...(r.topic ? { topic: r.topic } : {}),
    imageId: r.imageId ?? null,
    imageLabels: r.imageLabelsJson ? JSON.parse(r.imageLabelsJson) : [],
    approvedAt: r.approvedAt,
  };
}

function questionToRow(q: Question, quizId: string, position: number, id = newId()): QuestionRow {
  return {
    id,
    quizId,
    position,
    type: q.type,
    prompt: q.prompt,
    optionsJson: JSON.stringify(q.options),
    correctJson: JSON.stringify(q.correctIndices),
    acceptedAnswersJson: JSON.stringify(q.acceptedAnswers),
    numericAnswer: q.numericAnswer,
    numericTolerance: q.numericTolerance,
    explanation: q.explanation,
    bloom: q.bloom ?? null,
    difficulty: q.difficulty ?? null,
    timeLimitSec: q.timeLimitSec,
    pointsMode: q.points,
    sourceRefJson: q.sourceRef ? JSON.stringify(q.sourceRef) : null,
    qaStatus: q.qa.status,
    qaNotes: q.qa.notes,
    approvedAt: null,
    topic: q.topic ?? null,
    imageId: q.imageId ?? null,
    imageLabelsJson: JSON.stringify(q.imageLabels ?? []),
  };
}

function rowToQuiz(r: QuizRow, qs: StoredQuestion[]): StoredQuiz {
  return {
    id: r.id,
    teacherId: r.teacherId,
    schemaVersion: 1,
    title: r.title,
    language: r.language,
    gradeLevel: r.gradeLevel,
    sourceFiles: JSON.parse(r.sourceFilesJson),
    ...(r.tagsJson ? { tags: JSON.parse(r.tagsJson) as string[] } : {}),
    ...(r.themeJson ? { theme: JSON.parse(r.themeJson) as QuizTheme } : {}),
    settings: JSON.parse(r.settingsJson),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    questions: qs,
  };
}

export interface QuizListItem {
  id: string;
  title: string;
  theme: QuizTheme | null;
  /** quiz tags (e.g. the subject), for the gallery filter (Dodatek 5) */
  tags: string[];
  /** mean success in percent over the quiz's finished games and tests, null when nothing was played */
  avgSuccess: number | null;
  /** classes the quiz was played in (names only, the teacher's own games) */
  classes: { id: string; name: string }[];
  questionCount: number;
  flaggedCount: number;
  createdAt: number;
  updatedAt: number;
}

export class QuizRepo {
  constructor(private readonly db: Db) {}

  /** `quiz.theme` must already be normalised (normalizeTheme). */
  create(teacherId: string, quiz: Omit<Quiz, 'theme'> & { theme?: QuizTheme | null }, idem?: { key: string; hash: string }): StoredQuiz {
    const now = Date.now();
    const id = newId();
    this.db.transaction((tx) => {
      tx.insert(quizzes)
        .values({
          id,
          teacherId,
          title: quiz.title,
          language: quiz.language,
          gradeLevel: quiz.gradeLevel,
          sourceFilesJson: JSON.stringify(quiz.sourceFiles),
          tagsJson: quiz.tags?.length ? JSON.stringify(quiz.tags) : null,
          settingsJson: JSON.stringify(quiz.settings),
          themeJson: quiz.theme ? JSON.stringify(quiz.theme) : null,
          idempotencyKey: idem?.key ?? null,
          requestHash: idem?.hash ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      if (quiz.questions.length) tx.insert(questions).values(quiz.questions.map((q, i) => questionToRow(q, id, i))).run();
    });
    return this.get(id)!;
  }

  setIdempotencyResponse(id: string, response: unknown) {
    this.db.update(quizzes).set({ idempotencyResponse: JSON.stringify(response) }).where(eq(quizzes.id, id)).run();
  }

  findByIdempotencyKey(teacherId: string, key: string) {
    return this.db
      .select({ id: quizzes.id, requestHash: quizzes.requestHash, response: quizzes.idempotencyResponse })
      .from(quizzes)
      .where(and(eq(quizzes.teacherId, teacherId), eq(quizzes.idempotencyKey, key)))
      .get();
  }

  get(id: string): StoredQuiz | undefined {
    const r = this.db.select().from(quizzes).where(eq(quizzes.id, id)).get();
    if (!r) return undefined;
    const qs = this.db.select().from(questions).where(eq(questions.quizId, id)).orderBy(asc(questions.position)).all();
    return rowToQuiz(r, qs.map(rowToQuestion));
  }

  /** Quiz owned by the teacher, or undefined. */
  getOwned(id: string, teacherId: string): StoredQuiz | undefined {
    const q = this.get(id);
    return q && q.teacherId === teacherId ? q : undefined;
  }

  list(teacherId: string, search = ''): QuizListItem[] {
    const where = search
      ? and(eq(quizzes.teacherId, teacherId), like(quizzes.title, `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`))
      : eq(quizzes.teacherId, teacherId);
    const rows = this.db
      .select({
        id: quizzes.id,
        title: quizzes.title,
        themeJson: quizzes.themeJson,
        tagsJson: quizzes.tagsJson,
        createdAt: quizzes.createdAt,
        updatedAt: quizzes.updatedAt,
        // the outer column must be qualified: an unqualified "id" would resolve to q.id inside the subquery
        questionCount: sql<number>`(select count(*) from questions q where q.quiz_id = "quizzes"."id")`,
        flaggedCount: sql<number>`(select count(*) from questions q where q.quiz_id = "quizzes"."id" and q.qa_status = 'flagged')`,
      })
      .from(quizzes)
      .where(where)
      .orderBy(desc(quizzes.updatedAt))
      .all();
    const stats = this.galleryStats(teacherId);
    return rows.map(({ themeJson, tagsJson, ...r }) => ({
      ...r,
      theme: themeJson ? (JSON.parse(themeJson) as QuizTheme) : null,
      tags: tagsJson ? (JSON.parse(tagsJson) as string[]) : [],
      avgSuccess: stats.success.get(r.id) ?? null,
      classes: stats.classes.get(r.id) ?? [],
    }));
  }

  /**
   * Success per quiz for the gallery (Dodatek 5): a live game counts correct answers out of players × played
   * questions (as its results do), a test the mean percent of scored attempts; the quiz is the mean over its
   * finished games. Results removed by retention simply drop out.
   */
  private galleryStats(teacherId: string) {
    const db = this.db.$client;
    const perGame = db
      .prepare(
        `SELECT g.quiz_id AS quizId,
           CASE WHEN g.mode = 'test' THEN
             (SELECT avg(a.percent) FROM attempts a WHERE a.game_id = g.id AND a.percent IS NOT NULL)
           ELSE
             100.0 * (SELECT coalesce(sum(an.correct), 0) FROM answers an WHERE an.game_id = g.id)
               / nullif((SELECT count(*) FROM players p WHERE p.game_id = g.id) * json_array_length(coalesce(g.played_json, g.question_ids_json)), 0)
           END AS rate
         FROM games g
         WHERE g.teacher_id = ? AND g.status = 'finished'`,
      )
      .all(teacherId) as { quizId: string; rate: number | null }[];
    const sums = new Map<string, { total: number; n: number }>();
    for (const g of perGame) {
      if (g.rate === null) continue;
      const e = sums.get(g.quizId) ?? { total: 0, n: 0 };
      e.total += g.rate;
      e.n++;
      sums.set(g.quizId, e);
    }
    const success = new Map([...sums].map(([id, e]) => [id, Math.round(e.total / e.n)]));
    const classRows = db
      .prepare(
        `SELECT DISTINCT g.quiz_id AS quizId, c.id AS id, c.name AS name
         FROM games g JOIN classes c ON c.id = g.class_id
         WHERE g.teacher_id = ? ORDER BY c.name`,
      )
      .all(teacherId) as { quizId: string; id: string; name: string }[];
    const classes = new Map<string, { id: string; name: string }[]>();
    for (const r of classRows) classes.set(r.quizId, [...(classes.get(r.quizId) ?? []), { id: r.id, name: r.name }]);
    return { success, classes };
  }

  updateMeta(id: string, patch: { title?: string; language?: string; gradeLevel?: string; settings?: QuizSettings; theme?: QuizTheme | null }) {
    const set: Partial<QuizRow> = { updatedAt: Date.now() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.language !== undefined) set.language = patch.language;
    if (patch.gradeLevel !== undefined) set.gradeLevel = patch.gradeLevel;
    if (patch.settings !== undefined) set.settingsJson = JSON.stringify(patch.settings);
    if (patch.theme !== undefined) set.themeJson = patch.theme ? JSON.stringify(patch.theme) : null;
    this.db.update(quizzes).set(set).where(eq(quizzes.id, id)).run();
  }

  touch(id: string) {
    this.db.update(quizzes).set({ updatedAt: Date.now() }).where(eq(quizzes.id, id)).run();
  }

  delete(id: string) {
    this.db.delete(quizzes).where(eq(quizzes.id, id)).run();
  }

  clone(id: string, teacherId: string): StoredQuiz {
    const src = this.get(id)!;
    const { questions: qs, ...meta } = src;
    return this.create(teacherId, { ...meta, title: `${src.title} (kopie)`.slice(0, 120), questions: qs });
  }

  addQuestion(quizId: string, q: Question, position?: number): StoredQuestion {
    const id = newId();
    this.db.transaction((tx) => {
      const count = tx.select({ n: sql<number>`count(*)` }).from(questions).where(eq(questions.quizId, quizId)).get()!.n;
      const pos = position === undefined || position > count ? count : Math.max(0, position);
      tx.update(questions)
        .set({ position: sql`${questions.position} + 1` })
        .where(and(eq(questions.quizId, quizId), sql`${questions.position} >= ${pos}`))
        .run();
      tx.insert(questions).values(questionToRow(q, quizId, pos, id)).run();
    });
    this.touch(quizId);
    return this.getQuestion(quizId, id)!;
  }

  getQuestion(quizId: string, qid: string): StoredQuestion | undefined {
    const r = this.db.select().from(questions).where(and(eq(questions.quizId, quizId), eq(questions.id, qid))).get();
    return r ? rowToQuestion(r) : undefined;
  }

  replaceQuestion(quizId: string, qid: string, q: Question, approvedAt: number | null) {
    const { id: _id, quizId: _quizId, position: _pos, ...row } = questionToRow(q, quizId, 0, qid);
    this.db
      .update(questions)
      .set({ ...row, approvedAt })
      .where(and(eq(questions.quizId, quizId), eq(questions.id, qid)))
      .run();
    this.touch(quizId);
  }

  deleteQuestion(quizId: string, qid: string) {
    this.db.transaction((tx) => {
      tx.delete(questions).where(and(eq(questions.quizId, quizId), eq(questions.id, qid))).run();
      const rest = tx.select({ id: questions.id }).from(questions).where(eq(questions.quizId, quizId)).orderBy(asc(questions.position)).all();
      rest.forEach((r, i) => tx.update(questions).set({ position: i }).where(eq(questions.id, r.id)).run());
    });
    this.touch(quizId);
  }

  reorder(quizId: string, ids: string[]) {
    this.db.transaction((tx) => {
      ids.forEach((id, i) => tx.update(questions).set({ position: i }).where(and(eq(questions.quizId, quizId), eq(questions.id, id))).run());
    });
    this.touch(quizId);
  }

  approve(quizId: string, qids: string[]) {
    if (!qids.length) return;
    this.db
      .update(questions)
      .set({ qaStatus: 'ok', approvedAt: Date.now() })
      .where(and(eq(questions.quizId, quizId), inArray(questions.id, qids)))
      .run();
    this.touch(quizId);
  }
}
