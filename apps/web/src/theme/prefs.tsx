import { DEFAULT_UI_PREFS, resolveMotion, resolveTheme, sanitizeUiPrefs, UI_PREFS_KEY, type UiPrefs } from '@kvizhub/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Appearance preferences (Dodatek 4, V5): colour scheme, reduced motion and readable font.
 * Stored in localStorage of this device (try/catch, works without it); a logged-in teacher also
 * saves them on the server through `onSave` so they follow him to another device.
 */
interface PrefsState {
  prefs: UiPrefs;
  theme: 'light' | 'dark';
  motion: 'full' | 'reduced';
  setPrefs: (p: Partial<UiPrefs>) => void;
  /** replaces the local prefs with the teacher's saved ones (after login) */
  adopt: (p: unknown) => void;
  /** called after every user change (the teacher's prefs are saved on the server) */
  setOnSave: (fn: ((p: UiPrefs) => void) | null) => void;
}

const Ctx = createContext<PrefsState | null>(null);

export function readLocalPrefs(): UiPrefs {
  try {
    return sanitizeUiPrefs(JSON.parse(window.localStorage.getItem(UI_PREFS_KEY) ?? '{}'));
  } catch {
    return DEFAULT_UI_PREFS;
  }
}

function writeLocalPrefs(p: UiPrefs) {
  try {
    window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the system setting is used next time */
  }
}

function useMedia(query: string): boolean {
  const get = () => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [v, setV] = useState(get);
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(query);
    } catch {
      return;
    }
    const on = () => setV(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return v;
}

/** Applies the resolved values on <html> (theme-init.js did the same before the first paint). */
function apply(theme: 'light' | 'dark', motion: 'full' | 'reduced', font: UiPrefs['font']) {
  const d = document.documentElement;
  d.setAttribute('data-theme', theme);
  d.setAttribute('data-motion', motion);
  if (font === 'readable') d.setAttribute('data-font', 'readable');
  else d.removeAttribute('data-font');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f0b2a' : '#f7f5ff');
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<UiPrefs>(readLocalPrefs);
  const [onSave, setOnSaveState] = useState<{ fn: ((p: UiPrefs) => void) | null }>({ fn: null });
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const systemReduce = useMedia('(prefers-reduced-motion: reduce)');
  const theme = resolveTheme(prefs, systemDark);
  const motion = resolveMotion(prefs, systemReduce);

  useEffect(() => apply(theme, motion, prefs.font), [theme, motion, prefs.font]);

  const setPrefs = useCallback(
    (p: Partial<UiPrefs>) => {
      setState((cur) => {
        const next = sanitizeUiPrefs({ ...cur, ...p });
        writeLocalPrefs(next);
        onSave.fn?.(next);
        return next;
      });
    },
    [onSave],
  );
  const adopt = useCallback((p: unknown) => {
    const next = sanitizeUiPrefs(p);
    writeLocalPrefs(next);
    setState(next);
  }, []);
  const setOnSave = useCallback((fn: ((p: UiPrefs) => void) | null) => setOnSaveState({ fn }), []);

  const value = useMemo(() => ({ prefs, theme, motion, setPrefs, adopt, setOnSave }), [prefs, theme, motion, setPrefs, adopt, setOnSave]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsState {
  const c = useContext(Ctx);
  if (!c) throw new Error('PrefsProvider missing');
  return c;
}
