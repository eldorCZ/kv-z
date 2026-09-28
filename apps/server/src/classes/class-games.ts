import { createGameSchema, studentNumberLabel, type CreateGameInput } from '@kvizhub/core';
import { randomBytes } from 'node:crypto';
import type { GameManager } from '../game/engine.js';
import { HttpError } from '../game/service.js';
import type { GameRepo, GameRow } from '../repo/games.js';
import type { QuizRepo, StoredQuestion, StoredQuiz } from '../repo/quizzes.js';
import type { Config } from '../config.js';
import type { TestService } from '../test-mode/service.js';
import type { EvidenceService } from './evidence.js';
import type { ClassService, StudentRow } from './service.js';

const TICKET_TTL_MS = 2 * 60_000;
const THROTTLE_WINDOW_MS = 5 * 60_000;
const THROTTLE_LIMIT = 20;
const THROTTLE_BLOCK_MS = 60_000;

export const WRONG_CODE_MSG = 'Tento kód nepatří žádnému žákovi v této hře. Zkontroluj ho, nebo požádej učitele.';
export const NOT_IN_AUDIENCE_MSG = 'Tento test je určen jen vybraným žákům.';
export const ALREADY_JOINED_MSG = 'Tento žák už je ve hře připojen. Požádej učitele o obnovení.';

export interface ClassGameInfo {
  classId: string;
  className: string;
  allowGuests: boolean;
  audience: string[] | null;
  label: string;
  countInStats: boolean;
  rosterSize: number;
}

/**
 * Class games (Dodatek 3, C5, C6): preparation, identification by personal code with a one-time ticket,
 * guessing protection. Codes are only ever read from request bodies and never logged.
 */
export type PlayerNaming = (p: { studentId: string | null; nickname: string }, index: number) => string;

export class ClassGames {
  private tickets = new Map<string, { gameId: string; studentId: string; exp: number }>();
  private failures = new Map<string, { at: number[]; blockedUntil: number; alert: boolean }>();

  constructor(
    private readonly classes: ClassService,
    private readonly evidence: EvidenceService,
    private readonly games: GameRepo,
    private readonly live: GameManager,
    private readonly tests: () => TestService,
    private readonly now: () => number,
  ) {}

  /** Validates the class of a new game (C6.1). Returns null for a game without a class. */
  prepare(teacherId: string, input: CreateGameInput): ClassGameInfo | null {
    const s = input.settings;
    if (!s.classId) return null;
    const cls = this.classes.assertClassAccess(teacherId, s.classId, 'editor');
    if (cls.status !== 'active') throw new HttpError(409, 'Třída je archivovaná, nelze v ní spustit hru.', 'archived');
    const active = this.classes.students(cls.id).filter((x) => x.active);
    let audience: string[] | null = null;
    if (s.audience) {
      const ids = new Set(active.map((x) => x.id));
      audience = [...new Set(s.audience)].filter((id) => ids.has(id));
      if (audience.length === 0) throw new HttpError(422, 'Vyberte alespoň jednoho aktivního žáka třídy.', 'empty_audience');
    }
    return {
      classId: cls.id,
      className: cls.name,
      allowGuests: s.allowGuests,
      audience,
      label: s.label ?? '',
      countInStats: s.countInStats,
      rosterSize: audience ? audience.length : active.length,
    };
  }

  /** Stores class columns, the question snapshot and creates the activity record. */
  attach(row: GameRow, info: ClassGameInfo, quiz: StoredQuiz, questions: StoredQuestion[], kind: 'quiz' | 'test', playedAt: number, rootActivityId: string | null = null) {
    const activityId = this.evidence.createActivity({
      classId: info.classId,
      gameId: row.id,
      kind,
      label: (info.label || quiz.title).slice(0, 60),
      quizId: quiz.id,
      quizTitle: quiz.title,
      playedAt,
      countInStats: info.countInStats,
      rootActivityId,
      rosterSize: info.rosterSize,
    });
    this.games.setClassInfo(row.id, { classId: info.classId, activityId, allowGuests: info.allowGuests, audience: info.audience, snapshot: questions });
    return activityId;
  }

