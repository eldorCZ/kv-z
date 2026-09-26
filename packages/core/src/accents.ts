/**
 * Accent colours (Dodatek 4, V6.2). An accent replaces the primary colour family of the design tokens;
 * every value is checked against the same contrast manifest as the base tokens (pnpm check:contrast).
 * Fialová is the Jiskra default and equals the base tokens.
 */
import type { Scheme } from './motives.js';

export interface AccentTokens {
  primary: string;
  'primary-hover': string;
  'primary-soft': string;
  'on-primary-soft': string;
  'primary-shadow': string;
}

export interface AccentDef {
  id: string;
  name: string;
  tokens: Record<Scheme, AccentTokens>;
}

const a = (id: string, name: string, light: string[], dark: string[]): AccentDef => {
  const t = ([primary, hover, soft, onSoft, shadow]: string[]): AccentTokens => ({
    primary: primary!,
    'primary-hover': hover!,
    'primary-soft': soft!,
    'on-primary-soft': onSoft!,
    'primary-shadow': shadow!,
  });
  return { id, name, tokens: { light: t(light), dark: t(dark) } };
};

export const ACCENTS: readonly AccentDef[] = [
  a('fialova', 'Fialová', ['#5b3df5', '#4a2ee0', '#ece7ff', '#3f23c9', '#3a22b8'], ['#8b7bff', '#a193ff', '#2c2270', '#d6cfff', '#5a48d6']),
  a('modra', 'Modrá', ['#1c58c4', '#194fb0', '#e3edff', '#1a4aa8', '#153f8f'], ['#6ea4ff', '#8cb7ff', '#1b2f63', '#cfe0ff', '#3c6fd0']),
  a('azurova', 'Azurová', ['#0a667d', '#095b70', '#dcf3f8', '#0a5a6e', '#074656'], ['#3cc6e0', '#66d4e8', '#0f3a47', '#c4f1fa', '#1f8ea3']),
  a('zelena', 'Zelená', ['#166c45', '#13603c', '#dcf5e8', '#135c3a', '#0e4a2e'], ['#4fd08d', '#74dca5', '#103d2a', '#c6f5dc', '#2a9661']),
  a('jantarova', 'Jantarová', ['#8c5200', '#7a4700', '#fff0d6', '#744400', '#603800'], ['#ffb84d', '#ffc970', '#3f2a08', '#ffe6bf', '#c98a10']),
  a('koralova', 'Korálová', ['#a8380a', '#93310a', '#ffe6dc', '#9a3408', '#7c2a06'], ['#ff8a5c', '#ffa37f', '#43200f', '#ffd9c9', '#c9582d']),
  a('ruzova', 'Růžová', ['#a8215f', '#921c52', '#ffe2ef', '#9a1f57', '#7a1845'], ['#ff7ab6', '#ff99c8', '#451a31', '#ffd3e7', '#c94a86']),
  a('grafitova', 'Grafitová', ['#3f4556', '#2f3442', '#e8e9ee', '#2f3442', '#22262f'], ['#aab1c5', '#c1c7d6', '#2a2d38', '#e1e4ec', '#6f7690']),
];

export const DEFAULT_ACCENT = 'fialova';
const BY_ID = new Map(ACCENTS.map((x) => [x.id, x]));
export const getAccent = (id: string | null | undefined): AccentDef | undefined => (id ? BY_ID.get(id) : undefined);

/** CSS custom properties for an accent (set through React's style object, i.e. CSSOM – no inline <style>). */
export function accentVars(id: string | null | undefined, scheme: Scheme): Record<string, string> {
  const acc = getAccent(id);
  if (!acc || acc.id === DEFAULT_ACCENT) return {};
  return Object.fromEntries(Object.entries(acc.tokens[scheme]).map(([k, v]) => [`--${k}`, v]));
}
