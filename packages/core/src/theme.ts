/**
 * Theme of a quiz or a game (Dodatek 4, V7.4): only ids of a built-in motive and an accent. A custom image
 * (V8) can be chosen only in the app, never through the API. Unknown ids are dropped with a warning instead
 * of rejecting the quiz – the look must never block an agent's upload.
 */
import { getAccent } from './accents.js';
import { MOTIVE_LIST, getMotive } from './motives.js';
import { formatPath, type ContractError } from './validate.js';

export interface QuizTheme {
  motive?: string;
  accent?: string;
  /** custom background image (V8), app only */
  imageId?: string;
}

const ID = /^[a-z0-9-]{1,40}$/;

/**
 * Normalises an untrusted theme value. `allowImage` is true only for the teacher's own session in the app.
 * Returns null when nothing valid is left.
 */
export function normalizeTheme(input: unknown, path: (string | number)[] = ['theme'], allowImage = false): { theme: QuizTheme | null; warnings: ContractError[] } {
  const warnings: ContractError[] = [];
  if (input === undefined || input === null) return { theme: null, warnings };
  if (typeof input !== 'object' || Array.isArray(input)) {
    warnings.push({ path: formatPath(path), code: 'theme_ignored', message: 'Vzhled musí být objekt {"motive", "accent"}; byl ignorován.' });
    return { theme: null, warnings };
  }
  const raw = input as Record<string, unknown>;
  const theme: QuizTheme = {};
  if (raw.motive !== undefined) {
    if (typeof raw.motive === 'string' && getMotive(raw.motive)) theme.motive = raw.motive;
    else warnings.push({ path: formatPath([...path, 'motive']), code: 'unknown_motive', message: `Neznámý motiv ${JSON.stringify(String(raw.motive).slice(0, 40))} byl ignorován. Seznam motivů vrací GET /api/v1/themes.` });
  }
  if (raw.accent !== undefined) {
    if (typeof raw.accent === 'string' && getAccent(raw.accent)) theme.accent = raw.accent;
    else warnings.push({ path: formatPath([...path, 'accent']), code: 'unknown_accent', message: `Neznámý akcent ${JSON.stringify(String(raw.accent).slice(0, 40))} byl ignorován.` });
  }
  if (raw.imageId !== undefined) {
    if (allowImage && typeof raw.imageId === 'string' && ID.test(raw.imageId)) theme.imageId = raw.imageId;
    else warnings.push({ path: formatPath([...path, 'imageId']), code: 'image_app_only', message: 'Vlastní obrázek pozadí lze vybrat jen v aplikaci; byl ignorován.' });
  }
  for (const k of Object.keys(raw)) {
    if (!['motive', 'accent', 'imageId'].includes(k)) warnings.push({ path: formatPath([...path, k]), code: 'unknown_field', message: `Neznámé pole vzhledu „${k.slice(0, 40)}“ bylo ignorováno.` });
  }
  return { theme: Object.keys(theme).length ? theme : null, warnings };
}

/** Public list of built-in motives for GET /api/v1/themes. */
export function themeCatalog() {
  return MOTIVE_LIST.map((m) => ({ id: m.id, name: m.name, category: m.category, calm: m.calm }));
}

/**
 * Theme as sent to players (V7.4): exactly these four fields, only in game info (join, lobby, attempt),
 * never inside question objects. `scrimHint` asks for the stronger scrim (tests, custom photos).
 */
export interface PlayerTheme {
  motive: string | null;
  accent: string | null;
  imageUrl: string | null;
  scrimHint: 'normal' | 'strong';
}

export function playerTheme(theme: QuizTheme | null | undefined, opts: { calm: boolean; imageUrl?: string | null }): PlayerTheme {
  const imageUrl = theme?.imageId ? (opts.imageUrl ?? null) : null;
  return {
    motive: theme?.motive ?? null,
    accent: theme?.accent ?? null,
    imageUrl,
    scrimHint: opts.calm || imageUrl ? 'strong' : 'normal',
  };
}
