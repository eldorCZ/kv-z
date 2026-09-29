import type { HTMLAttributes, ReactNode } from 'react';

type CardVariant = 'plain' | 'interactive' | 'metric';

const VARIANT: Record<CardVariant, string> = {
  plain: 'border-line bg-surface',
  interactive: 'border-line bg-surface transition-[border-color,box-shadow,transform] duration-[var(--motion-base)] hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-soft',
  metric: 'border-line-subtle bg-surface shadow-soft',
};

/** Shared surface. Elevation is opt-in in focus mood and stronger only for play screens. */
export function Card({ className = '', children, variant = 'plain', ...props }: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant }) {
  return (
    <div className={`rounded-lg border text-fg ${VARIANT[variant]} ${className}`} {...props}>
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

export function CardContent({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-5 ${className}`} {...props}>{children}</div>;
}

export function CardFooter({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`border-t border-line-subtle px-5 py-3 ${className}`} {...props}>{children}</div>;
}
