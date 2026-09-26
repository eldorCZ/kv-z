import * as Popover from '@radix-ui/react-popover';
import { MonitorSmartphone, Moon, Sun } from 'lucide-react';
import { useEffect } from 'react';
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

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-pill border border-line bg-surface px-2 text-fg hover:bg-surface-2 ${className}`}
          aria-label={t('appearance.button', { value: t(`appearance.scheme.${prefs.scheme}`) })}
          title={t('appearance.button', { value: t(`appearance.scheme.${prefs.scheme}`) })}
          data-testid="scheme-switcher"
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="end"
          className="z-50 w-72 space-y-3 rounded-md border border-line bg-surface p-4 text-fg shadow-soft"
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
          <Popover.Arrow className="fill-surface" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
