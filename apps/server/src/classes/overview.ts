import {
  activityStats,
  classTopics,
  countedRoots,
  eligible,
  median,
  resultFor,
  roundHalfUp,
  studentSummary,
  topicMastery,
  weakQuestions,
  type ActivityKind,
  type MActivity,
  type MItem,
  type MResult,
  type MStudent,
} from '@kvizhub/core';
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import { HttpError } from '../game/service.js';
import type { GameRepo } from '../repo/games.js';
import { dayEnd, dayStart, type ActivityRow, type EvidenceService } from './evidence.js';
import type { ClassRow, ClassService, StudentRow } from './service.js';

export interface Period {
  from: number;
  to: number;
  key: 'year' | 'h1' | 'h2' | 'custom';
}

interface ResultRow {
  id: string;
  activityId: string;
  studentId: string | null;
  percent: number;
  excluded: boolean;
  excludedReason: string | null;
  status: string;
}

const csvCell = (v: unknown, sep: string) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const TREND_CS = { rising: 'roste', falling: 'klesá', stable: 'stabilní', little_data: 'málo dat' } as const;

/** Teacher overviews of a class (Dodatek 3, C8). Pure metrics come from packages/core (C7.2). */
export class ClassOverview {
  constructor(
    private readonly cfg: Config,
    private readonly classes: ClassService,
    private readonly evidence: EvidenceService,
    private readonly games: GameRepo,
  ) {}

  private get sql(): Database.Database {
    return this.evidence.db;
  }

  period(c: ClassRow, q: { period?: string; from?: string; to?: string }): Period {
    const [y1, y2] = c.schoolYear.split('/');
    const start = Date.parse(`${y1}-09-01T00:00:00`);
    const end = dayEnd(c.schoolYearEnd);
    const split = Date.parse(`${y2}-${c.settings.halfYearSplit}T00:00:00`);
    if (q.period === 'h1') return { from: start, to: split - 1, key: 'h1' };
    if (q.period === 'h2') return { from: split, to: end, key: 'h2' };
    if (q.from || q.to) {
      const from = q.from ? dayStart(q.from) : -Infinity;
      const to = q.to ? dayEnd(q.to) : Infinity;
      if (Number.isNaN(from) || Number.isNaN(to)) throw new HttpError(400, 'Neplatné datum období.', 'invalid_period');
      return { from, to, key: 'custom' };
    }
    return { from: -Infinity, to: Infinity, key: 'year' };
  }

  /** Activities that were held (have at least one result) as metric input; empty ones are "not held yet". */
  data(classId: string) {
    const acts = this.evidence.activities(classId);
    const results = (
      this.sql
        .prepare(
          'SELECT r.id, r.activity_id AS activityId, r.student_id AS studentId, r.percent, r.excluded, r.excluded_reason AS excludedReason, r.status FROM activity_results r JOIN class_activities a ON a.id = r.activity_id WHERE a.class_id = ?',
        )
        .all(classId) as (Omit<ResultRow, 'excluded'> & { excluded: number })[]
    ).map((r) => ({ ...r, excluded: r.excluded === 1 }));
    const heldRoots = new Set(results.map((r) => acts.find((a) => a.id === r.activityId)).filter(Boolean).map((a) => a!.rootActivityId ?? a!.id));
    const mActs: MActivity[] = acts
      .filter((a) => heldRoots.has(a.rootActivityId ?? a.id))
      .map((a) => ({ id: a.id, kind: a.kind, playedAt: a.playedAt, countInStats: a.countInStats, rootId: a.rootActivityId, rosterSize: a.rosterSize }));
    const mResults: MResult[] = results.map((r) => ({ activityId: r.activityId, studentId: r.studentId, percent: r.percent, excluded: r.excluded }));
    return { acts, results, mActs, mResults };
  }

  private mStudent(s: StudentRow): MStudent {
    return { id: s.id, since: dayStart(s.since), leftAt: s.leftAt ? dayEnd(s.leftAt) : null };
  }

