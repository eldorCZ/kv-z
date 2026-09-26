import type { PublicQuestion } from '@kvizhub/core';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import RosterCodeStep from '../classes/RosterCodeStep';
import { ANSWER_STYLES, Shape } from '../components/Shapes';
import { GuardController, type HeartbeatStatus } from '../leave-guard-client';
import { useCountdown } from '../socket';

/** Student view of a test attempt (D5, D7). Only whitelisted fields come from the server (D11). */
export interface AttemptView {
  status: 'not_started' | 'in_progress' | 'submitted' | 'expired';
  name: string;
  title: string;
  questionCount: number;
  timeLimitMin: number | null;
  closesAt: string | null;
  allowBackNavigation: boolean;
  remainingSec: number | null;
  questions?: PublicQuestion[];
  answers?: Record<string, unknown>;
  result?: {
    shown: 'none' | 'score' | 'full';
    percent?: number | null;
    questions?: { number: number; prompt: string; answer: string | null; correct: boolean; fraction: number; correctText: string[]; explanation: string }[];
  };
  // leave guard (Dodatek 2) – optional, filled by the server when enabled
  leaveGuard?: { mode: 'off' | 'log' | 'warn'; maxLeaves: number; onExceed: 'notify' | 'lock'; requireFullscreen: boolean; minLeaveMs: number } | null;
  locked?: boolean;
  guardExempt?: boolean;
  leaveCount?: number;
}

export class StudentApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = '',
  ) {
    super(message);
  }
}

const tokenKey = (pin: string) => `kvizhub-test-${pin}`;
export function readTestToken(pin: string): string | null {
  try {
    return localStorage.getItem(tokenKey(pin));
  } catch {
    return null;
  }
}
function writeTestToken(pin: string, token: string | null) {
  try {
    if (token) localStorage.setItem(tokenKey(pin), token);
    else localStorage.removeItem(tokenKey(pin));
  } catch {
    /* storage unavailable – the attempt survives only while the tab is open */
  }
}

