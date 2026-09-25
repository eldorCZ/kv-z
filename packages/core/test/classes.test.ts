import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  activityStats,
  buildResultItems,
  classTopics,
  currentSchoolYear,
  decodeCsv,
  derivePublicName,
  formatCode,
  generateCode,
  mean,
  normalizeCode,
  parseRosterCsv,
  parseRosterLines,
  r,
  rosterWarnings,
  schoolYearEnd,
  studentSummary,
  topicMastery,
  trend,
  weakQuestions,
  type MActivity,
  type MItem,
  type MResult,
} from '../src/index.js';

describe('personal codes (C4.4)', () => {
  it('alphabet has 31 unambiguous characters', () => {
    expect(CODE_ALPHABET).toHaveLength(31);
    for (const ch of 'ILO01') expect(CODE_ALPHABET).not.toContain(ch);
  });
  it('generates 8 characters from the alphabet with an injected random source', () => {
    let i = 0;
    const code = generateCode((max) => i++ % max);
    expect(code).toBe('ABCDEFGH');
    const code2 = generateCode((max) => max - 1);
    expect(code2).toBe('99999999');
    expect(formatCode('K7MQ2XRT')).toBe('K7MQ-2XRT');
  });
  it('normalizes input', () => {
    expect(normalizeCode(' k7mq-2xrt ')).toBe('K7MQ2XRT');
    expect(normalizeCode('K7MQ.2XRT')).toBe('K7MQ2XRT');
    expect(normalizeCode('K7MQ-2XR0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeCode('K7MQ-2XR')).toBeNull();
    expect(normalizeCode(12345678)).toBeNull();
  });
});

describe('school year (C4.1)', () => {
  it('switches on 1 September', () => {
    expect(currentSchoolYear(new Date(2026, 7, 31, 23, 59))).toBe('2025/2026');
    expect(currentSchoolYear(new Date(2026, 8, 1, 0, 0))).toBe('2026/2027');
    expect(currentSchoolYear(new Date(2027, 0, 15))).toBe('2026/2027');
    expect(schoolYearEnd('2026/2027')).toBe('2027-08-31');
  });
});

describe('public names (C4.2)', () => {
  it('given name + initial, single words, collisions', () => {
    expect(derivePublicName('Jana', 'Nováková')).toBe('Jana N.');
    expect(derivePublicName('', 'Žák 07')).toBe('Žák 07');
    expect(derivePublicName('Jana', 'Nová', ['Jana N.'])).toBe('Jana N. 2');
    expect(derivePublicName('Jana', 'Nosková', ['jana n.', 'Jana N. 2'])).toBe('Jana N. 3');
    expect(derivePublicName('Šárka', 'Čermáková')).toBe('Šárka Č.');
  });
});

describe('roster import (C4.3)', () => {
  it('parses pasted lines in both orders with optional numbers', () => {
    expect(parseRosterLines('1. Nováková Jana\n2 Svoboda Petr Jan\n\nDvořák')).toEqual([
      { line: 1, familyName: 'Nováková', givenName: 'Jana', rosterNo: 1 },
      { line: 2, familyName: 'Svoboda', givenName: 'Petr Jan', rosterNo: 2 },
      { line: 4, familyName: 'Dvořák', givenName: '', rosterNo: null },
    ]);
    expect(parseRosterLines('Jana Nováková', 'given-family')[0]).toMatchObject({ familyName: 'Nováková', givenName: 'Jana' });
    expect(parseRosterLines('Novák <script>')[0]!.error).toMatch(/Nepovolené/);
  });
  it('decodes UTF-8, UTF-8 with BOM and windows-1250', () => {
    const utf = new TextEncoder().encode('prijmeni;jmeno\nČermák;Šimon');
    expect(decodeCsv(utf)).toBe('prijmeni;jmeno\nČermák;Šimon');
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, ...utf]))).toBe('prijmeni;jmeno\nČermák;Šimon');
    // "Čermák" in windows-1250: C8 65 72 6D E1 6B
    expect(decodeCsv(new Uint8Array([0xc8, 0x65, 0x72, 0x6d, 0xe1, 0x6b]))).toBe('Čermák');
  });
  it('parses CSV with ; or , with and without a header', () => {
    expect(parseRosterCsv('prijmeni;jmeno;cislo\nNovák;Petr;3')).toEqual([{ line: 2, familyName: 'Novák', givenName: 'Petr', rosterNo: 3 }]);
    expect(parseRosterCsv('jmeno,prijmeni\nPetr,Novák')[0]).toMatchObject({ familyName: 'Novák', givenName: 'Petr' });
    expect(parseRosterCsv('Novák,Petr,4\n"Dvořák, ml.",Jan,')[1]).toMatchObject({ familyName: 'Dvořák, ml.', error: expect.any(String) });
    expect(parseRosterCsv('Novák;Petr;120')[0]!.error).toMatch(/1–99/);
  });
  it('warns about duplicates and class size', () => {
    const rows = parseRosterLines('Novák Petr\nNovák Petr');
    expect(rosterWarnings(rows, [], 60)).toHaveLength(1);
    expect(rosterWarnings(rows, [{ familyName: 'X', givenName: 'Y' }], 2).some((w) => w.includes('limit'))).toBe(true);
  });
});

