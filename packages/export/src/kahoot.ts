import ExcelJS from 'exceljs';
import { buildSummary, type ExportQuiz, type ExportSummary, type TooLongItem } from './types.js';

export const KAHOOT_TIME_LIMITS = [5, 10, 20, 30, 60, 120] as const;
export const KAHOOT_MAX_ANSWERS = 4;

export interface KahootOptions {
  /** contents of the official template (fixtures/kahoot-template.xlsx) */
  template: Buffer | ArrayBuffer;
  maxQuestionLength?: number;
  maxAnswerLength?: number;
  includeFlagged?: boolean;
}

export interface KahootColumns {
  headerRow: number;
  number: number;
  question: number;
  answers: number[];
  time: number;
  correct: number;
}

/** Round a time limit UP to the nearest value accepted by the Kahoot import. */
export function kahootTime(sec: number): number {
  return KAHOOT_TIME_LIMITS.find((t) => t >= sec) ?? 120;
}

const cellText = (v: ExcelJS.CellValue) => (v === null || v === undefined ? '' : typeof v === 'object' && 'richText' in v ? v.richText.map((r) => r.text).join('') : String(v));

/** Locate the header row and columns by header text so that the official template can be dropped in as is. */
export function findKahootColumns(ws: ExcelJS.Worksheet): KahootColumns {
  for (let r = 1; r <= Math.min(ws.rowCount, 30); r++) {
    const row = ws.getRow(r);
    const cols: Partial<KahootColumns> & { answers: number[] } = { answers: [] };
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const t = cellText(cell.value).toLowerCase();
      if (t.startsWith('question')) cols.question = col;
      else if (/^answer\s*\d/.test(t)) cols.answers.push(col);
      else if (t.startsWith('time limit')) cols.time = col;
      else if (t.startsWith('correct answer')) cols.correct = col;
    });
    if (cols.question && cols.answers.length >= 2 && cols.time && cols.correct) {
      return { headerRow: r, number: cols.question - 1, question: cols.question, answers: cols.answers.sort((a, b) => a - b), time: cols.time, correct: cols.correct };
    }
  }
  throw new Error('V šabloně Kahoot nebyl nalezen řádek s hlavičkami (Question, Answer 1–4, Time limit, Correct answer(s)).');
}

export async function kahootExport(quiz: ExportQuiz, opts: KahootOptions): Promise<{ buffer: Buffer; summary: ExportSummary }> {
  const maxQ = opts.maxQuestionLength ?? 95;
  const maxA = opts.maxAnswerLength ?? 60;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(opts.template as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Šablona Kahoot neobsahuje žádný list.');
  const cols = findKahootColumns(ws);

  // clear example rows below the header
  for (let r = ws.rowCount; r > cols.headerRow; r--) ws.spliceRows(r, 1);

  const skipped: Record<string, number[]> = { flagged: [], short: [], numeric: [], order: [], too_many_options: [], too_long: [] };
  const tooLong: TooLongItem[] = [];
  let row = cols.headerRow + 1;
  let n = 0;
  quiz.questions.forEach((q, i) => {
    const num = i + 1;
    if (q.qa.status === 'flagged' && !opts.includeFlagged) return void skipped.flagged!.push(num);
    if (q.type === 'short' || q.type === 'numeric' || q.type === 'order') return void skipped[q.type]!.push(num);
    if (q.options.length > KAHOOT_MAX_ANSWERS) return void skipped.too_many_options!.push(num);
    const long: TooLongItem[] = [];
    if (q.prompt.length > maxQ) long.push({ number: num, field: 'prompt', length: q.prompt.length, limit: maxQ });
    for (const o of q.options) if (o.length > maxA) long.push({ number: num, field: 'option', length: o.length, limit: maxA });
    if (long.length) {
      tooLong.push(...long);
      return void skipped.too_long!.push(num);
    }
    n++;
    const r = ws.getRow(row++);
    r.getCell(cols.number).value = n;
    r.getCell(cols.question).value = q.prompt;
    cols.answers.forEach((c, ai) => {
      r.getCell(c).value = q.options[ai] ?? null;
    });
    r.getCell(cols.time).value = kahootTime(q.timeLimitSec);
    r.getCell(cols.correct).value = q.correctIndices
      .map((c) => c + 1)
      .sort((a, b) => a - b)
      .join(',');
    r.commit();
  });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, summary: buildSummary('kahoot', quiz.questions.length, skipped, tooLong) };
}
