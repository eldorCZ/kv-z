import * as RSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { useId } from 'react';
import { controlCls } from './Field';

export interface SelectOption {
  value: string;
  label: string;
}

// Radix reserves the empty string for "no value"; an "all" choice uses this stand-in internally
const EMPTY = '__all__';

/**
 * Select on Radix (Dodatek 5, point 4): arrows, typeahead, Enter and Esc from the keyboard, the label tied
 * through aria-labelledby. Same shape as the native select in Field: options, value, onChange, label.
 * An option with value "" is allowed (typically "Vše").
 */
export function Select({
  label,
  value,
  onChange,
  options,
  hideLabel = false,
  className = '',
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  hideLabel?: boolean;
  className?: string;
  testId?: string;
}) {
  const id = useId();
  const current = options.find((o) => o.value === value);
  return (
    <div className={`text-sm ${className}`}>
      <span id={`${id}-label`} className={hideLabel ? 'sr-only' : 'mb-1 block font-semibold text-fg'}>
        {label}
      </span>
      <RSelect.Root value={value === '' ? EMPTY : value} onValueChange={(v) => onChange(v === EMPTY ? '' : v)}>
        <RSelect.Trigger aria-labelledby={`${id}-label ${id}-value`} data-testid={testId} className={`${controlCls} inline-flex items-center justify-between gap-2 text-left`}>
          <span id={`${id}-value`} className="truncate">
            <RSelect.Value>{current?.label}</RSelect.Value>
          </span>
          <RSelect.Icon>
            <ChevronDown className="h-4 w-4 text-muted" aria-hidden="true" />
          </RSelect.Icon>
        </RSelect.Trigger>
        <RSelect.Portal>
          <RSelect.Content position="popper" sideOffset={4} className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line bg-surface text-fg shadow-soft">
            <RSelect.Viewport className="p-1">
              {options.map((o) => (
                <RSelect.Item
                  key={o.value}
                  value={o.value === '' ? EMPTY : o.value}
                  className="relative flex min-h-10 cursor-pointer items-center rounded-sm py-2 pr-3 pl-8 text-sm outline-none select-none data-[highlighted]:bg-surface-2 data-[state=checked]:font-semibold"
                >
                  <RSelect.ItemIndicator className="absolute left-2 inline-flex items-center">
                    <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                  </RSelect.ItemIndicator>
                  <RSelect.ItemText>{o.label}</RSelect.ItemText>
                </RSelect.Item>
              ))}
            </RSelect.Viewport>
          </RSelect.Content>
        </RSelect.Portal>
      </RSelect.Root>
    </div>
  );
}
