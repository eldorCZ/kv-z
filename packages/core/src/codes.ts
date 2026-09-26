/** Zod-free helpers for personal codes and student labels (Dodatek 3), shared with the student bundle. */

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


/** "Skrýt jména" and leaderboardNames = "number": "Žák <číslo>", or the position in the roster when the number is missing. */
export function studentNumberLabel(rosterNo: number | null | undefined, index: number): string {
  return `Žák ${rosterNo ?? index + 1}`;
}
