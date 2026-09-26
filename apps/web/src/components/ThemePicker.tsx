import { ACCENTS, DEFAULT_ACCENT, MOTIVE_CATEGORIES, MOTIVE_LIST, accentVars, getMotive, hashSeed, motiveDataUrl, type MotiveCategory } from '@kvizhub/core';
import { Check, Leaf, Monitor, Moon, Shuffle, Smartphone, Sun } from 'lucide-react';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MotiveLayers } from '../game/Stage';
import { usePrefs } from '../theme/prefs';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { AnswerMark, answerStyle } from './Shapes';

/** Look of a quiz or a game as stored on the server (V7.4). null = Jiskra default. */
export type Look = { motive?: string; accent?: string; imageId?: string } | null;

const thumbs = new Map<string, string>();
/** Small picture of a motive; the same function as the full background, only scaled down (V6.1). */
export function motiveThumb(id: string, scheme: 'light' | 'dark'): string {
  const key = `${id}:${scheme}`;
  let url = thumbs.get(key);
  if (!url) {
    url = motiveDataUrl(id, { seed: hashSeed(id), scheme });
    thumbs.set(key, url);
  }
  return url;
}

export function lookName(look: Look, t: (k: string) => string): string {
  const m = getMotive(look?.motive);
  const a = ACCENTS.find((x) => x.id === look?.accent && x.id !== DEFAULT_ACCENT);
  if (!m && !a) return t('theme.default');
  return [m?.name, a?.name].filter(Boolean).join(' · ');
}

export interface PickerAction {
  id: string;
  label: string;
  primary?: boolean;
  testId: string;
}

type Filter = 'all' | 'calm' | MotiveCategory;
type Screen = 'lobby' | 'question' | 'test';

/**
 * Theme picker (V7.1): motive grid with category filter and "Náhodný", accents, and a live preview of the
 * lobby, a question and a test through the student's eyes, light or dark, phone or projector.
 */