  items(classId: string, filter: { kind?: ActivityKind; studentId?: string; period?: Period } = {}): MItem[] {
    const rows = this.sql
      .prepare(
        `SELECT r.student_id AS studentId, a.kind AS activityKind, a.played_at AS playedAt, i.question_id AS questionId, i.prompt_snapshot AS promptSnapshot, i.topic, i.weight, i.score_milli AS scoreMilli
         FROM result_items i JOIN activity_results r ON r.id = i.activity_result_id JOIN class_activities a ON a.id = r.activity_id
         WHERE a.class_id = ? AND a.count_in_stats = 1 AND r.excluded = 0`,
      )
      .all(classId) as (MItem & { playedAt: number })[];
    return rows.filter(
      (i) =>
        (!filter.kind || i.activityKind === filter.kind) &&
        (!filter.studentId || i.studentId === filter.studentId) &&
        (!filter.period || (i.playedAt >= filter.period.from && i.playedAt <= filter.period.to)),
    );
  }

  /** C8.2 "Žáci": matrix students x activities. */
  matrix(c: ClassRow, q: { period?: string; from?: string; to?: string; kind?: string }) {
    const p = this.period(c, q);
    const kind = q.kind === 'test' || q.kind === 'quiz' ? q.kind : undefined;
    const { acts, mActs, mResults } = this.data(c.id);
    const roots = countedRoots(mActs, p.from, p.to, kind);
    const allRoots = mActs.filter((a) => a.rootId === null && a.playedAt >= p.from && a.playedAt <= p.to && (!kind || a.kind === kind)).sort((a, b) => a.playedAt - b.playedAt);
    const byId = new Map(acts.map((a) => [a.id, a]));
    const students = this.classes.students(c.id);
    const settings = c.settings;
    const rows = students.map((s) => {
      const ms = this.mStudent(s);
      const cells: Record<string, { state: 'result' | 'missing' | 'excluded' | 'na'; percent?: number; makeup?: boolean }> = {};
      for (const a of allRoots) {
        const r = resultFor(s.id, a, mActs, mResults);
        if (r) cells[a.id] = { state: r.excluded ? 'excluded' : 'result', percent: r.percent, makeup: r.makeup };
        else cells[a.id] = eligible(ms, a) ? { state: 'missing' } : { state: 'na' };
      }
      return {
        id: s.id,
        accountName: s.accountName,
        rosterNo: s.rosterNo,
        active: s.active,
        cells,
        summary: studentSummary(ms, mActs, mResults, settings, { from: p.from, to: p.to }),
      };
    });
    const tests = rows.map((r) => r.summary.testAvg).filter((x): x is number => x !== null);
    const quizzes = rows.map((r) => r.summary.quizAvg).filter((x): x is number => x !== null);
    const parts = rows.map((r) => r.summary.participation).filter((x): x is number => x !== null);
    return {
      period: { key: p.key, from: Number.isFinite(p.from) ? p.from : null, to: Number.isFinite(p.to) ? p.to : null },
      activities: allRoots.map((a) => {
        const row = byId.get(a.id)!;
        return { id: a.id, label: row.label, kind: a.kind, playedAt: a.playedAt, gameId: row.gameId, counted: roots.some((x) => x.id === a.id), stats: activityStats(a, mActs, mResults) };
      }),
      students: rows,
      classSummary: {
        testAvg: tests.length ? roundHalfUp(tests.reduce((x, y) => x + y, 0) / tests.length) : null,
        quizAvg: quizzes.length ? roundHalfUp(quizzes.reduce((x, y) => x + y, 0) / quizzes.length) : null,
        participation: parts.length ? roundHalfUp(parts.reduce((x, y) => x + y, 0) / parts.length) : null,
      },
    };
  }

