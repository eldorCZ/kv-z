import * as RSwitch from '@radix-ui/react-switch';
import { useId, type ReactNode } from 'react';

export function Switch({ checked, onChange, label, hint, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string; disabled?: boolean; testId?: string }) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center gap-3">
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        data-testid={testId}
        className="relative h-7 w-12 shrink-0 rounded-pill border border-line-strong bg-surface-2 transition-colors duration-[var(--motion-fast)] data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:opacity-50"
      >
        <RSwitch.Thumb className="block h-5 w-5 translate-x-1 rounded-full bg-fg transition-transform duration-[var(--motion-fast)] data-[state=checked]:translate-x-6 data-[state=checked]:bg-on-primary" />
      </RSwitch.Root>
      <label htmlFor={id} className="text-sm">
        <span className="font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </label>
    </div>
  );
}
