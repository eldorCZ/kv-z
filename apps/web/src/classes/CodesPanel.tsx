import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Button } from '../components/ui';
import type { CreatedCode } from './types';
import { appName } from '../app-config';

/**
 * One-time display of plain codes (C4.4). They live only in the memory of this page:
 * after closing or reloading they cannot be shown again.
 */
export default function CodesPanel({ classId, className, codes, onClose }: { classId: string; className: string; codes: CreatedCode[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [qrs, setQrs] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    void Promise.all(codes.map(async (c) => [c.student.id, await QRCode.toDataURL(`${window.location.origin}/kod#c=${c.code}`, { margin: 0, width: 160 })] as const)).then((pairs) => {
      if (alive) setQrs(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [codes]);

  // warn before leaving the page while codes are shown
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  // adresa pro ruční zadání – bez https:// a bez kódu, ten je na kartě zvlášť
  const prihlaseniUrl = `${window.location.host}/kod`;

  const print = () => {
    if (!confirm(t('roster.printWarning'))) return;
    void api('POST', `/api/v1/classes/${classId}/log`, { action: 'cards_print', count: codes.length }).catch(() => undefined);
    window.print();
  };

  const csv = () => {
    if (!confirm(t('roster.csvWarning'))) return;
    const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = ['Číslo;Přihlašovací jméno;Kód', ...codes.map((c) => [c.student.rosterNo ?? '', c.student.accountName, c.code].map((v) => esc(String(v))).join(';'))];
    const blob = new Blob([`\ufeff${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kody-${className.replace(/[^\w.-]+/g, '_')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <div className="rounded-lg border-2 border-warning-line bg-warning-soft p-4" data-testid="codes-panel">
      <div className="no-print">
        <p className="font-semibold text-warning">{t('roster.codesOnce', { count: codes.length })}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={print} data-testid="print-cards">
            {t('roster.printCards')}
          </Button>
          <Button onClick={csv}>{t('roster.downloadCodes')}</Button>
          <Button variant="ghost" onClick={() => confirm(t('roster.closeCodesConfirm')) && onClose()} data-testid="close-codes">
            {t('common.close')}
          </Button>
        </div>
        <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
          {codes.map((c) => (
            <li key={c.student.id} className="flex justify-between gap-2 rounded bg-surface px-2 py-1">
              <span className="font-mono">{c.student.accountName}</span>
              <code className="font-mono font-bold" data-testid="plain-code">
                {c.code}
              </code>
            </li>
          ))}
        </ul>
      </div>
      {/* print sheet: A4, 2 x 5 cards (C4.5) */}
      <div className="print-area">
        <div className="card-sheet">
          {codes.map((c) => (
            <div key={c.student.id} className="code-card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-primary">{appName} · {className}</p>
                  <p className="mt-1 text-lg font-bold">
                    {c.student.accountName}
                    {c.student.rosterNo ? ` (${c.student.rosterNo})` : ''}
                  </p>
                  <p className="mt-2 font-mono text-2xl font-extrabold tracking-widest">{c.code}</p>
                  {/* adresa i slovy: ne každý žák má po ruce foťák a QR kód sám o sobě
                      nikam nevede, když sedí u počítače */}
                  <p className="mt-1 text-[11px] leading-tight">
                    {t('roster.cardUrl')} <span className="font-mono font-semibold">{prihlaseniUrl}</span>
                  </p>
                </div>
                {qrs[c.student.id] && <img src={qrs[c.student.id]} alt="" className="h-20 w-20" />}
              </div>
              <p className="mt-2 text-[10px] leading-tight">{t('roster.cardText')}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
