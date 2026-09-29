import type { ReactNode } from 'react';

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-5 border-b border-line-subtle pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-extrabold tracking-[0.12em] text-primary uppercase">{eyebrow}</p>}
        <h1 className="text-[clamp(1.75rem,3vw,2.25rem)] leading-tight font-bold tracking-[-0.02em] text-fg">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted sm:text-base">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Toolbar({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface p-3 shadow-[0_1px_2px_rgb(27_22_64/0.03)] sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {meta && <div className="shrink-0 px-1 text-sm text-muted">{meta}</div>}
    </div>
  );
}