export function ThemePicker({
  title,
  value,
  onClose,
  actions,
  onAction,
  testMode = false,
}: {
  title?: string;
  value: Look;
  onClose: () => void;
  actions: PickerAction[];
  onAction: (action: string, look: Look) => void | Promise<void>;
  /** the game will be a test: suggest calm motives and preview the test first */
  testMode?: boolean;
}) {
  const { t } = useTranslation();
  const { theme } = usePrefs();
  const [motive, setMotive] = useState<string | undefined>(value?.motive);
  const [accent, setAccent] = useState<string | undefined>(value?.accent);
  const [filter, setFilter] = useState<Filter>(testMode ? 'calm' : 'all');
  const [screen, setScreen] = useState<Screen>(testMode ? 'test' : 'lobby');
  const [device, setDevice] = useState<'phone' | 'projector'>('projector');
  const [scheme, setScheme] = useState<'light' | 'dark'>(theme);
  const [busy, setBusy] = useState('');

  const list = useMemo(() => MOTIVE_LIST.filter((m) => filter === 'all' || (filter === 'calm' ? m.calm : m.category === filter)), [filter]);
  const look: Look = motive || accent ? { ...(motive ? { motive } : {}), ...(accent && accent !== DEFAULT_ACCENT ? { accent } : {}), ...(value?.imageId && motive === value.motive ? { imageId: value.imageId } : {}) } : null;
  const random = () => {
    const pool = list.filter((m) => m.id !== motive);
    if (pool.length) setMotive(pool[Math.floor(Math.random() * pool.length)]!.id);
  };
  const chosen = getMotive(motive);

  return (
    <Dialog title={title ?? t('theme.title')} onClose={onClose} size="lg">
      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,22rem)]" data-testid="theme-picker">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('theme.motive')}>
            {(['all', 'calm', ...MOTIVE_CATEGORIES.map((c) => c.id)] as Filter[]).map((f) => (
              <Chip key={f} on={filter === f} onClick={() => setFilter(f)} testId={`theme-filter-${f}`}>
                {f === 'all' ? t('theme.all') : f === 'calm' ? t('theme.calm') : MOTIVE_CATEGORIES.find((c) => c.id === f)!.name}
              </Chip>
            ))}
            <Button size="sm" variant="ghost" icon={<Shuffle aria-hidden="true" className="h-4 w-4" />} onClick={random} data-testid="theme-random" className="ml-auto">
              {t('theme.random')}
            </Button>
          </div>
          {testMode && <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">{t('theme.calmHint')}</p>}
          <div role="radiogroup" aria-label={t('theme.motive')} className="grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3" data-testid="motive-grid">
            <Tile on={!motive} onClick={() => setMotive(undefined)} testId="motive-default" label={t('theme.default')} hint={t('theme.defaultHint')}>
              <img src={motiveThumb(testMode ? 'papir' : 'mlha', scheme)} alt="" className="h-full w-full object-cover" />
            </Tile>
            {list.map((m) => (
              <Tile key={m.id} on={motive === m.id} onClick={() => setMotive(m.id)} testId={`motive-${m.id}`} label={m.name} calm={m.calm} calmLabel={t('theme.calm')}>
                <img src={motiveThumb(m.id, scheme)} alt="" loading="lazy" className="h-full w-full object-cover" />
              </Tile>
            ))}
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold" id="accent-label">
              {t('theme.accent')}
            </p>
            <div role="radiogroup" aria-labelledby="accent-label" className="flex flex-wrap gap-2">
              {ACCENTS.map((a) => {
                const on = (accent ?? DEFAULT_ACCENT) === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={a.name}
                    title={a.name}
                    data-testid={`accent-${a.id}`}
                    onClick={() => setAccent(a.id === DEFAULT_ACCENT ? undefined : a.id)}
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-pill border-2 ${on ? 'border-fg' : 'border-transparent'}`}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-pill" style={{ background: a.tokens[scheme].primary }}>
                      {on && <Check aria-hidden="true" className="h-4 w-4" style={{ color: scheme === 'dark' ? '#0f0b2a' : '#ffffff' }} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <figure className="space-y-2">
          <figcaption className="text-sm font-semibold">{t('theme.preview')}</figcaption>
          <div className="flex flex-wrap items-center gap-1">
            {(['lobby', 'question', 'test'] as Screen[]).map((s) => (
              <Chip key={s} on={screen === s} onClick={() => setScreen(s)} testId={`preview-${s}`}>
                {t(`theme.screens.${s}`)}
              </Chip>
            ))}
            <span className="ml-auto flex gap-1">
              <Toggle on={device === 'phone'} onClick={() => setDevice('phone')} label={t('preview.phone')}>
                <Smartphone className="h-4 w-4" aria-hidden="true" />
              </Toggle>
              <Toggle on={device === 'projector'} onClick={() => setDevice('projector')} label={t('preview.projector')}>
                <Monitor className="h-4 w-4" aria-hidden="true" />
              </Toggle>
              <Toggle on={scheme === 'light'} onClick={() => setScheme('light')} label={t('appearance.scheme.light')}>
                <Sun className="h-4 w-4" aria-hidden="true" />
              </Toggle>
              <Toggle on={scheme === 'dark'} onClick={() => setScheme('dark')} label={t('appearance.scheme.dark')}>
                <Moon className="h-4 w-4" aria-hidden="true" />
              </Toggle>
            </span>
          </div>
          <LookPreview look={look} screen={screen} device={device} scheme={scheme} />
          <p className="text-sm text-muted" data-testid="theme-chosen">
            {lookName(look, t)}
            {chosen?.calm && ` · ${t('theme.calm')}`}
          </p>
        </figure>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        {actions.map((a) => (
          <Button
            key={a.id}
            variant={a.primary ? 'primary' : 'secondary'}
            loading={busy === a.id}
            data-testid={a.testId}
            onClick={async () => {
              setBusy(a.id);
              try {
                await onAction(a.id, look);
              } finally {
                setBusy('');
              }
            }}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}

/** Miniature of the lobby, a question or a test with the chosen look (V7.1). */
export function LookPreview({ look, screen, device, scheme }: { look: Look; screen: Screen; device: 'phone' | 'projector'; scheme: 'light' | 'dark' }) {
  const { t } = useTranslation();
  const test = screen === 'test';
  const phone = device === 'phone';
  const options = t('theme.sample.options', { returnObjects: true }) as string[];
  return (
    <div
      data-theme={scheme}
      data-mood={test ? 'focus' : 'play'}
      data-testid="theme-preview"
      aria-hidden="true"
      style={accentVars(look?.accent, scheme) as CSSProperties}
      className={`relative isolate overflow-hidden border-4 border-fg/80 bg-canvas text-fg ${phone ? 'mx-auto aspect-[9/17] w-full max-w-[220px] rounded-[26px]' : 'aspect-video w-full rounded-md'}`}
    >
      <MotiveLayers theme={{ motive: look?.motive, accent: look?.accent, scrimHint: test ? 'strong' : 'normal' }} seed={hashSeed('482913')} scheme={scheme} mood={test ? 'focus' : 'play'} position="absolute" />
      <div className={`flex h-full flex-col gap-2 ${phone ? 'p-3' : 'p-4'}`}>
        {screen === 'lobby' && (
          <>
            <div className="rounded-md bg-panel p-2 text-center shadow-pop">
              <p className="text-[9px] text-muted">PIN</p>
              <p className={`font-display leading-none font-bold tracking-widest tabular ${phone ? 'text-2xl' : 'text-4xl'}`}>482 913</p>
            </div>
            <p className="self-start rounded-sm bg-panel px-2 py-0.5 text-[10px]">{t('theme.sample.waiting')}</p>
            <div className="flex flex-wrap gap-1">
              {['novak12', 'mala4', 'erben7'].map((n) => (
                <span key={n} className="rounded-pill bg-panel px-2 py-0.5 text-[10px] font-semibold shadow-soft">
                  {n}
                </span>
              ))}
            </div>
            <span className="mt-auto self-end rounded-md bg-accent px-3 py-1 text-[10px] font-bold text-on-accent">▶</span>
          </>
        )}
        {screen === 'question' && (
          <>
            <div className="h-1 overflow-hidden rounded-pill bg-panel-2">
              <div className="h-full w-2/3 rounded-pill bg-primary" />
            </div>
            <p className={`rounded-md bg-panel p-2 font-display leading-snug font-bold ${phone ? 'text-xs' : 'text-sm'}`}>{t('theme.sample.prompt')}</p>
            <div className={`mt-auto grid gap-1 ${phone ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {options.map((o, i) => {
                const s = answerStyle(i);
                return (
                  <div key={i} className={`flex min-h-7 items-center gap-1.5 rounded-sm px-2 py-1 text-[10px] font-bold ${s.bg} ${s.fg}`}>
                    <AnswerMark index={i} size="sm" />
                    {o}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {test && (
          <>
            <div className="flex items-center justify-between rounded-sm bg-panel px-2 py-1 text-[10px] font-semibold">
              <span>{t('theme.sample.test')}</span>
              <span className="tabular">18:42</span>
            </div>
            <div className="rounded-md bg-panel p-2">
              <p className={`mb-1.5 font-semibold ${phone ? 'text-[11px]' : 'text-xs'}`}>{t('theme.sample.prompt')}</p>
              <div className="space-y-1">
                {options.map((o, i) => (
                  <div key={i} className="rounded-sm border border-line-strong px-2 py-0.5 text-[10px]">
                    {String.fromCharCode(65 + i)}. {o}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      data-testid={testId}
      className={`min-h-9 rounded-pill border px-3 text-sm font-semibold ${on ? 'border-primary bg-primary-soft text-on-primary-soft' : 'border-line text-fg hover:bg-surface-2'}`}
    >
      {children}
    </button>
  );
}

function Toggle({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border ${on ? 'border-primary bg-primary-soft text-on-primary-soft' : 'border-line text-muted hover:bg-surface-2'}`}
    >
      {children}
    </button>
  );
}

function Tile({ on, onClick, label, hint, calm, calmLabel, testId, children }: { on: boolean; onClick: () => void; label: string; hint?: string; calm?: boolean; calmLabel?: string; testId: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      data-testid={testId}
      title={hint}
      className={`group overflow-hidden rounded-md border-2 bg-surface text-left ${on ? 'border-primary ring-2 ring-primary' : 'border-line hover:border-line-strong'}`}
    >
      <span className="block aspect-video overflow-hidden">{children}</span>
      <span className="flex items-center gap-1 px-2 py-1 text-sm font-semibold">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {calm && <Leaf aria-label={calmLabel} className="h-4 w-4 shrink-0 text-success" />}
        {on && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" strokeWidth={3} />}
      </span>
    </button>
  );
}
