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

// ---------------------------------------------------------------- account names (C4.2)

// eslint-disable-next-line no-control-regex
const INVISIBLE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff]/g;

/** NFC, invisible characters removed, whitespace collapsed and trimmed (class names, labels). */
export function cleanName(s: string): string {
  return s.normalize('NFC').replace(INVISIBLE_CHARS, '').replace(/\s+/g, ' ').trim();
}

const ACCOUNT_RE = /^[\p{L}\p{N}._-]{2,40}$/u;

export type AccountNameResult = { ok: true; value: string } | { ok: false; value: string; error: string };

/**
 * The only name of a student: the school login without the domain ("novak12").
 * NFC, trimmed, lower case; "novak12@skola.cz" and "SKOLA\novak12" become "novak12" (the domain is dropped).
 * Letters, digits, dot, dash and underscore, 2–40 characters.
 */
export function normalizeAccountName(raw: unknown): AccountNameResult {
  if (typeof raw !== 'string') return { ok: false, value: '', error: 'Chybí přihlašovací jméno.' };
  let v = raw.normalize('NFC').replace(INVISIBLE_CHARS, '').trim();
  if (v.includes('\\')) v = v.slice(v.lastIndexOf('\\') + 1);
  if (v.includes('@')) v = v.slice(0, v.indexOf('@'));
  v = v.trim().toLocaleLowerCase('cs');
  if (!v) return { ok: false, value: v, error: 'Chybí přihlašovací jméno.' };
  if (/\s/.test(v)) return { ok: false, value: v, error: 'Přihlašovací jméno nesmí obsahovat mezeru (vkládejte jen přihlašovací jména, ne jména a příjmení).' };
  if ([...v].length < 2 || [...v].length > 40) return { ok: false, value: v, error: 'Přihlašovací jméno musí mít 2–40 znaků.' };
  if (!ACCOUNT_RE.test(v)) return { ok: false, value: v, error: 'Přihlašovací jméno smí obsahovat jen písmena, číslice, tečku, pomlčku a podtržítko.' };
  return { ok: true, value: v };
}

/** Diacritics folded ("novák12" ~ "novak12"): such a match is only a warning. */
export function foldAccountName(v: string): string {
  return v.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('cs');
}

/** "Skrýt jména" and leaderboardNames = "number": "Žák <číslo>", or the position in the roster when the number is missing. */
export function studentNumberLabel(rosterNo: number | null | undefined, index: number): string {
  return `Žák ${rosterNo ?? index + 1}`;
}

export const accountNameSchema = z.string().transform((v, ctx) => {
  const r = normalizeAccountName(v);
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.error, params: { code: 'invalid_account_name' } });
    return z.NEVER;
  }
  return r.value;
});

/** The server accepts only these fields about a student (C4.3); anything else is dropped. */
export const studentInputSchema = z.object({
  accountName: accountNameSchema,
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
  /** what classmates and the projector see in a live class game (C5.6) */
  leaderboardNames: z.enum(['account', 'number']).default('account'),
});
export type ClassSettings = z.output<typeof classSettingsSchema>;

export const classInputSchema = z.object({
  name: z.string().transform(cleanName).pipe(z.string().min(1).max(40)),
  schoolYear: z.string().regex(SCHOOL_YEAR_RE).optional(),
  subject: z.string().transform(cleanName).pipe(z.string().max(40)).nullable().optional(),
  settings: classSettingsSchema.partial().optional(),
});

// ---------------------------------------------------------------- roster import (C4.3), runs in the teacher's browser

