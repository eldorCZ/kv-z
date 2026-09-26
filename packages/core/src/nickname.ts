import words from '../data/profanity.json' with { type: 'json' };
import { stripDiacritics } from './text.js';

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

const list = [...words.cs, ...words.en].map((w) => stripDiacritics(w.toLowerCase()));
const longWords = list.filter((w) => w.length >= 5);
const shortWords = new Set(list.filter((w) => w.length < 5));

function canonical(s: string): string {
  return stripDiacritics(s.toLowerCase())
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('');
}

export function containsProfanity(nickname: string): boolean {
  const c = canonical(nickname);
  const squashed = c.replace(/[^a-z]/g, '');
  // collapse repeated letters ("kuuurva" -> "kurva")
  const collapsed = squashed.replace(/(.)\1+/g, '$1');
  if (longWords.some((w) => squashed.includes(w) || collapsed.includes(w.replace(/(.)\1+/g, '$1')))) return true;
  const tokens = c.split(/[^a-z]+/).filter(Boolean);
  return tokens.some((t) => shortWords.has(t) || shortWords.has(t.replace(/(.)\1+/g, '$1')));
}

// control characters, zero-width and bidi override characters
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g;

export type NicknameCheck = { ok: true; nickname: string } | { ok: false; error: string };

/** Nickname rules: 2–20 characters, no control characters, no profanity. */
export function checkNickname(raw: unknown): NicknameCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'Zadejte přezdívku.' };
  const nickname = raw.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  const len = [...nickname].length;
  if (len < 2) return { ok: false, error: 'Přezdívka musí mít alespoň 2 znaky.' };
  if (len > 20) return { ok: false, error: 'Přezdívka může mít nejvýše 20 znaků.' };
  if (containsProfanity(nickname)) return { ok: false, error: 'Tuto přezdívku nelze použít. Zvolte prosím jinou.' };
  return { ok: true, nickname };
}

/** Test mode (requireName): first name and surname, 3–60 characters, no profanity. */
export function checkStudentName(raw: unknown): NicknameCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'Zadejte jméno a příjmení.' };
  const name = raw.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  const len = [...name].length;
  if (len < 3) return { ok: false, error: 'Zadejte jméno a příjmení.' };
  if (len > 60) return { ok: false, error: 'Jméno může mít nejvýše 60 znaků.' };
  if (!/\p{L}/u.test(name)) return { ok: false, error: 'Jméno musí obsahovat písmena.' };
  if (containsProfanity(name)) return { ok: false, error: 'Toto jméno nelze použít.' };
  return { ok: true, nickname: name };
}
