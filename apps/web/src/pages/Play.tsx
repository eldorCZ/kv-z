import { hashSeed, type GameOverEvent, type JoinResult, type LeaderboardEvent, type PublicQuestion, type RevealEvent } from '@kvizhub/core/client';
import { useTitle } from '../ui/useTitle';
import { Check, CircleSlash, Hourglass, LoaderCircle, SquareCheck, Square, X, Medal } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import RosterCodeStep from '../classes/RosterCodeStep';
import { AnswerMark, answerStyle } from '../components/Shapes';
import { Stage, type StageTheme } from '../game/Stage';
import { TimeBar, TimerRing } from '../game/TimerRing';
import { call, createSocket, useCountdown, type GameSocket } from '../socket';
import { Logo } from '../ui/Logo';
import { Mascot } from '../ui/Mascot';
import { SchemeSwitcher } from '../ui/SchemeSwitcher';

const TOKEN_KEY = 'lore-player';
/** PIN of the joined game, only to seed the same background picture as the projector after a reload */
const PIN_KEY = 'lore-player-pin';

type View = 'join' | 'lobby' | 'question' | 'answered' | 'reveal' | 'leaderboard' | 'over' | 'kicked';

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function readPin(): string {
  try {
    return sessionStorage.getItem(PIN_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeToken(v: string | null, pin?: string) {
  try {
    if (v) sessionStorage.setItem(TOKEN_KEY, v);
    else sessionStorage.removeItem(TOKEN_KEY);
    if (v && pin) sessionStorage.setItem(PIN_KEY, pin);
    if (!v) sessionStorage.removeItem(PIN_KEY);
  } catch {
    /* ignore – reconnect will not survive a reload */
  }
}

/** Student screen (mobile first). No account, only a nickname and a technical game token in sessionStorage. */
export default function Play() {
  const { t } = useTranslation();
  useTitle(t('titles.play'));
  const [params] = useSearchParams();
  const navigate = useNavigate();
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
  const [theme, setTheme] = useState<StageTheme | null>(null);
  const answeredFor = useRef<string | null>(null);
  const remaining = useCountdown(view === 'question' ? deadline : null);

  useEffect(() => {
    const s = createSocket();
    sock.current = s;
    s.on('connect', async () => {
      setConnected(true);
      const token = readToken();
      if (!token) return;
      const r = await call<JoinResult & { theme?: StageTheme }>(s, 'reconnect_player', { token });
      if (r.ok) {
        setMe(r);
        setTheme(r.theme ?? null);
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

  /** A PIN can belong to a live game or a test; class games need a personal code (Dodatek 3, C5). */
  const [roster, setRoster] = useState<{ allowGuests: boolean } | null>(null);
  const [guest, setGuest] = useState(false);
  const lookup = async (p: string): Promise<{ mode: string; identity: string; allowGuests: boolean } | null> => {
    if (!p) return null;
    try {
      const r = await fetch(`/play/roster/lookup?pin=${encodeURIComponent(p)}`);
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const p = params.get('pin')?.replace(/\D/g, '');
    if (p && !readToken())
      void lookup(p).then((info) => {
        if (info?.mode === 'test') navigate(`/test?pin=${p}`, { replace: true });
        else if (info?.identity === 'roster') setRoster({ allowGuests: info.allowGuests });
      });
  }, []);

  const finishJoin = (r: { ok: true } & JoinResult & { theme?: StageTheme }) => {
    writeToken(r.token, pin);
    setMe(r);
    setTheme(r.theme ?? null);
    setView((v) => (v === 'join' ? 'lobby' : v));
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (!sock.current) return;
    setBusy(true);
    setError('');
    const info = await lookup(pin);
    if (info?.mode === 'test') {
      setBusy(false);
      return navigate(`/test?pin=${pin}&name=${encodeURIComponent(nickname)}`);
    }
    if (info?.identity === 'roster' && !guest) {
      setBusy(false);
      return setRoster({ allowGuests: info.allowGuests });
    }
    if (!nickname.trim()) {
      setBusy(false);
      return setError(t('play.nicknameHint'));
    }
    const r = await call<JoinResult & { theme?: StageTheme }>(sock.current, 'join', { pin, nickname });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    finishJoin(r);
  };

  const joinWithTicket = async (ticket: string) => {
    if (!sock.current) return;
    const r = await call<JoinResult & { theme?: StageTheme }>(sock.current, 'join', { pin, ticket });
    if (!r.ok) {
      setRoster(null);
      return setError(r.error);
    }
    finishJoin(r);
  };

  const answer = async (payload: unknown) => {
    if (!sock.current || !question) return;
    answeredFor.current = question.id;
    setView('answered');
    const r = await call(sock.current, 'answer', { questionId: question.id, payload });
    if (!r.ok) setError(r.error);
    else setError('');
  };

  const seed = hashSeed(pin || readPin());
  // before joining, the PIN screen always has the default Lore look (V7.3)
  const shell = (children: ReactNode) => (
    <Stage theme={me ? theme : null} seed={seed} testId="play-stage">
      <header className="flex min-h-12 items-center justify-between gap-3 bg-panel px-4 py-1 text-base shadow-soft">
        {me?.nickname ? (
          <span className="truncate font-semibold" data-testid="player-name">
            {me.nickname}
          </span>
        ) : (
          <Logo variant="mark" height={28} />
        )}
        <span className="flex items-center gap-3">
          {question && view !== 'join' && view !== 'lobby' && view !== 'over' && (
            <span className="tabular">
              {question.index + 1}/{question.total}
            </span>
          )}
          <SchemeSwitcher />
        </span>
      </header>
      {(!connected || paused) && (
        <div role="status" className="flex items-center justify-center gap-2 bg-accent px-4 py-2 text-center text-base font-semibold text-on-accent" data-testid="reconnect-bar">
          {!connected ? <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" /> : <Hourglass aria-hidden="true" className="h-5 w-5" />}
          {!connected ? t('play.reconnecting') : t('play.paused')}
        </div>
      )}
      <main className="flex flex-1 flex-col p-4">{children}</main>
    </Stage>
  );

  if (view === 'join' && roster && !guest)
    return shell(
      <div className="m-auto flex w-full justify-center">
        <RosterCodeStep pin={pin} allowGuests={roster.allowGuests} onTicket={(ticket) => joinWithTicket(ticket)} onGuest={() => setGuest(true)} dark />
      </div>,
    );

  if (view === 'join')
    return shell(
      <form onSubmit={join} className="m-auto w-full max-w-sm space-y-5 rounded-lg bg-panel p-6 text-fg shadow-pop">
        <h1 className="flex justify-center py-1">
          <Logo height={52} />
        </h1>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t('play.pin')}</span>
          <input
            className="min-h-16 w-full rounded-md border-2 border-line-strong bg-surface px-3 py-3 text-center font-display text-4xl tracking-[0.2em] tabular"
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
            className="min-h-14 w-full rounded-md border-2 border-line-strong bg-surface px-3 py-3 text-xl"
            autoComplete="off"
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            aria-label={t('play.nickname')}
          />
          <span className="mt-1 block text-xs text-muted">{t('play.nicknameHint')}</span>
        </label>
        {error && (
          <p role="alert" className="rounded bg-danger-soft p-2 text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn-press min-h-14 w-full rounded-md bg-primary py-3 text-xl font-bold text-on-primary shadow-pop hover:bg-primary-hover disabled:opacity-50">
          {t('play.join')}
        </button>
        <p className="text-center text-xs text-muted">{t('play.privacy')}</p>
      </form>,
    );

  if (view === 'kicked') return shell(<Card>{t('play.kicked')}</Card>);

  if (view === 'lobby')
    return shell(
      <Card testId="player-lobby">
        <p className="text-3xl font-bold">{me?.nickname ? t('play.inGameAs', { name: me.nickname }) : t('play.inGame')}</p>
        <p className="mt-3 text-lg text-muted">{t('play.waitForStart')}</p>
        <Mascot pose="hello" size={120} className="mx-auto mt-4" />
      </Card>,
    );

  if (view === 'answered')
    return shell(
      <Card testId="player-answered">
        <Check aria-hidden="true" className="mx-auto mb-2 h-12 w-12 text-primary" strokeWidth={3} />
        <p className="text-3xl font-bold">{t('play.answerSent')}</p>
        <p className="mt-3 text-lg text-muted">{t('play.waitForReveal')}</p>
        {error && <p className="mt-3 rounded-md bg-danger p-2 text-on-danger">{error}</p>}
      </Card>,
    );

  if (view === 'question' && question)
    return shell(
      <div className="flex flex-1 flex-col gap-4">
        <TimeBar remaining={remaining} total={question.timeLimitSec} />
        <div className="flex items-center gap-3 rounded-lg bg-panel p-4 shadow-soft">
          <p className="flex-1 text-xl font-bold" data-testid="player-prompt">
            {question.prompt}
          </p>
          <TimerRing remaining={remaining} total={question.timeLimitSec} size="md" />
        </div>
        <AnswerInput q={question} onAnswer={answer} disabled={paused || remaining === 0} />
        {error && (
          <p role="alert" className="rounded bg-danger p-2 text-sm text-on-danger">
            {error}
          </p>
        )}
      </div>,
    );

  if (view === 'reveal' && reveal) {
    const you = reveal.you;
    const partial = you && !you.correct && you.points > 0;
    const kind = !you?.answered ? 'none' : you.correct ? 'ok' : partial ? 'partial' : 'wrong';
    const Icon = { ok: Check, partial: SquareCheck, wrong: X, none: CircleSlash }[kind];
    const tone = { ok: 'bg-success-strong text-on-success', partial: 'bg-accent text-on-accent', wrong: 'bg-danger text-on-danger', none: 'bg-panel-2 text-fg' }[kind];
    return shell(
      <div className="m-auto w-full max-w-md text-center" data-testid="player-reveal" data-result={kind}>
        <div className={`pop-in rounded-lg p-6 shadow-pop ${tone}`}>
          <Icon aria-hidden="true" className="mx-auto h-16 w-16" strokeWidth={3} />
          <p className="mt-2 text-3xl font-bold">{kind === 'none' ? t('play.noAnswer') : kind === 'ok' ? t('play.correct') : kind === 'partial' ? t('play.partial') : t('play.wrong')}</p>
          {you && (
            <p className="mt-2 text-xl">
              +{you.points} · {t('play.score', { score: you.score })}
            </p>
          )}
          {you && you.streak > 1 && <p className="mt-1">{t('play.streak', { count: you.streak })}</p>}
          {you && <p className="mt-1 text-lg">{t('play.rank', { rank: you.rank })}</p>}
        </div>
        {!you?.correct && reveal.correctText.length > 0 && (
          <p className="mt-4 rounded-lg bg-panel p-3 text-lg">
            {t('play.correctWas')}: <strong>{reveal.correctText.join(question?.type === 'order' ? ' → ' : ' / ')}</strong>
          </p>
        )}
        {reveal.explanation && <p className="mt-3 rounded-lg bg-panel p-3 text-base text-muted">{reveal.explanation}</p>}
      </div>,
    );
  }

  if (view === 'leaderboard' && leaderboard)
    return shell(
      <Card>
        <p className="text-2xl">{t('play.yourRank')}</p>
        <p className="font-display text-7xl font-bold text-primary tabular">{leaderboard.you?.rank}.</p>
        <p className="mt-2 text-xl">{t('play.score', { score: leaderboard.you?.score ?? 0 })}</p>
      </Card>,
    );

  if (view === 'over' && over)
    return shell(
      <Card testId="player-over">
        <p className="text-2xl">{t('play.gameOver')}</p>
        <p className="mt-2 font-display text-7xl font-bold text-primary tabular">{over.you?.rank}.</p>
        <p className="mt-2 text-xl">{t('play.score', { score: over.you?.score ?? 0 })}</p>
        <ol className="mt-6 space-y-2 text-left">
          {over.podium.map((p, i) => (
            <li key={i} className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2">
              <Medal aria-hidden="true" className={`h-5 w-5 ${i === 0 ? 'text-warning' : 'text-muted'}`} />
              <span className="font-semibold tabular">{i + 1}.</span>
              <span className="flex-1 truncate">{p.nickname}</span>
              <span className="tabular">{p.score}</span>
            </li>
          ))}
        </ol>
      </Card>,
    );

  return shell(<p className="m-auto rounded-md bg-panel px-4 py-2">{t('common.loading')}</p>);
}

/** Centered message card above the motive */
function Card({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="pop-in m-auto w-full max-w-md rounded-lg bg-panel p-6 text-center shadow-pop" data-testid={testId}>
      {children}
    </div>
  );
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

  const choice = q.type === 'single' || q.type === 'truefalse' || q.type === 'multi';
  // keyboard: A–E or 1–5 picks an answer, Enter confirms a multi-select (V9.3, V11.1)
  useEffect(() => {
    if (!choice) return;
    const onKey = (e: KeyboardEvent) => {
      if (disabled || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      const i = /^[1-5]$/.test(k) ? Number(k) - 1 : /^[a-e]$/.test(k) ? k.charCodeAt(0) - 97 : -1;
      if (i >= 0 && i < q.options.length) {
        e.preventDefault();
        if (q.type === 'multi') setSelected((sel) => (sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]));
        else onAnswer({ indices: [i] });
      } else if (e.key === 'Enter' && q.type === 'multi' && selected.length > 0 && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        onAnswer({ indices: selected });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choice, disabled, q, selected, onAnswer]);

  if (choice) {
    const multi = q.type === 'multi';
    return (
      <div className="flex flex-1 flex-col gap-3">
        {multi && <p className="self-start rounded-md bg-panel px-3 py-1 text-base">{t('play.multiHint')}</p>}
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
          {q.options.map((o, i) => {
            const st = answerStyle(i);
            const on = selected.includes(i);
            return (
              <button
                key={i}
                disabled={disabled}
                data-testid={`option-${i}`}
                aria-pressed={multi ? on : undefined}
                aria-label={`${st.letter}, ${st.label}: ${o}`}
                onClick={() => (multi ? setSelected(on ? selected.filter((x) => x !== i) : [...selected, i]) : onAnswer({ indices: [i] }))}
                className={`btn-press flex min-h-20 items-center gap-3 rounded-lg p-4 text-left text-xl font-bold shadow-tile ${st.bg} ${st.fg} ${on ? 'ring-4 ring-fg ring-offset-2 ring-offset-canvas' : ''} disabled:opacity-60`}
              >
                <AnswerMark index={i} />
                <span className="flex-1">{o}</span>
                {multi && (on ? <SquareCheck aria-hidden="true" className="h-7 w-7" /> : <Square aria-hidden="true" className="h-7 w-7" />)}
              </button>
            );
          })}
        </div>
        {multi && (
          <button disabled={disabled || selected.length === 0} onClick={() => onAnswer({ indices: selected })} className="btn-press min-h-14 rounded-lg bg-primary py-4 text-xl font-bold text-on-primary shadow-pop disabled:opacity-50" data-testid="submit-answer">
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
        <p className="self-start rounded-md bg-panel px-3 py-1 text-base">{t('play.orderHint')}</p>
        <ol className="space-y-2">
          {order.map((i, pos) => (
            <li key={i}>
              <button className="flex min-h-14 w-full items-center gap-2 rounded-lg border-2 border-primary bg-surface p-3 text-left text-lg font-semibold text-primary" onClick={() => setOrder(order.filter((x) => x !== i))}>
                <span className="tabular">{pos + 1}.</span>
                <span className="flex-1">{q.options[i]}</span>
                <X aria-hidden="true" className="h-5 w-5 text-muted" />
              </button>
            </li>
          ))}
        </ol>
        <ul className="space-y-2">
          {rest.map((i) => (
            <li key={i}>
              <button className="min-h-14 w-full rounded-lg bg-panel p-3 text-left text-lg shadow-soft" onClick={() => setOrder([...order, i])} data-testid={`order-${i}`}>
                {q.options[i]}
              </button>
            </li>
          ))}
        </ul>
        <button disabled={disabled || rest.length > 0} onClick={() => onAnswer({ order })} className="btn-press mt-auto min-h-14 rounded-lg bg-primary py-4 text-xl font-bold text-on-primary shadow-pop disabled:opacity-50" data-testid="submit-answer">
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
        className="min-h-16 w-full rounded-lg border-2 border-line-strong bg-surface px-4 py-4 text-2xl text-fg"
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
      {q.type === 'numeric' && <p className="self-start rounded-md bg-panel px-3 py-1 text-base">{t('play.numericHint')}</p>}
      <button type="submit" disabled={disabled || !text.trim()} className="btn-press min-h-14 rounded-lg bg-primary py-4 text-xl font-bold text-on-primary shadow-pop disabled:opacity-50" data-testid="submit-answer">
        {t('play.submit')}
      </button>
    </form>
  );
}
