import { z } from 'zod';

// ---------------------------------------------------------------- personal codes (C4.4)

/** 31 characters without I, L, O, 0, 1 (easy to read and type). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;

/** randInt(max) must return a cryptographically secure integer in [0, max). */
export function generateCode(randInt: (max: number) => number): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randInt(CODE_ALPHABET.length)];
  return s;
}

/** Upper case, without spaces, dashes and dots. Returns null when the input is not a valid code. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.toUpperCase().replace(/[\s\-.]/g, '');
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** K7MQ2XRT -> K7MQ-2XRT */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// ---------------------------------------------------------------- school year (C4.1)

/** School year runs 1 Sep – 31 Aug: 2026-08-31 -> "2025/2026", 2026-09-01 -> "2026/2027". */
export function currentSchoolYear(date: Date): string {
  const y = date.getFullYear();
  const start = date.getMonth() >= 8 ? y : y - 1;
  return `${start}/${start + 1}`;
}

/** Last day of a school year "2026/2027" -> "2027-08-31". */
export function schoolYearEnd(schoolYear: string): string {
  const m = /^(\d{4})\/(\d{4})$/.exec(schoolYear);
  if (!m) throw new Error('invalid school year');
  return `${m[2]}-08-31`;
}

export const SCHOOL_YEAR_RE = /^(\d{4})\/(\d{4})$/;

// ---------------------------------------------------------------- names (C4.2)

const NAME_RE = /^[\p{L}\p{N} .'’-]*$/u;

// eslint-disable-next-line no-control-regex
const INVISIBLE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g;

export function cleanName(s: string): string {
  return s
    .normalize('NFC')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isValidNamePart(s: string): boolean {
  return NAME_RE.test(s);
}

/**
 * Default public name: given name + first letter of the family name + "." ("Jana N.").
 * A single word (pseudonym, number) is used as is. Collisions in the class get " 2", " 3".
 */
export function derivePublicName(given: string, family: string, taken: Iterable<string> = []): string {
  const g = cleanName(given);
  const f = cleanName(family);
  let base: string;
  if (g && f) base = `${g} ${[...f][0]!.toLocaleUpperCase('cs')}.`;
  else base = g || f;
  base = [...base].slice(0, 26).join('');
  const used = new Set([...taken].map((t) => t.toLocaleLowerCase('cs')));
  if (!used.has(base.toLocaleLowerCase('cs'))) return base;
  for (let i = 2; ; i++) {
    const c = `${base} ${i}`;
    if (!used.has(c.toLocaleLowerCase('cs'))) return c;
  }
}

const namePart = (min: number, max: number) =>
  z
    .string()
    .transform(cleanName)
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine(isValidNamePart, { message: 'Jméno smí obsahovat jen písmena, číslice, mezeru, pomlčku, apostrof a tečku.', params: { code: 'invalid_chars' } }),
    );

export const studentInputSchema = z.object({
  familyName: namePart(1, 40),
  givenName: namePart(0, 40).default(''),
  publicName: namePart(1, 30).optional(),
  rosterNo: z.number().int().min(1).max(99).nullable().optional(),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type StudentInput = z.output<typeof studentInputSchema>;

export const classSettingsSchema = z.object({
  supportThresholdPercent: z.number().int().min(0).max(100).default(50),
  trendDropPp: z.number().int().min(1).max(50).default(10),
  halfYearSplit: z
    .string()
    .regex(/^\d{2}-\d{2}$/)
    .default('02-01'),
});
export type ClassSettings = z.output<typeof classSettingsSchema>;

export const classInputSchema = z.object({
  name: z.string().transform(cleanName).pipe(z.string().min(1).max(40)),
  schoolYear: z.string().regex(SCHOOL_YEAR_RE).optional(),
  subject: z.string().transform(cleanName).pipe(z.string().max(40)).nullable().optional(),
  settings: classSettingsSchema.partial().optional(),
});

// ---------------------------------------------------------------- roster import (C4.3)

export interface RosterRow {
  line: number;
  familyName: string;
  givenName: string;
  rosterNo: number | null;
  error?: string;
}

/**
 * Decode an uploaded CSV: valid UTF-8 (with or without BOM) first, otherwise windows-1250
 * (Czech Excel often saves CSV like that).
 */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return s.replace(/^\ufeff/, '');
  } catch {
    return new TextDecoder('windows-1250').decode(bytes);
  }
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const HEADER_KEYS: Record<string, 'family' | 'given' | 'no'> = {
  prijmeni: 'family',
  'příjmení': 'family',
  jmeno: 'given',
  'jméno': 'given',
  cislo: 'no',
  'číslo': 'no',
};

function rowFrom(line: number, family: string, given: string, no: string | undefined): RosterRow {
  const n = no && no.trim() ? Number(no.trim()) : null;
  const row: RosterRow = { line, familyName: cleanName(family), givenName: cleanName(given), rosterNo: n };
  if (n !== null && (!Number.isInteger(n) || n < 1 || n > 99)) row.error = 'Číslo v třídním výkazu musí být 1–99.';
  else if (!row.familyName) row.error = 'Chybí příjmení.';
  else if ([...row.familyName].length > 40 || [...row.givenName].length > 40) row.error = 'Jméno je příliš dlouhé (max. 40 znaků).';
  else if (!isValidNamePart(row.familyName) || !isValidNamePart(row.givenName)) row.error = 'Nepovolené znaky ve jméně.';
  return row;
}

/** CSV with ; or , as separator, optional header (prijmeni, jmeno, cislo). */
export function parseRosterCsv(text: string): RosterRow[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.find((l) => l.trim()) ?? '';
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  let map: ('family' | 'given' | 'no' | null)[] | null = null;
  const rows: RosterRow[] = [];
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const cells = splitCsvLine(raw, sep);
    if (!map && rows.length === 0) {
      const keys = cells.map((c) => HEADER_KEYS[c.toLowerCase().trim()] ?? null);
      if (keys.some((k) => k)) {
        map = keys;
        return;
      }
    }
    const get = (k: 'family' | 'given' | 'no') => {
      if (map) {
        const idx = map.indexOf(k);
        return idx >= 0 ? (cells[idx] ?? '') : '';
      }
      return { family: cells[0] ?? '', given: cells[1] ?? '', no: cells[2] ?? '' }[k];
    };
    rows.push(rowFrom(i + 1, get('family'), get('given'), get('no')));
  });
  return rows;
}

