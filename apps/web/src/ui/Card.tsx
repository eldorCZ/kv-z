import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** lighter surface and a small shadow on hover; never moves (Dodatek 5, point 2) */
  hoverable?: boolean;
  /** shrinks slightly while pressed (100 ms) */
  pressable?: boolean;
}

/** Surface card: flat in the calm mood, soft shadow in the playful one (V3.3). */
export function Card({ className = '', children, hoverable = false, pressable = false, ...props }: CardProps) {
  // one transition list for both, otherwise the two utilities overwrite each other's transition-property
  const transition = hoverable || pressable ? 'transition-[filter,box-shadow,transform] duration-100' : '';
  const hover = hoverable ? 'hover:shadow-sm hover:brightness-[1.04]' : '';
  const press = pressable ? 'active:scale-[0.98]' : '';
  return (
    <div className={`rounded-lg border border-line bg-surface text-fg shadow-soft ${transition} ${hover} ${press} ${className}`} {...props}>
      {children}
    </div>
  );
}

/**
 * Soft glow that follows the pointer (Dodatek 5, point 7; Aceternity "card hover effect" pattern, own code).
 * Meant for a single highlighted card. Primary colour at ~0.15 opacity; off with reduced motion.
 * Position goes through CSS variables set via CSSOM, so the CSP needs nothing new.
 */
export function CardGlow({ children, className = '', enabled = true }: { children: ReactNode; className?: string; enabled?: boolean }) {
  return (
    <div
      className={`group/glow relative ${className}`}
      onPointerMove={(e) => {
        if (!enabled) return;
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--glow-x', `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty('--glow-y', `${e.clientY - r.top}px`);
      }}
    >
      {children}
      {enabled && (
        <div
          aria-hidden="true"
          data-testid="card-glow"
          className="pointer-events-none absolute inset-0 z-[1] rounded-lg opacity-0 transition-opacity duration-200 group-hover/glow:opacity-15"
          style={{ background: 'radial-gradient(260px circle at var(--glow-x, 50%) var(--glow-y, 50%), var(--primary), transparent 70%)' }}
        />
      )}
    </div>
  );
}

export function CardHeader({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <h2 className="mr-auto text-lg font-bold">{title}</h2>
      {actions}
      {children}
    </div>
  );
}
