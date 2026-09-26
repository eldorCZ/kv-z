import * as RTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export const TooltipProvider = RTooltip.Provider;

/** Self-contained (own provider), so the student bundle does not carry Radix Tooltip (V11.2). */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <RTooltip.Provider>
    <RTooltip.Root delayDuration={300}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content sideOffset={6} className="z-50 max-w-xs rounded-sm bg-fg px-2 py-1 text-xs text-canvas shadow-soft">
          {content}
          <RTooltip.Arrow className="fill-fg" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
    </RTooltip.Provider>
  );
}
