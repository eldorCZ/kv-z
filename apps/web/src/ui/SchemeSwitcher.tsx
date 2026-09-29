import { MonitorSmartphone, Moon, Sun } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { usePrefs } from '../theme/prefs';

const ICON = { system: MonitorSmartphone, light: Sun, dark: Moon } as const;

function Choice<T extends string>({ label, value, options, onChange, name }: { label: string; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; name: string }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            onClick={() => onChange(o.v)}
            data-testid={`${name}-${o.v}`}
            className={`min-h-9 rounded-pill border px-3 text-sm ${value === o.v ? 'border-primary bg-primary-soft font-semibold text-on-primary-soft' : 'border-line bg-surface text-fg hover:bg-surface-2'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * "Vzhled" button with a popover: colour scheme, reduced motion, readable font (Dodatek 4, V5.1, V5.2).
 * `hotkey` enables the T key (host screen).
 */
export function SchemeSwitcher({ hotkey = false, className = '' }: { hotkey?: boolean; className?: string }) {
  const { t } = useTranslation();
  const { prefs, setPrefs } = usePrefs();
  const Icon = ICON[prefs.scheme];

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 't' && e.key !== 'T') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const order = ['system', 'light', 'dark'] as const;
      setPrefs({ scheme: order[(order.indexOf(prefs.scheme) + 1) % order.length] });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey, prefs.scheme, setPrefs]);

  // a light disclosure instead of a popover library: this button is on every student screen (V11.2)
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  // Panel visí na <body> a pozicuje se podle tlačítka. Kdyby byl jen `absolute` pod tlačítkem,
  // v učitelském menu (tlačítko vlevo dole) by vyjel pod spodní hranu okna a doleva mimo obrazovku.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const b = button.current?.getBoundingClientRect();
      const p = panel.current?.getBoundingClientRect();
      if (!b || !p) return;
      const m = 8;
      const vh = window.innerHeight;
      const dolu = b.bottom + m;
      const nahoru = b.top - m - p.height;
      // pod tlačítko, když se tam vejde; jinak nad něj; a když se nevejde nikam (nízké okno),
      // aspoň přilepit k hornímu okraji – panel má vlastní scrollování
      const top = dolu + p.height <= vh - m ? dolu : nahoru >= m ? nahoru : Math.max(m, vh - m - p.height);
      const left = Math.min(Math.max(m, b.right - p.width), Math.max(m, window.innerWidth - p.width - m));
      setPos({ top, left });
    };
    place();
    // přepnutí na čitelné písmo panel zvětší – jinak by po té změně vyjel z okna
    const ro = new ResizeObserver(place);
    if (panel.current) ro.observe(panel.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const cil = e.target as Node;
      if (!box.current?.contains(cil) && !panel.current?.contains(cil)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={box} className="relative inline-block">
      <button
        ref={button}
        type="button"
        className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-pill border border-line bg-surface px-2 text-fg hover:bg-surface-2 ${className}`}
        aria-label={t('appearance.button', { value: t(`appearance.scheme.${prefs.scheme}`) })}
        title={t('appearance.button', { value: t(`appearance.scheme.${prefs.scheme}`) })}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        data-testid="scheme-switcher"
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="group"
            aria-label={t('appearance.title')}
            className="dialog-content fixed z-50 max-h-[calc(100dvh-1rem)] w-72 max-w-[calc(100vw-1rem)] space-y-3 overflow-auto rounded-md border border-line bg-surface p-4 text-left text-fg shadow-soft"
            // než se změří, drží se mimo obraz – jinak by problikl vlevo nahoře
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? undefined : 'hidden' }}
            data-testid="appearance-popover"
          >
            <p className="font-display text-lg font-bold">{t('appearance.title')}</p>
            <Choice
              name="scheme"
              label={t('appearance.schemeLabel')}
              value={prefs.scheme}
              onChange={(scheme) => setPrefs({ scheme })}
              options={(['system', 'light', 'dark'] as const).map((v) => ({ v, label: t(`appearance.scheme.${v}`) }))}
            />
            <Choice
              name="motion"
              label={t('appearance.motionLabel')}
              value={prefs.motion}
              onChange={(motion) => setPrefs({ motion })}
              options={(['system', 'reduce', 'full'] as const).map((v) => ({ v, label: t(`appearance.motion.${v}`) }))}
            />
            <Choice
              name="font"
              label={t('appearance.fontLabel')}
              value={prefs.font}
              onChange={(font) => setPrefs({ font })}
              options={(['default', 'readable'] as const).map((v) => ({ v, label: t(`appearance.font.${v}`) }))}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
