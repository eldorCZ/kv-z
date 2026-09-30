import * as RDialog from '@radix-ui/react-dialog';
import { TriangleAlert, X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
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
 * Potvrzení nevratného kroku (Dodatek 5/3). Stojí na stejném Radix dialogu jako `Dialog`,
 * proto se chová stejně: Esc zavírá, Tab cykluje uvnitř, po zavření se ohnisko vrátí
 * na tlačítko, které dialog otevřelo.
 *
 * Nahrazuje `window.confirm`, který nejde ostylovat, nedá se přeložit a na mobilu vypadá
 * jako chyba prohlížeče. Ohnisko schválně startuje na „zrušit“ – u mazání je bezpečnější,
 * když Enter nic nesmaže.
 */
export function AlertDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
  open = true,
  variant = 'danger',
  busy = false,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  open?: boolean;
  variant?: 'danger' | 'primary';
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const zrusit = useRef<HTMLButtonElement>(null);
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-black/50" />
        <RDialog.Content
          role="alertdialog"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            zrusit.current?.focus();
          }}
          className="dialog-content fixed left-1/2 top-[15vh] z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-line bg-surface p-5 text-fg shadow-soft focus:outline-none"
          data-testid="alert-dialog"
        >
          <div className="flex items-start gap-3">
            {variant === 'danger' && <TriangleAlert className="mt-0.5 h-6 w-6 shrink-0 text-danger" aria-hidden="true" />}
            <div className="min-w-0">
              <RDialog.Title className="text-lg font-bold">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-2 whitespace-pre-line text-sm text-muted">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{title}</RDialog.Description>
              )}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button ref={zrusit} onClick={onClose} data-testid="alert-cancel">
              {cancelLabel ?? t('common.cancel')}
            </Button>
            <Button variant={variant} loading={busy} onClick={onConfirm} data-testid="alert-confirm">
              {confirmLabel}
            </Button>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
