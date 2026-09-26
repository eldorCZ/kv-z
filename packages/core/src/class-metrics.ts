import type { CheckOptions } from './scoring.js';
import type { Question } from './schema.js';
import { pointsWeight, scoreQuestion } from './test-mode.js';

/** Round half up (also for negative values: -2.5 -> -2). */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

// ---------------------------------------------------------------- result items (C7.1)

export type ItemQuestion = Pick<Question, 'type' | 'prompt' | 'options' | 'correctIndices' | 'acceptedAnswers' | 'numericAnswer' | 'numericTolerance' | 'points'> & {
  id: string;
  topic?: string | null;
  bloom?: string | null;
  difficulty?: string | null;
};

export interface ResultItem {
  position: number;
  questionId: string | null;
  promptSnapshot: string;
  topic: string | null;
  bloom: string | null;
  difficulty: string | null;
  weight: 1 | 2;
  scoreMilli: number;
  answered: boolean;
}

export interface BuiltResult {
  items: ResultItem[];
  percent: number;
  pointsCenti: number;
  maxPointsCenti: number;
  answeredCount: number;
  questionCount: number;
}

/**
 * Items of one student's result in one activity. `questions` are the questions as played (snapshot, play order);
 * questions with points "none", excluded or skipped ones are left out. Only correctness counts (no speed bonus).
 */
export function buildResultItems(input: {
  questions: ItemQuestion[];
  answers: Map<string, unknown>;
  excluded?: Set<string>;
  opts?: CheckOptions;
}): BuiltResult {
  const items: ResultItem[] = [];
  let sum = 0;
  let wsum = 0;
  for (const q of input.questions) {
    if (q.points === 'none' || input.excluded?.has(q.id)) continue;
    const w = pointsWeight(q.points) as 1 | 2;
    const r = scoreQuestion(q, input.answers.get(q.id), input.opts);
    sum += w * r.fraction;
    wsum += w;
    items.push({
      position: items.length,
      questionId: q.id,
      promptSnapshot: q.prompt.slice(0, 300),
      topic: q.topic ?? null,
      bloom: q.bloom ?? null,
      difficulty: q.difficulty ?? null,
      weight: w,
      scoreMilli: Math.round(r.fraction * 1000),
      answered: r.answered,
    });
  }
  return {
    items,
    percent: wsum ? roundHalfUp((100 * sum) / wsum) : 0,
    pointsCenti: Math.round(sum * 100),
    maxPointsCenti: wsum * 100,
    answeredCount: items.filter((i) => i.answered).length,
    questionCount: items.length,
  };
}

// ---------------------------------------------------------------- metrics (C7.2)

export type ActivityKind = 'quiz' | 'test';

export interface MActivity {
  id: string;
  kind: ActivityKind;
  playedAt: number;
  countInStats: boolean;
  rootId: string | null;
  rosterSize: number;
}

export interface MResult {
  activityId: string;
  studentId: string | null;
  percent: number;
  excluded: boolean;
}

