import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export const controlCls =
  'w-full min-h-11 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-primary focus:outline-none focus-visible:outline-3 focus-visible:outline-focus disabled:opacity-60';

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-fg">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && (
        <span className="mt-1 block text-xs font-semibold text-danger" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...p }, ref) {
  return <input ref={ref} className={`${controlCls} ${className}`} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...p }, ref) {
  return <textarea ref={ref} className={`${controlCls} ${className}`} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', ...p }, ref) {
  return <select ref={ref} className={`${controlCls} ${className}`} {...p} />;
});

/** Native checkbox / radio with the accent colour and a 44 px touch row. */
export function Check({ label, type = 'checkbox', className = '', ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-2 text-sm ${className}`}>
      <input type={type} className="h-5 w-5 shrink-0 accent-[var(--primary)]" {...p} />
      <span>{label}</span>
    </label>
  );
}
