import {
  checkAnswer,
  checkNickname,
  checkStudentName,
  correctText,
  gameSettingsSchema,
  mapDisplayedPayload,
  permutation,
  pointsWeight,
  scoreTest,
  shuffleOptions,
  testSettingsSchema,
  toDisplayedPayload,
  toPublicQuestion,
  type CreateGameInput,
  type TestSettings,
} from '@kvizhub/core';
import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { HttpError, playableQuestions } from '../game/service.js';
import type { GameManager } from '../game/engine.js';
import type { Attempt, AttemptRepo } from '../repo/attempts.js';
import type { GameRepo, GameRow } from '../repo/games.js';
import type { QuizRepo, StoredQuestion, StoredQuiz } from '../repo/quizzes.js';
import { newId, sha256 } from '../util.js';
import { guardOf, type ClientEvent, type LeaveGuardService } from './leave-guard.js';
import { ALREADY_JOINED_MSG, type ClassGameInfo, type ClassGames } from '../classes/class-games.js';

/** Answers are accepted this long after the deadline (network latency). */
export const DEADLINE_GRACE_MS = 5000;
const DAY = 86_400_000;

export interface StudentCtx {
  attempt: Attempt;
  nickname: string;
  game: GameRow;
  test: TestSettings;
}

function testOf(g: GameRow): TestSettings {
  return (g.settings as { test?: TestSettings }).test ?? testSettingsSchema.parse({});
}

const nameKey = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('cs');

export class TestService {
  constructor(
    private readonly cfg: Config,
    private readonly games: GameRepo,
    private readonly attempts: AttemptRepo,
    private readonly quizzes: QuizRepo,
    private readonly manager: GameManager,
    private readonly log: FastifyBaseLogger,
    readonly now: () => number,
    readonly guard: LeaveGuardService,
  ) {}

  classGames?: ClassGames;
  /** called after an attempt was finalized (class records, C7.1) */
  onFinalize?: (g: GameRow) => void;

  isOpenPin(pin: string) {
    return !!this.attempts.openTestByPin(pin);
  }

  // ------------------------------------------------------------------ teacher

  create(quiz: StoredQuiz, input: CreateGameInput, classInfo: ClassGameInfo | null = null, rootActivityId: string | null = null, snapshot: StoredQuestion[] | null = null) {
    const playable = snapshot ?? playableQuestions(quiz);
    if (playable.length === 0) {
      throw new HttpError(409, 'Kvíz nemá žádnou hratelnou otázku: všechny otázky čekají na kontrolu (flagged). Učitel je musí nejdřív schválit v aplikaci.', 'no_playable_questions');
    }
    const now = this.now();
    const test = { ...(input.settings.test ?? testSettingsSchema.parse({})) };
    const t = test;
    if (!test.closesAt) test.closesAt = new Date(now + 7 * DAY).toISOString();
    if (Date.parse(test.closesAt) <= now) {
      throw new HttpError(422, 'Termín uzavření testu musí být v budoucnosti.', 'invalid_closes_at');
    }
    const settings = {
      ...gameSettingsSchema.parse(input.settings),
      shuffleQuestions: input.settings.shuffleQuestions ?? quiz.settings.shuffleQuestions,
      shuffleOptions: input.settings.shuffleOptions ?? quiz.settings.shuffleOptions,
      test,
    };
    const pin = this.manager.allocatePin((p) => this.isOpenPin(p));
    const row = this.games.create({
      id: newId(),
      quizId: quiz.id,
      teacherId: quiz.teacherId,
      mode: 'test',
      pin,
      // tests are controlled from the teacher's dashboard (session), no host link
      hostKeyHash: sha256(randomBytes(32).toString('base64url')),
      settings,
      questionIds: playable.map((q) => q.id),
      endsAt: Date.parse(test.closesAt),
    });
    this.games.setStatus(row.id, 'running');
    if (classInfo && this.classGames) {
      this.classGames.attach(row, classInfo, quiz, playable, 'test', t.opensAt ? Date.parse(t.opensAt) : now, rootActivityId);
    }
    return {
      gameId: row.id,
      mode: 'test' as const,
      pin,
      joinUrl: `${this.cfg.publicUrl}/play`,
      qrUrl: `${this.cfg.publicUrl}/play?pin=${pin}`,
      dashboardUrl: `${this.cfg.publicUrl}/tests/${row.id}`,
      questionCount: playable.length,
      skippedFlagged: quiz.questions.length - playable.length,
      closesAt: test.closesAt,
    };
  }

