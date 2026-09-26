import type { HTMLAttributes, ReactNode } from 'react';

/** Surface card: flat in the calm mood, soft shadow in the playful one (V3.3). */
export function Card({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-lg border border-line bg-surface text-fg shadow-soft ${className}`} {...props}>
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
