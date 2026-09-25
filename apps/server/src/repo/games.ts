import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { GameSettings } from '@kvizhub/core';
import type { Db } from '../db/index.js';
import { answers, games, players, quizzes } from '../db/schema.js';
import { newId } from '../util.js';

export type GameStatus = 'lobby' | 'running' | 'finished' | 'aborted';

export interface GameRow {
  id: string;
  quizId: string;
  teacherId: string;
  mode: string;
  pin: string;
  hostKeyHash: string;
  status: GameStatus;
  settings: GameSettings & { shuffleQuestions: boolean; shuffleOptions: boolean };
  questionIds: string[];
  createdAt: number;
  endsAt: number | null;
  finishedAt: number | null;
}

function toGame(r: typeof games.$inferSelect): GameRow {
  return {
    ...r,
    status: r.status as GameStatus,
    settings: JSON.parse(r.settingsJson),
    questionIds: JSON.parse(r.questionIdsJson),
  };
}

export class GameRepo {
  constructor(private readonly db: Db) {}

  create(g: Omit<GameRow, 'createdAt' | 'finishedAt' | 'status'>): GameRow {
    this.db
      .insert(games)
      .values({
        id: g.id,
        quizId: g.quizId,
        teacherId: g.teacherId,
        mode: g.mode,
        pin: g.pin,
        hostKeyHash: g.hostKeyHash,
        status: 'lobby',
        settingsJson: JSON.stringify(g.settings),
        questionIdsJson: JSON.stringify(g.questionIds),
        createdAt: Date.now(),
        endsAt: g.endsAt,
      })
      .run();
    return this.get(g.id)!;
  }

  get(id: string): GameRow | undefined {
    const r = this.db.select().from(games).where(eq(games.id, id)).get();
    return r ? toGame(r) : undefined;
  }

  list(teacherId: string, quizId?: string) {
    const where = quizId ? and(eq(games.teacherId, teacherId), eq(games.quizId, quizId)) : eq(games.teacherId, teacherId);
    return this.db
      .select({ id: games.id, quizId: games.quizId, quizTitle: quizzes.title, pin: games.pin, status: games.status, mode: games.mode, createdAt: games.createdAt, finishedAt: games.finishedAt })
      .from(games)
      .innerJoin(quizzes, eq(quizzes.id, games.quizId))
      .where(where)
      .orderBy(desc(games.createdAt))
      .limit(200)
      .all();
  }

  setStatus(id: string, status: GameStatus) {
    this.db
      .update(games)
      .set({ status, ...(status === 'finished' || status === 'aborted' ? { finishedAt: Date.now() } : {}) })
      .where(eq(games.id, id))
      .run();
  }

  /** Games that were live when the process stopped cannot be resumed (state is in memory). */
  abortUnfinished() {
    this.db
      .update(games)
      .set({ status: 'aborted', finishedAt: Date.now() })
      .where(inArray(games.status, ['lobby', 'running']))
      .run();
  }

  addPlayer(gameId: string, nickname: string, tokenHash: string): string {
    const id = newId();
    this.db.insert(players).values({ id, gameId, nickname, tokenHash, joinedAt: Date.now() }).run();
    return id;
  }

  removePlayer(playerId: string) {
    this.db.delete(players).where(eq(players.id, playerId)).run();
  }

  addAnswer(a: { gameId: string; playerId: string; questionId: string; payload: unknown; correct: boolean; points: number; elapsedMs: number }) {
    this.db
      .insert(answers)
      .values({
        id: newId(),
        gameId: a.gameId,
        playerId: a.playerId,
        questionId: a.questionId,
        payloadJson: JSON.stringify(a.payload),
        correct: a.correct ? 1 : 0,
        points: a.points,
        elapsedMs: a.elapsedMs,
      })
      .onConflictDoNothing()
      .run();
  }

  deleteAnswers(gameId: string, questionId: string) {
    this.db.delete(answers).where(and(eq(answers.gameId, gameId), eq(answers.questionId, questionId))).run();
  }

  players(gameId: string) {
    return this.db.select({ id: players.id, nickname: players.nickname }).from(players).where(eq(players.gameId, gameId)).all();
  }

  answers(gameId: string) {
    return this.db.select().from(answers).where(eq(answers.gameId, gameId)).all();
  }

  /** Retention: delete games (and by cascade players and answers) older than the cutoff. */
  deleteOlderThan(cutoff: number): number {
    return this.db.delete(games).where(lt(games.createdAt, cutoff)).run().changes;
  }
}
