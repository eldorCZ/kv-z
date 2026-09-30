import * as RSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { useId } from 'react';
import { controlCls } from './Field';

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Rozbalovací výběr nad Radixem (Dodatek 5/4).
 *
 * Nativní `<select>` z `Field.tsx` zůstává tam, kde je v pořádku — tenhle je pro filtry
 * v galerii, kde potřebujeme stejný vzhled ve všech prohlížečích. Radix dodává ovládání
 * klávesnicí (šipky, Enter, Esc, psaní písmen) a správné role, sami dopisujeme jen vzhled.
 *
 * `label` se váže přes `aria-labelledby`, ne jako `<label for>`: spouštěč je tlačítko,
 * ne formulářové pole, takže `for` by na něj neukázalo.
 */
export function SelectMenu({
  value,
  onChange,
  options,
  label,
  className = '',
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  label: string;
  className?: string;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <span id={id} className="shrink-0 text-sm text-muted">
        {label}
      </span>
      <RSelect.Root value={value} onValueChange={onChange}>
        <RSelect.Trigger className={`${controlCls} flex w-auto items-center justify-between gap-2`} aria-labelledby={id} data-testid={testId}>
          <RSelect.Value />
          <RSelect.Icon>
            <ChevronDown className="h-4 w-4 text-muted" aria-hidden="true" />
          </RSelect.Icon>
        </RSelect.Trigger>
        <RSelect.Portal>
          <RSelect.Content position="popper" sideOffset={4} className="dialog-content z-50 overflow-hidden rounded-md border border-line bg-surface text-fg shadow-soft">
            <RSelect.Viewport className="p-1">
              {options.map((o) => (
                <RSelect.Item
                  key={o.value}
                  value={o.value}
                  className="flex min-h-11 cursor-pointer select-none items-center gap-2 rounded px-3 text-sm outline-none data-[highlighted]:bg-surface-2 data-[state=checked]:font-semibold"
                >
                  <RSelect.ItemIndicator>
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
