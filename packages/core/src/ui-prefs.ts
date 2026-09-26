import { z } from 'zod';

/**
 * Appearance preferences (Dodatek 4, V5). Teachers: stored in teachers.ui_prefs_json and localStorage;
 * students and hosts: only localStorage of their device (key "jiskra.ui"), never on the server.
 */
export const UI_PREFS_KEY = 'jiskra.ui';

export const uiPrefsSchema = z.object({
  scheme: z.enum(['system', 'light', 'dark']).catch('system'),
  motion: z.enum(['system', 'reduce', 'full']).catch('system'),
  font: z.enum(['default', 'readable']).catch('default'),
});
export type UiPrefs = z.output<typeof uiPrefsSchema>;
export const DEFAULT_UI_PREFS: UiPrefs = { scheme: 'system', motion: 'system', font: 'default' };

/** Unknown or malformed values fall back to the defaults, unknown keys are dropped. */
export function sanitizeUiPrefs(raw: unknown): UiPrefs {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return uiPrefsSchema.parse({ scheme: obj.scheme, motion: obj.motion, font: obj.font });
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
