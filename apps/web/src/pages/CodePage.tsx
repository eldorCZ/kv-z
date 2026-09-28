import { formatCode, normalizeCode } from '@kvizhub/core/client';
import { useTitle } from '../ui/useTitle';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { forgetDeviceCode, readDeviceCode, saveDeviceCode } from '../classes/deviceCode';
import { Logo } from '../ui/Logo';
import { SchemeSwitcher } from '../ui/SchemeSwitcher';

/**
 * /kod#c=<code> (QR from the printed card, C4.6). The code is read from the fragment (never sent to the server)
 * and removed from the address bar immediately.
 */
export default function CodePage() {
  const { t } = useTranslation();
  useTitle(t('titles.code'));
  const [code, setCode] = useState<string | null>(null);
  const [saved, setSaved] = useState<'none' | 'saved' | 'skipped'>('none');

  useEffect(() => {
    const m = /[#&]c=([^&]+)/.exec(window.location.hash);
    history.replaceState(null, '', window.location.pathname);
    const c = m ? normalizeCode(decodeURIComponent(m[1]!)) : null;
    setCode(c);
  }, []);

  if (!code)
    return (
      <div className="mx-auto max-w-sm p-6 text-center">
        <p>{t('kod.invalid')}</p>
        <Link to="/play" className="mt-4 inline-block text-primary underline">
          {t('kod.toPlay')}
        </Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-sm space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1>
          <Logo height={40} />
        </h1>
        <SchemeSwitcher />
      </div>
      <p>{t('kod.intro')}</p>
      <p className="text-center font-mono text-2xl font-bold tracking-widest">{formatCode(code)}</p>
      {saved === 'none' ? (
        <>
          {/* Uložení je hlavní volba: bez něj naskenování karty nic neušetří — žák
              stejně musí kód při připojení opsat. Souhlas ale zůstává výslovný,
              proto dvě jasná tlačítka místo zaškrtávátka (C5.5). */}
          <p className="text-sm">{t('kod.saveHint')}</p>
          <p className="text-xs text-warning">{t('kod.saveWarning')}</p>
          <button
            className="w-full rounded-md bg-primary py-3 font-semibold text-on-primary"
            onClick={() => setSaved(saveDeviceCode(code) ? 'saved' : 'skipped')}
            data-testid="code-continue"
          >
            {t('kod.saveButton')}
          </button>
          <button className="w-full rounded-md border border-line py-2 text-sm" onClick={() => setSaved('skipped')} data-testid="code-skip">
            {t('kod.dontRemember')}
          </button>
        </>
      ) : (
        <div className="space-y-3 text-center">
          <p>{saved === 'saved' ? t('kod.saved') : t('kod.notSaved')}</p>
          <Link to="/play" className="inline-block rounded-md bg-primary px-4 py-2 font-semibold text-on-primary">
            {t('kod.toPlay')}
          </Link>
        </div>
      )}
      {readDeviceCode() && (
        <button className="block w-full text-center text-sm text-muted underline" onClick={() => (forgetDeviceCode(), setSaved('skipped'))}>
          {t('kod.forget')}
        </button>
      )}
    </div>
  );
}