export interface MStudent {
  id: string;
  /** ms, start of the day the student joined the class */
  since: number;
  /** ms, end of the day the student left, or null */
  leftAt: number | null;
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export const r = (x: number | null) => (x === null ? null : roundHalfUp(x));

export type TrendLabel = 'rising' | 'falling' | 'stable' | 'little_data';

/** Trend over chronologically ordered percents: K = min(3, floor(n/2)), delta of the last K vs the K before. */
export function trend(values: number[]): { label: TrendLabel; delta: number | null } {
  const n = values.length;
  if (n < 4) return { label: 'little_data', delta: null };
  const k = Math.min(3, Math.floor(n / 2));
  const last = values.slice(n - k);
  const prev = values.slice(n - 2 * k, n - k);
  const delta = mean(last)! - mean(prev)!;
  return { label: delta >= 5 ? 'rising' : delta <= -5 ? 'falling' : 'stable', delta };
}

/** Root (column) activities: makeup activities are merged with their original. */
export function rootOf(a: MActivity): string {
  return a.rootId ?? a.id;
}

export function eligible(s: MStudent, root: MActivity): boolean {
  return root.playedAt >= s.since && (s.leftAt === null || root.playedAt <= s.leftAt);
}

/** Counted root activities in the period, chronologically. */
export function countedRoots(activities: MActivity[], from = -Infinity, to = Infinity, kind?: ActivityKind): MActivity[] {
  return activities
    .filter((a) => a.rootId === null && a.countInStats && a.playedAt >= from && a.playedAt <= to && (!kind || a.kind === kind))
    .sort((a, b) => a.playedAt - b.playedAt || a.id.localeCompare(b.id));
}

/** Result of a student for a root activity (original or any makeup); `makeup` marks results written later. */
export function resultFor(studentId: string, root: MActivity, activities: MActivity[], results: MResult[]): (MResult & { makeup: boolean }) | null {
  const ids = new Set(activities.filter((a) => rootOf(a) === root.id).map((a) => a.id));
  const res = results.find((x) => x.studentId === studentId && ids.has(x.activityId));
  return res ? { ...res, makeup: res.activityId !== root.id } : null;
}

export interface StudentSummary {
  testAvg: number | null;
  quizAvg: number | null;
  testCount: number;
  quizCount: number;
  testTrend: { label: TrendLabel; delta: number | null };
  quizTrend: { label: TrendLabel; delta: number | null };
  participation: number | null;
  eligibleCount: number;
  flags: { rule: 'low_average' | 'falling' | 'low_participation'; text: string }[];
}

export function studentSummary(
  s: MStudent,
  activities: MActivity[],
  results: MResult[],
  settings: { supportThresholdPercent: number; trendDropPp: number },
  period: { from?: number; to?: number } = {},
): StudentSummary {
  const roots = countedRoots(activities, period.from, period.to);
  const series = (kind: ActivityKind) =>
    roots
      .filter((a) => a.kind === kind)
      .map((a) => resultFor(s.id, a, activities, results))
      .filter((x): x is MResult & { makeup: boolean } => !!x && !x.excluded)
      .map((x) => x.percent);
  const tests = series('test');
  const quizzes = series('quiz');
  const el = roots.filter((a) => eligible(s, a));
  const present = el.filter((a) => resultFor(s.id, a, activities, results)).length;
  const participation = el.length ? r((100 * present) / el.length) : null;
  const testTrend = trend(tests);
  const flags: StudentSummary['flags'] = [];
  const testAvg = mean(tests);
  if (tests.length >= 2 && testAvg !== null && testAvg < settings.supportThresholdPercent) {
    flags.push({ rule: 'low_average', text: `Průměr testů (${r(testAvg)} %) je pod ${settings.supportThresholdPercent} % (aspoň 2 testy).` });
  }
  if (testTrend.delta !== null && testTrend.delta <= -settings.trendDropPp) {
    flags.push({ rule: 'falling', text: `Výsledky testů klesly o ${Math.abs(r(testTrend.delta)!)} p. b. (práh ${settings.trendDropPp} p. b.).` });
  }
  if (participation !== null && el.length >= 3 && participation < 70) {
    flags.push({ rule: 'low_participation', text: `Účast ${participation} % je pod 70 % (aspoň 3 aktivity).` });
  }
  return {
    testAvg: r(testAvg),
    quizAvg: r(mean(quizzes)),
    testCount: tests.length,
    quizCount: quizzes.length,
    testTrend: { label: testTrend.label, delta: r(testTrend.delta) },
    quizTrend: (() => {
      const t = trend(quizzes);
      return { label: t.label, delta: r(t.delta) };
    })(),
    participation,
    eligibleCount: el.length,
    flags,
  };
}

/** Class statistics for one root activity (original + makeups). */
export function activityStats(root: MActivity, activities: MActivity[], results: MResult[]) {
  const ids = new Set(activities.filter((a) => rootOf(a) === root.id).map((a) => a.id));
  const rs = results.filter((x) => ids.has(x.activityId));
  const counted = rs.filter((x) => !x.excluded).map((x) => x.percent);
  const dist = [0, 0, 0, 0, 0];
  for (const p of counted) dist[Math.min(4, Math.floor(p / 20))]!++;
  return {
    n: rs.length,
    participationRate: root.rosterSize ? r((100 * rs.length) / root.rosterSize) : null,
    avg: r(mean(counted)),
    median: r(median(counted)),
    distribution: dist,
  };
}

// ---------------------------------------------------------------- topics and questions

export interface MItem {
  studentId: string | null;
  activityKind: ActivityKind;
  questionId: string | null;
  promptSnapshot: string;
  topic: string | null;
  weight: number;
  scoreMilli: number;
}

export type Mastery = { percent: number; items: number } | { percent: null; items: number; littleData: true };

export function topicMastery(items: MItem[], minItems: number): Mastery {
  if (items.length < minItems) return { percent: null, items: items.length, littleData: true };
  const w = items.reduce((a, i) => a + i.weight, 0);
  const s = items.reduce((a, i) => a + (i.weight * i.scoreMilli) / 1000, 0);
  return { percent: roundHalfUp((100 * s) / w), items: items.length };
}

/** Class topic table, weakest first; a class value needs >= 3 students and >= 3 * minItems items. */
export function classTopics(items: MItem[], minItems: number) {
  const by = new Map<string, MItem[]>();
  for (const i of items) if (i.topic) by.set(i.topic, [...(by.get(i.topic) ?? []), i]);
  return [...by.entries()]
    .map(([topic, its]) => {
      const students = new Set(its.map((i) => i.studentId).filter(Boolean)).size;
      const enough = students >= 3 && its.length >= 3 * minItems;
      const m = topicMastery(its, 1);
      return { topic, items: its.length, students, percent: enough ? m.percent : null };
    })
    .sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101) || a.topic.localeCompare(b.topic, 'cs'));
}

/** Weakest questions: success = Σ score / (1000 · answers), by question id (or prompt), >= minItems answers. */
export function weakQuestions(items: MItem[], minItems: number, limit = 10) {
  const by = new Map<string, MItem[]>();
  for (const i of items) {
    const k = i.questionId ?? `p:${i.promptSnapshot}`;
    by.set(k, [...(by.get(k) ?? []), i]);
  }
  return [...by.values()]
    .filter((its) => its.length >= minItems)
    .map((its) => ({
      questionId: its[0]!.questionId,
      prompt: its[0]!.promptSnapshot,
      topic: its[0]!.topic,
      answers: its.length,
      successRate: roundHalfUp((100 * its.reduce((a, i) => a + i.scoreMilli, 0)) / (1000 * its.length)),
    }))
    .sort((a, b) => a.successRate - b.successRate)
    .slice(0, limit);
}
