import {
  LATENCY_GRACE_MS,
  checkAnswer,
  checkNickname,
  mapDisplayedPayload,
  computePoints,
  correctText,
  shuffleOptions,
  toPublicQuestion,
  type GameOverEvent,
  type GamePhase,
  type HostState,
  type LeaderboardEvent,
  type LobbyUpdate,
  type PlayerResult,
  type RankEntry,
  type RevealEvent,
  type ServerToClientEvents,
  type ShuffledOptions,
} from '@kvizhub/core';
import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { GameRepo, GameRow } from '../repo/games.js';
import type { StoredQuestion } from '../repo/quizzes.js';
import { randomPin, sha256 } from '../util.js';

export const MAX_PLAYERS = 500;
/** How long a finished game stays in memory so that reconnecting players still see the podium. */
const FINISHED_RETENTION_MS = 10 * 60 * 1000;

/** Minimal emitter interface (Socket.IO server) – keeps the engine testable. */
export interface Emitter {
  to(room: string | string[]): { emit<E extends keyof ServerToClientEvents>(ev: E, ...args: Parameters<ServerToClientEvents[E]>): boolean };
  in(room: string): { socketsLeave(room: string | string[]): void; disconnectSockets(close?: boolean): void };
}

export const rooms = {
  all: (gameId: string) => `g:${gameId}`,
  hosts: (gameId: string) => `h:${gameId}`,
  player: (playerId: string) => `p:${playerId}`,
};

interface LivePlayer {
  id: string;
  nickname: string;
  tokenHash: string;
  score: number;
  streak: number;
  sockets: number;
  lastResult?: PlayerResult;
}

interface Round {
  q: StoredQuestion;
  shuffled: ShuffledOptions;
  startedAt: number;
  deadline: number;
  answers: Map<string, { correct: boolean; points: number; displayed: number[] | null; prevStreak: number }>;
  timer?: NodeJS.Timeout;
  closed: boolean;
  pausedAt?: number;
  playerCount: number;
}

export class GameError extends Error {}

export interface GameDeps {
  io: Emitter;
  repo: GameRepo;
  log: FastifyBaseLogger;
  hostTimeoutMs: number;
  onFinished: (game: LiveGame) => void;
}

export class LiveGame {
  phase: GamePhase = 'lobby';
  index = -1;
  locked = false;
  paused = false;
  hostSockets = 0;
  readonly players = new Map<string, LivePlayer>();
  private round?: Round;
  private lastReveal?: RevealEvent;
  private hostTimer?: NodeJS.Timeout;

  constructor(
    readonly row: GameRow,
    readonly title: string,
    readonly questions: StoredQuestion[],
    private readonly deps: GameDeps,
  ) {}

  get id() {
    return this.row.id;
  }
  get pin() {
    return this.row.pin;
  }
  get settings() {
    return this.row.settings;
  }
  get finished() {
    return this.phase === 'finished';
  }

  private emitAll<E extends keyof ServerToClientEvents>(ev: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.deps.io.to(rooms.all(this.id)).emit(ev, ...args);
  }
  private emitHosts<E extends keyof ServerToClientEvents>(ev: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.deps.io.to(rooms.hosts(this.id)).emit(ev, ...args);
  }
  private emitPlayer<E extends keyof ServerToClientEvents>(pid: string, ev: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.deps.io.to(rooms.player(pid)).emit(ev, ...args);
  }

  // ---------- state snapshots ----------

  lobby(): LobbyUpdate {
    return { pin: this.pin, locked: this.locked, players: [...this.players.values()].map((p) => ({ id: p.id, nickname: p.nickname })) };
  }

  hostState(): HostState {
    return {
      phase: this.phase,
      index: this.index,
      total: this.questions.length,
      playerCount: this.players.size,
      answeredCount: this.round?.answers.size ?? 0,
      paused: this.paused,
      locked: this.locked,
    };
  }

  private broadcastHostState() {
    this.emitHosts('host_state', this.hostState());
  }

