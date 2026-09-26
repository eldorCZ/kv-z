import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ANNOUNCE = [30, 10, 5];

/**
 * Countdown ring (V9.3). The number is always visible; the last five seconds switch to the warning colour
 * and a symbol, so the state is never told by colour alone. Screen readers hear only 30, 10 and 5 s.
 */
export function TimerRing({ remaining, total, size = 'lg' }: { remaining: number; total: number; size?: 'md' | 'lg' }) {
  const { t } = useTranslation();
  const [said, setSaid] = useState('');
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (ANNOUNCE.includes(remaining) && last.current !== remaining && remaining < total) setSaid(t('game.secondsLeft', { count: remaining }));
    last.current = remaining;
  }, [remaining, total, t]);

  const px = size === 'lg' ? 128 : 64;
  const stroke = size === 'lg' ? 12 : 7;
  const r = (px - stroke) / 2;
  const len = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;
  const low = remaining <= 5;
  return (
    <div className="timer-ring relative shrink-0" style={{ width: px, height: px }} data-testid="timer">
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} aria-hidden="true" className="-rotate-90">
        <circle cx={px / 2} cy={px / 2} r={r} fill="var(--surface)" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          className="progress"
          cx={px / 2}
          cy={px / 2}
          r={r}
          fill="none"
          stroke={low ? 'var(--danger)' : 'var(--primary)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - frac)}
        />
      </svg>
      <span className={`absolute inset-0 flex flex-col items-center justify-center font-display leading-none font-bold tabular ${low ? 'text-danger' : 'text-fg'} ${size === 'lg' ? 'text-5xl' : 'text-2xl'}`}>
        {remaining}
        {low && (
          <span aria-hidden="true" className={size === 'lg' ? 'text-base' : 'text-[0.6rem]'}>
            ⏱
          </span>
        )}
      </span>
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
    </div>
  );
}

/** Thin time bar for phones (V9.4). */
export function TimeBar({ remaining, total }: { remaining: number; total: number }) {
  const frac = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-pill bg-panel-2" aria-hidden="true" data-testid="time-bar">
      <div className={`h-full origin-left rounded-pill transition-transform duration-300 ease-linear ${remaining <= 5 ? 'bg-danger' : 'bg-primary'}`} style={{ transform: `scaleX(${frac})` }} />
    </div>
  );
}
