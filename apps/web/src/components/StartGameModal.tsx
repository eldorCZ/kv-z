import QRCode from 'qrcode';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import type { QuizDto } from '../pages/QuizReview';
import { Button, ErrorBox, Modal } from './ui';

interface Created {
  gameId: string;
  pin: string;
  joinUrl: string;
  qrUrl: string;
  hostUrl: string;
  questionCount: number;
  skippedFlagged: number;
}

export default function StartGameModal({ quiz, onClose }: { quiz: QuizDto; onClose: () => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState({
    shuffleQuestions: quiz.settings.shuffleQuestions,
    shuffleOptions: quiz.settings.shuffleOptions,
    showLeaderboard: true,
    streakBonus: false,
    allowLateJoin: false,
    partialMulti: false,
  });
  const [created, setCreated] = useState<Created | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Created>('POST', `/api/v1/quizzes/${quiz.id}/games`, { mode: 'live', settings });
      setCreated(r);
      setQr(await QRCode.toDataURL(r.qrUrl, { margin: 1, width: 240 }));
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

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
          <p className="text-sm text-slate-600">{t('game.mode')}</p>
          {quiz.stats.flagged > 0 && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">{t('game.flaggedSkipped', { count: quiz.stats.flagged })}</p>}
          <div className="grid gap-2 sm:grid-cols-2">{(Object.keys(settings) as (keyof typeof settings)[]).map(toggle)}</div>
          <ErrorBox error={error} />
          <Button variant="success" onClick={start} disabled={busy} data-testid="confirm-start">
            ▶ {t('game.start')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 text-center">
          <p className="text-sm text-slate-600">{t('game.ready', { count: created.questionCount })}</p>
          <p className="text-5xl font-extrabold tracking-widest" data-testid="pin">
            {created.pin.replace(/(\d{3})(\d+)/, '$1 $2')}
          </p>
          {qr && <img src={qr} alt={t('game.qrAlt')} className="mx-auto h-48 w-48" />}
          <p className="text-sm">
            {t('game.joinAt')} <strong>{created.joinUrl}</strong>
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <a href={created.hostUrl} target="_blank" rel="noreferrer" className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700" data-testid="open-host">
              {t('game.openHost')}
            </a>
            <Button onClick={() => navigator.clipboard?.writeText(created.hostUrl)}>{t('game.copyHost')}</Button>
          </div>
          <p className="text-xs text-slate-500">{t('game.hostHint')}</p>
        </div>
      )}
    </Modal>
  );
}
