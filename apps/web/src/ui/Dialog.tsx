import * as RDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Modal dialog (Radix: focus trap, Esc, focus return). `side` renders it as a sheet from the right. */
export function Dialog({ title, open = true, onClose, children, size = 'md', side = false, description }: { title: string; open?: boolean; onClose: () => void; children: ReactNode; size?: 'sm' | 'md' | 'lg'; side?: boolean; description?: string }) {
  const { t } = useTranslation();
  const width = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' }[size];
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-black/50" />
        <RDialog.Content
          aria-describedby={description ? undefined : undefined}
          className={
            side
              ? 'dialog-sheet fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col overflow-y-auto border-l border-line bg-surface p-5 text-fg shadow-soft focus:outline-none'
              : `dialog-content fixed left-1/2 top-[5vh] z-50 max-h-[90vh] w-[calc(100%-2rem)] ${width} -translate-x-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-5 text-fg shadow-soft focus:outline-none`
          }
        >
          <div className="mb-4 flex items-start gap-3">
            <RDialog.Title className="mr-auto text-xl font-bold">{title}</RDialog.Title>
            <RDialog.Close className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg" aria-label={t('common.close')}>
              <X className="h-5 w-5" aria-hidden="true" />
            </RDialog.Close>
          </div>
          {description ? <RDialog.Description className="mb-3 text-sm text-muted">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
