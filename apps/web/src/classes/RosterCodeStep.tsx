import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { forgetDeviceCode, readDeviceCode } from './deviceCode';

/**
 * "Osobní kód" step of a class game (C5.1, C5.5): identify -> "Jsi to ty, Jana N.?" -> ticket.
 * The code is sent only in the request body, never in the URL.
 */
export default function RosterCodeStep({
  pin,
  allowGuests,
  onTicket,
  onGuest,
  dark = false,
}: {
  pin: string;
  allowGuests: boolean;
  onTicket: (ticket: string, accountName: string) => Promise<void> | void;
  onGuest: () => void;
  dark?: boolean;
}) {
  const { t } = useTranslation();
  const saved = readDeviceCode();
  const [code, setCode] = useState(saved ?? '');
  const [who, setWho] = useState<{ accountName: string; ticket: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [noCode, setNoCode] = useState(false);
  const [hasSaved, setHasSaved] = useState(!!saved);

  const identify = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/play/roster/identify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin, code }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // a remembered code that the server refuses (rotated, student left) is forgotten
        if (hasSaved && code === saved && res.status === 404) {
          forgetDeviceCode();
          setHasSaved(false);
        }
        setError(data.error ?? t('errors.generic'));
        return;
      }
      setWho(data);
    } catch {
      setError(t('errors.network'));
    } finally {
      setBusy(false);
    }
  };

  const box = `w-full max-w-sm space-y-4 rounded-xl p-6 shadow-lg ${dark ? 'bg-white text-slate-900' : 'bg-white'}`;

  if (who)
    return (
      <div className={box} data-testid="roster-confirm">
        <p className="text-center text-2xl font-bold">{t('rosterLogin.isItYou', { name: who.accountName })}</p>
        <button
          className="w-full rounded-md bg-indigo-600 py-3 text-lg font-bold text-white"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onTicket(who.ticket, who.accountName);
            setBusy(false);
          }}
          data-testid="roster-yes"
        >
          {t('rosterLogin.yes')}
        </button>
        <button className="w-full rounded-md border border-slate-300 py-3" onClick={() => (setWho(null), setCode(''))}>
          {t('rosterLogin.no')}
        </button>
      </div>
    );

  return (
    <form onSubmit={identify} className={box} data-testid="roster-code-step">
      <h1 className="text-xl font-bold text-indigo-700">{t('rosterLogin.title')}</h1>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t('rosterLogin.code')}</span>
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-3 text-center font-mono text-2xl uppercase tracking-widest"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          data-testid="roster-code"
        />
        <span className="mt-1 block text-xs text-slate-500">{t('rosterLogin.hint')}</span>
      </label>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !code.trim()} className="w-full rounded-md bg-indigo-600 py-3 text-lg font-bold text-white disabled:bg-indigo-300" data-testid="roster-continue">
        {t('rosterLogin.continue')}
      </button>
      <button type="button" className="w-full text-sm text-indigo-700 underline" onClick={() => (allowGuests ? onGuest() : setNoCode(true))}>
        {t('rosterLogin.noCode')}
      </button>
      {noCode && <p className="text-center text-sm">{t('rosterLogin.askTeacher')}</p>}
      {hasSaved && (
        <button
          type="button"
          className="w-full text-xs text-slate-500 underline"
          onClick={() => {
            forgetDeviceCode();
            setHasSaved(false);
            setCode('');
          }}
        >
          {t('kod.forget')}
        </button>
      )}
    </form>
  );
}