  // ---------------------------------------------------------------- students

  /** Game behind a PIN (live or open test) – only class information, never names or counts. */
  gameByPin(pin: string): GameRow | undefined {
    const live = this.live.getByPin(pin);
    if (live) return this.games.get(live.id);
    return this.tests().lookup(pin)?.g;
  }

  lookup(pin: string) {
    const g = this.gameByPin(pin);
    if (!g) return undefined;
    return { mode: g.mode === 'test' ? 'test' : 'live', identity: g.classId ? 'roster' : 'nickname', allowGuests: !!g.classId && g.allowGuests };
  }

  private throttle(gameId: string) {
    let f = this.failures.get(gameId);
    if (!f) this.failures.set(gameId, (f = { at: [], blockedUntil: 0, alert: false }));
    return f;
  }

  /** Teacher warning "Opakované chybné kódy" (C5.4). */
  codeAlert(gameId: string) {
    return this.failures.get(gameId)?.alert ?? false;
  }

  /** POST /play/roster/identify (C5.1 step 3). */
  identify(pin: string, rawCode: unknown): { accountName: string; ticket: string } {
    const g = this.gameByPin(pin);
    if (!g) throw new HttpError(404, 'Hra s tímto PINem neexistuje. Zkontrolujte PIN.', 'not_found');
    if (!g.classId) throw new HttpError(409, 'Do této hry se připojuje přezdívkou, ne kódem.', 'not_roster');
    const now = this.now();
    const f = this.throttle(g.id);
    if (f.blockedUntil > now) {
      throw new HttpError(429, `Příliš mnoho chybných kódů. Zkus to znovu za ${Math.ceil((f.blockedUntil - now) / 1000)} s.`, 'code_throttled');
    }
    const student = this.classes.findByCode(g.classId, rawCode);
    if (!student) {
      f.at = f.at.filter((t) => t > now - THROTTLE_WINDOW_MS);
      f.at.push(now);
      if (f.at.length >= THROTTLE_LIMIT) {
        f.blockedUntil = now + THROTTLE_BLOCK_MS;
        f.alert = true;
        f.at = [];
      }
      throw new HttpError(404, WRONG_CODE_MSG, 'wrong_code');
    }
    if (g.audience && !g.audience.includes(student.id)) throw new HttpError(403, NOT_IN_AUDIENCE_MSG, 'not_in_audience');
    const ticket = randomBytes(24).toString('base64url');
    this.sweep(now);
    this.tickets.set(ticket, { gameId: g.id, studentId: student.id, exp: now + TICKET_TTL_MS });
    // whitelist (C11): the student's own account name for "Jsi to ty, novak12?" and the ticket, nothing else
    return { accountName: student.accountName, ticket };
  }

  /** One-time ticket bound to game and student (C5.1 step 4). */
  consumeTicket(ticket: unknown, gameId: string): { student: StudentRow } {
    const t = typeof ticket === 'string' ? this.tickets.get(ticket) : undefined;
    if (t) this.tickets.delete(ticket as string);
    if (!t || t.gameId !== gameId || t.exp < this.now()) throw new HttpError(401, 'Přihlášení vypršelo. Zadej svůj kód znovu.', 'ticket_invalid');
    const g = this.games.get(gameId)!;
    const student = this.classes.students(g.classId!).find((s) => s.id === t.studentId && s.active);
    if (!student) throw new HttpError(404, WRONG_CODE_MSG, 'wrong_code');
    return { student };
  }

  private sweep(now: number) {
    for (const [k, v] of this.tickets) if (v.exp < now) this.tickets.delete(k);
  }

