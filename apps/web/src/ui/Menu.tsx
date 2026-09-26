import * as RMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';

export function Menu({ trigger, items }: { trigger: ReactNode; items: { label: ReactNode; onSelect: () => void; danger?: boolean; icon?: ReactNode; testId?: string }[] }) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content sideOffset={6} align="end" className="z-50 min-w-48 rounded-md border border-line bg-surface p-1 text-fg shadow-soft">
          {items.map((it, i) => (
            <RMenu.Item
              key={i}
              onSelect={it.onSelect}
              data-testid={it.testId}
              className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-surface-2 ${it.danger ? 'text-danger' : ''}`}
            >
              {it.icon}
              {it.label}
            </RMenu.Item>
          ))}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}