  /** Questions of the game (current quiz content), in the given id order; deleted questions are skipped. */
  private questionsFor(g: GameRow, ids: string[]): StoredQuestion[] {
    if (g.snapshot) {
      // class games play the questions as they were when the game was created (C3)
      const snap = new Map((g.snapshot as StoredQuestion[]).map((q) => [q.id, q]));
      return ids.map((id) => snap.get(id)).filter((q): q is StoredQuestion => !!q);
    }
    const quiz = this.quizzes.get(g.quizId);
    const byId = new Map(quiz?.questions.map((q) => [q.id, q]));
    return ids.map((id) => byId.get(id)).filter((q): q is StoredQuestion => !!q && q.qa.status !== 'flagged');
  }

  private grade(g: GameRow, a: Attempt) {
    const qs = this.questionsFor(g, a.questionIds);
    return scoreTest(qs, this.attempts.answers(a.playerId), { partialMulti: g.settings.partialMulti, ignoreDiacritics: g.settings.ignoreDiacritics });
  }

  /** Finish an attempt: grade it and store the result. */
  finalize(g: GameRow, a: Attempt, status: 'submitted' | 'expired', at: number) {
    const r = this.grade(g, a);
    this.attempts.update(a.id, { status, submittedAt: at, percent: r.percent, score: r.score, maxScore: r.maxScore });
    if (g.classId) this.onFinalize?.(g);
    return r;
  }

  counts(g: GameRow) {
    const list = this.attempts.listForGame(g.id);
    const by = (s: string[]) => list.filter((x) => s.includes(x.attempt.status)).length;
    return {
      joined: list.length,
      notStarted: by(['not_started']),
      inProgress: by(['in_progress']),
      submitted: by(['submitted', 'expired']),
      locked: list.filter((x) => x.attempt.lockedAt !== null && x.attempt.status === 'in_progress').length,
    };
  }

  status(g: GameRow) {
    return { gameId: g.id, quizId: g.quizId, mode: 'test', status: g.status, pin: g.pin, counts: this.counts(g), closesAt: testOf(g).closesAt, createdAt: g.createdAt };
  }

  /** Dashboard rows (D8.2). `fullNames` only for a teacher session with owner/editor role (C6.2). */
  dashboard(g: GameRow, opts: { fullNames?: boolean } = {}) {
    const now = this.now();
    const quizCount = g.questionIds.length;
    const list = this.attempts.listForGame(g.id);
    const names = g.classId && opts.fullNames && this.classGames ? this.classGames.fullNames(g.classId) : null;
    const joined = new Set(list.map((x) => x.attempt.studentId).filter((x): x is string => !!x));
    return {
      ...this.status(g),
      classGame: !!g.classId,
      ...(g.classId && this.classGames ? { codeAlert: this.classGames.codeAlert(g.id), notJoined: this.classGames.notJoined(g, joined) } : {}),
      title: this.quizzes.get(g.quizId)?.title ?? '',
      settings: testOf(g),
      qrUrl: `${this.cfg.publicUrl}/play?pin=${g.pin}`,
      joinUrl: `${this.cfg.publicUrl}/play`,
      students: list.map(({ attempt: a, nickname }) => ({
        attemptId: a.id,
        student: (a.studentId && names?.get(a.studentId)) || nickname,
        guest: !!a.isGuest,
        status: a.status,
        answered: this.attempts.answers(a.playerId).size,
        total: a.questionIds.length || quizCount,
        remainingSec: a.status === 'in_progress' && a.deadlineAt ? Math.max(0, Math.ceil((a.deadlineAt - now) / 1000)) : null,
        percent: a.percent,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        allowReturn: a.allowReturn,
        ...this.guardFields(g, a),
      })),
    };
  }

  /** Leave guard columns for the teacher (G6). */
  private guardFields(g: GameRow, a: Attempt) {
    const guard = guardOf(g);
    return {
      leaveCount: a.leaveCount,
      leaveTotal: a.leaveTotal,
      awaySec: Math.round(a.awayTotalMs / 1000),
      locked: a.lockedAt !== null,
      guardExempt: a.guardExempt,
      unconfirmedGap: this.guard.hasGap(a.id),
      fullscreenSupported: a.fullscreenSupported,
      overLimit: guard.mode !== 'off' && a.leaveTotal > guard.maxLeaves,
    };
  }