const base = { options: [], correctIndices: [], acceptedAnswers: [], numericAnswer: null, numericTolerance: null };

describe('buildResultItems (C7.1)', () => {
  const qs = [
    { ...base, id: 'a', type: 'single' as const, prompt: 'A', options: ['x', 'y', 'z'], correctIndices: [0], points: 'double' as const, topic: 'Lom' },
    { ...base, id: 'b', type: 'multi' as const, prompt: 'B', options: ['1', '2', '3', '4'], correctIndices: [0, 1], points: 'standard' as const },
    { ...base, id: 'c', type: 'short' as const, prompt: 'C', acceptedAnswers: ['x'], points: 'none' as const },
    { ...base, id: 'd', type: 'truefalse' as const, prompt: 'D', options: ['Pravda', 'Nepravda'], correctIndices: [0], points: 'standard' as const },
  ];
  it('weights 1 and 2, points none left out, unanswered = 0', () => {
    const b = buildResultItems({ questions: qs, answers: new Map<string, unknown>([['a', { indices: [0] }], ['b', { indices: [1] }]]) });
    expect(b.items.map((i) => [i.questionId, i.weight, i.scoreMilli, i.answered])).toEqual([
      ['a', 2, 1000, true],
      ['b', 1, 0, true],
      ['d', 1, 0, false],
    ]);
    expect(b.percent).toBe(50); // 2 / 4
    expect(b.pointsCenti).toBe(200);
    expect(b.maxPointsCenti).toBe(400);
    expect(b.answeredCount).toBe(2);
    expect(b.items[0]!.topic).toBe('Lom');
  });
  it('partial credit and excluded / skipped questions', () => {
    const b = buildResultItems({ questions: qs, answers: new Map<string, unknown>([['b', { indices: [0] }]]), excluded: new Set(['a', 'd']), opts: { partialMulti: true } });
    expect(b.items).toHaveLength(1);
    expect(b.items[0]!.scoreMilli).toBe(500);
    expect(b.percent).toBe(50);
  });
  it('weight vector: (w=2, s=1) and (w=1, s=0) -> 67 %', () => {
    const b = buildResultItems({ questions: [qs[0]!, qs[3]!], answers: new Map<string, unknown>([['a', { indices: [0] }], ['d', { indices: [1] }]]) });
    expect(b.percent).toBe(67);
  });
});

describe('metrics vectors (C7.3)', () => {
  it('testAvg [67, 73, 50] = 63', () => expect(r(mean([67, 73, 50]))).toBe(63));
  it('trend [80, 70, 60, 50] falling -20', () => expect(trend([80, 70, 60, 50])).toEqual({ label: 'falling', delta: -20 }));
  it('trend [40, 50, 60, 70, 80] rising +20', () => expect(trend([40, 50, 60, 70, 80])).toEqual({ label: 'rising', delta: 20 }));
  it('trend [80, 70, 60, 40, 30, 20] -40', () => expect(trend([80, 70, 60, 40, 30, 20]).delta).toBe(-40));
  it('trend [70, 72, 71] little data', () => expect(trend([70, 72, 71]).label).toBe('little_data'));
  it('topic 1, 0, 1, 1, 0.5 = 70 %; 4 items = little data (4 of 5)', () => {
    const mk = (s: number): MItem => ({ studentId: 's', activityKind: 'test', questionId: null, promptSnapshot: '', topic: 'T', weight: 1, scoreMilli: s * 1000 });
    expect(topicMastery([1, 0, 1, 1, 0.5].map(mk), 5)).toEqual({ percent: 70, items: 5 });
    expect(topicMastery([1, 0, 1, 1].map(mk), 5)).toEqual({ percent: null, items: 4, littleData: true });
  });
  it('participation: joined after the first activity, 4 eligible, results in 3 = 75 %', () => {
    const day = 86_400_000;
    const acts: MActivity[] = [0, 10, 20, 30, 40].map((d, i) => ({ id: `a${i}`, kind: 'test', playedAt: d * day, countInStats: true, rootId: null, rosterSize: 20 }));
    const results: MResult[] = ['a1', 'a2', 'a4'].map((a) => ({ activityId: a, studentId: 's', percent: 80, excluded: false }));
    const s = studentSummary({ id: 's', since: 5 * day, leftAt: null }, acts, results, { supportThresholdPercent: 50, trendDropPp: 10 });
    expect(s.eligibleCount).toBe(4);
    expect(s.participation).toBe(75);
  });
});