  /** C8.2 "Aktivity" (includes activities without results yet). */
  activities(c: ClassRow) {
    const { acts, mResults } = this.data(c.id);
    const students = this.classes.students(c.id);
    return acts
      .filter((a) => a.rootActivityId === null)
      .sort((a, b) => b.playedAt - a.playedAt)
      .map((a) => {
        const m: MActivity = { id: a.id, kind: a.kind, playedAt: a.playedAt, countInStats: a.countInStats, rootId: null, rosterSize: a.rosterSize };
        const makeups = acts.filter((x) => x.rootActivityId === a.id);
        const game = a.gameId ? this.games.get(a.gameId) : undefined;
        return {
          id: a.id,
          label: a.label,
          kind: a.kind,
          quizTitle: a.quizTitle,
          playedAt: a.playedAt,
          countInStats: a.countInStats,
          gameId: a.gameId,
          gameStatus: game ? game.status : 'deleted',
          makeups: makeups.map((x) => ({ id: x.id, gameId: x.gameId, playedAt: x.playedAt })),
          missing: a.kind === 'test' ? this.evidence.missingStudents(a, students).length : null,
          stats: activityStats(m, [m, ...makeups.map((x) => ({ id: x.id, kind: x.kind, playedAt: x.playedAt, countInStats: x.countInStats, rootId: a.id, rosterSize: x.rosterSize }))], mResults),
        };
      });
  }

  setCountInStats(c: ClassRow, activityId: string, count: boolean) {
    const a = this.evidence.activity(activityId);
    if (!a || a.classId !== c.id || a.rootActivityId) throw new HttpError(404, 'Aktivita nenalezena.', 'not_found');
    this.sql.prepare('UPDATE class_activities SET count_in_stats = ? WHERE id = ? OR root_activity_id = ?').run(count ? 1 : 0, activityId, activityId);
  }

  /** C8.2 "Témata". */
  topics(c: ClassRow, q: { kind?: string; period?: string; from?: string; to?: string }) {
    const kind = q.kind === 'test' || q.kind === 'quiz' ? q.kind : undefined;
    const items = this.items(c.id, { kind, period: this.period(c, q) });
    return { topics: classTopics(items, this.cfg.minTopicItems), weakQuestions: weakQuestions(items, this.cfg.minTopicItems), minItems: this.cfg.minTopicItems };
  }

  /** Rename or merge a topic in the teacher's quizzes and this class's records. dry = only counts. */
  renameTopic(c: ClassRow, teacherId: string, from: string, to: string, dry: boolean) {
    const target = to.trim().slice(0, 60);
    if (!from || !target) throw new HttpError(400, 'Zadejte původní i nový název tématu.', 'invalid');
    const qs = this.sql.prepare('SELECT count(*) n FROM questions q JOIN quizzes z ON z.id = q.quiz_id WHERE z.teacher_id = ? AND q.topic = ?').get(teacherId, from) as { n: number };
    const items = this.sql
      .prepare('SELECT count(*) n FROM result_items i JOIN activity_results r ON r.id = i.activity_result_id JOIN class_activities a ON a.id = r.activity_id WHERE a.class_id = ? AND i.topic = ?')
      .get(c.id, from) as { n: number };
    if (!dry) {
      this.sql.transaction(() => {
        this.sql.prepare('UPDATE questions SET topic = ? WHERE topic = ? AND quiz_id IN (SELECT id FROM quizzes WHERE teacher_id = ?)').run(target, from, teacherId);
        this.sql
          .prepare(
            'UPDATE result_items SET topic = ? WHERE topic = ? AND activity_result_id IN (SELECT r.id FROM activity_results r JOIN class_activities a ON a.id = r.activity_id WHERE a.class_id = ?)',
          )
          .run(target, from, c.id);
      })();
    }
    return { questions: qs.n, items: items.n };
  }