export async function studentApi<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/play/test${path}`, {
      method,
      headers: { ...(token ? { 'x-player-token': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new StudentApiError(0, 'Spojení se serverem se přerušilo. Odpovědi zkusím uložit znovu.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new StudentApiError(res.status, data.error ?? 'Něco se nepovedlo.', data.code);
  return data as T;
}

type SaveState = 'saved' | 'saving' | 'pending' | 'error';

export default function TestPlay() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [pin, setPin] = useState(params.get('pin')?.replace(/\D/g, '') ?? '');
  const [name, setName] = useState(params.get('name') ?? '');
  const [info, setInfo] = useState<{ title: string; requireName: boolean; questionCount: number; timeLimitMin: number | null; identity?: 'roster' | 'name'; allowGuests?: boolean } | null>(null);
  const [guest, setGuest] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [view, setView] = useState<AttemptView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [exempt, setExempt] = useState(false);
  const [warning, setWarning] = useState<{ count: number; left: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(typeof document !== 'undefined' && !!document.fullscreenElement);
  const warnedCount = useRef(0);
  const pending = useRef(new Map<string, unknown>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const remaining = useCountdown(view?.status === 'in_progress' ? deadline : null);

  const apply = useCallback((v: AttemptView) => {
    setView(v);
    setLocked(false);
    if (v.guardExempt !== undefined) setExempt(v.guardExempt);
    if (v.leaveCount !== undefined) warnedCount.current = Math.max(warnedCount.current, v.leaveCount);
    if (v.answers) setAnswers({ ...v.answers, ...Object.fromEntries(pending.current) });
    setDeadline(v.remainingSec !== null ? Date.now() + v.remainingSec * 1000 : null);
  }, []);

  const reload = useCallback(
    async (tok: string) => {
      try {
        apply(await studentApi<AttemptView>('GET', '/attempt', tok));
      } catch (e) {
        const err = e as StudentApiError;
        if (err.status === 423) {
          setLocked(true);
          return;
        }
        if (err.status === 401) {
          writeTestToken(pin, null);
          setToken(null);
          setView(null);
        }
        setError(err.message);
      }
    },
    [apply, pin],
  );

  // resume an attempt after reload, or load public info for the join form
  useEffect(() => {
    if (!pin) return;
    const tok = readTestToken(pin);
    if (tok) {
      setToken(tok);
      void reload(tok);
    }
    fetch(`/play/test/lookup?pin=${pin}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setInfo(d))
      .catch(() => undefined);
  }, []);

  // time is up -> ask the server (it expires and grades the attempt)
  useEffect(() => {
    if (view?.status === 'in_progress' && deadline !== null && remaining === 0 && token) {
      const h = setTimeout(() => void reload(token), 1500);
      return () => clearTimeout(h);
    }
  }, [remaining, view?.status, deadline, token, reload]);

  // retry answers that could not be saved (lost connection)
  useEffect(() => {
    if (!token) return;
    const i = setInterval(() => {
      for (const [qid] of pending.current) if (!timers.current.has(qid)) void save(qid);
    }, 3000);
    return () => clearInterval(i);
  }, [token]);

  const guard = view?.leaveGuard ?? null;
  const tracking = !!guard && guard.mode !== 'off' && !exempt;
  const fullscreenSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const needFullscreen = tracking && !!guard?.requireFullscreen && fullscreenSupported;

  // leave guard + heartbeat while the attempt runs (G3); also while locked, to notice an unlock
  useEffect(() => {
    if (!token || !(view?.status === 'in_progress' || locked)) return;
    const onStatus = (st: HeartbeatStatus) => {
      if (st.guardExempt !== exempt) setExempt(st.guardExempt);
      if (st.remainingSec !== null) setDeadline(Date.now() + st.remainingSec * 1000);
      setLocked((was) => {
        if (was && !st.locked && st.status === 'in_progress') void reload(token);
        return st.locked;
      });
      if (st.status !== 'in_progress') void reload(token);
    };
    const c = new GuardController({
      token,
      track: tracking && !locked,
      requireFullscreen: !!guard?.requireFullscreen,
      fullscreenSupported,
      onStatus,
      onReturn: (st) => {
        // warn mode: a counted leave shows a warning that must be confirmed (G5)
        if (guard?.mode === 'warn' && !st.guardExempt && !st.locked && st.leaveCount > warnedCount.current) {
          warnedCount.current = st.leaveCount;
          setWarning({ count: st.leaveCount, left: Math.max(0, st.maxLeaves - st.leaveCount) });
        }
      },
    });
    c.start();
    return () => c.stop();
  }, [token, view?.status, locked, tracking, exempt, guard?.mode, guard?.requireFullscreen, fullscreenSupported, reload]);

  useEffect(() => {
    const on = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const save = async (qid: string) => {
    if (!token || !pending.current.has(qid)) return;
    const payload = pending.current.get(qid);
    setSaveState((s) => ({ ...s, [qid]: 'saving' }));
    try {
      await studentApi('PUT', `/answers/${encodeURIComponent(qid)}`, token, { payload });
      if (pending.current.get(qid) === payload) pending.current.delete(qid);
      setSaveState((s) => ({ ...s, [qid]: pending.current.has(qid) ? 'pending' : 'saved' }));
    } catch (e) {
      const err = e as StudentApiError;
      setSaveState((s) => ({ ...s, [qid]: 'error' }));
      if (err.status === 423) {
        setLocked(true);
        return;
      }
      if (err.status === 409 || err.status === 401) {
        pending.current.delete(qid);
        setError(err.message);
        void reload(token);
      }
    }
  };

  const setAnswer = (qid: string, payload: unknown) => {
    setAnswers((a) => ({ ...a, [qid]: payload }));
    pending.current.set(qid, payload);
    setSaveState((s) => ({ ...s, [qid]: 'pending' }));
    clearTimeout(timers.current.get(qid));
    timers.current.set(
      qid,
      setTimeout(() => {
        timers.current.delete(qid);
        void save(qid);
      }, 400),
    );
  };

  const joinWithTicket = async (ticket: string) => {
    setError('');
    try {
      const r = await studentApi<{ playerToken: string }>('POST', '/join', null, { pin, ticket });
      writeTestToken(pin, r.playerToken);
      setToken(r.playerToken);
      await reload(r.playerToken);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await studentApi<{ playerToken: string }>('POST', '/join', null, { pin, name });
      writeTestToken(pin, r.playerToken);
      setToken(r.playerToken);
      await reload(r.playerToken);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!token) return;
    // must be called directly in the click handler (user gesture); unsupported devices (iPhone) skip it (G3.5)
    if (view?.leaveGuard?.requireFullscreen && view.leaveGuard.mode !== 'off' && !view.guardExempt && document.fullscreenEnabled) {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
    setBusy(true);
    try {
      apply(await studentApi<AttemptView>('POST', '/start', token));
      setIndex(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!token) return;
    setBusy(true);
    // flush pending answers first
    for (const [qid, h] of timers.current) {
      clearTimeout(h);
      timers.current.delete(qid);
    }
    for (const qid of [...pending.current.keys()]) await save(qid);
    try {
      apply(await studentApi<AttemptView>('POST', '/submit', token));
      setConfirmSubmit(false);
    } catch (e) {
      if ((e as StudentApiError).status === 423) {
        setConfirmSubmit(false);
        setLocked(true);
        return;
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <header className="flex items-center gap-3 bg-hra-700 px-4 py-2 text-white">
        <span className="flex-1 truncate font-semibold">{view?.title ?? info?.title ?? 'KvizHub'}</span>
        {view?.status === 'in_progress' && deadline !== null && (
          <span className={`rounded px-2 py-0.5 font-mono text-lg ${remaining <= 60 ? 'bg-amber-400 text-slate-900' : 'bg-white/15'}`} aria-label={t('test.remaining')} data-testid="test-timer">
            {formatTime(remaining)}
          </span>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col p-4">
        {error && (
          <p role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">
            {error}
          </p>
        )}
        {children}
      </main>
    </div>
  );

  if (token && locked)
    return shell(
      <div role="alert" className="m-auto w-full space-y-3 rounded-xl border-2 border-red-400 bg-white p-6 text-center shadow" data-testid="test-locked">
        <p className="text-4xl" aria-hidden="true">
          🔒
        </p>
        <p className="text-xl font-semibold">{t('guard.lockedTitle')}</p>
        <p className="text-slate-600">{t('guard.lockedHint')}</p>
      </div>,
    );

  if ((!token || !view) && info?.identity === 'roster' && !guest)
    return shell(
      <div className="m-auto flex w-full justify-center">
        <RosterCodeStep pin={pin} allowGuests={!!info.allowGuests} onTicket={(ticket) => joinWithTicket(ticket)} onGuest={() => setGuest(true)} />
      </div>,
    );

  if (!token || !view)
    return shell(
      <form onSubmit={join} className="m-auto w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow">
        <h1 className="text-xl font-bold text-hra-700">{info?.title ?? t('test.joinTitle')}</h1>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('play.pin')}</span>
          <input className="w-full rounded-md border border-slate-300 px-3 py-2 text-2xl tracking-widest" inputMode="numeric" required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{info?.requireName === false || guest ? t('play.nickname') : t('test.name')}</span>
          <input className="w-full rounded-md border border-slate-300 px-3 py-2 text-lg" autoComplete="name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} data-testid="test-name" />
          <span className="mt-1 block text-xs text-slate-500">{info?.requireName === false || guest ? t('play.nicknameHint') : t('test.nameHint')}</span>
        </label>
        <button type="submit" disabled={busy} className="w-full rounded-md bg-hra-600 py-3 text-lg font-bold text-white hover:bg-hra-700 disabled:bg-hra-500">
          {t('test.continue')}
        </button>
      </form>,
    );

  if (view.status === 'not_started')
    return shell(
      <div className="m-auto w-full space-y-4 rounded-xl bg-white p-6 shadow" data-testid="test-intro">
        <h1 className="text-2xl font-bold">{view.title}</h1>
        <p>{t('test.hello', { name: view.name })}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{t('test.questionCount', { count: view.questionCount })}</li>
          <li>{view.timeLimitMin ? t('test.timeLimit', { min: view.timeLimitMin }) : t('test.noTimeLimit')}</li>
          {view.closesAt && <li>{t('test.closesAt', { date: new Date(view.closesAt).toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }) })}</li>}
          <li>{t('test.autosave')}</li>
          {!view.allowBackNavigation && <li>{t('test.noBack')}</li>}
        </ul>
        {view.leaveGuard && view.leaveGuard.mode !== 'off' && !view.guardExempt && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="guard-intro">
            <p>{t('guard.intro')}</p>
            {view.leaveGuard.mode === 'warn' && view.leaveGuard.onExceed === 'lock' && <p className="mt-1">{t('guard.introLock')}</p>}
            {view.leaveGuard.requireFullscreen && <p className="mt-1">{t('guard.introFullscreen')}</p>}
          </div>
        )}
        <button onClick={start} disabled={busy} className="w-full rounded-md bg-emerald-600 py-3 text-lg font-bold text-white hover:bg-emerald-700 disabled:bg-emerald-300" data-testid="test-start">
          {t('test.start')}
        </button>
      </div>,
    );

  if (view.status === 'submitted' || view.status === 'expired') {
    const r = view.result;
    return shell(
      <div className="w-full space-y-4 rounded-xl bg-white p-6 shadow" data-testid="test-done">
        <h1 className="text-2xl font-bold">{view.status === 'expired' ? t('test.expired') : t('test.submitted')}</h1>
        {r?.shown !== 'none' && r?.percent !== undefined && r?.percent !== null && (
          <p className="text-4xl font-extrabold text-hra-700" data-testid="test-percent">
            {r.percent} %
          </p>
        )}
        {r?.shown === 'none' && <p>{t('test.resultsLater')}</p>}
        {r?.shown === 'full' && (
          <ol className="space-y-3">
            {r.questions?.map((q) => (
              <li key={q.number} className={`rounded-md border p-3 text-sm ${q.correct ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
                <p className="font-medium">
                  {q.number}. {q.prompt}
                </p>
                <p>
                  {q.correct ? '✓' : '✗'} {t('test.yourAnswer')}: {q.answer ?? t('test.noAnswer')}
                </p>
                {!q.correct && (
                  <p>
                    {t('play.correctWas')}: {q.correctText.join(' / ')}
                  </p>
                )}
                {q.explanation && <p className="mt-1 text-slate-600">{q.explanation}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>,
    );
  }

  const qs = view.questions ?? [];
  const q = qs[Math.min(index, qs.length - 1)];
  const answeredCount = qs.filter((x) => answers[x.id] !== undefined).length;
  if (!q) return shell(<p>{t('common.loading')}</p>);

  return shell(
    <div className="flex flex-1 flex-col gap-4">
      <nav aria-label={t('test.overview')} className="flex flex-wrap gap-1">
        {qs.map((x, i) => (
          <button
            key={x.id}
            onClick={() => setIndex(i)}
            disabled={!view.allowBackNavigation && i < index}
            aria-current={i === index ? 'step' : undefined}
            className={`h-9 w-9 rounded-md border text-sm font-semibold ${i === index ? 'border-hra-700 bg-hra-700 text-white' : answers[x.id] !== undefined ? 'border-emerald-600 bg-emerald-100' : 'border-slate-300 bg-white'} disabled:opacity-40`}
            aria-label={t('test.goTo', { n: i + 1 })}
          >
            {i + 1}
          </button>
        ))}
      </nav>
      <section className="rounded-xl bg-white p-4 shadow" data-testid="test-question">
        <p className="text-xs text-slate-500">{t('test.questionOf', { n: index + 1, total: qs.length })}</p>
        <h2 className="mt-1 text-xl font-semibold" data-testid="test-prompt">
          {q.prompt}
        </h2>
        <div className="mt-4">
          <TestAnswer key={q.id} q={q} value={answers[q.id]} onChange={(p) => setAnswer(q.id, p)} disabled={remaining === 0 && deadline !== null} />
        </div>
        <p className="mt-3 text-xs text-slate-500" aria-live="polite" data-testid="test-save-state">
          {saveState[q.id] ? t(`test.save.${saveState[q.id]}`) : ''}
        </p>
      </section>
      <div className="mt-auto flex flex-wrap gap-2">
        {view.allowBackNavigation && (
          <button className="rounded-md border border-slate-300 bg-white px-4 py-3" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            ← {t('test.prev')}
          </button>
        )}
        {index < qs.length - 1 ? (
          <button className="ml-auto rounded-md bg-hra-600 px-4 py-3 font-semibold text-white" onClick={() => setIndex(index + 1)} data-testid="test-next">
            {t('test.next')} →
          </button>
        ) : (
          <button className="ml-auto rounded-md bg-emerald-600 px-4 py-3 font-semibold text-white" onClick={() => setConfirmSubmit(true)} data-testid="test-submit">
            {t('test.submit')}
          </button>
        )}
      </div>
      {warning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-hra-900/80 p-4" role="alertdialog" aria-modal="true" aria-labelledby="guard-warning-text" data-testid="guard-warning">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 text-center">
            <p id="guard-warning-text" className="text-lg font-semibold">
              {t('guard.warning', { count: warning.count, left: warning.left })}
            </p>
            <button className="w-full rounded-md bg-hra-600 py-3 font-semibold text-white" onClick={() => setWarning(null)} autoFocus>
              {t('guard.understood')}
            </button>
          </div>
        </div>
      )}
      {needFullscreen && !isFullscreen && !warning && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-hra-900/80 p-4" role="alertdialog" aria-modal="true">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 text-center">
            <p className="font-semibold">{t('guard.fullscreenNeeded')}</p>
            <button className="w-full rounded-md bg-hra-600 py-3 font-semibold text-white" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)} autoFocus>
              {t('guard.backToFullscreen')}
            </button>
          </div>
        </div>
      )}
      {confirmSubmit && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-hra-900/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5">
            <p className="text-lg font-semibold">{t('test.confirmTitle')}</p>
            <p>{answeredCount < qs.length ? t('test.unanswered', { count: qs.length - answeredCount }) : t('test.allAnswered')}</p>
            <div className="flex gap-2">
              <button className="flex-1 rounded-md border border-slate-300 py-2" onClick={() => setConfirmSubmit(false)} autoFocus>
                {t('test.back')}
              </button>
              <button className="flex-1 rounded-md bg-emerald-600 py-2 font-semibold text-white" onClick={submit} disabled={busy} data-testid="test-confirm-submit">
                {t('test.submitNow')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
  );
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Controlled answer input for one question (test mode: answers can be changed until submit). */
function TestAnswer({ q, value, onChange, disabled }: { q: PublicQuestion; value: unknown; onChange: (p: unknown) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const v = (value ?? {}) as { indices?: number[]; order?: number[]; text?: string; value?: string };
  if (q.type === 'single' || q.type === 'truefalse' || q.type === 'multi') {
    const multi = q.type === 'multi';
    const selected = v.indices ?? [];
    return (
      <div className="grid gap-2" role={multi ? 'group' : 'radiogroup'}>
        {multi && <p className="text-sm text-slate-600">{t('play.multiHint')}</p>}
        {q.options.map((o, i) => {
          const on = selected.includes(i);
          const st = ANSWER_STYLES[i % ANSWER_STYLES.length]!;
          return (
            <button
              key={i}
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange({ indices: multi ? (on ? selected.filter((x) => x !== i) : [...selected, i].sort()) : [i] })}
              className={`flex items-center gap-3 rounded-lg border-2 p-3 text-left text-lg ${on ? 'border-hra-700 bg-indigo-50 font-semibold' : 'border-slate-200 bg-white'}`}
              data-testid={`test-option-${i}`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded ${st.bg}`}>
                <Shape index={i} className="h-5 w-5" />
              </span>
              <span className="flex-1">{o}</span>
              <span aria-hidden="true">{on ? (multi ? '☑' : '◉') : multi ? '☐' : '○'}</span>
            </button>
          );
        })}
      </div>
    );
  }
  if (q.type === 'order') {
    const order = v.order ?? q.options.map((_, i) => i);
    const move = (pos: number, dir: -1 | 1) => {
      const j = pos + dir;
      if (j < 0 || j >= order.length) return;
      const next = [...order];
      [next[pos], next[j]] = [next[j]!, next[pos]!];
      onChange({ order: next });
    };
    return (
      <ol className="space-y-2">
        <p className="text-sm text-slate-600">{t('test.orderHint')}</p>
        {order.map((i, pos) => (
          <li key={i} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-2">
            <span className="w-6 text-right font-semibold">{pos + 1}.</span>
            <span className="flex-1">{q.options[i]}</span>
            <button className="rounded px-2 py-1 hover:bg-slate-100" disabled={disabled || pos === 0} onClick={() => move(pos, -1)} aria-label={t('review.moveUp')}>
              ▲
            </button>
            <button className="rounded px-2 py-1 hover:bg-slate-100" disabled={disabled || pos === order.length - 1} onClick={() => move(pos, 1)} aria-label={t('review.moveDown')}>
              ▼
            </button>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div>
      <input
        className="w-full rounded-lg border border-slate-300 px-3 py-3 text-xl"
        inputMode={q.type === 'numeric' ? 'decimal' : 'text'}
        autoComplete="off"
        maxLength={q.type === 'numeric' ? 40 : 100}
        disabled={disabled}
        value={(q.type === 'numeric' ? v.value : v.text) ?? ''}
        onChange={(e) => onChange(q.type === 'numeric' ? { value: e.target.value } : { text: e.target.value })}
        aria-label={t(q.type === 'numeric' ? 'play.numberLabel' : 'play.textLabel')}
        data-testid="test-text-answer"
      />
      {q.type === 'numeric' && <p className="mt-1 text-sm text-slate-600">{t('play.numericHint')}</p>}
    </div>
  );
}
