/**
 * Reconstructs the layout of the official Kahoot spreadsheet import template
 * ("KahootQuizTemplate.xlsx") because support.kahoot.com was not reachable from the build environment.
 * Replace fixtures/kahoot-template.xlsx with the official file when possible – the exporter locates the
 * header row and columns by their text, so the official file works without code changes.
 */
import ExcelJS from 'exceljs';
import { join } from 'node:path';

export const KAHOOT_HEADERS = [
  'Question - max 120 characters',
  'Answer 1 - max 75 characters',
  'Answer 2 - max 75 characters',
  'Answer 3 - max 75 characters',
  'Answer 4 - max 75 characters',
  'Time limit (sec) – 5, 10, 20, 30, 60, 90, 120, or 240 secs',
  'Correct answer(s) - choose at least one',
];

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('B2').value = 'Quiz template';
  ws.getCell('B3').value =
    'Add questions, at least two answer alternatives, time limit and choose correct answers (at least one). Have fun creating your awesome quiz!';
  ws.getCell('B4').value =
    'Remember: questions have a limit of 120 characters and answers can have 75 characters max. Text will turn red in Excel or Google Docs if you exceed this limit. If several answers are correct, separate them with a comma.';
  ws.getCell('B5').value = "See an example question below (don't forget to overwrite this with your first question!)";
  ws.getCell('B6').value = "And remember, if you're not using Excel you need to export to .xlsx format before you upload to Kahoot!";
  ws.getRow(8).values = ['', ...KAHOOT_HEADERS];
  ws.getRow(8).font = { bold: true };
  ws.getRow(9).values = [1, 'Example question: What is the capital of Norway?', 'Oslo', 'Bergen', 'Trondheim', 'Stavanger', 20, '1'];
  ws.getColumn(2).width = 60;
  for (const c of [3, 4, 5, 6]) ws.getColumn(c).width = 30;
  ws.getColumn(7).width = 20;
  ws.getColumn(8).width = 20;
  const out = join(import.meta.dirname, '../../../fixtures/kahoot-template.xlsx');
  await wb.xlsx.writeFile(out);
  console.log(`Template written to ${out}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) void main();
