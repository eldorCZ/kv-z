import { buildSummary, type ExportQuiz, type ExportQuestion, type ExportSummary } from './types.js';

/** Escape GIFT special characters: ~ = # { } : and backslash. Newlines become \n. */
export function giftEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/([~=#{}:])/g, '\\$1')
    .replace(/\r?\n/g, '\\n');
}

// Moodle accepts only these answer weights.
const MOODLE_FRACTIONS = [100, 90, 83.33333, 80, 75, 70, 66.66667, 60, 50, 40, 33.33333, 30, 25, 20, 16.66667, 14.28571, 12.5, 11.11111, 10, 5];

function nearestFraction(p: number): string {
  const best = MOODLE_FRACTIONS.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a));
  return String(best);
}

function comment(s: string): string {
  return s.replace(/\r?\n/g, ' ');
}

function formatNumber(n: number): string {
  return String(n);
}

function answerBlock(q: ExportQuestion): string {
  const fb = q.explanation ? `\n\t####${giftEscape(q.explanation)}` : '';
  switch (q.type) {
    case 'single':
      return `{\n${q.options.map((o, i) => `\t${q.correctIndices.includes(i) ? '=' : '~'}${giftEscape(o)}`).join('\n')}${fb}\n}`;
    case 'multi': {
      const w = nearestFraction(100 / q.correctIndices.length);
      return `{\n${q.options.map((o, i) => `\t~%${q.correctIndices.includes(i) ? w : '-100'}%${giftEscape(o)}`).join('\n')}${fb}\n}`;
    }
    case 'truefalse':
      return `{${q.correctIndices[0] === 0 ? 'TRUE' : 'FALSE'}${fb}\n}`;
    case 'short':
      return `{\n${q.acceptedAnswers.map((a) => `\t=${giftEscape(a)}`).join('\n')}${fb}\n}`;
    case 'numeric':
      return `{#${formatNumber(q.numericAnswer ?? 0)}:${formatNumber(q.numericTolerance ?? 0)}${fb}\n}`;
    case 'order':
    case 'image-label':
      throw new Error(`${q.type} is not supported by GIFT`);
  }
}

export function giftExport(quiz: ExportQuiz, opts: { includeFlagged?: boolean } = {}): { text: string; summary: ExportSummary } {
  const skipped: Record<string, number[]> = { flagged: [], order: [], image: [] };
  const blocks: string[] = [
    `// ${comment(quiz.title)}`,
    `// Exportováno z Lore, formát Moodle GIFT (UTF-8).`,
    '',
  ];
  quiz.questions.forEach((q, i) => {
    const num = i + 1;
    if (q.qa.status === 'flagged' && !opts.includeFlagged) return void skipped.flagged!.push(num);
    if (q.type === 'order') return void skipped.order!.push(num);
    if (q.type === 'image-label') return void skipped.image!.push(num);
    const lines: string[] = [];
    if (q.sourceRef) {
      const loc = [q.sourceRef.file, q.sourceRef.locator].filter(Boolean).join(', ');
      lines.push(`// Zdroj: ${comment(loc)}${q.sourceRef.quote ? ` – „${comment(q.sourceRef.quote)}“` : ''}`);
    }
    if (q.qa.status === 'flagged') lines.push(`// POZOR: otázka ke kontrole – ${comment(q.qa.notes)}`);
    lines.push(`::Q${num}::${giftEscape(q.prompt)} ${answerBlock(q)}`);
    blocks.push(lines.join('\n'), '');
  });
  return { text: blocks.join('\n'), summary: buildSummary('gift', quiz.questions.length, skipped, []) };
}

/**
 * Lightweight GIFT syntax check (used by tests): every question has a title and prompt and exactly one
 * balanced, non-empty answer block made of valid answer lines. Returns a list of problems.
 */
export function checkGiftSyntax(text: string): string[] {
  const problems: string[] = [];
  const questions = text
    .split(/\n\s*\n/)
    .map((b) => b.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').trim())
    .filter(Boolean);
  questions.forEach((q, qi) => {
    const where = `otázka ${qi + 1}`;
    // find unescaped braces
    const braces: { ch: string; pos: number }[] = [];
    for (let i = 0; i < q.length; i++) {
      if (q[i] === '\\') {
        i++;
        continue;
      }
      if (q[i] === '{' || q[i] === '}') braces.push({ ch: q[i]!, pos: i });
    }
    if (braces.length !== 2 || braces[0]!.ch !== '{' || braces[1]!.ch !== '}') return void problems.push(`${where}: chybné složené závorky`);
    const head = q.slice(0, braces[0]!.pos);
    if (!/^::[^:]+::\S/.test(head)) problems.push(`${where}: chybí ::název:: nebo text otázky`);
    const body = q.slice(braces[0]!.pos + 1, braces[1]!.pos).trim();
    if (!body) return void problems.push(`${where}: prázdný blok odpovědí`);
    const main = body.split(/(?<!\\)####/)[0]!.trim();
    if (/^(TRUE|FALSE|T|F)(#.*)?$/s.test(main)) return;
    if (/^#-?\d+(\.\d+)?(:\d+(\.\d+)?)?$/.test(main)) return;
    const answers = main.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (!answers.length) return void problems.push(`${where}: žádné odpovědi`);
    let hasCorrect = false;
    for (const a of answers) {
      const m = /^([=~])(%-?\d+(\.\d+)?%)?(.+)$/s.exec(a);
      if (!m) {
        problems.push(`${where}: neplatný řádek odpovědi „${a}“`);
        continue;
      }
      if (m[1] === '=' || (m[2] && !m[2].startsWith('%-'))) hasCorrect = true;
      if (/(?<!\\)[=~{}]/.test(m[4]!.replace(/(?<!\\)#.*$/, ''))) problems.push(`${where}: neescapovaný speciální znak v „${a}“`);
    }
    if (!hasCorrect) problems.push(`${where}: chybí správná odpověď`);
  });
  return problems;
}
