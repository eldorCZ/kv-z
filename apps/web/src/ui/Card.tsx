import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Surface card: flat in the calm mood, soft shadow in the playful one (V3.3).
 *
 * `hoverable` / `pressable` (Dodatek 5/2) jsou dobrovolné. Karta se pod myší jen
 * prosvětlí a přidá stín — schválně **žádný posun ani zvětšení**: v mřížce kvízů
 * by sebou sousedi cukali. Stisk je jediná výjimka, tam drobné zmáčknutí dává
 * zpětnou vazbu na dotykovém displeji.
 */
export function Card({ className = '', hoverable = false, pressable = false, children, ...props }: HTMLAttributes<HTMLDivElement> & { hoverable?: boolean; pressable?: boolean }) {
  const chovani = [
    hoverable ? 'transition-[background-color,box-shadow] duration-[var(--motion-fast)] hover:bg-surface-2 hover:shadow-sm' : '',
    pressable ? 'transition-transform duration-100 active:scale-[0.98] motion-reduce:active:scale-100' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={`rounded-lg border border-line bg-surface text-fg shadow-soft ${chovani} ${className}`} {...props}>
      {children}
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
