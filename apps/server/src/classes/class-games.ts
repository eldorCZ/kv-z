import type { CreateGameInput } from '@kvizhub/core';
import { randomBytes } from 'node:crypto';
import type { GameManager } from '../game/engine.js';
import { HttpError } from '../game/service.js';
import type { GameRepo, GameRow } from '../repo/games.js';
import type { StoredQuestion, StoredQuiz } from '../repo/quizzes.js';
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
export class ClassGames {
  private tickets = new Map<string, { gameId: string; studentId: string; publicName: string; exp: number }>();
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
  identify(pin: string, rawCode: unknown): { publicName: string; ticket: string } {
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
    this.tickets.set(ticket, { gameId: g.id, studentId: student.id, publicName: student.publicName, exp: now + TICKET_TTL_MS });
    return { publicName: student.publicName, ticket };
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

  /** Nickname guests are allowed only with allowGuests and may not use a student's public name. */
  assertGuestAllowed(g: GameRow, nickname: string) {
    if (!g.classId) return;
    if (!g.allowGuests) throw new HttpError(403, 'Do této hry se připojuje osobním kódem. Požádej učitele o nový kód.', 'guests_disabled');
    const taken = this.classes.students(g.classId).some((s) => s.publicName.toLocaleLowerCase('cs') === nickname.toLocaleLowerCase('cs'));
    if (taken) throw new HttpError(409, 'Tuto přezdívku nelze použít. Zvolte jinou.', 'nickname_taken');
  }

  /** studentId -> "Příjmení Jméno" (only for a logged-in teacher with owner/editor role, C6.2). */
  fullNames(classId: string): Map<string, string> {
    return new Map(this.classes.students(classId).map((s) => [s.id, `${s.familyName} ${s.givenName}`.trim()]));
  }

  /** Audience students who have not joined yet (C6.2) – public names only. */
  notJoined(g: GameRow, joinedStudentIds: Set<string>) {
    if (!g.classId) return [];
    const eligible = this.classes.students(g.classId).filter((s) => s.active && (!g.audience || g.audience.includes(s.id)));
    return eligible.filter((s) => !joinedStudentIds.has(s.id)).map((s) => ({ studentId: s.id, publicName: s.publicName }));
  }
}
