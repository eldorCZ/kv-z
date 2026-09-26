import { AlertTriangle, CheckCircle2, Circle, Info, ShieldCheck, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export type BadgeTone = 'ok' | 'flagged' | 'approved' | 'neutral' | 'danger' | 'info';

const TONE: Record<BadgeTone, [string, typeof Circle]> = {
  ok: ['bg-success-soft text-success border-success', CheckCircle2],
  approved: ['bg-info-soft text-info border-info', ShieldCheck],
  flagged: ['bg-warning-soft text-warning border-warning-line', AlertTriangle],
  danger: ['bg-danger-soft text-danger border-danger', XCircle],
  info: ['bg-info-soft text-info border-info', Info],
  neutral: ['bg-surface-2 text-fg border-line-strong', Circle],
};

/** State badge: always icon AND text, never colour alone (V9.1, V11.1). */
export function Badge({ tone, children, icon = true }: { tone: BadgeTone; children: ReactNode; icon?: boolean }) {
  const [cls, Icon] = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
}