export interface RosterRow {
  line: number;
  accountName: string;
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

const ACCOUNT_KEYS = ['login', 'samaccountname', 'ucet', 'účet', 'upn', 'userprincipalname', 'prihlasovacijmeno', 'přihlašovacíjméno'];
const NUMBER_KEYS = ['cislo', 'číslo', 'c', 'č', 'no', 'number'];
/** header words of name columns: a header with these but without an account column is refused */
const NAME_KEYS = ['jmeno', 'jméno', 'prijmeni', 'příjmení', 'name', 'givenname', 'surname', 'sn', 'displayname', 'celejmeno', 'celéjméno'];

const headerKey = (c: string) => c.toLowerCase().replace(/[\s_-]/g, '');

function rowFrom(line: number, account: string, no: string | undefined): RosterRow {
  const n = no && no.trim() ? Number(no.trim().replace(/\.$/, '')) : null;
  const acc = normalizeAccountName(account);
  const row: RosterRow = { line, accountName: acc.value, rosterNo: n };
  if (n !== null && (!Number.isInteger(n) || n < 1 || n > 99)) row.error = 'Číslo v třídním výkazu musí být 1–99.';
  else if (!acc.ok) row.error = acc.error;
  return row;
}

/**
 * CSV with ; , or tab as separator and an optional header. The account column is recognised by its name
 * (login, SamAccountName, ucet, UPN), otherwise it is the first column; optional column "cislo".
 * All other columns (names from an AD export…) are dropped here and never leave the browser.
 */
export function parseRosterCsv(text: string): RosterRow[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.find((l) => l.trim()) ?? '';
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = count('\t') > Math.max(count(';'), count(',')) ? '\t' : count(';') >= count(',') ? ';' : ',';
  let accIdx = 0;
  let noIdx = -1;
  let headerSeen = false;
  let missingAccount = false;
  const rows: RosterRow[] = [];
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const cells = splitCsvLine(raw, sep);
    if (!headerSeen && rows.length === 0) {
      const keys = cells.map(headerKey);
      const a = keys.findIndex((k) => ACCOUNT_KEYS.includes(k));
      const n = keys.findIndex((k) => NUMBER_KEYS.includes(k));
      if (a >= 0 || n >= 0 || keys.some((k) => NAME_KEYS.includes(k))) {
        headerSeen = true;
        accIdx = a;
        noIdx = n;
        if (a < 0) {
          // e.g. "jmeno;prijmeni": never take a name column as the account
          const firstOther = keys.findIndex((k, j) => j !== n && !NAME_KEYS.includes(k));
          if (firstOther >= 0) accIdx = firstOther;
          else missingAccount = true;
        }
        return;
      }
      // no header: first column = account, a second numeric column = number
      noIdx = cells.length > 1 && /^\d{1,2}\.?$/.test(cells[1] ?? '') ? 1 : -1;
    }
    if (missingAccount) {
      rows.push({ line: i + 1, accountName: '', rosterNo: null, error: 'Soubor nemá sloupec s přihlašovacím jménem (login, SamAccountName, ucet nebo UPN).' });
      return;
    }
    rows.push(rowFrom(i + 1, cells[accIdx] ?? '', noIdx >= 0 ? cells[noIdx] : undefined));
  });
  return rows;
}

/** One student per line: login or the account address, optional number at the start ("12 novak12", "12. novak12@skola.cz"). */
export function parseRosterLines(text: string): RosterRow[] {
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
      rows.push(rowFrom(i + 1, line, no));
    });
  return rows;
}

/**
 * Duplicates (case-insensitive, within the list and against the class) become errors; a match after removing
 * diacritics is only a warning; class size over the limit is a warning.
 */
export function checkRoster(rows: RosterRow[], existing: { accountName: string }[], maxStudents: number): { rows: RosterRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const exact = new Set(existing.map((e) => e.accountName));
  const folded = new Map(existing.map((e) => [foldAccountName(e.accountName), e.accountName]));
  const out = rows.map((r) => {
    if (r.error) return r;
    if (exact.has(r.accountName)) return { ...r, error: `Přihlašovací jméno ${r.accountName} už ve třídě nebo v seznamu je.` };
    const f = foldAccountName(r.accountName);
    const similar = folded.get(f);
    if (similar) warnings.push(`Řádek ${r.line}: ${r.accountName} se liší od ${similar} jen diakritikou.`);
    exact.add(r.accountName);
    folded.set(f, r.accountName);
    return r;
  });
  const total = existing.length + out.filter((r) => !r.error).length;
  if (total > maxStudents) warnings.push(`Třída by měla ${total} žáků, limit je ${maxStudents}.`);
  return { rows: out, warnings };
}
