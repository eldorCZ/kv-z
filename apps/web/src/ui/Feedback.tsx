import type { ReactNode } from 'react';
import { Mascot } from './Mascot';

/** Placeholder while loading, instead of a spinner (V9.6). */
export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <span className={`skeleton block rounded-sm bg-surface-2 ${className}`} aria-hidden="true" />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Načítám">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface p-4">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/** Empty state with a call to action (V9.6). */
export function EmptyState({ title, text, action, icon }: { title: string; text?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface px-6 py-10 text-center" data-testid="empty-state">
      <span className="text-primary">{icon ?? <Mascot pose="sleep" size={112} />}</span>
      <p className="font-display text-xl font-bold">{title}</p>
      {text && <p className="max-w-md text-sm text-muted">{text}</p>}
      {action}
    </div>
  );
}

export function ProgressBar({ value, max = 100, label, tone = 'primary' }: { value: number; max?: number; label: string; tone?: 'primary' | 'success' | 'warning' }) {
  const pct = Math.max(0, Math.min(100, (100 * value) / max));
  const bar = { primary: 'bg-primary', success: 'bg-success-strong', warning: 'bg-warning-line' }[tone];
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2.5 w-full overflow-hidden rounded-pill bg-surface-2">
      <div className={`h-full rounded-pill ${bar} transition-[width] duration-[var(--motion-base)]`} ref={(el) => el?.style.setProperty('width', `${pct}%`)} />
    </div>
  );
}

/** Placeholder while a lazily loaded page arrives (V9.6). */
export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-6" aria-busy="true" data-testid="page-skeleton">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <SkeletonList rows={3} />
    </div>
  );
}
