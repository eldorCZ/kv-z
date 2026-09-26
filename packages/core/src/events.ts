import type { QuestionType } from './schema.js';

/**
 * Question as sent to clients during play. It NEVER contains the key:
 * no correctIndices, acceptedAnswers, numericAnswer/Tolerance, explanation, sourceRef or correct order.
 */
export interface PublicQuestion {
  id: string;
  index: number;
  total: number;
  type: QuestionType;
  prompt: string;
  /** options in DISPLAYED order (shuffled when enabled) */
  options: string[];
  timeLimitSec: number;
  points: 'standard' | 'double' | 'none';
}

export type GamePhase = 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'finished';

export interface PlayerSummary {
  id: string;
  nickname: string;
  /** class games: guest without a code (visible to hosts in the lobby list) */
  guest?: boolean;
}

export interface RankEntry {
  nickname: string;
  score: number;
  rank: number;
}

export interface LobbyUpdate {
  pin: string;
  players: PlayerSummary[];
  locked: boolean;
}

export interface QuestionEvent {
  question: PublicQuestion;
  /** remaining time in ms at the moment the server emitted the event */
  remainingMs: number;
}

export interface PlayerResult {
  correct: boolean;
  answered: boolean;
  points: number;
  score: number;
  rank: number;
  streak: number;
}

export interface RevealEvent {
  questionId: string;
  /** correct options in DISPLAYED positions (single/multi/truefalse) */
  correctDisplayed: number[];
  /** human readable correct answer(s): accepted answers, number ± tolerance, or items in the correct order */
  correctText: string[];
  explanation: string;
  stats: {
    answered: number;
    correct: number;
    playerCount: number;
    /** number of picks per displayed option (choice questions only) */
    distribution: number[];
  };
  /** only in the copy sent to a specific player */
  you?: PlayerResult;
}

export interface LeaderboardEvent {
  top: RankEntry[];
  you?: { rank: number; score: number };
}

export interface GameOverEvent {
  podium: RankEntry[];
  ranking: RankEntry[];
  you?: { rank: number; score: number };
}

export interface HostState {
  phase: GamePhase;
  index: number;
  total: number;
  playerCount: number;
  answeredCount: number;
  paused: boolean;
  locked: boolean;
  /** class games (Dodatek 3): students who have not joined yet (account name or "Žák <číslo>"), only sent to hosts */
  notJoined?: { studentId: string; name: string }[];
  /** repeated wrong personal codes in this game (C5.4) */
  codeAlert?: boolean;
  classGame?: boolean;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ServerToClientEvents {
  lobby_update: (e: LobbyUpdate) => void;
  question: (e: QuestionEvent) => void;
  answer_count: (e: { answered: number; playerCount: number }) => void;
  reveal: (e: RevealEvent) => void;
  leaderboard: (e: LeaderboardEvent) => void;
  game_over: (e: GameOverEvent) => void;
  host_state: (e: HostState) => void;
  paused: (e: { paused: boolean; reason: string }) => void;
  kicked: (e: { reason: string }) => void;
  error_msg: (e: { message: string }) => void;
}

export interface JoinResult {
  token: string;
  playerId: string;
  nickname: string;
  score: number;
}

export interface ClientToServerEvents {
  // host (authorised by gameId + hostKey)
  host_attach: (e: { gameId: string; hostKey: string }, ack: Ack<{ state: HostState; lobby: LobbyUpdate; joinUrl: string; title: string }>) => void;
  start: (ack?: Ack) => void;
  next: (ack?: Ack) => void;
  reveal: (ack?: Ack) => void;
  skip: (ack?: Ack) => void;
  end: (ack?: Ack) => void;
  kick_player: (e: { playerId: string }, ack?: Ack) => void;
  lock_lobby: (e: { locked: boolean }, ack?: Ack) => void;
  /** class games: let a student take over their player from another device (C5.3) */
  allow_return: (e: { playerId: string }, ack?: Ack) => void;
  // player
  /** nickname join, or a class game join with a one-time ticket from /play/roster/identify */
  join: (e: { pin: string; nickname?: string; ticket?: string }, ack: Ack<JoinResult>) => void;
  reconnect_player: (e: { token: string }, ack: Ack<JoinResult>) => void;
  answer: (e: { questionId: string; payload: unknown }, ack?: Ack<{ accepted: boolean }>) => void;
}

/** Keys that must never appear in any payload sent to a client before reveal. */
export const SECRET_KEYS = ['correctIndices', 'acceptedAnswers', 'numericAnswer', 'numericTolerance', 'explanation', 'sourceRef'] as const;
