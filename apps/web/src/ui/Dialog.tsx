import * as RDialog from '@radix-ui/react-dialog';
import { TriangleAlert, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';

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

/**
 * Confirmation before a destructive action (Dodatek 5, point 3), on top of the Radix dialog: focus stays
 * inside (Tab cycles), Esc and Cancel close, focus starts on Cancel. Radix returns focus to the element that
 * had it before opening; `returnFocus` names it explicitly when that element is gone (a closed menu item).
 */
export function AlertDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
  variant = 'danger',
  returnFocus,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  variant?: 'danger' | 'primary';
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-black/50" />
        <RDialog.Content
          role="alertdialog"
          data-testid="alert-dialog"
          onOpenAutoFocus={(e) => {
            // the safe choice gets focus first
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-autofocus]')?.focus();
          }}
          onCloseAutoFocus={(e) => {
            const target = returnFocus?.();
            if (target) {
              e.preventDefault();
              target.focus();
            }
          }}
          className="dialog-content fixed left-1/2 top-[20vh] z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-line bg-surface p-5 text-fg shadow-soft focus:outline-none"
        >
          <div className="flex items-start gap-3">
            {variant === 'danger' && (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-danger-soft text-danger">
                <TriangleAlert className="h-5 w-5" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              <RDialog.Title className="text-lg font-bold">{title}</RDialog.Title>
              <RDialog.Description className="mt-1 text-sm text-muted">{description}</RDialog.Description>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <RDialog.Close asChild>
              <Button variant="outline" data-autofocus disabled={busy}>
                {cancelLabel}
              </Button>
            </RDialog.Close>
            <Button
              variant={variant}
              loading={busy}
              data-testid="alert-confirm"
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                } finally {
                  setBusy(false);
                }
                onClose();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