  /**
   * Name of a student in a class game (C5.6, C6.2): the account name; in a live game with
   * leaderboardNames = "number" "Žák <číslo>" (classmates and the projector see it).
   */
  displayName(g: GameRow, student: StudentRow): string {
    if (g.mode === 'test' || this.classes.settingsOf(g.classId!).leaderboardNames !== 'number') return student.accountName;
    const list = this.classes.students(g.classId!);
    return studentNumberLabel(student.rosterNo, list.findIndex((s) => s.id === student.id));
  }

  /** Nickname guests are allowed only with allowGuests and may not use a student's name. */
  assertGuestAllowed(g: GameRow, nickname: string) {
    if (!g.classId) return;
    if (!g.allowGuests) throw new HttpError(403, 'Do této hry se připojuje osobním kódem. Požádej učitele o nový kód.', 'guests_disabled');
    const n = nickname.toLocaleLowerCase('cs');
    const taken = this.classes.students(g.classId).some((s) => s.accountName === n || this.displayName(g, s).toLocaleLowerCase('cs') === n);
    if (taken) throw new HttpError(409, 'Tuto přezdívku nelze použít. Zvolte jinou.', 'nickname_taken');
  }

  /**
   * Names in game results of a class game (C10.3): "Žák N" for API tokens without results:pii,
   * otherwise the account name (guests keep their nickname).
   */
  naming(g: GameRow, pii: boolean): PlayerNaming | undefined {
    if (!g.classId) return undefined;
    if (!pii) return (_p, i) => `Žák ${i + 1}`;
    const names = this.accountNames(g.classId);
    return (p) => (p.studentId && names.get(p.studentId)) || (p.studentId ? p.nickname : `${p.nickname} (host)`);
  }

  /**
   * Čísla v třídním výkazu podle id žáka. Učitel podle nich zapisuje známky,
   * takže je posíláme k výsledkům; u hry bez třídy je mapa prázdná.
   */
  rosterNumbers(g: GameRow): Map<string, number | null> {
    if (!g.classId) return new Map();
    return new Map(this.classes.students(g.classId).map((s) => [s.id, s.rosterNo ?? null]));
  }

  accountNames(classId: string): Map<string, string> {
    return new Map(this.classes.students(classId).map((s) => [s.id, s.accountName]));
  }

  /** Audience students who have not joined yet (C6.2), named as in the game. */
  notJoined(g: GameRow, joinedStudentIds: Set<string>) {
    if (!g.classId) return [];
    const eligible = this.classes.students(g.classId).filter((s) => s.active && (!g.audience || g.audience.includes(s.id)));
    return eligible.filter((s) => !joinedStudentIds.has(s.id)).map((s) => ({ studentId: s.id, name: this.displayName(g, s) }));
  }
}

export interface MakeupResult {
  gameId: string;
  pin: string;
  joinUrl: string;
  hostUrl: string;
  resultsUrl: string;
  audienceSize: number;
  reused: boolean;
}

/** Guests and makeup tests (C6.3, C6.4) – kept apart from the join flow above. */
export class ClassGameAdmin {
  constructor(
    private readonly cg: ClassGames,
    private readonly classes: ClassService,
    private readonly evidence: EvidenceService,
    private readonly games: GameRepo,
    private readonly quizzes: QuizRepo,
    private readonly tests: () => TestService,
    private readonly cfg: Config,
    private readonly now: () => number,
  ) {}

  /** Guests of a class game and the students who can still get a result in its activity. */
  guests(g: GameRow) {
    if (!g.classId || !g.activityId) return { guests: [], candidates: [] };
    const players = this.games.players(g.id).filter((p) => p.isGuest === 1);
    const withResult = new Set(this.evidence.resultStudentIds(g.activityId));
    const candidates = this.classes
      .students(g.classId)
      .filter((s) => s.active && !withResult.has(s.id) && !this.games.players(g.id).some((p) => p.studentId === s.id))
      .map((s) => ({ studentId: s.id, accountName: s.accountName, rosterNo: s.rosterNo }));
    return { guests: players.map((p) => ({ playerId: p.id, nickname: p.nickname })), candidates };
  }

