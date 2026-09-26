import type { RankEntry } from '@kvizhub/core';
import { Crown, Maximize, Minimize } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../ui/Dialog';
import { Mascot } from '../ui/Mascot';
import { Confetti } from './Confetti';

/** Giant PIN with tabular digits, split 3 + rest for reading aloud (V9.3). */
export function PinDisplay({ pin }: { pin: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg bg-panel px-8 py-5 text-center shadow-pop">
      <p className="text-2xl font-semibold text-muted">{t('host.pinLabel')}</p>
      <p className="font-display text-[clamp(4rem,11vw,9rem)] leading-none font-bold tracking-[0.12em] tabular" data-testid="host-pin">
        {pin.replace(/(\d{3})(\d+)/, '$1 $2')}
      </p>
    </div>
  );
}

/** QR code in a white frame (it has to stay dark-on-light to be scannable in dark mode too). */
export function QrFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="rounded-lg bg-[#ffffff] p-4 shadow-pop">
      <img src={src} alt={alt} className="h-[min(38vh,20rem)] w-[min(38vh,20rem)]" />
    </div>
  );
}

/** Ranking whose rows glide from their previous position (FLIP, transform only). */
export function Ranking({ title, entries, previous }: { title: string; entries: RankEntry[]; previous?: Map<string, number> }) {
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  useLayoutEffect(() => {
    const els = rows.current;
    entries.forEach((e, i) => {
      const el = els[i];
      if (!el) return;
      const before = previous?.get(e.nickname);
      const shift = before === undefined ? entries.length - i : before - i;
      if (!shift) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${shift * 110}%)`;
      el.style.opacity = before === undefined ? '0' : '1';
    });
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const el of els) {
          if (!el) continue;
          el.style.transition = 'transform .7s cubic-bezier(.2,.8,.2,1), opacity .5s';
          el.style.transform = '';
          el.style.opacity = '';
        }
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, [entries, previous]);
  return (
    <div className="mx-auto w-full max-w-4xl">
      <h2 className="mb-6 text-center text-5xl font-bold">{title}</h2>
      <ol className="space-y-3" data-testid="leaderboard">
        {entries.map((e, i) => (
          <li
            key={e.nickname}
            ref={(el) => {
              rows.current[i] = el;
            }}
            className={`flex items-center gap-5 rounded-lg px-6 py-4 text-3xl shadow-soft ${i === 0 ? 'bg-primary text-on-primary' : 'bg-panel'}`}
          >
            <span className="w-14 font-display font-bold tabular">{e.rank}.</span>
            <span className="flex-1 truncate font-semibold">{e.nickname}</span>
            <span className="font-display font-bold tabular">{e.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Podium: three columns 2–1–3 rising from the floor, then one burst of confetti. */
export function Podium({ podium, title }: { podium: RankEntry[]; title: string }) {
  const { t } = useTranslation();
  const heights = ['h-[36vh]', 'h-[26vh]', 'h-[19vh]'];
  const tones = ['bg-accent text-on-accent', 'bg-primary text-on-primary', 'bg-panel-2 text-fg'];
  return (
    <div className="flex flex-1 flex-col items-center justify-end gap-8">
      <Confetti />
      <div className="flex items-center gap-4">
        <Mascot pose="celebrate" size={120} />
        <h2 className="text-6xl font-bold">{title}</h2>
      </div>
      <div className="flex items-end gap-6" data-testid="podium">
        {[1, 0, 2].map((i) => {
          const p = podium[i];
          if (!p) return null;
          return (
            <div key={i} className="flex w-[min(18rem,26vw)] flex-col items-center">
              {i === 0 && <Crown aria-hidden="true" className="mb-1 h-12 w-12 text-accent" strokeWidth={2.5} />}
              <span className="mb-1 max-w-full truncate text-center text-3xl font-bold">{p.nickname}</span>
              <span className="mb-3 text-2xl text-muted tabular">{t('game.points', { count: p.score })}</span>
              <div className={`podium-col ${heights[i]} flex w-full items-start justify-center rounded-t-lg pt-4 font-display text-7xl font-bold ${tones[i]}`} style={{ animationDelay: `${[0.4, 0.2, 0][i]}s` }}>
                {i + 1}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function useFullscreen() {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const f = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);
  return { on, toggle };
}

export function FullscreenButton({ on, toggle }: { on: boolean; toggle: () => void }) {
  const { t } = useTranslation();
  const label = on ? t('game.exitFullscreen') : t('game.fullscreen');
  return (
    <button type="button" onClick={toggle} aria-label={label} title={`${label} (F)`} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-fg hover:bg-surface-2" data-testid="fullscreen">
      {on ? <Minimize aria-hidden="true" className="h-5 w-5" /> : <Maximize aria-hidden="true" className="h-5 w-5" />}
    </button>
  );
}

/** "?" – list of keyboard shortcuts. */
export function ShortcutsDialog({ open, onClose, keys }: { open: boolean; onClose: () => void; keys: [string, string][] }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} size="sm" title={t('game.shortcuts')}>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2" data-testid="shortcuts">
        {keys.map(([k, v]) => (
          <Row key={k} k={k}>
            {v}
          </Row>
        ))}
      </dl>
    </Dialog>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt>
        <kbd className="rounded-sm border border-line-strong bg-surface-2 px-2 py-0.5 font-mono text-sm">{k}</kbd>
      </dt>
      <dd>{children}</dd>
    </>
  );
}