  ranking(): RankEntry[] {
    const sorted = [...this.players.values()].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'cs'));
    return sorted.map((p) => ({ nickname: p.nickname, score: p.score, rank: 1 + sorted.filter((o) => o.score > p.score).length }));
  }

  private rankOf(p: LivePlayer): number {
    let r = 1;
    for (const o of this.players.values()) if (o.score > p.score) r++;
    return r;
  }

  // ---------- host ----------

  hostAttached() {
    this.hostSockets++;
    if (this.hostTimer) {
      clearTimeout(this.hostTimer);
      this.hostTimer = undefined;
    }
    if (this.paused) this.resume();
  }

  hostDetached() {
    this.hostSockets = Math.max(0, this.hostSockets - 1);
    if (this.hostSockets > 0 || this.finished) return;
    this.pause('Učitel se odpojil. Hra pokračuje, jakmile se znovu připojí.');
    this.hostTimer = setTimeout(() => {
      this.deps.log.info({ gameId: this.id }, 'host did not return, ending game');
      this.end();
    }, this.deps.hostTimeoutMs);
    this.hostTimer.unref?.();
  }

  private pause(reason: string) {
    if (this.paused) return;
    this.paused = true;
    const r = this.round;
    if (this.phase === 'question' && r && !r.closed) {
      clearTimeout(r.timer);
      r.pausedAt = Date.now();
    }
    this.emitAll('paused', { paused: true, reason });
  }

  private resume() {
    this.paused = false;
    const r = this.round;
    if (this.phase === 'question' && r && !r.closed && r.pausedAt !== undefined) {
      const pausedFor = Date.now() - r.pausedAt;
      r.startedAt += pausedFor;
      r.deadline += pausedFor;
      r.pausedAt = undefined;
      this.armTimer(r);
      this.emitQuestion(r);
    }
    this.emitAll('paused', { paused: false, reason: '' });
    this.broadcastHostState();
  }

  lockLobby(locked: boolean) {
    this.locked = locked;
    this.emitAll('lobby_update', this.lobby());
    this.broadcastHostState();
  }

  start() {
    if (this.phase !== 'lobby') throw new GameError('Hra už běží.');
    if (this.players.size === 0) throw new GameError('Počkejte, až se připojí alespoň jeden žák.');
    if (!this.settings.allowLateJoin) this.locked = true;
    this.deps.repo.setStatus(this.id, 'running');
    this.startQuestion(0);
  }

  /** Space bar: move forward. */
  next() {
    if (this.paused) throw new GameError('Hra je pozastavena.');
    switch (this.phase) {
      case 'lobby':
        return this.start();
      case 'question':
        return this.reveal();
      case 'reveal':
        if (this.settings.showLeaderboard && this.index < this.questions.length - 1) return this.showLeaderboard();
        return this.advance();
      case 'leaderboard':
        return this.advance();
      case 'finished':
        throw new GameError('Hra už skončila.');
    }
  }

  /** Enter: reveal the answer now. */
  reveal() {
    if (this.phase !== 'question' || !this.round) throw new GameError('Teď není co odhalit.');
    this.closeRound();
  }

  /** Skip the current question without scoring. */
  skip() {
    if (this.phase !== 'question' || !this.round) throw new GameError('Přeskočit lze jen probíhající otázku.');
    const r = this.round;
    clearTimeout(r.timer);
    r.closed = true;
    for (const [pid, a] of r.answers) {
      const p = this.players.get(pid);
      if (p) {
        p.score -= a.points;
        p.streak = a.prevStreak;
      }
    }
    this.deps.repo.deleteAnswers(this.id, r.q.id);
    this.advance();
  }

  private advance() {
    if (this.index + 1 >= this.questions.length) return this.end();
    this.startQuestion(this.index + 1);
  }

  kick(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) throw new GameError('Hráč nenalezen.');
    this.players.delete(playerId);
    this.round?.answers.delete(playerId);
    this.deps.repo.removePlayer(playerId);
    this.emitPlayer(playerId, 'kicked', { reason: 'Učitel vás odebral ze hry.' });
    this.deps.io.in(rooms.player(playerId)).socketsLeave([rooms.all(this.id), rooms.player(playerId)]);
    this.emitAll('lobby_update', this.lobby());
    this.broadcastHostState();
    this.maybeCloseEarly();
  }

  end() {
    if (this.finished) return;
    if (this.round && !this.round.closed) {
      clearTimeout(this.round.timer);
      this.round.closed = true;
    }
    if (this.hostTimer) clearTimeout(this.hostTimer);
    this.phase = 'finished';
    this.paused = false;
    this.deps.repo.setStatus(this.id, 'finished');
    const ranking = this.ranking();
    const base: GameOverEvent = { podium: ranking.slice(0, 3), ranking: ranking.slice(0, 10) };
    this.emitHosts('game_over', { ...base, ranking });
    for (const p of this.players.values()) this.emitPlayer(p.id, 'game_over', { ...base, you: { rank: this.rankOf(p), score: p.score } });
    this.broadcastHostState();
    this.deps.onFinished(this);
  }

  // ---------- questions ----------

  private startQuestion(index: number) {
    const q = this.questions[index]!;
    this.index = index;
    this.phase = 'question';
    const shuffled = shuffleOptions(q, this.settings.shuffleOptions);
    const now = Date.now();
    const r: Round = {
      q,
      shuffled,
      startedAt: now,
      deadline: now + q.timeLimitSec * 1000,
      answers: new Map(),
      closed: false,
      playerCount: this.players.size,
    };
    this.round = r;
    this.lastReveal = undefined;
    this.armTimer(r);
    this.emitQuestion(r);
    this.broadcastHostState();
  }

  private armTimer(r: Round) {
    clearTimeout(r.timer);
    r.timer = setTimeout(() => this.closeRound(), Math.max(0, r.deadline - Date.now()) + LATENCY_GRACE_MS);
    r.timer.unref?.();
  }

  private publicQuestion(r: Round) {
    return toPublicQuestion(r.q, r.shuffled, this.index, this.questions.length);
  }

  private emitQuestion(r: Round, target?: string) {
    const payload = { question: this.publicQuestion(r), remainingMs: Math.max(0, r.deadline - Date.now()) };
    if (target) this.emitPlayer(target, 'question', payload);
    else this.emitAll('question', payload);
  }

  answer(playerId: string, questionId: string, payload: unknown, now = Date.now()): { accepted: boolean; reason?: string } {
    const r = this.round;
    const p = this.players.get(playerId);
    if (!p) return { accepted: false, reason: 'Nejste ve hře.' };
    if (this.phase !== 'question' || !r || r.closed || r.q.id !== questionId) return { accepted: false, reason: 'Na tuto otázku už nelze odpovědět.' };
    if (this.paused) return { accepted: false, reason: 'Hra je pozastavena.' };
    if (now > r.deadline + LATENCY_GRACE_MS) return { accepted: false, reason: 'Čas vypršel.' };
    if (r.answers.has(playerId)) return { accepted: false, reason: 'Odpověď už byla odeslána.' };

    const { original, displayed } = this.mapPayload(r, payload);
    const check = checkAnswer(r.q, original, { partialMulti: this.settings.partialMulti, ignoreDiacritics: this.settings.ignoreDiacritics });
    const elapsedMs = Math.max(0, now - r.startedAt);
    const streak = check.correct ? p.streak + 1 : 0;
    const score = computePoints({
      fraction: check.fraction,
      elapsedMs,
      timeLimitSec: r.q.timeLimitSec,
      pointsMode: r.q.points,
      streak,
      streakBonus: this.settings.streakBonus,
    });
    r.answers.set(playerId, { correct: check.correct, points: score.total, displayed, prevStreak: p.streak });
    p.score += score.total;
    p.streak = streak;
    this.deps.repo.addAnswer({ gameId: this.id, playerId, questionId, payload: original, correct: check.correct, points: score.total, elapsedMs });
    this.emitHosts('answer_count', { answered: r.answers.size, playerCount: this.players.size });
    this.maybeCloseEarly();
    return { accepted: true };
  }

  private mapPayload(r: Round, payload: unknown) {
    return mapDisplayedPayload(r.q.type, r.shuffled.perm, payload);
  }

  private connectedPlayers(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.sockets > 0) n++;
    return n;
  }

  private maybeCloseEarly() {
    const r = this.round;
    if (this.phase !== 'question' || !r || r.closed || this.paused) return;
    const connected = this.connectedPlayers();
    if (connected > 0 && [...this.players.values()].filter((p) => p.sockets > 0).every((p) => r.answers.has(p.id))) this.closeRound();
  }

  private closeRound() {
    const r = this.round;
    if (!r || r.closed) return;
    clearTimeout(r.timer);
    r.closed = true;
    this.phase = 'reveal';
    const distribution = r.shuffled.options.map(() => 0);
    let correct = 0;
    for (const a of r.answers.values()) {
      if (a.correct) correct++;
      a.displayed?.forEach((d) => {
        if (d >= 0 && d < distribution.length) distribution[d]!++;
      });
    }
    const base: RevealEvent = {
      questionId: r.q.id,
      correctDisplayed: r.q.type === 'order' ? [] : r.shuffled.correctDisplayed,
      correctText: correctText(r.q),
      explanation: r.q.explanation,
      stats: { answered: r.answers.size, correct, playerCount: this.players.size, distribution },
    };
    this.lastReveal = base;
    // players who did not answer lose their streak
    for (const p of this.players.values()) {
      const a = r.answers.get(p.id);
      if (!a) p.streak = 0;
    }
    this.emitHosts('reveal', base);
    for (const p of this.players.values()) {
      const a = r.answers.get(p.id);
      p.lastResult = { correct: a?.correct ?? false, answered: !!a, points: a?.points ?? 0, score: p.score, rank: this.rankOf(p), streak: p.streak };
      this.emitPlayer(p.id, 'reveal', { ...base, you: p.lastResult });
    }
    this.broadcastHostState();
  }

  private leaderboardEvent(): LeaderboardEvent {
    return { top: this.ranking().slice(0, 5) };
  }

  private showLeaderboard() {
    this.phase = 'leaderboard';
    const lb = this.leaderboardEvent();
    this.emitHosts('leaderboard', lb);
    for (const p of this.players.values()) this.emitPlayer(p.id, 'leaderboard', { ...lb, you: { rank: this.rankOf(p), score: p.score } });
    this.broadcastHostState();
  }

  // ---------- players ----------

  canJoin(): string | null {
    if (this.finished) return 'Hra už skončila.';
    if (this.locked) return 'Hra je uzamčená, připojit se už nelze.';
    if (this.phase !== 'lobby' && !this.settings.allowLateJoin) return 'Hra už začala.';
    if (this.players.size >= MAX_PLAYERS) return 'Hra je plná.';
    return null;
  }

  join(rawNickname: unknown): { player: LivePlayer; token: string } {
    const blocked = this.canJoin();
    if (blocked) throw new GameError(blocked);
    const nick = checkNickname(rawNickname);
    if (!nick.ok) throw new GameError(nick.error);
    const key = nick.nickname.toLocaleLowerCase('cs');
    for (const p of this.players.values()) if (p.nickname.toLocaleLowerCase('cs') === key) throw new GameError('Tuto přezdívku už někdo ve hře má. Zvolte jinou.');
    const token = randomBytes(24).toString('base64url');
    const tokenHash = sha256(token);
    const id = this.deps.repo.addPlayer(this.id, nick.nickname, tokenHash);
    const player: LivePlayer = { id, nickname: nick.nickname, tokenHash, score: 0, streak: 0, sockets: 0 };
    this.players.set(id, player);
    this.emitAll('lobby_update', this.lobby());
    this.broadcastHostState();
    return { player, token };
  }

  findPlayerByTokenHash(hash: string): LivePlayer | undefined {
    for (const p of this.players.values()) if (p.tokenHash === hash) return p;
    return undefined;
  }

  playerAttached(playerId: string) {
    const p = this.players.get(playerId);
    if (p) p.sockets++;
  }

  playerDetached(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.sockets = Math.max(0, p.sockets - 1);
    this.maybeCloseEarly();
  }

  /** Send the current state to a (re)connected player. */
  syncPlayer(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) return;
    this.emitPlayer(playerId, 'lobby_update', this.lobby());
    if (this.paused) this.emitPlayer(playerId, 'paused', { paused: true, reason: 'Učitel se odpojil. Hra pokračuje, jakmile se znovu připojí.' });
    const r = this.round;
    switch (this.phase) {
      case 'question':
        if (r && !r.answers.has(playerId)) this.emitQuestion(r, playerId);
        else if (r) this.emitPlayer(playerId, 'answer_count', { answered: r.answers.size, playerCount: this.players.size });
        break;
      case 'reveal':
        if (this.lastReveal) this.emitPlayer(playerId, 'reveal', { ...this.lastReveal, you: p.lastResult ?? { correct: false, answered: false, points: 0, score: p.score, rank: this.rankOf(p), streak: p.streak } });
        break;
      case 'leaderboard':
        this.emitPlayer(playerId, 'leaderboard', { ...this.leaderboardEvent(), you: { rank: this.rankOf(p), score: p.score } });
        break;
      case 'finished': {
        const ranking = this.ranking();
        this.emitPlayer(playerId, 'game_over', { podium: ranking.slice(0, 3), ranking: ranking.slice(0, 10), you: { rank: this.rankOf(p), score: p.score } });
        break;
      }
    }
  }

  /** Send the current state to a (re)connected host. */
  syncHost(socketRoom: string) {
    const io = this.deps.io.to(socketRoom);
    io.emit('host_state', this.hostState());
    io.emit('lobby_update', this.lobby());
    const r = this.round;
    if (this.phase === 'question' && r) {
      io.emit('question', { question: this.publicQuestion(r), remainingMs: Math.max(0, r.deadline - Date.now()) });
      io.emit('answer_count', { answered: r.answers.size, playerCount: this.players.size });
    } else if (this.phase === 'reveal' && this.lastReveal) {
      if (r) io.emit('question', { question: this.publicQuestion(r), remainingMs: 0 });
      io.emit('reveal', this.lastReveal);
    } else if (this.phase === 'leaderboard') io.emit('leaderboard', this.leaderboardEvent());
    else if (this.phase === 'finished') {
      const ranking = this.ranking();
      io.emit('game_over', { podium: ranking.slice(0, 3), ranking });
    }
  }

  dispose() {
    clearTimeout(this.round?.timer);
    clearTimeout(this.hostTimer);
  }
}

