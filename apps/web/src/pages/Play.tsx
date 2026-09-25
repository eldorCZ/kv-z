import type { GameOverEvent, JoinResult, LeaderboardEvent, PublicQuestion, RevealEvent } from '@kvizhub/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ANSWER_STYLES, Shape } from '../components/Shapes';
import { call, createSocket, useCountdown, type GameSocket } from '../socket';

const TOKEN_KEY = 'kvizhub-player';

type View = 'join' | 'lobby' | 'question' | 'answered' | 'reveal' | 'leaderboard' | 'over' | 'kicked';

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function writeToken(v: string | null) {
  try {
    if (v) sessionStorage.setItem(TOKEN_KEY, v);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore – reconnect will not survive a reload */
  }
}

/** Student screen (mobile first). No account, only a nickname and a technical game token in sessionStorage. */
export default function Play() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const sock = useRef<GameSocket | null>(null);
  const [view, setView] = useState<View>('join');
  const [pin, setPin] = useState(params.get('pin')?.replace(/\D/g, '') ?? '');
  const [nickname, setNickname] = useState('');
  const [me, setMe] = useState<JoinResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState<PublicQuestion | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [reveal, setReveal] = useState<RevealEvent | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEvent | null>(null);
  const [over, setOver] = useState<GameOverEvent | null>(null);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(true);
  const answeredFor = useRef<string | null>(null);
  const remaining = useCountdown(view === 'question' ? deadline : null);

  useEffect(() => {
    const s = createSocket();
    sock.current = s;
    s.on('connect', async () => {
      setConnected(true);
      const token = readToken();
      if (!token) return;
      const r = await call<JoinResult>(s, 'reconnect_player', { token });
      if (r.ok) {
        setMe(r);
        setView((v) => (v === 'join' ? 'lobby' : v));
      } else {
        writeToken(null);
        setMe(null);
        setView('join');
      }
    });
    s.on('disconnect', () => setConnected(false));
    s.on('question', (e) => {
      setQuestion(e.question);
      setDeadline(Date.now() + e.remainingMs);
      setReveal(null);
      setView(answeredFor.current === e.question.id ? 'answered' : 'question');
    });
    s.on('answer_count', () => setView((v) => (v === 'question' || v === 'lobby' ? 'answered' : v)));
    s.on('reveal', (e) => {
      setReveal(e);
      setView('reveal');
    });
    s.on('leaderboard', (e) => {
      setLeaderboard(e);
      setView('leaderboard');
    });
    s.on('game_over', (e) => {
      setOver(e);
      setView('over');
      writeToken(null);
    });
    s.on('paused', (e) => setPaused(e.paused));
    s.on('kicked', () => {
      writeToken(null);
      setView('kicked');
    });
    return () => {
      s.disconnect();
    };
  }, []);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (!sock.current) return;
    setBusy(true);
    setError('');
    const r = await call<JoinResult>(sock.current, 'join', { pin, nickname });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    writeToken(r.token);
    setMe(r);
    setView((v) => (v === 'join' ? 'lobby' : v));
  };

  const answer = async (payload: unknown) => {
    if (!sock.current || !question) return;
    answeredFor.current = question.id;
    setView('answered');
    const r = await call(sock.current, 'answer', { questionId: question.id, payload });
    if (!r.ok) setError(r.error);
    else setError('');
  };

  const shell = (children: React.ReactNode, tone = 'bg-indigo-700') => (
    <div className={`flex min-h-screen flex-col ${tone} text-white`}>
      <header className="flex items-center justify-between px-4 py-2 text-sm">
        <span className="font-semibold">{me?.nickname ?? 'KvizHub'}</span>
        {question && view !== 'join' && view !== 'lobby' && view !== 'over' && (
          <span>
            {question.index + 1}/{question.total}
          </span>
        )}
      </header>
      {(!connected || paused) && (
        <div role="status" className="bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-slate-900">
          {!connected ? t('play.reconnecting') : t('play.paused')}
        </div>
      )}
      <main className="flex flex-1 flex-col p-4">{children}</main>
    </div>
  );

  if (view === 'join')
    return shell(
      <form onSubmit={join} className="m-auto w-full max-w-sm space-y-4 rounded-xl bg-white p-6 text-slate-900 shadow-lg">
        <h1 className="text-center text-2xl font-bold text-indigo-700">KvizHub</h1>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t('play.pin')}</span>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-3 text-center text-3xl tracking-widest"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            required
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            aria-label={t('play.pin')}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t('play.nickname')}</span>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-3 text-xl"
            autoComplete="off"
            minLength={2}
            maxLength={20}
            required
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            aria-label={t('play.nickname')}
          />
          <span className="mt-1 block text-xs text-slate-500">{t('play.nicknameHint')}</span>
        </label>
        {error && (
          <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="w-full rounded-md bg-indigo-600 py-3 text-xl font-bold text-white hover:bg-indigo-700 disabled:bg-indigo-300">
          {t('play.join')}
        </button>
        <p className="text-center text-xs text-slate-500">{t('play.privacy')}</p>
      </form>,
    );

  if (view === 'kicked') return shell(<p className="m-auto text-center text-2xl">{t('play.kicked')}</p>, 'bg-slate-800');

  if (view === 'lobby')
    return shell(
      <div className="m-auto text-center" data-testid="player-lobby">
        <p className="text-3xl font-bold">{t('play.inGame')}</p>
        <p className="mt-3 text-lg">{t('play.waitForStart')}</p>
      </div>,
    );

  if (view === 'answered')
    return shell(
      <div className="m-auto text-center" data-testid="player-answered">
        <p className="text-3xl font-bold">{t('play.answerSent')}</p>
        <p className="mt-3 text-lg">{t('play.waitForReveal')}</p>
        {error && <p className="mt-3 rounded bg-red-600 p-2">{error}</p>}
      </div>,
    );

  if (view === 'question' && question)
    return shell(
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex items-start gap-3">
          <p className="flex-1 text-xl font-semibold" data-testid="player-prompt">
            {question.prompt}
          </p>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-xl font-bold text-indigo-700" aria-label={t('host.remaining')}>
            {remaining}
          </span>
        </div>
        <AnswerInput q={question} onAnswer={answer} disabled={paused || remaining === 0} />
        {error && (
          <p role="alert" className="rounded bg-red-600 p-2 text-sm">
            {error}
          </p>
        )}
      </div>,
    );

  if (view === 'reveal' && reveal) {
    const you = reveal.you;
    const partial = you && !you.correct && you.points > 0;
    return shell(
      <div className="m-auto max-w-md text-center" data-testid="player-reveal">
        <p className="text-5xl" aria-hidden="true">
          {you?.correct ? '✓' : partial ? '½' : '✗'}
        </p>
        <p className="mt-2 text-3xl font-bold">{!you?.answered ? t('play.noAnswer') : you.correct ? t('play.correct') : partial ? t('play.partial') : t('play.wrong')}</p>
        {you && <p className="mt-2 text-xl">+{you.points} · {t('play.score', { score: you.score })}</p>}
        {you && you.streak > 1 && <p className="mt-1">{t('play.streak', { count: you.streak })}</p>}
        {you && <p className="mt-1 text-lg">{t('play.rank', { rank: you.rank })}</p>}
        {!you?.correct && reveal.correctText.length > 0 && (
          <p className="mt-4 rounded-lg bg-white/15 p-3 text-lg">
            {t('play.correctWas')}: <strong>{reveal.correctText.join(question?.type === 'order' ? ' → ' : ' / ')}</strong>
          </p>
        )}
        {reveal.explanation && <p className="mt-3 text-base opacity-90">{reveal.explanation}</p>}
      </div>,
      you?.correct ? 'bg-emerald-700' : partial ? 'bg-amber-600' : 'bg-rose-700',
    );
  }

  if (view === 'leaderboard' && leaderboard)
    return shell(
      <div className="m-auto text-center">
        <p className="text-2xl">{t('play.yourRank')}</p>
        <p className="text-6xl font-extrabold">{leaderboard.you?.rank}.</p>
        <p className="mt-2 text-xl">{t('play.score', { score: leaderboard.you?.score ?? 0 })}</p>
      </div>,
    );

  if (view === 'over' && over)
    return shell(
      <div className="m-auto text-center" data-testid="player-over">
        <p className="text-2xl">{t('play.gameOver')}</p>
        <p className="mt-2 text-6xl font-extrabold">{over.you?.rank}.</p>
        <p className="mt-2 text-xl">{t('play.score', { score: over.you?.score ?? 0 })}</p>
        <ol className="mt-6 space-y-1 text-left">
          {over.podium.map((p, i) => (
            <li key={i} className="rounded bg-white/10 px-3 py-2">
              {['🥇', '🥈', '🥉'][i]} {p.nickname} – {p.score}
            </li>
          ))}
        </ol>
      </div>,
    );

  return shell(<p className="m-auto">{t('common.loading')}</p>);
}

