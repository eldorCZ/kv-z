import type { ReactNode } from 'react';

/** Small label + value card for a row of statistics (Dodatek 5, point 5). */
export function StatCard({ label, value, icon, hint, testId }: { label: string; value: ReactNode; icon?: ReactNode; hint?: string; testId?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-4 text-fg" data-testid={testId}>
      {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-on-primary-soft">{icon}</span>}
      <div className="min-w-0">
        <p className="text-sm text-muted">{label}</p>
        <p className="font-display text-2xl leading-tight font-bold tabular">{value}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
}
