import { gameSettingsSchema, permutation, type CreateGameInput, type QuizTheme } from '@kvizhub/core';
import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { GameRepo, GameRow } from '../repo/games.js';
import type { QuizRepo, StoredQuestion, StoredQuiz } from '../repo/quizzes.js';
import { hmac, newId, sha256 } from '../util.js';
import type { GameManager, LiveGame } from './engine.js';
import type { ClassGameInfo, ClassGames, PlayerNaming } from '../classes/class-games.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message);
  }
}

/** Playable = not flagged (approved or ok). */
export const playableQuestions = (quiz: StoredQuiz) => quiz.questions.filter((q) => q.qa.status !== 'flagged');

export class GameService {
  constructor(
    private readonly cfg: Config,
    private readonly repo: GameRepo,
    private readonly quizzes: QuizRepo,
    private readonly manager: GameManager,
    private readonly log: FastifyBaseLogger,
    private readonly isTestPin: (pin: string) => boolean = () => false,
  ) {}

  classGames?: ClassGames;

  urls(gameId: string, pin: string, hostKey?: string) {
    return {
      joinUrl: `${this.cfg.publicUrl}/play`,
      qrUrl: `${this.cfg.publicUrl}/play?pin=${pin}`,
      // the host key travels in the URL fragment so it never reaches server or proxy logs
      hostUrl: `${this.cfg.publicUrl}/host/${gameId}${hostKey ? `#key=${hostKey}` : ''}`,
    };
  }

  create(quiz: StoredQuiz, input: CreateGameInput, classInfo: ClassGameInfo | null = null) {
    const playable = playableQuestions(quiz);
    if (playable.length === 0) {
      throw new HttpError(
        409,
        'Kvíz nemá žádnou hratelnou otázku: všechny otázky čekají na kontrolu (flagged). Učitel je musí nejdřív schválit v aplikaci.',
        'no_playable_questions',
      );
    }
    const settings = {
      ...gameSettingsSchema.parse(input.settings),
      shuffleQuestions: input.settings.shuffleQuestions ?? quiz.settings.shuffleQuestions,
      shuffleOptions: input.settings.shuffleOptions ?? quiz.settings.shuffleOptions,
    };
    const ordered: StoredQuestion[] = settings.shuffleQuestions ? permutation(playable.length).map((i) => playable[i]!) : playable;
    const hostKey = randomBytes(32).toString('base64url');
    const pin = this.manager.allocatePin(this.isTestPin);
    let row = this.repo.create({
      id: newId(),
      quizId: quiz.id,
      teacherId: quiz.teacherId,
      mode: input.mode,
      pin,
      hostKeyHash: sha256(hostKey),
      settings,
      questionIds: ordered.map((q) => q.id),
      endsAt: input.endsAt ? Date.parse(input.endsAt) : null,
      // settings.theme was normalised by the route; otherwise the quiz's look (V7.2)
      theme: (input.settings.theme as QuizTheme | undefined) ?? quiz.theme ?? null,
    });
    if (classInfo && this.classGames) {
      this.classGames.attach(row, classInfo, quiz, ordered, 'quiz', Date.now());
      row = this.repo.get(row.id)!;
    }
    this.manager.create(row, quiz.title, ordered);
    return {
      gameId: row.id,
      pin,
      ...this.urls(row.id, pin, hostKey),
      questionCount: ordered.length,
      skippedFlagged: quiz.questions.length - playable.length,
    };
  }

  status(row: GameRow) {
    const live = this.manager.get(row.id);
    return {
      gameId: row.id,
      quizId: row.quizId,
      status: live ? (live.finished ? 'finished' : live.phase === 'lobby' ? 'lobby' : 'running') : row.status,
      phase: live?.phase ?? null,
      pin: row.pin,
      playerCount: live ? live.players.size : this.repo.players(row.id).length,
      currentQuestion: live && live.index >= 0 ? live.index + 1 : null,
      totalQuestions: row.questionIds.length,
      createdAt: row.createdAt,
    };
  }