  /** C8.3 student profile. */
  profile(c: ClassRow, studentId: string) {
    const s = this.classes.student(c.id, studentId);
    const ms = this.mStudent(s);
    const { acts, results, mActs, mResults } = this.data(c.id);
    const roots = countedRoots(mActs);
    const series = (kind: ActivityKind) =>
      roots
        .filter((a) => a.kind === kind)
        .map((a) => {
          const r = resultFor(s.id, a, mActs, mResults);
          const others = mResults.filter((x) => !x.excluded && (x.activityId === a.id || mActs.find((y) => y.id === x.activityId)?.rootId === a.id)).map((x) => x.percent);
          return { activityId: a.id, label: acts.find((x) => x.id === a.id)!.label, playedAt: a.playedAt, percent: r && !r.excluded ? r.percent : null, classMedian: median(others) };
        })
        .filter((x) => x.percent !== null || x.classMedian !== null);
    const items = this.items(c.id, { studentId: s.id });
    const topicNames = [...new Set(items.map((i) => i.topic).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b, 'cs'));
    const topics = topicNames.map((topic) => ({ topic, ...topicMastery(items.filter((i) => i.topic === topic), this.cfg.minTopicItems) }));
    const wrong = new Map<string, { prompt: string; count: number; topic: string | null }>();
    for (const i of items) {
      if (i.scoreMilli >= 1000) continue;
      const k = i.questionId ?? `p:${i.promptSnapshot}`;
      const w = wrong.get(k) ?? { prompt: i.promptSnapshot, count: 0, topic: i.topic };
      w.count++;
      wrong.set(k, w);
    }
    const own = results.filter((r) => r.studentId === s.id);
    return {
      class: { id: c.id, name: c.name, role: c.role, status: c.status },
      student: s,
      summary: studentSummary(ms, mActs, mResults, c.settings),
      tests: series('test'),
      quizzes: series('quiz'),
      topics,
      mistakes: [...wrong.values()].filter((w) => w.count >= 2).sort((a, b) => b.count - a.count),
      results: own
        .map((r) => {
          const a = acts.find((x) => x.id === r.activityId)!;
          return { resultId: r.id, activityId: a.id, label: a.label, kind: a.kind, playedAt: a.playedAt, gameId: a.gameId, percent: r.percent, status: r.status, excluded: r.excluded, excludedReason: r.excludedReason, makeup: !!a.rootActivityId, counted: a.countInStats };
        })
        .sort((a, b) => a.playedAt - b.playedAt),
      minItems: this.cfg.minTopicItems,
    };
  }

  setExcluded(c: ClassRow, resultId: string, excluded: boolean, reason: string | null) {
    const r = this.sql.prepare('SELECT r.id FROM activity_results r JOIN class_activities a ON a.id = r.activity_id WHERE r.id = ? AND a.class_id = ?').get(resultId, c.id);
    if (!r) throw new HttpError(404, 'Výsledek nenalezen.', 'not_found');
    this.sql.prepare('UPDATE activity_results SET excluded = ?, excluded_reason = ?, updated_at = ? WHERE id = ?').run(excluded ? 1 : 0, excluded ? (reason === 'technical' ? 'technical' : 'other') : null, Date.now(), resultId);
  }

  /** C8.5: class CSV (UTF-8 with BOM, ; or , separator, CSV injection guard). */
  classCsv(c: ClassRow, sep: ';' | ',') {
    const m = this.matrix(c, {});
    const header = ['Přihlašovací jméno', 'Číslo', ...m.activities.map((a) => `${a.label} (${new Date(a.playedAt).toLocaleDateString('cs-CZ')})`), 'Průměr testů', 'Průměr kvízů', 'Účast', 'Trend testů'];
    const lines = [header.map((h) => csvCell(h, sep)).join(sep)];
    for (const s of m.students) {
      const cells = m.activities.map((a) => {
        const x = s.cells[a.id]!;
        return x.state === 'result' ? x.percent : x.state === 'excluded' ? `nezapočteno (${x.percent})` : x.state === 'missing' ? 'chybí' : '';
      });
      lines.push(
        [s.accountName, s.rosterNo ?? '', ...cells, s.summary.testAvg ?? '', s.summary.quizAvg ?? '', s.summary.participation ?? '', TREND_CS[s.summary.testTrend.label]]
          .map((v) => csvCell(v, sep))
          .join(sep),
      );
    }
    return `\ufeff${lines.join('\r\n')}\r\n`;
  }

