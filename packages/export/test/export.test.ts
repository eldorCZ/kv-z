import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateQuiz, type Quiz } from '@kvizhub/core';
import { checkGiftSyntax, findKahootColumns, giftEscape, giftExport, jsonExport, kahootExport, kahootTime } from '../src/index.js';

const root = join(import.meta.dirname, '../../..');
const template = readFileSync(join(root, 'fixtures/kahoot-template.xlsx'));
function quiz(): Quiz {
  const r = validateQuiz(JSON.parse(readFileSync(join(root, 'fixtures/quizzes/valid/optika.json'), 'utf8')));
  if (!r.ok) throw new Error('fixture invalid');
  return r.data;
}

async function readBack(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb.worksheets[0]!;
}

describe('kahoot export', () => {
  it('fills the template, keeps headers and skips unsupported types', async () => {
    const { buffer, summary } = await kahootExport(quiz(), { template });
    const ws = await readBack(buffer);
    const tws = await readBack(template);
    const cols = findKahootColumns(ws);
    // headers identical to the template
    for (let c = 1; c <= 8; c++) expect(ws.getRow(cols.headerRow).getCell(c).value).toEqual(tws.getRow(cols.headerRow).getCell(c).value);
    // intro rows untouched
    expect(ws.getCell('B2').value).toEqual(tws.getCell('B2').value);
    const rows = [];
    for (let r = cols.headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row.getCell(cols.question).value) continue;
      rows.push({
        q: String(row.getCell(cols.question).value),
        answers: cols.answers.map((c) => row.getCell(c).value).filter((v) => v !== null && v !== undefined && v !== ''),
        time: Number(row.getCell(cols.time).value),
        correct: String(row.getCell(cols.correct).value),
      });
    }
    // single (ok), truefalse, multi has 5 options -> skipped, short/numeric/order skipped, flagged skipped
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ q: quiz().questions[0]!.prompt, answers: ['Lom světla', 'Odraz světla', 'Ohyb světla', 'Rozklad světla'], time: 20, correct: '1' });
    expect(rows[1]).toMatchObject({ answers: ['Pravda', 'Nepravda'], correct: '1', time: 10 });
    for (const r of rows) {
      expect(r.q.length).toBeLessThanOrEqual(95);
      expect(r.answers.length).toBeGreaterThanOrEqual(2);
      expect(r.answers.length).toBeLessThanOrEqual(4);
      for (const a of r.answers) expect(String(a).length).toBeLessThanOrEqual(60);
      expect([5, 10, 20, 30, 60, 120]).toContain(r.time);
      expect(r.correct).toMatch(/^[1-4](,[1-4])*$/);
    }
    expect(summary.exported).toBe(2);
    expect(summary.skipped).toEqual({ flagged: 1, short: 1, numeric: 1, order: 1, too_many_options: 1 });
    expect(summary.message).toBe('Exportováno 2 z 7 otázek. Vynecháno: 1 ke kontrole, 1 otevřená, 1 číselná, 1 řazení, 1 s více než 4 možnostmi. Zkráceno/odmítnuto pro délku: 0.');
  });

  it('multi with 4 options -> several correct numbers; flagged included on request', async () => {
    const q = quiz();
    q.questions[2]!.options = ['Sklo', 'Voda', 'Dřevo', 'Vzduch'];
    const { buffer, summary } = await kahootExport(q, { template, includeFlagged: true });
    const ws = await readBack(buffer);
    const cols = findKahootColumns(ws);
    const correct = [];
    for (let r = cols.headerRow + 1; r <= ws.rowCount; r++) correct.push(ws.getRow(r).getCell(cols.correct).value);
    expect(correct).toContain('1,2,4');
    expect(summary.exported).toBe(4);
  });

  it('does not silently truncate long texts', async () => {
    const q = quiz();
    q.questions[0]!.prompt = 'x'.repeat(100);
    q.questions[0]!.options[1] = 'y'.repeat(61);
    const { summary } = await kahootExport(q, { template });
    expect(summary.tooLong).toEqual([
      { number: 1, field: 'prompt', length: 100, limit: 95 },
      { number: 1, field: 'option', length: 61, limit: 60 },
    ]);
    expect(summary.message).toContain('Zkráceno/odmítnuto pro délku: 1.');
    const custom = await kahootExport(q, { template, maxQuestionLength: 120, maxAnswerLength: 75 });
    expect(custom.summary.tooLong).toEqual([]);
  });

  it('rounds time up to allowed values', () => {
    expect(kahootTime(5)).toBe(5);
    expect(kahootTime(15)).toBe(20);
    expect(kahootTime(45)).toBe(60);
    expect(kahootTime(500)).toBe(120);
  });
});

describe('gift export', () => {
  it('escapes special characters', () => {
    expect(giftEscape('a~b=c#d{e}f:g\\h')).toBe('a\\~b\\=c\\#d\\{e\\}f\\:g\\\\h');
    expect(giftEscape('1\n2')).toBe('1\\n2');
  });

  it('produces syntactically valid GIFT for all supported types', () => {
    const q = quiz();
    q.questions[0]!.prompt = 'Co je {lom}: 50% = ~polovina #?';
    const { text, summary } = giftExport(q);
    expect(checkGiftSyntax(text)).toEqual([]);
    expect(text).toContain('::Q1::Co je \\{lom\\}\\: 50% \\= \\~polovina \\#?');
    expect(text).toContain('=Lom světla');
    expect(text).toContain('~%33.33333%Sklo');
    expect(text).toContain('~%-100%Dřevo');
    expect(text).toContain('{TRUE');
    expect(text).toContain('=ohnisko');
    expect(text).toContain('{#1.33:0.01');
    expect(text).toContain('// Zdroj: optika.pdf, str. 3');
    expect(text).toContain('####Při přechodu');
    expect(summary.skipped).toEqual({ flagged: 1, order: 1 });
    expect(summary.exported).toBe(5);
  });

  it('checker detects broken syntax', () => {
    expect(checkGiftSyntax('::a::b {=x ~y').length).toBeGreaterThan(0);
    expect(checkGiftSyntax('::a::b {~x ~y}').length).toBeGreaterThan(0);
    expect(checkGiftSyntax('::a::b {=x {y}').length).toBeGreaterThan(0);
  });
});

describe('json export', () => {
  it('roundtrips through the contract', () => {
    const q = quiz();
    const { data } = jsonExport(q);
    const r = validateQuiz(JSON.parse(JSON.stringify(data)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual(q);
  });
});
