import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '../api';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

const variants: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  ghost: 'text-slate-700 hover:bg-slate-100',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...props} className={`inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${variants[variant]} ${className}`} />;
}

export function Badge({ tone, children }: { tone: 'ok' | 'flagged' | 'approved' | 'neutral'; children: ReactNode }) {
  const cls = {
    ok: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    approved: 'bg-sky-100 text-sky-800 border-sky-300',
    flagged: 'bg-amber-100 text-amber-900 border-amber-400',
    neutral: 'bg-slate-100 text-slate-700 border-slate-300',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function ErrorBox({ error, onClose }: { error: ApiError | Error | string | null; onClose?: () => void }) {
  const { t } = useTranslation();
  if (!error) return null;
  const msg = typeof error === 'string' ? error : error.message;
  const details = typeof error === 'object' && 'errors' in error ? error.errors : [];
  return (
    <div role="alert" className="my-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <div className="flex items-start gap-2">
        <p className="flex-1 font-medium">{msg}</p>
        {onClose && (
          <button className="text-red-700 hover:underline" onClick={onClose}>
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="mt-10 w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl outline-none">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="rounded px-2 text-2xl leading-none text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Zavřít">
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
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';

export function formatDate(ms: number | null | undefined) {
  if (!ms) return '–';
  return new Date(ms).toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
}
