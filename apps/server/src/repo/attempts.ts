import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { answers, attempts, games, players } from '../db/schema.js';
import { newId } from '../util.js';

export type AttemptStatus = 'not_started' | 'in_progress' | 'submitted' | 'expired';

export interface Attempt {
  id: string;
  gameId: string;
  playerId: string;
  status: AttemptStatus;
  startedAt: number | null;
  deadlineAt: number | null;
  submittedAt: number | null;
  allowReturn: boolean;
  percent: number | null;
  score: number | null;
  maxScore: number | null;
  questionIds: string[];
  optionPerms: Record<string, number[]>;
  createdAt: number;
}

type Row = typeof attempts.$inferSelect;

function toAttempt(r: Row): Attempt {
  return {
    id: r.id,
    gameId: r.gameId,
    playerId: r.playerId,
    status: r.status as AttemptStatus,
    startedAt: r.startedAt,
    deadlineAt: r.deadlineAt,
    submittedAt: r.submittedAt,
    allowReturn: r.allowReturn === 1,
    percent: r.percent,
    score: r.score,
    maxScore: r.maxScore,
    questionIds: JSON.parse(r.questionIdsJson),
    optionPerms: JSON.parse(r.optionPermsJson),
    createdAt: r.createdAt,
  };
}

export type AttemptPatch = Partial<Pick<Attempt, 'status' | 'startedAt' | 'deadlineAt' | 'submittedAt' | 'allowReturn' | 'percent' | 'score' | 'maxScore'>>;

export class AttemptRepo {
  constructor(private readonly db: Db) {}

  /** Creates the player and their attempt in one transaction. */
  create(gameId: string, nickname: string, tokenHash: string, questionIds: string[], optionPerms: Record<string, number[]>, now: number) {
    const playerId = newId();
    const id = newId();
    this.db.transaction((tx) => {
      tx.insert(players).values({ id: playerId, gameId, nickname, tokenHash, joinedAt: now }).run();
      tx.insert(attempts)
        .values({ id, gameId, playerId, status: 'not_started', questionIdsJson: JSON.stringify(questionIds), optionPermsJson: JSON.stringify(optionPerms), createdAt: now })
        .run();
    });
    return this.get(id)!;
  }

  get(id: string): Attempt | undefined {
    const r = this.db.select().from(attempts).where(eq(attempts.id, id)).get();
    return r ? toAttempt(r) : undefined;
  }

  /** Attempt + player for a player token hash. */
  byTokenHash(tokenHash: string) {
    const r = this.db
      .select({ a: attempts, nickname: players.nickname })
      .from(attempts)
      .innerJoin(players, eq(players.id, attempts.playerId))
      .where(eq(players.tokenHash, tokenHash))
      .get();
    return r ? { attempt: toAttempt(r.a), nickname: r.nickname } : undefined;
  }

  /** Attempts of a game with the player's nickname, in join order. */
  listForGame(gameId: string) {
    return this.db
      .select({ a: attempts, nickname: players.nickname, joinedAt: players.joinedAt })
      .from(attempts)
      .innerJoin(players, eq(players.id, attempts.playerId))
      .where(eq(attempts.gameId, gameId))
      .orderBy(asc(players.joinedAt), asc(attempts.id))
      .all()
      .map((r) => ({ attempt: toAttempt(r.a), nickname: r.nickname }));
  }

  update(id: string, patch: AttemptPatch) {
    const set: Partial<Row> = {};
    for (const [k, v] of Object.entries(patch)) (set as Record<string, unknown>)[k] = k === 'allowReturn' ? (v ? 1 : 0) : v;
    if (Object.keys(set).length) this.db.update(attempts).set(set).where(eq(attempts.id, id)).run();
  }

  setPlayerToken(playerId: string, tokenHash: string) {
    this.db.update(players).set({ tokenHash }).where(eq(players.id, playerId)).run();
  }

  /** In-progress attempts whose deadline is at or before `cutoff`. */
  due(cutoff: number) {
    return this.db
      .select()
      .from(attempts)
      .where(and(eq(attempts.status, 'in_progress'), lte(attempts.deadlineAt, cutoff)))
      .all()
      .map(toAttempt);
  }

  inProgress(gameId: string) {
    return this.db
      .select()
      .from(attempts)
      .where(and(eq(attempts.gameId, gameId), inArray(attempts.status, ['in_progress'])))
      .all()
      .map(toAttempt);
  }

  /** Stored answers (ORIGINAL indices) of one player, keyed by question id. */
  answers(playerId: string): Map<string, unknown> {
    const rows = this.db.select({ q: answers.questionId, p: answers.payloadJson }).from(answers).where(eq(answers.playerId, playerId)).all();
    return new Map(rows.map((r) => [r.q, JSON.parse(r.p)]));
  }

  upsertAnswer(gameId: string, playerId: string, questionId: string, payload: unknown, correct: boolean, points: number, elapsedMs: number) {
    const payloadJson = JSON.stringify(payload);
    this.db
      .insert(answers)
      .values({ id: newId(), gameId, playerId, questionId, payloadJson, correct: correct ? 1 : 0, points, elapsedMs })
      .onConflictDoUpdate({ target: [answers.playerId, answers.questionId], set: { payloadJson, correct: correct ? 1 : 0, points, elapsedMs } })
      .run();
  }

  /** Open (running) test games whose deadline passed. */
  openTestsClosingBefore(now: number) {
    return this.db
      .select({ id: games.id, settingsJson: games.settingsJson })
      .from(games)
      .where(and(eq(games.mode, 'test'), eq(games.status, 'running')))
      .all()
      .filter((g) => {
        const closes = (JSON.parse(g.settingsJson) as { test?: { closesAt?: string | null } }).test?.closesAt;
        return closes ? Date.parse(closes) <= now : false;
      })
      .map((g) => g.id);
  }

  openTestByPin(pin: string) {
    return this.db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.mode, 'test'), eq(games.status, 'running'), eq(games.pin, pin)))
      .get();
  }

  /** D9: replace names in test games older than the cutoff by "Žák N". */
  anonymizeNames(cutoff: number): number {
    const client = this.db.$client;
    const old = client.prepare("SELECT id FROM games WHERE mode = 'test' AND created_at < ?").all(cutoff) as { id: string }[];
    let n = 0;
    const upd = client.prepare('UPDATE players SET nickname = ? WHERE id = ? AND nickname <> ?');
    for (const g of old) {
      const ps = client.prepare('SELECT id FROM players WHERE game_id = ? ORDER BY joined_at, id').all(g.id) as { id: string }[];
      ps.forEach((p, i) => {
        const label = `Žák ${i + 1}`;
        n += upd.run(label, p.id, label).changes;
      });
    }
    return n;
  }
}