/** One student per line, "Příjmení Jméno" (default) or "Jméno Příjmení", optional number at the start. */
export function parseRosterLines(text: string, order: 'family-given' | 'given-family' = 'family-given'): RosterRow[] {
  const rows: RosterRow[] = [];
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((raw, i) => {
      let line = cleanName(raw.replace(/\t/g, ' '));
      if (!line) return;
      let no: string | undefined;
      const m = /^(\d{1,3})[.)]?\s+(.*)$/.exec(line);
      if (m) {
        no = m[1];
        line = m[2]!;
      }
      const parts = line.split(' ');
      let family: string;
      let given: string;
      if (parts.length === 1) {
        family = parts[0]!;
        given = '';
      } else if (order === 'family-given') {
        family = parts[0]!;
        given = parts.slice(1).join(' ');
      } else {
        family = parts[parts.length - 1]!;
        given = parts.slice(0, -1).join(' ');
      }
      rows.push(rowFrom(i + 1, family, given, no));
    });
  return rows;
}

/** Preview warnings (duplicate names, class size). Duplicates are allowed (homonyms). */
export function rosterWarnings(rows: RosterRow[], existing: { familyName: string; givenName: string }[], maxStudents: number): string[] {
  const w: string[] = [];
  const key = (f: string, g: string) => `${f} ${g}`.toLocaleLowerCase('cs');
  const seen = new Map<string, number>();
  for (const e of existing) seen.set(key(e.familyName, e.givenName), 0);
  for (const r of rows) {
    if (r.error) continue;
    const k = key(r.familyName, r.givenName);
    if (seen.has(k)) w.push(`Řádek ${r.line}: jméno ${r.familyName} ${r.givenName} už v seznamu je (duplicitní jména jsou povolená).`);
    seen.set(k, r.line);
  }
  const total = existing.length + rows.filter((r) => !r.error).length;
  if (total > maxStudents) w.push(`Třída by měla ${total} žáků, limit je ${maxStudents}.`);
  return w;
}
