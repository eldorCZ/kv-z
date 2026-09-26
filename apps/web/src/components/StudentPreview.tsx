import type { QuestionType } from '@kvizhub/core';
import { Monitor, Moon, Smartphone, Sun } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrefs } from '../theme/prefs';
import { AnswerMark, answerStyle } from './Shapes';

export interface PreviewQuestion {
  type: QuestionType;
  prompt: string;
  options: string[];
  timeLimitSec: number;
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

/** The question as a student (phone) or the projector sees it, in light or dark mode (V7.2, V9.2). */
export function StudentPreview({ q, index = 0, total = 1, background }: { q: PreviewQuestion; index?: number; total?: number; background?: ReactNode }) {
  const { t } = useTranslation();
  const { theme } = usePrefs();
  const [device, setDevice] = useState<'phone' | 'projector'>('phone');
  const [scheme, setScheme] = useState<'light' | 'dark'>(theme);
  const choice = q.type === 'single' || q.type === 'multi' || q.type === 'truefalse';
  const phone = device === 'phone';

  return (
    <figure className="space-y-2" aria-label={t('preview.title')}>
      <figcaption className="flex items-center gap-1">
        <span className="mr-auto text-sm font-semibold">{t('preview.title')}</span>
        <Toggle on={phone} onClick={() => setDevice('phone')} label={t('preview.phone')}>
          <Smartphone className="h-4 w-4" aria-hidden="true" />
        </Toggle>
        <Toggle on={!phone} onClick={() => setDevice('projector')} label={t('preview.projector')}>
          <Monitor className="h-4 w-4" aria-hidden="true" />
        </Toggle>
        <Toggle on={scheme === 'light'} onClick={() => setScheme('light')} label={t('appearance.scheme.light')}>
          <Sun className="h-4 w-4" aria-hidden="true" />
        </Toggle>
        <Toggle on={scheme === 'dark'} onClick={() => setScheme('dark')} label={t('appearance.scheme.dark')}>
          <Moon className="h-4 w-4" aria-hidden="true" />
        </Toggle>
      </figcaption>
      <div
        data-theme={scheme}
        data-mood="play"
        data-testid="student-preview"
        className={`relative overflow-hidden border-4 border-fg/80 bg-canvas text-fg ${phone ? 'mx-auto aspect-[9/17] w-full max-w-[260px] rounded-[28px]' : 'aspect-video w-full rounded-md'}`}
        aria-hidden="true"
      >
        {background && <div className="absolute inset-0">{background}</div>}
        <div className={`relative flex h-full flex-col gap-2 ${phone ? 'p-3' : 'p-4'}`}>
          <div className="flex items-center justify-between text-[10px] font-semibold text-muted">
            <span className="tabular">
              {index + 1}/{total}
            </span>
            <span className="tabular">{q.timeLimitSec} s</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-pill bg-surface-2">
            <div className="h-full w-2/3 rounded-pill bg-primary" />
          </div>
          <p className={`rounded-md bg-surface/95 p-2 font-display font-bold leading-snug ${phone ? 'text-sm' : 'text-lg'}`}>{q.prompt || '…'}</p>
          {choice && (
            <div className={`mt-auto grid gap-1.5 ${phone ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {q.options.map((o, i) => {
                const s = answerStyle(i);
                return (
                  <div key={i} className={`flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold ${s.bg} ${s.fg}`}>
                    <AnswerMark index={i} size="sm" />
                    <span className="line-clamp-2">{o || '…'}</span>
                  </div>
                );
              })}
            </div>
          )}
          {(q.type === 'short' || q.type === 'numeric') && (
            <div className="mt-auto space-y-1.5">
              <div className="h-9 rounded-md border border-line-strong bg-surface" />
              <div className="flex h-9 items-center justify-center rounded-md bg-primary text-xs font-bold text-on-primary">{t('preview.send')}</div>
            </div>
          )}
          {q.type === 'order' && (
            <ol className="mt-auto space-y-1">
              {q.options.map((o, i) => (
                <li key={i} className="rounded-md border border-line bg-surface px-2 py-1 text-xs">
                  {o || '…'}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </figure>
  );
}
