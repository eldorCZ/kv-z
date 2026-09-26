import { studentNumberLabel } from '@kvizhub/core/client';
export interface ClassDto {
  id: string;
  name: string;
  schoolYear: string;
  subject: string | null;
  status: 'active' | 'archived';
  role: 'owner' | 'editor' | 'viewer';
  settings: { supportThresholdPercent: number; trendDropPp: number; halfYearSplit: string; leaderboardNames: 'account' | 'number' };
  schoolYearEnd: string;
  archivedAt: number | null;
  anonymizeAt?: number;
  students?: StudentDto[];
}

export interface StudentDto {
  id: string;
  /** school login without the domain, the only name of a student (C4.2) */
  accountName: string;
  rosterNo: number | null;
  active: boolean;
  since: string;
  leftAt: string | null;
}

export interface CreatedCode {
  student: StudentDto;
  code: string;
}

/** Name shown in overviews: the account name, or "Žák <číslo>" when names are hidden (C8). */
export function studentName(s: { accountName: string; rosterNo: number | null }, hideNames: boolean, index: number): string {
  return hideNames ? studentNumberLabel(s.rosterNo, index) : s.accountName;
}

/** Per-browser preference "Skrýt jména (promítání)" (C8). */
export function readShowNames(defaultValue: boolean): boolean {
  try {
    const v = localStorage.getItem('lore-show-names');
    return v === null ? defaultValue : v === '1';
  } catch {
    return defaultValue;
  }
}
export function writeShowNames(v: boolean) {
  try {
    localStorage.setItem('lore-show-names', v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

// ---------------- overviews (C8)
export type TrendLabel = 'rising' | 'falling' | 'stable' | 'little_data';
export interface Summary {
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
export interface ActivityStats {
  n: number;
  participationRate: number | null;
  avg: number | null;
  median: number | null;
  distribution: number[];
}
export interface MatrixCell {
  state: 'result' | 'missing' | 'excluded' | 'na';
  percent?: number;
  makeup?: boolean;
}
export interface MatrixDto {
  period: { key: string; from: number | null; to: number | null };
  activities: { id: string; label: string; kind: 'quiz' | 'test'; playedAt: number; gameId: string | null; counted: boolean; stats: ActivityStats }[];
  students: (Omit<StudentDto, 'since' | 'leftAt'> & { cells: Record<string, MatrixCell>; summary: Summary })[];
  classSummary: { testAvg: number | null; quizAvg: number | null; participation: number | null };
}
export interface ActivityDto {
  id: string;
  label: string;
  kind: 'quiz' | 'test';
  quizTitle: string;
  playedAt: number;
  countInStats: boolean;
  gameId: string | null;
  gameStatus: string;
  makeups: { id: string; gameId: string | null; playedAt: number }[];
  missing: number | null;
  stats: ActivityStats;
}
export interface SeriesPoint {
  activityId: string;
  label: string;
  playedAt: number;
  percent: number | null;
  classMedian: number | null;
}
export interface ProfileDto {
  class: { id: string; name: string; role: ClassDto['role']; status: ClassDto['status'] };
  student: StudentDto;
  summary: Summary;
  tests: SeriesPoint[];
  quizzes: SeriesPoint[];
  topics: { topic: string; percent: number | null; items: number; littleData?: true }[];
  mistakes: { prompt: string; count: number; topic: string | null }[];
  results: {
    resultId: string;
    activityId: string;
    label: string;
    kind: 'quiz' | 'test';
    playedAt: number;
    gameId: string | null;
    percent: number;
    status: string;
    excluded: boolean;
    excludedReason: string | null;
    makeup: boolean;
    counted: boolean;
  }[];
  minItems: number;
}

export const shortDate = (ms: number) => new Date(ms).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v} %`);
export const TREND_ARROW: Record<TrendLabel, string> = { rising: '↗', falling: '↘', stable: '→', little_data: '·' };
/** a game's results page for the teacher */
export const gameLink = (kind: 'quiz' | 'test', gameId: string) => (kind === 'test' ? `/tests/${gameId}` : `/games/${gameId}`);
