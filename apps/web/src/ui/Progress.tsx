/**
 * Pruh úspěšnosti 0–100 % (Dodatek 5/5).
 *
 * Barva je jen doprovod, ne nositel informace — číslo je vždy vedle pruhu napsané.
 * Prahy: 75 % a výš zelená, 50–74 % jantarová, pod 50 % červená; všechno z existujících
 * tokenů, žádná nová barva.
 */
export function Progress({ value, label, className = '' }: { value: number; label: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const barva = pct >= 75 ? 'bg-success-strong' : pct >= 50 ? 'bg-warning' : 'bg-danger';
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-pill bg-panel-2 ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      {/* šířku měníme plynule, ale při omezeném pohybu skočí rovnou na cíl */}
      <div className={`h-full rounded-pill transition-[width] duration-[var(--motion-base)] motion-reduce:transition-none ${barva}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