  /** Teacher's detail of one attempt (D8.3). */
  detail(g: GameRow, attemptId: string) {
    const entry = this.attempts.listForGame(g.id).find((x) => x.attempt.id === attemptId);
    if (!entry) throw new HttpError(404, 'Pokus nenalezen.', 'not_found');
    const a = entry.attempt;
    const answers = this.attempts.answers(a.playerId);
    const qs = this.questionsFor(g, a.questionIds);
    return {
      attemptId: a.id,
      student: entry.nickname,
      status: a.status,
      startedAt: a.startedAt,
      deadlineAt: a.deadlineAt,
      submittedAt: a.submittedAt,
      percent: a.percent,
      events: this.guard.timeline(a),
      questions: qs.map((q, i) => {
        const payload = answers.get(q.id);
        const r = payload === undefined ? null : checkAnswer(q, payload, { partialMulti: g.settings.partialMulti, ignoreDiacritics: g.settings.ignoreDiacritics });
        return {
          number: i + 1,
          questionId: q.id,
          prompt: q.prompt,
          type: q.type,
          answer: payload === undefined ? null : renderAnswer(q, payload),
          correct: r?.correct ?? false,
          fraction: r?.fraction ?? 0,
          correctText: correctText(q),
        };
      }),
    };
  }

  reopen(g: GameRow, attemptId: string, minutes: number) {
    if (g.status !== 'running') throw new HttpError(409, 'Test je ukončený, pokus nelze znovu otevřít.', 'test_closed');
    const a = this.attempts.get(attemptId);
    if (!a || a.gameId !== g.id) throw new HttpError(404, 'Pokus nenalezen.', 'not_found');
    if (a.status !== 'submitted' && a.status !== 'expired') throw new HttpError(409, 'Znovu otevřít lze jen odevzdaný pokus.', 'not_submitted');
    const now = this.now();
    this.attempts.update(a.id, { status: 'in_progress', deadlineAt: now + minutes * 60_000, submittedAt: null, startedAt: a.startedAt ?? now });
    return this.attempts.get(a.id)!;
  }

  allowReturn(g: GameRow, attemptId: string) {
    const a = this.attempts.get(attemptId);
    if (!a || a.gameId !== g.id) throw new HttpError(404, 'Pokus nenalezen.', 'not_found');
    this.attempts.update(a.id, { allowReturn: true });
    return this.attempts.get(a.id)!;
  }

  /** D3.4: end the test, grade running attempts. */
  end(g: GameRow) {
    const now = this.now();
    for (const a of this.attempts.inProgress(g.id)) this.finalize(g, a, 'submitted', now);
    this.games.setStatus(g.id, 'finished');
  }

  /** D5.6: expire attempts after their deadline, close tests after closesAt. Runs every 5 s. */
  tick() {
    const now = this.now();
    let expired = 0;
    for (const a of this.attempts.due(now - DEADLINE_GRACE_MS)) {
      const g = this.games.get(a.gameId);
      if (!g) continue;
      this.finalize(g, a, 'expired', a.deadlineAt ?? now);
      expired++;
    }
    for (const id of this.guard.withOpenLeaves()) {
      const a = this.attempts.get(id);
      const g = a ? this.games.get(a.gameId) : undefined;
      if (a && g) this.guard.evaluateOpen(g, a, now);
    }
    for (const id of this.attempts.openTestsClosingBefore(now - DEADLINE_GRACE_MS)) {
      const g = this.games.get(id);
      if (g) this.end(g);
    }
    return expired;
  }

