/** Colour by threshold (Dodatek 5, point 5): ≥ 75 % success, 50–74 % warning, below 50 % danger. */
export function progressTone(value: number): 'success' | 'warning' | 'danger' {
  return value >= 75 ? 'success' : value >= 50 ? 'warning' : 'danger';
}

const FILL = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' } as const;

/**
 * Bar 0–100 %. Colour only supports the number shown next to it (never the only carrier, V11.1);
 * the accessible name and value come from `label` and role="progressbar".
 */
export function Progress({ value, label, className = '' }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const tone = progressTone(v);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      data-tone={tone}
      className={`h-2 w-full overflow-hidden rounded-pill bg-surface-2 ${className}`}
    >
      <div className={`h-full rounded-pill ${FILL[tone]}`} style={{ width: `${v}%` }} />
    </div>
  );
}
