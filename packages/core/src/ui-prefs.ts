/**
 * Appearance preferences (Dodatek 4, V5). Teachers: stored in teachers.ui_prefs_json and localStorage;
 * students and hosts: only localStorage of their device (key "lore.ui"), never on the server.
 */
export const UI_PREFS_KEY = 'lore.ui';

// no zod here: this module is part of the student bundle (V11.2)
const SCHEMES = ['system', 'light', 'dark'] as const;
const MOTIONS = ['system', 'reduce', 'full'] as const;
const FONTS = ['default', 'readable'] as const;
export interface UiPrefs {
  scheme: (typeof SCHEMES)[number];
  motion: (typeof MOTIONS)[number];
  font: (typeof FONTS)[number];
}
export const DEFAULT_UI_PREFS: UiPrefs = { scheme: 'system', motion: 'system', font: 'default' };

/** Unknown or malformed values fall back to the defaults, unknown keys are dropped. */
export function sanitizeUiPrefs(raw: unknown): UiPrefs {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const pick = <T extends string>(list: readonly T[], v: unknown, d: T): T => (list.includes(v as T) ? (v as T) : d);
  return { scheme: pick(SCHEMES, obj.scheme, 'system'), motion: pick(MOTIONS, obj.motion, 'system'), font: pick(FONTS, obj.font, 'default') };
}

/** The user's choice wins over the system; "system" follows prefers-color-scheme. */
export function resolveTheme(prefs: Pick<UiPrefs, 'scheme'>, systemDark: boolean): 'light' | 'dark' {
  if (prefs.scheme === 'light' || prefs.scheme === 'dark') return prefs.scheme;
  return systemDark ? 'dark' : 'light';
}

export function resolveMotion(prefs: Pick<UiPrefs, 'motion'>, systemReduce: boolean): 'full' | 'reduced' {
  if (prefs.motion === 'reduce') return 'reduced';
  if (prefs.motion === 'full') return 'full';
  return systemReduce ? 'reduced' : 'full';
}
