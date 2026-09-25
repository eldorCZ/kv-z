import QRCode from 'qrcode';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api, ApiError } from '../api';
import type { QuizDto } from '../pages/QuizReview';
import { Button, ErrorBox, Field, inputCls, Modal } from './ui';

interface Created {
  gameId: string;
  mode?: 'test';
  pin: string;
  joinUrl: string;
  qrUrl: string;
  hostUrl?: string;
  dashboardUrl?: string;
  questionCount: number;
  skippedFlagged: number;
}

/** yyyy-mm-ddThh:mm in local time for <input type="datetime-local"> */
function localInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function StartGameModal({ quiz, onClose }: { quiz: QuizDto; onClose: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'live' | 'test'>('live');
  const [settings, setSettings] = useState({
    shuffleQuestions: quiz.settings.shuffleQuestions,
    shuffleOptions: quiz.settings.shuffleOptions,
    showLeaderboard: true,
    streakBonus: false,
    allowLateJoin: false,
    partialMulti: false,
  });
  const [test, setTest] = useState({
    timeLimitMin: '20',
    closesAt: localInput(Date.now() + 7 * 86_400_000),
    requireName: true,
    allowBackNavigation: true,
    showResultsToStudent: 'score' as 'none' | 'score' | 'full',
  });
  const [created, setCreated] = useState<Created | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === 'live'
          ? { mode, settings }
          : {
              mode,
              settings: {
                shuffleQuestions: settings.shuffleQuestions,
                shuffleOptions: settings.shuffleOptions,
                partialMulti: settings.partialMulti,
                test: {
                  timeLimitMin: test.timeLimitMin ? Number(test.timeLimitMin) : null,
                  closesAt: new Date(test.closesAt).toISOString(),
                  requireName: test.requireName,
                  allowBackNavigation: test.allowBackNavigation,
                  showResultsToStudent: test.showResultsToStudent,
                },
              },
            };
      const r = await api<Created>('POST', `/api/v1/quizzes/${quiz.id}/games`, body);
      setCreated(r);
      setQr(await QRCode.toDataURL(r.qrUrl, { margin: 1, width: 240 }));
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const liveKeys = ['shuffleQuestions', 'shuffleOptions', 'showLeaderboard', 'streakBonus', 'allowLateJoin', 'partialMulti'] as const;
  const testKeys = ['shuffleQuestions', 'shuffleOptions', 'partialMulti'] as const;
  const toggle = (k: keyof typeof settings) => (
    <label key={k} className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4" checked={settings[k]} onChange={(e) => setSettings({ ...settings, [k]: e.target.checked })} />
      {t(`game.settings.${k}`)}
    </label>
  );

  return (
    <Modal title={t('game.startTitle')} onClose={onClose}>
      {!created ? (
        <div className="space-y-3">
          <div className="flex gap-2" role="radiogroup" aria-label={t('game.modeLabel')}>
            {(['live', 'test'] as const).map((m) => (
              <label key={m} className={`flex-1 cursor-pointer rounded-md border p-3 text-sm ${mode === m ? 'border-indigo-600 bg-indigo-50' : 'border-slate-300'}`}>
                <input type="radio" className="sr-only" name="mode" checked={mode === m} onChange={() => setMode(m)} data-testid={`mode-${m}`} />
                <span className="block font-semibold">{t(`game.modes.${m}`)}</span>
                <span className="text-slate-600">{t(`game.modesHint.${m}`)}</span>
              </label>
            ))}
          </div>
          {quiz.stats.flagged > 0 && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">{t('game.flaggedSkipped', { count: quiz.stats.flagged })}</p>}
          {mode === 'test' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('game.test.timeLimit')} hint={t('game.test.timeLimitHint')}>
                <input className={inputCls} type="number" min={1} max={240} value={test.timeLimitMin} onChange={(e) => setTest({ ...test, timeLimitMin: e.target.value })} data-testid="test-limit" />
              </Field>
              <Field label={t('game.test.closesAt')}>
                <input className={inputCls} type="datetime-local" required value={test.closesAt} onChange={(e) => setTest({ ...test, closesAt: e.target.value })} />
              </Field>
              <Field label={t('game.test.showResults')}>
                <select className={inputCls} value={test.showResultsToStudent} onChange={(e) => setTest({ ...test, showResultsToStudent: e.target.value as 'none' | 'score' | 'full' })}>
                  {(['none', 'score', 'full'] as const).map((v) => (
                    <option key={v} value={v}>
                      {t(`game.test.results.${v}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="space-y-2 pt-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={test.requireName} onChange={(e) => setTest({ ...test, requireName: e.target.checked })} />
                  {t('game.test.requireName')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={test.allowBackNavigation} onChange={(e) => setTest({ ...test, allowBackNavigation: e.target.checked })} />
                  {t('game.test.allowBack')}
                </label>
              </div>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">{(mode === 'live' ? liveKeys : testKeys).map(toggle)}</div>
          <ErrorBox error={error} />
          <Button variant="success" onClick={start} disabled={busy} data-testid="confirm-start">
            ▶ {mode === 'live' ? t('game.start') : t('game.startTest')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 text-center">
          <p className="text-sm text-slate-600">{t(created.mode === 'test' ? 'game.testReady' : 'game.ready', { count: created.questionCount })}</p>
          <p className="text-5xl font-extrabold tracking-widest" data-testid="pin">
            {created.pin.replace(/(\d{3})(\d+)/, '$1 $2')}
          </p>
          {qr && <img src={qr} alt={t('game.qrAlt')} className="mx-auto h-48 w-48" />}
          <p className="text-sm">
            {t('game.joinAt')} <strong>{created.joinUrl}</strong>
          </p>
          {created.mode === 'test' ? (
            <Link to={`/tests/${created.gameId}`} className="inline-block rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700" data-testid="open-dashboard">
              {t('game.openDashboard')}
            </Link>
          ) : (
            <>
              <div className="flex flex-wrap justify-center gap-2">
                <a href={created.hostUrl} target="_blank" rel="noreferrer" className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700" data-testid="open-host">
                  {t('game.openHost')}
                </a>
                <Button onClick={() => navigator.clipboard?.writeText(created.hostUrl ?? '')}>{t('game.copyHost')}</Button>
              </div>
              <p className="text-xs text-slate-500">{t('game.hostHint')}</p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