  /** D3.3 results. `pii` = names allowed (teacher session or results:pii scope). */
  results(g: GameRow, pii: boolean) {
    const list = this.attempts.listForGame(g.id);
    const students = list.map(({ attempt: a, nickname }, i) => ({
      student: pii ? nickname : `Žák ${i + 1}`,
      attemptId: a.id,
      percent: a.percent,
      status: a.status,
      submittedAt: a.submittedAt,
      leaveCount: a.leaveTotal,
      awaySec: Math.round(a.awayTotalMs / 1000),
      locked: a.lockedAt !== null,
    }));
    const guardSettings = guardOf(g);
    const done = list.filter((x) => x.attempt.status === 'submitted' || x.attempt.status === 'expired');
    const percents = done.map((x) => x.attempt.percent ?? 0).sort((a, b) => a - b);
    const qs = this.questionsFor(g, g.questionIds);
    const opts = { partialMulti: g.settings.partialMulti, ignoreDiacritics: g.settings.ignoreDiacritics };
    const answersByPlayer = new Map(done.map((x) => [x.attempt.playerId, this.attempts.answers(x.attempt.playerId)]));
    const perQuestion = qs.map((q, i) => {
      let sum = 0;
      let answered = 0;
      for (const ans of answersByPlayer.values()) {
        const p = ans.get(q.id);
        if (p === undefined) continue;
        answered++;
        sum += checkAnswer(q, p, opts).fraction;
      }
      return {
        questionId: q.id,
        number: i + 1,
        prompt: q.prompt,
        answered,
        successRate: done.length ? Math.round((sum / done.length) * 1000) / 1000 : 0,
      };
    });
    const median = percents.length ? (percents.length % 2 ? percents[(percents.length - 1) / 2]! : Math.round((percents[percents.length / 2 - 1]! + percents[percents.length / 2]!) / 2)) : null;
    return {
      gameId: g.id,
      quizId: g.quizId,
      mode: 'test' as const,
      status: g.status,
      summary: {
        students: list.length,
        submitted: done.length,
        avgPercent: percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null,
        medianPercent: median,
        leaveFlagged: guardSettings.mode === 'off' ? 0 : list.filter((x) => x.attempt.leaveTotal > guardSettings.maxLeaves).length,
      },
      students,
      perQuestion,
    };
  }

  resultsCsv(g: GameRow): string {
    const res = this.results(g, true);
    const cell = (v: unknown) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const statusCs: Record<string, string> = { not_started: 'nezačal', in_progress: 'rozpracováno', submitted: 'odevzdáno', expired: 'vypršel čas' };
    const header = ['Žák', 'Procenta', 'Stav', 'Odevzdáno', 'Počet opuštění okna', 'Doba mimo okno (s)', 'Zamčeno', ...res.perQuestion.flatMap((q) => [`Otázka ${q.number}`, `Otázka ${q.number} správně`])];
    const lines = [header.map(cell).join(';')];
    const sorted = [...res.students].sort((a, b) => a.student.localeCompare(b.student, 'cs'));
    for (const s of sorted) {
      const d = this.detail(g, s.attemptId);
      const byQ = new Map(d.questions.map((q) => [q.questionId, q]));
      const cols: unknown[] = [
        s.student,
        s.percent ?? '',
        statusCs[s.status] ?? s.status,
        s.submittedAt ? new Date(s.submittedAt).toISOString() : '',
        s.leaveCount,
        s.awaySec,
        s.locked ? 'ano' : 'ne',
      ];
      for (const q of res.perQuestion) {
        const a = byQ.get(q.questionId);
        cols.push(a?.answer ?? '', a?.answer === null || !a ? '' : a.correct ? 'ano' : a.fraction > 0 ? 'částečně' : 'ne');
      }
      lines.push(cols.map(cell).join(';'));
    }
    return `\ufeff${lines.join('\r\n')}\r\n`;
  }

  // ------------------------------------------------------------------ student

  /** Public information about an open test by PIN (D5.1). */
  lookup(pin: string) {
    const found = this.attempts.openTestByPin(pin);
    const g = found ? this.games.get(found.id) : undefined;
    if (!g) return undefined;
    const t = testOf(g);
    return { g, info: { mode: 'test' as const, title: this.quizzes.get(g.quizId)?.title ?? '', questionCount: g.questionIds.length, ...t } };
  }

