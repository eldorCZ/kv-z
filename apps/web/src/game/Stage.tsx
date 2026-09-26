import { DEFAULT_LIVE_MOTIVE, DEFAULT_TEST_MOTIVE, accentVars, getMotive, motiveDataUrl, scrimAlpha } from '@kvizhub/core';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { usePrefs } from '../theme/prefs';

/** Theme of a game as sent to the host and the players (V7.4); only ids, never content. */
export interface StageTheme {
  motive?: string | null;
  accent?: string | null;
  /** custom teacher image (V8), already a same-origin URL */
  imageUrl?: string | null;
}

/**
 * Background layers of a game screen (V6.3): motive → scrim → content. Text never sits on the motive
 * directly, content uses bg-panel surfaces. The motive animates only in the playful mood with full motion;
 * tests (focus) always get a static picture under a strong scrim.
 */
export function Stage({
  theme,
  seed,
  mood = 'play',
  idleCursor = false,
  className = '',
  children,
  testId,
}: {
  theme?: StageTheme | null;
  seed: number;
  mood?: 'play' | 'focus';
  /** hide the mouse pointer after 3 s without movement (projector) */
  idleCursor?: boolean;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const { theme: scheme, motion } = usePrefs();
  const fallback = mood === 'focus' ? DEFAULT_TEST_MOTIVE : DEFAULT_LIVE_MOTIVE;
  const motive = theme?.motive && getMotive(theme.motive) ? theme.motive : fallback;
  const animate = mood === 'play' && motion === 'full';
  const src = useMemo(() => theme?.imageUrl || motiveDataUrl(motive, { seed, scheme, animate }), [theme?.imageUrl, motive, seed, scheme, animate]);
  // custom photos are busier than our motives: always the stronger scrim
  const scrim = theme?.imageUrl ? Math.max(0.6, scrimAlpha(motive, scheme, 'focus')) : scrimAlpha(motive, scheme, mood);
  const idle = useIdle(idleCursor ? 3000 : 0);
  const style = accentVars(theme?.accent, scheme) as CSSProperties;

  return (
    <div
      data-mood={mood}
      data-motive={motive}
      data-testid={testId ?? 'stage'}
      style={style}
      className={`relative isolate flex min-h-dvh flex-col bg-canvas text-fg ${idle ? 'stage-idle' : ''} ${className}`}
    >
      <img src={src} alt="" aria-hidden="true" draggable={false} className="pointer-events-none fixed inset-0 -z-20 h-full w-full object-cover select-none" />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-scrim" style={{ opacity: scrim }} />
      {children}
    </div>
  );
}

/** true after `ms` without pointer movement; 0 disables */
function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!ms) return;
    let timer = setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), ms);
    };
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, [ms]);
  return idle;
}
