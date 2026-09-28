import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import type { QuizDto } from '../pages/QuizReview';
import { Button, ErrorBox, Field, inputCls, Modal } from './ui';
import { ClipboardList, Palette, Users } from 'lucide-react';
import { DEFAULT_LIVE_MOTIVE, DEFAULT_TEST_MOTIVE, getMotive } from '@kvizhub/core/client';
import { lookName, motiveThumb, ThemePicker, type Look } from './ThemePicker';
import { usePrefs } from '../theme/prefs';
import { useToast } from '../ui/Toast';

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

export default function StartGameModal({ quiz, onClose, onQuizTheme }: { quiz: QuizDto; onClose: () => void; onQuizTheme?: (theme: Look) => void }) {
  const { t } = useTranslation();
  const { theme: scheme } = usePrefs();
  const toast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'live' | 'test'>('live');
  // look of this game only (V7.2); undefined = the quiz's look
  const [gameLook, setGameLook] = useState<Look | undefined>(undefined);
  const [quizLook, setQuizLook] = useState<Look>(quiz.theme ?? null);
  const [picking, setPicking] = useState(false);
  const look = gameLook === undefined ? quizLook : gameLook;
  const lookMotive = getMotive(look?.motive)?.id ?? (mode === 'test' ? DEFAULT_TEST_MOTIVE : DEFAULT_LIVE_MOTIVE);
  // "Lore default for this game only" still has to override a quiz look: send the default motive explicitly
  const themeSetting = gameLook === undefined ? {} : { theme: gameLook ?? { motive: mode === 'test' ? DEFAULT_TEST_MOTIVE : DEFAULT_LIVE_MOTIVE } };
  const [settings, setSettings] = useState({
    shuffleQuestions: quiz.settings.shuffleQuestions,
    shuffleOptions: quiz.settings.shuffleOptions,
    showLeaderboard: true,
    streakBonus: false,
    allowLateJoin: false,
    partialMulti: false,
  });
  // Výchozí nastavení míří na test psaný v hodině, ne na domácí úkol:
  // zavírá se dnes večer, žák nezadává jméno (u třídy se hlásí kódem jako
  // do kvízu) a vyžaduje se celá obrazovka.
  const konecDne = () => {
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    return d.getTime();
  };
  const [test, setTest] = useState({
    timeLimitMin: '20',
    closesAt: localInput(konecDne()),
    requireName: false,
    allowBackNavigation: true,
    showResultsToStudent: 'score' as 'none' | 'score' | 'full',
  });
  // Dodatek 2, G2 defaults
  const [guard, setGuard] = useState({ mode: 'warn' as 'off' | 'log' | 'warn', maxLeaves: 2, onExceed: 'notify' as 'notify' | 'lock', requireFullscreen: true, minLeaveMs: 1000 });
  // Dodatek 3 (C6.1): class game
  const [classes, setClasses] = useState<{ id: string; name: string; status: string; role?: string }[]>([]);
  const [cls, setCls] = useState({ classId: '', label: quiz.title.slice(0, 60), audienceAll: true, audience: [] as string[], allowGuests: false, countInStats: true });
  const [students, setStudents] = useState<{ id: string; accountName: string; rosterNo: number | null; active: boolean }[]>([]);
  useEffect(() => {
    api<{ classes: typeof classes }>('GET', '/api/v1/classes')
      .then((r) => setClasses(r.classes.filter((c) => c.status === 'active' && (c.role === 'owner' || c.role === 'editor'))))
      .catch(() => setClasses([]));
  }, []);
  useEffect(() => {
    if (!cls.classId || cls.audienceAll) return;
    api<{ students: typeof students }>('GET', `/api/v1/classes/${cls.classId}`)
      .then((r) => setStudents(r.students.filter((x) => x.active)))
      .catch(() => setStudents([]));
  }, [cls.classId, cls.audienceAll]);
  const className = classes.find((c) => c.id === cls.classId)?.name;
  const classSettings = cls.classId
    ? { classId: cls.classId, label: cls.label || quiz.title.slice(0, 60), allowGuests: cls.allowGuests, countInStats: cls.countInStats, ...(cls.audienceAll ? {} : { audience: cls.audience }) }
    : {};
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
          ? { mode, settings: { ...settings, ...classSettings, ...themeSetting } }
          : {
              mode,
              settings: {
                ...classSettings,
                ...themeSetting,
                shuffleQuestions: settings.shuffleQuestions,
                shuffleOptions: settings.shuffleOptions,
                partialMulti: settings.partialMulti,
                test: {
                  timeLimitMin: test.timeLimitMin ? Number(test.timeLimitMin) : null,
                  closesAt: new Date(test.closesAt).toISOString(),
                  requireName: test.requireName,
                  allowBackNavigation: test.allowBackNavigation,
                  showResultsToStudent: test.showResultsToStudent,
                  leaveGuard: guard,
                },
              },
            };
      const r = await api<Created>('POST', `/api/v1/quizzes/${quiz.id}/games`, body);
      // Živá hra jde rovnou do lobby: PIN, QR i adresa jsou na projektoru větší
      // a učitel nemusí mačkat další tlačítko. Mezikrok by jen zdržoval.
      if (r.mode !== 'test' && r.hostUrl) {
        const u = new URL(r.hostUrl);
        navigate(u.pathname + u.hash);
        return;
      }
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
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('game.modeLabel')}>
            {(['live', 'test'] as const).map((m) => {
              const Icon = m === 'live' ? Users : ClipboardList;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  data-testid={`mode-${m}`}
                  className={`flex min-h-20 items-start gap-3 rounded-lg border-2 p-3 text-left text-sm transition-colors ${mode === m ? 'border-primary bg-primary-soft text-on-primary-soft' : 'border-line bg-surface text-fg hover:bg-surface-2'}`}
                >
                  <Icon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="block text-base font-bold">{t(`game.modes.${m}`)}</span>
                    <span className={mode === m ? '' : 'text-muted'}>{t(`game.modesHint.${m}`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 rounded-md border border-line p-2" data-testid="game-look-row">
            <img src={motiveThumb(lookMotive, scheme)} alt="" className="h-12 w-20 shrink-0 rounded-sm object-cover" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="block font-semibold">{t('theme.gameLook')}</span>
              <span className="text-muted" data-testid="game-look-name">
                {lookName(look, t)} · {gameLook === undefined ? t('theme.fromQuiz') : t('theme.onlyThisGame')}
              </span>
            </span>
            <Button size="sm" icon={<Palette aria-hidden="true" className="h-4 w-4" />} onClick={() => setPicking(true)} data-testid="game-look">
              {t('theme.change')}
            </Button>
          </div>
          {picking && (
            <ThemePicker
              value={look}
              testMode={mode === 'test'}
              onClose={() => setPicking(false)}
              actions={[
                { id: 'quiz', label: t('theme.saveQuiz'), testId: 'theme-save-quiz' },
                { id: 'game', label: t('theme.applyGame'), primary: true, testId: 'theme-apply-game' },
              ]}
              onAction={async (action, chosen) => {
                if (action === 'quiz') {
                  await api('PATCH', `/api/v1/quizzes/${quiz.id}`, { theme: chosen });
                  setQuizLook(chosen);
                  setGameLook(undefined);
                  onQuizTheme?.(chosen);
                  toast(t('theme.saved'));
                } else setGameLook(chosen);
                setPicking(false);
              }}
            />
          )}
          {quiz.stats.flagged > 0 && <p className="rounded bg-warning-soft p-2 text-sm text-warning">{t('game.flaggedSkipped', { count: quiz.stats.flagged })}</p>}
          {classes.length > 0 && (
            <fieldset className="space-y-2 rounded-md border border-line p-3" data-testid="class-settings">
              <Field label={t('game.class.label')}>
                <select className={inputCls} value={cls.classId} onChange={(e) => setCls({ ...cls, classId: e.target.value })} data-testid="game-class">
                  <option value="">{t('game.class.none')}</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              {cls.classId && (
                <>
                  <p className="rounded bg-info-soft p-2 text-sm text-info">{t('game.class.notice', { name: className })}</p>
                  <Field label={t('game.class.recordLabel')}>
                    <input className={inputCls} maxLength={60} value={cls.label} onChange={(e) => setCls({ ...cls, label: e.target.value })} data-testid="game-label" />
                  </Field>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={cls.audienceAll} onChange={() => setCls({ ...cls, audienceAll: true })} /> {t('game.class.all')}
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={!cls.audienceAll} onChange={() => setCls({ ...cls, audienceAll: false })} /> {t('game.class.selected')}
                    </label>
                  </div>
                  {!cls.audienceAll && (
                    <ul className="grid max-h-40 gap-1 overflow-y-auto text-sm sm:grid-cols-2">
                      {students.map((st) => (
                        <li key={st.id}>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={cls.audience.includes(st.id)}
                              onChange={(e) => setCls({ ...cls, audience: e.target.checked ? [...cls.audience, st.id] : cls.audience.filter((x) => x !== st.id) })}
                            />
                            {st.rosterNo ? `${st.rosterNo}. ` : ''}
                            {st.accountName}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={cls.allowGuests} onChange={(e) => setCls({ ...cls, allowGuests: e.target.checked })} /> {t('game.class.allowGuests')}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={cls.countInStats} onChange={(e) => setCls({ ...cls, countInStats: e.target.checked })} /> {t('game.class.countInStats')}
                  </label>
                </>
              )}
            </fieldset>
          )}
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
                {!cls.classId && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={test.requireName} onChange={(e) => setTest({ ...test, requireName: e.target.checked })} />
                    {t('game.test.requireName')}
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={test.allowBackNavigation} onChange={(e) => setTest({ ...test, allowBackNavigation: e.target.checked })} />
                  {t('game.test.allowBack')}
                </label>
              </div>
            </div>
          )}
          {mode === 'test' && (
            <fieldset className="space-y-2 rounded-md border border-line p-3" data-testid="guard-settings">
              <legend className="px-1 text-sm font-semibold">{t('guard.settings.title')}</legend>
              <p className="text-xs text-muted">{t('guard.settings.limits')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('guard.settings.mode')}>
                  <select className={inputCls} value={guard.mode} onChange={(e) => setGuard({ ...guard, mode: e.target.value as typeof guard.mode })} data-testid="guard-mode">
                    {(['off', 'log', 'warn'] as const).map((m) => (
                      <option key={m} value={m}>
                        {t(`guard.settings.modes.${m}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                {guard.mode === 'warn' && (
                  <>
                    <Field label={t('guard.settings.maxLeaves')} hint={t('guard.settings.maxLeavesHint')}>
                      <input className={inputCls} type="number" min={0} max={10} value={guard.maxLeaves} onChange={(e) => setGuard({ ...guard, maxLeaves: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })} data-testid="guard-max" />
                    </Field>
                    <Field label={t('guard.settings.onExceed')}>
                      <select className={inputCls} value={guard.onExceed} onChange={(e) => setGuard({ ...guard, onExceed: e.target.value as typeof guard.onExceed })} data-testid="guard-on-exceed">
                        <option value="notify">{t('guard.settings.notify')}</option>
                        <option value="lock">{t('guard.settings.lock')}</option>
                      </select>
                    </Field>
                  </>
                )}
                {guard.mode !== 'off' && (
                  <>
                    <Field label={t('guard.settings.minLeave')} hint={t('guard.settings.minLeaveHint')}>
                      <input className={inputCls} type="number" min={0.5} max={5} step={0.5} value={guard.minLeaveMs / 1000} onChange={(e) => setGuard({ ...guard, minLeaveMs: Math.round(Math.max(0.5, Math.min(5, Number(e.target.value) || 1)) * 1000) })} />
                    </Field>
                    <label className="flex items-center gap-2 pt-6 text-sm">
                      <input type="checkbox" className="h-4 w-4" checked={guard.requireFullscreen} onChange={(e) => setGuard({ ...guard, requireFullscreen: e.target.checked })} data-testid="guard-fullscreen" />
                      {t('guard.settings.fullscreen')}
                    </label>
                  </>
                )}
              </div>
            </fieldset>
          )}
          <div className="grid gap-2 sm:grid-cols-2">{(mode === 'live' ? liveKeys : testKeys).map(toggle)}</div>
          <ErrorBox error={error} />
          <Button variant="success" onClick={start} disabled={busy} data-testid="confirm-start">
            ▶ {mode === 'live' ? t('game.start') : t('game.startTest')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted">{t(created.mode === 'test' ? 'game.testReady' : 'game.ready', { count: created.questionCount })}</p>
          <p className="text-5xl font-extrabold tracking-widest" data-testid="pin">
            {created.pin.replace(/(\d{3})(\d+)/, '$1 $2')}
          </p>
          {qr && <img src={qr} alt={t('game.qrAlt')} className="mx-auto h-48 w-48" />}
          <p className="text-sm">
            {t('game.joinAt')} <strong>{created.joinUrl}</strong>
          </p>
          {created.mode === 'test' ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Link to={`/tests/${created.gameId}`} className="inline-block rounded-md bg-primary px-4 py-2 font-medium text-on-primary hover:bg-primary-hover" data-testid="open-dashboard">
                {t('game.openDashboard')}
              </Link>
              <Button
                data-testid="copy-invite"
                onClick={() => {
                  void navigator.clipboard?.writeText(t('game.inviteText', { title: quiz.title, url: created.joinUrl, pin: created.pin }));
                  toast(t('game.inviteCopied'));
                }}
              >
                {t('game.copyInvite')}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap justify-center gap-2">
                <a href={created.hostUrl} target="_blank" rel="noreferrer" className="rounded-md bg-primary px-4 py-2 font-medium text-on-primary hover:bg-primary-hover" data-testid="open-host">
                  {t('game.openHost')}
                </a>
                <Button onClick={() => navigator.clipboard?.writeText(created.hostUrl ?? '')}>{t('game.copyHost')}</Button>
              </div>
              <p className="text-xs text-muted">{t('game.hostHint')}</p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
