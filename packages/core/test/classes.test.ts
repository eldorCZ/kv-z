import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  activityStats,
  buildResultItems,
  classTopics,
  currentSchoolYear,
  decodeCsv,
  checkRoster,
  normalizeAccountName,
  studentInputSchema,
  studentNumberLabel,
  formatCode,
  generateCode,
  mean,
  normalizeCode,
  parseRosterCsv,
  parseRosterLines,
  r,
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

describe('account names (C4.2)', () => {
  it('normalizeAccountName: lower case, domain removed, NFC, invalid characters, empty input', () => {
    expect(normalizeAccountName(' Novak12 ')).toEqual({ ok: true, value: 'novak12' });
    expect(normalizeAccountName('NOVAK12@skola.cz')).toEqual({ ok: true, value: 'novak12' });
    expect(normalizeAccountName('SKOLA\\novak12')).toEqual({ ok: true, value: 'novak12' });
    expect(normalizeAccountName('j.novak_2-b')).toEqual({ ok: true, value: 'j.novak_2-b' });
    // diacritics are kept (NFC), decomposed input is composed
    expect(normalizeAccountName('Novák12')).toEqual({ ok: true, value: 'novák12' });
    expect(normalizeAccountName('')).toMatchObject({ ok: false });
    expect(normalizeAccountName('   ')).toMatchObject({ ok: false });
    expect(normalizeAccountName(null)).toMatchObject({ ok: false });
    expect(normalizeAccountName('a')).toMatchObject({ ok: false, error: expect.stringMatching(/2–40/) });
    expect(normalizeAccountName('x'.repeat(41))).toMatchObject({ ok: false });
    expect(normalizeAccountName('Jana Nováková')).toMatchObject({ ok: false, error: expect.stringMatching(/mezeru/) });
    expect(normalizeAccountName('novak<script>')).toMatchObject({ ok: false, error: expect.stringMatching(/jen písmena/) });
  });
  it('server schema keeps only account name and number', () => {
    const r = studentInputSchema.safeParse({ accountName: 'Novak12@skola.cz', rosterNo: 3, familyName: 'Novák', givenName: 'Jan' });
    expect(r.success && r.data).toEqual({ accountName: 'novak12', rosterNo: 3 });
    expect(studentInputSchema.safeParse({ accountName: 'Jan Novák' }).success).toBe(false);
  });
  it('number label', () => {
    expect(studentNumberLabel(7, 0)).toBe('Žák 7');
    expect(studentNumberLabel(null, 4)).toBe('Žák 5');
  });
});

describe('roster import (C4.3)', () => {
  it('parses pasted lines: login or address, optional number', () => {
    expect(parseRosterLines('1. novak12\n2 Svobodova3@skola.cz\n\ndvorak')).toEqual([
      { line: 1, accountName: 'novak12', rosterNo: 1 },
      { line: 2, accountName: 'svobodova3', rosterNo: 2 },
      { line: 4, accountName: 'dvorak', rosterNo: null },
    ]);
    expect(parseRosterLines('Nováková Jana')[0]!.error).toMatch(/mezeru/);
  });
  it('decodes UTF-8, UTF-8 with BOM and windows-1250', () => {
    const utf = new TextEncoder().encode('login;cislo\nčermák2;1');
    expect(decodeCsv(utf)).toBe('login;cislo\nčermák2;1');
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, ...utf]))).toBe('login;cislo\nčermák2;1');
    // "Čermák" in windows-1250: C8 65 72 6D E1 6B
    expect(decodeCsv(new Uint8Array([0xc8, 0x65, 0x72, 0x6d, 0xe1, 0x6b]))).toBe('Čermák');
  });
  it('CSV: account column by header name, other columns dropped, ; , and tab', () => {
    // AD export with names: only the login column is used
    expect(parseRosterCsv('"jmeno";"prijmeni";"SamAccountName";"cislo"\nPetr;Novák;novak12;3\nJana;Malá;mala4;')).toEqual([
      { line: 2, accountName: 'novak12', rosterNo: 3 },
      { line: 3, accountName: 'mala4', rosterNo: null },
    ]);
    expect(parseRosterCsv('UPN,Name\nnovak12@skola.cz,Petr Novák')).toEqual([{ line: 2, accountName: 'novak12', rosterNo: null }]);
    expect(parseRosterCsv('login\tdisplayName\nnovak12\tPetr Novák')[0]).toEqual({ line: 2, accountName: 'novak12', rosterNo: null });
    expect(parseRosterCsv('ucet;cislo\nnovak12;120')[0]!.error).toMatch(/1–99/);
  });
  it('CSV without a header: first column is the account, a second numeric column the number', () => {
    expect(parseRosterCsv('novak12;4\nmala4;5')).toEqual([
      { line: 1, accountName: 'novak12', rosterNo: 4 },
      { line: 2, accountName: 'mala4', rosterNo: 5 },
    ]);
    expect(parseRosterCsv('novak12,Petr Novák')).toEqual([{ line: 1, accountName: 'novak12', rosterNo: null }]);
  });
  it('a header with names but no account column is refused (names never become accounts)', () => {
    const rows = parseRosterCsv('jmeno;prijmeni\nPetr;Novák');
    expect(rows[0]).toMatchObject({ accountName: '', error: expect.stringMatching(/přihlašovacím jménem/) });
  });
  it('duplicates are errors, diacritics-only matches and class size are warnings', () => {
    const { rows, warnings } = checkRoster(parseRosterLines('novak12\nNOVAK12\nnovák12'), [{ accountName: 'mala4' }], 60);
    expect(rows.map((r) => !!r.error)).toEqual([false, true, false]);
    expect(warnings).toEqual([expect.stringMatching(/diakritikou/)]);
    expect(checkRoster(parseRosterLines('mala4'), [{ accountName: 'mala4' }], 60).rows[0]!.error).toMatch(/už ve třídě/);
    expect(checkRoster(parseRosterLines('a1\nb2'), [{ accountName: 'c3' }], 2).warnings.some((w) => w.includes('limit'))).toBe(true);
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