  join(pin: string, rawName: unknown, ticket?: unknown) {
    const found = this.lookup(pin);
    if (!found) throw new HttpError(404, 'Test s tímto PINem neexistuje nebo už je uzavřený. Zkontrolujte PIN.', 'not_found');
    const { g } = found;
    const t = testOf(g);
    const now = this.now();
    if (t.opensAt && Date.parse(t.opensAt) > now) throw new HttpError(409, `Test ještě nezačal. Začíná ${new Date(t.opensAt).toLocaleString('cs-CZ')}.`, 'not_open');
    if (t.closesAt && Date.parse(t.closesAt) <= now) throw new HttpError(409, 'Termín testu už vypršel.', 'closed');
    if (g.classId && this.classGames) return this.joinClass(g, rawName, ticket);
    const name = t.requireName ? checkStudentName(rawName) : checkNickname(rawName);
    if (!name.ok) throw new HttpError(422, name.error, 'invalid_name');
    const token = randomBytes(24).toString('base64url');
    const existing = this.attempts.listForGame(g.id).find((x) => nameKey(x.nickname) === nameKey(name.nickname));
    if (existing) {
      if (!existing.attempt.allowReturn) {
        throw new HttpError(409, 'Toto jméno už je v testu použité. Pokud jsi to ty (například na jiném zařízení), požádej učitele o „Povolit návrat“.', 'name_taken');
      }
      // D5.7: the returning student takes over the attempt, the old token stops working
      this.attempts.setPlayerToken(existing.attempt.playerId, sha256(token));
      this.attempts.update(existing.attempt.id, { allowReturn: false });
      return { playerToken: token, attemptId: existing.attempt.id, name: existing.nickname, returned: true };
    }
    const qs = this.questionsFor(g, g.questionIds);
    const order = g.settings.shuffleQuestions ? permutation(qs.length).map((i) => qs[i]!) : qs;
    const perms: Record<string, number[]> = {};
    for (const q of order) perms[q.id] = shuffleOptions(q, g.settings.shuffleOptions).perm;
    const a = this.attempts.create(g.id, name.nickname, sha256(token), order.map((q) => q.id), perms, now);
    return { playerToken: token, attemptId: a.id, name: name.nickname, returned: false };
  }

  /** Class test (C5.1): a student with a one-time ticket, or a guest with a nickname when allowed (C6.3). */
  private joinClass(g: GameRow, rawName: unknown, ticket: unknown) {
    const now = this.now();
    const token = randomBytes(24).toString('base64url');
    const list = this.attempts.listForGame(g.id);
    if (ticket !== undefined && ticket !== null && ticket !== '') {
      const { student } = this.classGames!.consumeTicket(ticket, g.id);
      const existing = list.find((x) => x.attempt.studentId === student.id);
      if (existing) {
        if (!existing.attempt.allowReturn) throw new HttpError(409, ALREADY_JOINED_MSG, 'already_joined');
        this.attempts.setPlayerToken(existing.attempt.playerId, sha256(token));
        this.attempts.update(existing.attempt.id, { allowReturn: false });
        return { playerToken: token, attemptId: existing.attempt.id, name: student.publicName, returned: true };
      }
      const a = this.newAttempt(g, student.publicName, token, now, { studentId: student.id, isGuest: false });
      return { playerToken: token, attemptId: a.id, name: student.publicName, returned: false };
    }
    const nick = checkNickname(rawName);
    if (!nick.ok) throw new HttpError(422, nick.error, 'invalid_name');
    this.classGames!.assertGuestAllowed(g, nick.nickname);
    if (list.some((x) => x.nickname.toLocaleLowerCase('cs') === nick.nickname.toLocaleLowerCase('cs'))) {
      throw new HttpError(409, 'Tuto přezdívku už někdo v testu má. Zvolte jinou.', 'name_taken');
    }
    const a = this.newAttempt(g, nick.nickname, token, now, { studentId: null, isGuest: true });
    return { playerToken: token, attemptId: a.id, name: nick.nickname, returned: false };
  }

  private newAttempt(g: GameRow, nickname: string, token: string, now: number, who: { studentId: string | null; isGuest: boolean }) {
    const qs = this.questionsFor(g, g.questionIds);
    const order = g.settings.shuffleQuestions ? permutation(qs.length).map((i) => qs[i]!) : qs;
    const perms: Record<string, number[]> = {};
    for (const q of order) perms[q.id] = shuffleOptions(q, g.settings.shuffleOptions).perm;
    return this.attempts.create(g.id, nickname, sha256(token), order.map((q) => q.id), perms, now, who);
  }