describe('eligibility, makeups, flags', () => {
  const day = 86_400_000;
  const acts: MActivity[] = [
    { id: 't1', kind: 'test', playedAt: 1 * day, countInStats: true, rootId: null, rosterSize: 3 },
    { id: 't1m', kind: 'test', playedAt: 5 * day, countInStats: true, rootId: 't1', rosterSize: 1 },
    { id: 'q1', kind: 'quiz', playedAt: 2 * day, countInStats: true, rootId: null, rosterSize: 3 },
    { id: 't2', kind: 'test', playedAt: 8 * day, countInStats: true, rootId: null, rosterSize: 3 },
    { id: 'trial', kind: 'test', playedAt: 9 * day, countInStats: false, rootId: null, rosterSize: 3 },
    { id: 't3', kind: 'test', playedAt: 12 * day, countInStats: true, rootId: null, rosterSize: 3 },
  ];
  const results: MResult[] = [
    { activityId: 't1m', studentId: 's', percent: 40, excluded: false }, // makeup merged with t1
    { activityId: 't2', studentId: 's', percent: 30, excluded: false },
    { activityId: 'trial', studentId: 's', percent: 100, excluded: false },
    { activityId: 't3', studentId: 's', percent: 90, excluded: true }, // present but not counted in averages
  ];
  it('merges makeups, ignores count_in_stats=false, excluded counts for participation only', () => {
    const s = studentSummary({ id: 's', since: 0, leftAt: 10 * day }, acts, results, { supportThresholdPercent: 50, trendDropPp: 10 });
    expect(s.testAvg).toBe(35);
    expect(s.testCount).toBe(2);
    expect(s.quizAvg).toBeNull();
    // left before t3 -> eligible t1, q1, t2; present t1 (makeup), t2 -> 67 %
    expect(s.eligibleCount).toBe(3);
    expect(s.participation).toBe(67);
    expect(s.flags.map((f) => f.rule).sort()).toEqual(['low_average', 'low_participation']);
  });
  it('activity statistics include makeups', () => {
    const st = activityStats(acts[0]!, acts, [...results, { activityId: 't1', studentId: 'x', percent: 90, excluded: false }]);
    expect(st).toMatchObject({ n: 2, participationRate: 67, avg: 65, median: 65 });
    expect(st.distribution).toEqual([0, 0, 1, 0, 1]);
  });
  it('falling trend flag', () => {
    const a: MActivity[] = [80, 70, 60, 40].map((_, i) => ({ id: `x${i}`, kind: 'test', playedAt: i * day, countInStats: true, rootId: null, rosterSize: 1 }));
    const rs: MResult[] = [80, 70, 60, 40].map((p, i) => ({ activityId: `x${i}`, studentId: 's', percent: p, excluded: false }));
    const s = studentSummary({ id: 's', since: 0, leftAt: null }, a, rs, { supportThresholdPercent: 50, trendDropPp: 10 });
    expect(s.testTrend).toEqual({ label: 'falling', delta: -25 });
    expect(s.flags.map((f) => f.rule)).toEqual(['falling']);
  });
});

describe('class topics and weak questions', () => {
  const items: MItem[] = [];
  for (const st of ['a', 'b', 'c']) for (let i = 0; i < 5; i++) items.push({ studentId: st, activityKind: 'test', questionId: `q${i}`, promptSnapshot: `Q${i}`, topic: 'Lom', weight: 1, scoreMilli: i === 0 ? 0 : 1000 });
  items.push({ studentId: 'a', activityKind: 'quiz', questionId: 'z', promptSnapshot: 'Z', topic: 'Zrcadla', weight: 1, scoreMilli: 0 });
  it('class value needs 3 students and 3 * min items', () => {
    const t = classTopics(items, 5);
    expect(t[0]).toMatchObject({ topic: 'Lom', percent: 80, items: 15, students: 3 });
    expect(t[1]).toMatchObject({ topic: 'Zrcadla', percent: null });
  });
  it('weak questions need min answers', () => {
    expect(weakQuestions(items, 3)[0]).toMatchObject({ questionId: 'q0', successRate: 0, answers: 3 });
    expect(weakQuestions(items, 4)).toEqual([]);
  });
});
