import * as RTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

/** Accessible tabs (Radix, arrow keys). `value`/`onChange` keep the tab in the URL where needed. */
export function Tabs({ value, onChange, items, label, children }: { value: string; onChange: (v: string) => void; items: { value: string; label: ReactNode; testId?: string }[]; label: string; children?: ReactNode }) {
  return (
    <RTabs.Root value={value} onValueChange={onChange} activationMode="manual">
      <RTabs.List aria-label={label} className="no-print flex flex-wrap gap-1 border-b border-line">
        {items.map((it) => (
          <RTabs.Trigger
            key={it.value}
            value={it.value}
            data-testid={it.testId}
            className="-mb-px min-h-11 border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-muted transition-colors hover:text-fg data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            {it.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}

export const TabPanel = ({ value, children }: { value: string; children: ReactNode }) => (
  <RTabs.Content value={value} className="pt-4 focus-visible:outline-none">
    {children}
  </RTabs.Content>
);