  /** Resolve the student from a player token; lazily expires an attempt past its deadline. */
  resolve(token: unknown): StudentCtx {
    if (typeof token !== 'string' || !token) throw new HttpError(401, 'Chybí přihlášení do testu. Připojte se znovu PINem.', 'no_token');
    const found = this.attempts.byTokenHash(sha256(token));
    if (!found) throw new HttpError(401, 'Přihlášení do testu už neplatí. Připojte se znovu PINem, případně požádejte učitele o povolení návratu.', 'invalid_token');
    const game = this.games.get(found.attempt.gameId)!;
    let attempt = found.attempt;
    if (attempt.status === 'in_progress' && attempt.deadlineAt !== null && attempt.deadlineAt + DEADLINE_GRACE_MS <= this.now()) {
      this.finalize(game, attempt, 'expired', attempt.deadlineAt);
      attempt = this.attempts.get(attempt.id)!;
    }
    attempt = this.guard.evaluateOpen(game, attempt, this.now());
    return { attempt, nickname: found.nickname, game, test: testOf(game) };
  }

  start(ctx: StudentCtx) {
    const { attempt: a, game: g, test: t } = ctx;
    if (a.status !== 'not_started') return this.view(ctx);
    if (g.status !== 'running') throw new HttpError(409, 'Test už byl ukončen.', 'closed');
    const now = this.now();
    const closes = t.closesAt ? Date.parse(t.closesAt) : Infinity;
    const byLimit = t.timeLimitMin ? now + t.timeLimitMin * 60_000 : Infinity;
    const deadline = Math.min(closes, byLimit);
    this.attempts.update(a.id, { status: 'in_progress', startedAt: now, deadlineAt: Number.isFinite(deadline) ? deadline : null });
    return this.view({ ...ctx, attempt: this.attempts.get(a.id)! });
  }

  /** Student view of the attempt. Only whitelisted fields (D11). */
  view(ctx: StudentCtx) {
    const { attempt: a, game: g, test: t } = ctx;
    const now = this.now();
    const base = {
      status: a.status,
      name: ctx.nickname,
      title: this.quizzes.get(g.quizId)?.title ?? '',
      serverTimeMs: now,
      questionCount: a.questionIds.length,
      timeLimitMin: t.timeLimitMin,
      closesAt: t.closesAt,
      allowBackNavigation: t.allowBackNavigation,
      remainingSec: a.status === 'in_progress' && a.deadlineAt !== null ? Math.max(0, Math.ceil((a.deadlineAt - now) / 1000)) : null,
      leaveGuard: guardOf(g),
      guardExempt: a.guardExempt,
      leaveCount: a.leaveCount,
      locked: a.lockedAt !== null,
    };
    if (a.status === 'not_started') return base;
    if (a.status === 'in_progress' && a.lockedAt !== null) this.lockedError();
    if (a.status === 'in_progress') {
      const qs = this.questionsFor(g, a.questionIds);
      const stored = this.attempts.answers(a.playerId);
      const answers: Record<string, unknown> = {};
      const questions = qs.map((q, i) => {
        const perm = a.optionPerms[q.id] ?? q.options.map((_, j) => j);
        const shuffled = { perm, options: perm.map((j) => q.options[j]!), correctDisplayed: [] };
        if (stored.has(q.id)) answers[q.id] = toDisplayedPayload(perm, stored.get(q.id));
        return toPublicQuestion(q, shuffled, i, qs.length);
      });
      return { ...base, questions, answers };
    }
    return { ...base, result: this.studentResult(ctx) };
  }

  private studentResult(ctx: StudentCtx) {
    const { attempt: a, game: g, test: t } = ctx;
    if (t.showResultsToStudent === 'none') return { shown: 'none' as const };
    if (t.showResultsToStudent === 'score') return { shown: 'score' as const, percent: a.percent };
    const d = this.detail(g, a.id);
    const qs = new Map(this.questionsFor(g, a.questionIds).map((q) => [q.id, q]));
    return {
      shown: 'full' as const,
      percent: a.percent,
      questions: d.questions.map((q) => ({
        number: q.number,
        prompt: q.prompt,
        answer: q.answer,
        correct: q.correct,
        fraction: q.fraction,
        correctText: q.correctText,
        explanation: qs.get(q.questionId)?.explanation ?? '',
      })),
    };
  }