  /** Assign a guest to a student (C6.3): the result is written into the records. */
  assignGuest(g: GameRow, playerId: string, studentId: string) {
    const { guests, candidates } = this.guests(g);
    if (!guests.some((x) => x.playerId === playerId)) throw new HttpError(404, 'Host nenalezen.', 'not_found');
    if (!candidates.some((c) => c.studentId === studentId)) throw new HttpError(409, 'Tento žák už v aktivitě výsledek má nebo není aktivní.', 'conflict');
    this.evidence.db.prepare('UPDATE players SET student_id = ?, is_guest = 0 WHERE id = ?').run(studentId, playerId);
    this.evidence.materializeGame(g.id);
  }

  /**
   * Makeup test for students who missed the original (C6.4): same questions (snapshot), same settings,
   * audience = eligible active students without a result in the original or its makeups. Idempotent.
   */
  makeup(teacherId: string, classId: string, activityId: string): MakeupResult {
    const cls = this.classes.assertClassAccess(teacherId, classId, 'editor');
    if (cls.status !== 'active') throw new HttpError(409, 'Třída je archivovaná.', 'archived');
    const act = this.evidence.activity(activityId);
    if (!act || act.classId !== classId) throw new HttpError(404, 'Aktivita nenalezena.', 'not_found');
    const rootId = act.rootActivityId ?? act.id;
    const root = this.evidence.activity(rootId)!;
    if (root.kind !== 'test') throw new HttpError(409, 'Náhradní termín lze vytvořit jen pro test.', 'not_a_test');
    const missing = this.evidence.missingStudents(root, this.classes.students(classId));
    const chain = this.evidence.chain(rootId);
    // reuse a running makeup with the same audience (idempotent)
    for (const a of chain) {
      if (!a.rootActivityId || !a.gameId) continue;
      const g = this.games.get(a.gameId);
      if (g && g.status === 'running' && g.audience && [...g.audience].sort().join() === missing.map((s) => s.id).sort().join()) {
        return this.makeupResult(g, missing.length, true);
      }
    }
    if (missing.length === 0) throw new HttpError(409, 'Nikdo z třídy v tomto testu nechybí.', 'nobody_missing');
    const source = chain.map((a) => (a.gameId ? this.games.get(a.gameId) : undefined)).find((g): g is GameRow => !!g && !!g.snapshot);
    if (!source) throw new HttpError(409, 'Původní test už není k dispozici (byl smazán podle doby uchování).', 'source_missing');
    const quiz = this.quizzes.get(source.quizId);
    if (!quiz) throw new HttpError(409, 'Kvíz původního testu byl smazán.', 'quiz_missing');
    const test = { ...((source.settings as { test?: Record<string, unknown> }).test ?? {}), opensAt: null, closesAt: new Date(this.now() + 7 * 86_400_000).toISOString() };
    const input = createGameSchema.parse({
      mode: 'test',
      settings: {
        shuffleQuestions: source.settings.shuffleQuestions,
        shuffleOptions: source.settings.shuffleOptions,
        partialMulti: source.settings.partialMulti,
        ignoreDiacritics: source.settings.ignoreDiacritics,
        test,
      },
    });
    const info: ClassGameInfo = {
      classId,
      className: cls.name,
      allowGuests: false,
      audience: missing.map((s) => s.id),
      label: root.label,
      countInStats: root.countInStats,
      rosterSize: missing.length,
    };
    const created = this.tests().create(quiz, input, info, rootId, source.snapshot as StoredQuestion[]);
    return this.makeupResult(this.games.get(created.gameId)!, missing.length, false);
  }

  private makeupResult(g: GameRow, audienceSize: number, reused: boolean): MakeupResult {
    const base = this.cfg.publicUrl;
    return { gameId: g.id, pin: g.pin, joinUrl: `${base}/play`, hostUrl: `${base}/tests/${g.id}`, resultsUrl: `${base}/games/${g.id}`, audienceSize, reused };
  }
}