export class GameManager {
  private readonly games = new Map<string, LiveGame>();
  private readonly byPin = new Map<string, string>();

  constructor(
    private readonly deps: Omit<GameDeps, 'onFinished'> & { pinLength: number; onFinished?: (g: LiveGame) => void },
  ) {}

  /** Unique among live games and (via `isTaken`) open tests. */
  allocatePin(isTaken: (pin: string) => boolean = () => false): string {
    for (let i = 0; i < 1000; i++) {
      const pin = randomPin(this.deps.pinLength);
      if (!this.byPin.has(pin) && !isTaken(pin)) return pin;
    }
    throw new Error('Nepodařilo se přidělit PIN.');
  }

  create(row: GameRow, title: string, questions: StoredQuestion[]): LiveGame {
    const game = new LiveGame(row, title, questions, {
      ...this.deps,
      onFinished: (g) => {
        this.byPin.delete(g.pin);
        setTimeout(() => this.remove(g.id), FINISHED_RETENTION_MS).unref?.();
        this.deps.onFinished?.(g);
      },
    });
    this.games.set(row.id, game);
    this.byPin.set(row.pin, row.id);
    return game;
  }

  get(id: string) {
    return this.games.get(id);
  }

  getByPin(pin: string) {
    const id = this.byPin.get(pin);
    return id ? this.games.get(id) : undefined;
  }

  findByPlayerToken(token: string): { game: LiveGame; playerId: string } | undefined {
    const hash = sha256(token);
    for (const g of this.games.values()) {
      const p = g.findPlayerByTokenHash(hash);
      if (p) return { game: g, playerId: p.id };
    }
    return undefined;
  }

  remove(id: string) {
    const g = this.games.get(id);
    if (!g) return;
    g.dispose();
    this.games.delete(id);
    if (this.byPin.get(g.pin) === id) this.byPin.delete(g.pin);
  }

  activeCount() {
    return this.byPin.size;
  }

  shutdown() {
    for (const g of this.games.values()) g.dispose();
    this.games.clear();
    this.byPin.clear();
  }
}