function AnswerInput({ q, onAnswer, disabled }: { q: PublicQuestion; onAnswer: (p: unknown) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<number[]>([]);
  const [text, setText] = useState('');
  const [order, setOrder] = useState<number[]>([]);

  useEffect(() => {
    setSelected([]);
    setText('');
    setOrder([]);
  }, [q.id]);

  if (q.type === 'single' || q.type === 'truefalse' || q.type === 'multi') {
    const multi = q.type === 'multi';
    return (
      <div className="flex flex-1 flex-col gap-3">
        {multi && <p className="text-sm">{t('play.multiHint')}</p>}
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
          {q.options.map((o, i) => {
            const st = ANSWER_STYLES[i % ANSWER_STYLES.length]!;
            const on = selected.includes(i);
            return (
              <button
                key={i}
                disabled={disabled}
                data-testid={`option-${i}`}
                aria-pressed={multi ? on : undefined}
                aria-label={`${st.label}: ${o}`}
                onClick={() => (multi ? setSelected(on ? selected.filter((x) => x !== i) : [...selected, i]) : onAnswer({ indices: [i] }))}
                className={`flex min-h-20 items-center gap-3 rounded-xl p-4 text-left text-xl font-semibold ${st.bg} ${on ? `ring-4 ${st.ring}` : ''} disabled:opacity-60`}
              >
                <Shape index={i} className="h-9 w-9 shrink-0" />
                <span className="flex-1">{o}</span>
                {multi && <span aria-hidden="true">{on ? '☑' : '☐'}</span>}
              </button>
            );
          })}
        </div>
        {multi && (
          <button disabled={disabled || selected.length === 0} onClick={() => onAnswer({ indices: selected })} className="rounded-xl bg-white py-4 text-xl font-bold text-indigo-700 disabled:opacity-50" data-testid="submit-answer">
            {t('play.submit')}
          </button>
        )}
      </div>
    );
  }

  if (q.type === 'order') {
    const rest = q.options.map((_, i) => i).filter((i) => !order.includes(i));
    return (
      <div className="flex flex-1 flex-col gap-3">
        <p className="text-sm">{t('play.orderHint')}</p>
        <ol className="space-y-2">
          {order.map((i, pos) => (
            <li key={i}>
              <button className="w-full rounded-lg bg-white p-3 text-left text-lg font-semibold text-indigo-800" onClick={() => setOrder(order.filter((x) => x !== i))}>
                {pos + 1}. {q.options[i]} <span className="float-right text-sm text-slate-400">✕</span>
              </button>
            </li>
          ))}
        </ol>
        <ul className="space-y-2">
          {rest.map((i) => (
            <li key={i}>
              <button className="w-full rounded-lg bg-white/15 p-3 text-left text-lg" onClick={() => setOrder([...order, i])} data-testid={`order-${i}`}>
                {q.options[i]}
              </button>
            </li>
          ))}
        </ul>
        <button disabled={disabled || rest.length > 0} onClick={() => onAnswer({ order })} className="mt-auto rounded-xl bg-white py-4 text-xl font-bold text-indigo-700 disabled:opacity-50" data-testid="submit-answer">
          {t('play.submit')}
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onAnswer(q.type === 'numeric' ? { value: text } : { text });
      }}
    >
      <input
        className="w-full rounded-lg px-4 py-4 text-2xl text-slate-900"
        inputMode={q.type === 'numeric' ? 'decimal' : 'text'}
        autoComplete="off"
        autoFocus
        maxLength={q.type === 'numeric' ? 40 : 100}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={t(q.type === 'numeric' ? 'play.numberLabel' : 'play.textLabel')}
        data-testid="text-answer"
        disabled={disabled}
      />
      {q.type === 'numeric' && <p className="text-sm">{t('play.numericHint')}</p>}
      <button type="submit" disabled={disabled || !text.trim()} className="rounded-xl bg-white py-4 text-xl font-bold text-indigo-700 disabled:opacity-50" data-testid="submit-answer">
        {t('play.submit')}
      </button>
    </form>
  );
}