  results(row: GameRow, naming?: PlayerNaming) {
    const players = this.repo.players(row.id).map((p, i) => (naming ? { ...p, nickname: naming({ studentId: p.studentId ?? null, nickname: p.nickname }, i) } : p));
    const answers = this.repo.answers(row.id);
    const quiz = this.quizzes.get(row.quizId);
    const qmap = new Map(quiz?.questions.map((q) => [q.id, q]));
    const scores = new Map(players.map((p) => [p.id, 0]));
    for (const a of answers) scores.set(a.playerId, (scores.get(a.playerId) ?? 0) + a.points);
    const sorted = players.map((p) => ({ playerId: p.id, nickname: p.nickname, score: scores.get(p.id) ?? 0 })).sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'cs'));
    const ranking = sorted.map((p) => ({ ...p, rank: 1 + sorted.filter((o) => o.score > p.score).length }));
    const perQuestion = row.questionIds.map((qid, i) => {
      const as = answers.filter((a) => a.questionId === qid);
      const correct = as.filter((a) => a.correct).length;
      return {
        questionId: qid,
        number: i + 1,
        prompt: qmap.get(qid)?.prompt ?? '(otázka byla smazána)',
        answered: as.length,
        correct,
        successRate: players.length ? Math.round((correct / players.length) * 1000) / 1000 : 0,
        avgTimeMs: as.length ? Math.round(as.reduce((s, a) => s + a.elapsedMs, 0) / as.length) : null,
      };
    });
    return { gameId: row.id, quizId: row.quizId, status: this.status(row).status, playerCount: players.length, ranking, perQuestion };
  }

  /** CSV with nickname, score and answers only (no personal data). Semicolon separated + BOM for Czech Excel. */
  resultsCsv(row: GameRow, naming?: PlayerNaming): string {
    const res = this.results(row, naming);
    const answers = this.repo.answers(row.id);
    const quiz = this.quizzes.get(row.quizId);
    const qmap = new Map(quiz?.questions.map((q) => [q.id, q]));
    const cell = (v: unknown) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV formula injection guard
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const render = (qid: string, payload: Record<string, unknown>) => {
      const q = qmap.get(qid);
      if (!q) return '';
      if (Array.isArray(payload.indices)) return payload.indices.map((i: number) => q.options[i] ?? '?').join(', ');
      if (Array.isArray(payload.order)) return payload.order.map((i: number) => q.options[i] ?? '?').join(' > ');
      if (typeof payload.text === 'string') return payload.text;
      if (payload.value !== undefined) return String(payload.value);
      return '';
    };
    const header = ['Pořadí', 'Přezdívka', 'Skóre', ...res.perQuestion.flatMap((q) => [`Otázka ${q.number}`, `Otázka ${q.number} správně`])];
    const lines = [header.map(cell).join(';')];
    for (const p of res.ranking) {
      const cols: unknown[] = [p.rank, p.nickname, p.score];
      for (const q of res.perQuestion) {
        const a = answers.find((x) => x.playerId === p.playerId && x.questionId === q.questionId);
        cols.push(a ? render(q.questionId, JSON.parse(a.payloadJson)) : '', a ? (a.correct ? 'ano' : 'ne') : '');
      }
      lines.push(cols.map(cell).join(';'));
    }
    return `\ufeff${lines.join('\r\n')}\r\n`;
  }

  /** Webhook after a game ends: no personal data, HMAC-SHA256 signature. */
  async notifyFinished(game: LiveGame) {
    if (!this.cfg.webhookUrl) return;
    const body = JSON.stringify({ gameId: game.id, quizId: game.row.quizId, status: 'finished' });
    const signature = `sha256=${hmac(this.cfg.webhookSecret, body)}`;
    try {
      const res = await fetch(this.cfg.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-kvizhub-signature': signature },
        body,
        signal: AbortSignal.timeout(5000),
      });
      this.log.info({ gameId: game.id, status: res.status }, 'webhook delivered');
    } catch (err) {
      this.log.warn({ gameId: game.id, err: (err as Error).message }, 'webhook failed');
    }
  }
}