  studentCsv(c: ClassRow, studentId: string, sep: ';' | ',') {
    const p = this.profile(c, studentId);
    const lines = [['Datum', 'Aktivita', 'Druh', 'Procenta', 'Stav', 'Poznámka'].map((h) => csvCell(h, sep)).join(sep)];
    for (const r of p.results) {
      lines.push(
        [new Date(r.playedAt).toLocaleDateString('cs-CZ'), r.label, r.kind === 'test' ? 'test' : 'kvíz', r.percent, r.status, [r.makeup ? 'dopsáno' : '', r.excluded ? 'nezapočteno' : '', r.counted ? '' : 'mimo evidenci'].filter(Boolean).join(', ')]
          .map((v) => csvCell(v, sep))
          .join(sep),
      );
    }
    return `\ufeff${lines.join('\r\n')}\r\n`;
  }

  /**
   * C10.3 summary for the agent: aggregates only, no names, codes or individual results.
   * Groups below MIN_AGGREGATE_STUDENTS become null with the note "malá skupina".
   */
  summary(c: ClassRow, q: { from?: string; to?: string }) {
    const min = this.cfg.minAggregateStudents;
    const p = this.period(c, { from: q.from?.slice(0, 10), to: q.to?.slice(0, 10) });
    const { acts, mActs, mResults } = this.data(c.id);
    const roots = countedRoots(mActs, p.from, p.to);
    const students = this.classes.students(c.id);
    const small = students.filter((x) => x.active).length < min;
    const notes: string[] = [];
    if (small) notes.push(`malá skupina: třída má méně než ${min} aktivních žáků, souhrny se neposkytují`);
    const activities = roots.map((a) => {
      const st = activityStats(a, mActs, mResults);
      const tiny = small || st.n < min;
      return {
        activityId: a.id,
        label: acts.find((x) => x.id === a.id)!.label,
        kind: a.kind,
        playedAt: new Date(a.playedAt).toISOString(),
        n: st.n,
        participationRate: small ? null : st.participationRate,
        avgPercent: tiny ? null : st.avg,
        medianPercent: tiny ? null : st.median,
        ...(tiny && !small ? { note: 'malá skupina' } : {}),
      };
    });
    const sums = students.map((s) => studentSummary(this.mStudent(s), mActs, mResults, c.settings, { from: p.from, to: p.to }));
    const avg = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null);
      return v.length >= min ? roundHalfUp(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    const items = this.items(c.id, { period: p });
    const weakTopics = small
      ? []
      : classTopics(items, this.cfg.minTopicItems)
          .filter((t) => t.percent !== null && t.students >= min)
          .slice(0, 5)
          .map((t) => ({ topic: t.topic, successRate: t.percent!, items: t.items }));
    const quizOf = this.sql.prepare('SELECT quiz_id AS quizId FROM questions WHERE id = ?');
    const weakQs = small
      ? []
      : weakQuestions(items, Math.max(this.cfg.minTopicItems, min), 5).map((w) => ({
          quizId: w.questionId ? ((quizOf.get(w.questionId) as { quizId: string } | undefined)?.quizId ?? null) : null,
          questionId: w.questionId,
          prompt: w.prompt,
          successRate: w.successRate,
          answers: w.answers,
        }));
    return {
      classId: c.id,
      className: c.name,
      period: { from: Number.isFinite(p.from) ? new Date(p.from).toISOString() : null, to: Number.isFinite(p.to) ? new Date(p.to).toISOString() : null },
      activeStudents: students.filter((x) => x.active).length,
      activities,
      testAvg: small ? null : avg(sums.map((x) => x.testAvg)),
      quizAvg: small ? null : avg(sums.map((x) => x.quizAvg)),
      participationRate: small ? null : avg(sums.map((x) => x.participation)),
      weakTopics,
      weakQuestions: weakQs,
      notes,
    };
  }

  /** Topics used by the teacher so far (C10.3 GET /topics). */
  teacherTopics(teacherId: string): string[] {
    const rows = this.sql.prepare('SELECT DISTINCT q.topic FROM questions q JOIN quizzes z ON z.id = q.quiz_id WHERE z.teacher_id = ? AND q.topic IS NOT NULL').all(teacherId) as { topic: string }[];
    return rows.map((r) => r.topic).sort((a, b) => a.localeCompare(b, 'cs'));
  }

  /** Every activity row, for API summaries (C10.3). */
  activityRows(classId: string): ActivityRow[] {
    return this.evidence.activities(classId);
  }
}
