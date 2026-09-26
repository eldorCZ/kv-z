import type { ReactNode } from 'react';
import { Dialog } from '../ui/Dialog';
import { controlCls } from '../ui/Field';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '../api';

// Compatibility layer: the design system lives in ../ui (Dodatek 4, V9.1).
export { Badge } from '../ui/Badge';
export { Button } from '../ui/Button';
export { Field } from '../ui/Field';

export function ErrorBox({ error, onClose }: { error: ApiError | Error | string | null; onClose?: () => void }) {
  const { t } = useTranslation();
  if (!error) return null;
  const msg = typeof error === 'string' ? error : error.message;
  const details = typeof error === 'object' && 'errors' in error ? error.errors : [];
  return (
    <div role="alert" className="my-3 rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">
      <div className="flex items-start gap-2">
        <p className="flex-1 font-medium">{msg}</p>
        {onClose && (
          <button className="text-danger hover:underline" onClick={onClose}>
            {t('common.close')}
          </button>
        )}
      </div>
      {details.length > 0 && (
        <ul className="mt-2 list-disc pl-5">
          {details.map((d, i) => (
            <li key={i}>
              <code className="text-xs">{d.path}</code>: {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Modal dialog built on the accessible Dialog of the design system. */
export function Modal({ title, onClose, children, size }: { title: string; onClose: () => void; children: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <Dialog title={title} onClose={onClose} size={size}>
      {children}
    </Dialog>
  );
}

export const inputCls = controlCls;

export function formatDate(ms: number | null | undefined) {
  if (!ms) return '–';
  return new Date(ms).toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
}