  private lockedError(): never {
    throw new HttpError(423, 'Test je zamčený, protože jsi opakovaně opustil okno. Přihlas se učiteli.', 'locked');
  }

  saveAnswer(ctx: StudentCtx, questionId: string, payload: unknown) {
    const { attempt: a, game: g } = ctx;
    if (a.status === 'in_progress' && a.lockedAt !== null) this.lockedError();
    if (a.status === 'not_started') throw new HttpError(409, 'Test ještě nezačal. Klikněte na „Začít test“.', 'not_started');
    if (a.status !== 'in_progress') throw new HttpError(409, 'Test je odevzdaný, odpovědi už nelze měnit.', 'submitted');
    const now = this.now();
    if (a.deadlineAt !== null && now > a.deadlineAt + DEADLINE_GRACE_MS) throw new HttpError(409, 'Čas na test vypršel.', 'time_up');
    if (!a.questionIds.includes(questionId)) throw new HttpError(404, 'Otázka v testu neexistuje.', 'not_found');
    const q = this.questionsFor(g, [questionId])[0];
    if (!q) throw new HttpError(404, 'Otázka v testu neexistuje.', 'not_found');
    const perm = a.optionPerms[q.id] ?? q.options.map((_, j) => j);
    const { original } = mapDisplayedPayload(q.type, perm, payload);
    const r = checkAnswer(q, original, { partialMulti: g.settings.partialMulti, ignoreDiacritics: g.settings.ignoreDiacritics });
    this.attempts.upsertAnswer(g.id, a.playerId, q.id, original, r.correct, Math.round(r.fraction * pointsWeight(q.points) * 1000), now - (a.startedAt ?? now));
    return { saved: true, remainingSec: a.deadlineAt !== null ? Math.max(0, Math.ceil((a.deadlineAt - now) / 1000)) : null };
  }

  // ------------------------------------------------------------------ leave guard (Dodatek 2)

  events(ctx: StudentCtx, events: ClientEvent[]) {
    this.guard.record(ctx.game, ctx.attempt, events, this.now());
  }

  heartbeat(ctx: StudentCtx, body: { fullscreenSupported?: unknown }) {
    const now = this.now();
    const a = ctx.attempt.status === 'in_progress' ? this.guard.heartbeat(ctx.game, ctx.attempt, body, now) : ctx.attempt;
    const guard = guardOf(ctx.game);
    return {
      status: a.status,
      locked: a.lockedAt !== null && a.status === 'in_progress',
      remainingSec: a.status === 'in_progress' && a.deadlineAt !== null ? Math.max(0, Math.ceil((a.deadlineAt - now) / 1000)) : null,
      serverTimeMs: now,
      leaveCount: a.leaveCount,
      maxLeaves: guard.maxLeaves,
      guardExempt: a.guardExempt,
    };
  }

  private attemptOf(g: GameRow, attemptId: string) {
    const a = this.attempts.get(attemptId);
    if (!a || a.gameId !== g.id) throw new HttpError(404, 'Pokus nenalezen.', 'not_found');
    return a;
  }

  unlock(g: GameRow, attemptId: string, extraMinutes: number) {
    const a = this.attemptOf(g, attemptId);
    if (a.lockedAt === null) throw new HttpError(409, 'Pokus není zamčený.', 'not_locked');
    this.guard.unlock(a, extraMinutes);
  }

  setExempt(g: GameRow, attemptId: string, exempt: boolean) {
    this.guard.setExempt(this.attemptOf(g, attemptId), exempt);
  }

  submit(ctx: StudentCtx) {
    const { attempt: a, game: g } = ctx;
    if (a.status === 'not_started') throw new HttpError(409, 'Test ještě nezačal.', 'not_started');
    if (a.status === 'in_progress' && a.lockedAt !== null) this.lockedError();
    if (a.status === 'in_progress') this.finalize(g, a, 'submitted', this.now());
    return this.view({ ...ctx, attempt: this.attempts.get(a.id)! });
  }
}

function renderAnswer(q: StoredQuestion, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (Array.isArray(p.indices)) return p.indices.map((i: number) => q.options[i] ?? '?').join(', ');
  if (Array.isArray(p.order)) return p.order.map((i: number) => q.options[i] ?? '?').join(' > ');
  if (typeof p.text === 'string') return p.text;
  if (p.value !== undefined) return String(p.value);
  return '';
}
