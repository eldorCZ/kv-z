import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '../api';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover disabled:opacity-50',
  secondary: 'border border-line-strong bg-surface text-fg hover:bg-surface-2 disabled:opacity-50',
  danger: 'bg-danger text-on-danger hover:brightness-95 disabled:opacity-50',
  success: 'bg-success-strong text-on-success hover:brightness-95 disabled:opacity-50',
  ghost: 'text-fg hover:bg-surface-2',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...props} className={`inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${variants[variant]} ${className}`} />;
}

export function Badge({ tone, children }: { tone: 'ok' | 'flagged' | 'approved' | 'neutral'; children: ReactNode }) {
  const cls = {
    ok: 'bg-success-soft text-success border-success',
    approved: 'bg-info-soft text-info border-info',
    flagged: 'bg-warning-soft text-warning border-warning-line',
    neutral: 'bg-surface-2 text-fg border-line-strong',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function ErrorBox({ error, onClose }: { error: ApiError | Error | string | null; onClose?: () => void }) {
  const { t } = useTranslation();
  if (!error) return null;
  const msg = typeof error === 'string' ? error : error.message;
  const details = typeof error === 'object' && 'errors' in error ? error.errors : [];
  return (
    <div role="alert" className="my-3 rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">
      <div className="flex items-start gap-2">
        <p className="flex-1 font-medium">{msg}</p>
        {onClose && (
          <button className="text-danger hover:underline" onClick={onClose}>
            {t('common.close')}
          </button>
        )}
      </div>
      {details.length > 0 && (
        <ul className="mt-2 list-disc pl-5">
          {details.map((d, i) => (
            <li key={i}>
              <code className="text-xs">{d.path}</code>: {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="mt-10 w-full max-w-2xl rounded-lg bg-surface p-5 shadow-xl outline-none">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="rounded px-2 text-2xl leading-none text-muted hover:bg-surface-2" onClick={onClose} aria-label="Zavřít">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-md border border-line-strong px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft';

export function formatDate(ms: number | null | undefined) {
  if (!ms) return '–';
  return new Date(ms).toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
}
