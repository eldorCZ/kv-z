import { hashSeed, type GameOverEvent, type HostState, type LeaderboardEvent, type LobbyUpdate, type PublicQuestion, type RevealEvent } from '@kvizhub/core/client';
import { useTitle } from '../ui/useTitle';
import { Check, Keyboard, Lock, LockOpen, Play, RotateCcw, SkipForward, Square, TriangleAlert } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { AnswerMark, answerStyle } from '../components/Shapes';
import { FullscreenButton, PinDisplay, Podium, QrFrame, Ranking, ShortcutsDialog, useFullscreen } from '../game/Board';
import { Stage, type StageTheme } from '../game/Stage';
import { TimerRing } from '../game/TimerRing';
import { call, createSocket, useCountdown, type GameSocket } from '../socket';
import { Logo } from '../ui/Logo';
import { Mascot } from '../ui/Mascot';
import { SchemeSwitcher } from '../ui/SchemeSwitcher';

const keyStorage = (gameId: string) => `lore-host-${gameId}`;

/** Projector + host controls (V9.3). Optimised for 1280x720: large type, 5 % safe margins, keyboard control. */
export default function Host() {
  const { t } = useTranslation();
  useTitle(t('titles.host'));
  const { gameId = '' } = useParams();
  const sock = useRef<GameSocket | null>(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [joinUrl, setJoinUrl] = useState('');
  const [qr, setQr] = useState('');
  const [state, setState] = useState<HostState | null>(null);
  const [lobby, setLobby] = useState<LobbyUpdate | null>(null);
  const [question, setQuestion] = useState<PublicQuestion | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [answered, setAnswered] = useState(0);
  const [reveal, setReveal] = useState<RevealEvent | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEvent | null>(null);
  const [over, setOver] = useState<GameOverEvent | null>(null);
  const [paused, setPaused] = useState(false);
  const [actionError, setActionError] = useState('');
  const [theme, setTheme] = useState<StageTheme | null>(null);
  const [help, setHelp] = useState(false);
  const previousRanks = useRef<Map<string, number> | undefined>(undefined);
  const fullscreen = useFullscreen();
  const remaining = useCountdown(state?.phase === 'question' ? deadline : null);

  useEffect(() => {
    // take the host key from the URL fragment, keep it for this tab and hide it from the projector
    const m = /key=([\w-]+)/.exec(window.location.hash);
    if (m) {
      try {
        sessionStorage.setItem(keyStorage(gameId), m[1]!);
      } catch {
        /* ignore */
      }
      history.replaceState(null, '', window.location.pathname);
    }
    let hostKey = m?.[1] ?? '';
    try {
      hostKey ||= sessionStorage.getItem(keyStorage(gameId)) ?? '';
    } catch {
      /* ignore */
    }

    const s = createSocket();
    sock.current = s;
    s.on('connect', async () => {
      const r = await call<{ state: HostState; lobby: LobbyUpdate; joinUrl: string; title: string; theme?: StageTheme }>(s, 'host_attach', { gameId, hostKey });
      if (!r.ok) return setError(r.error);
      setError('');
      setTitle(r.title);
      setJoinUrl(r.joinUrl);
      setState(r.state);
      setLobby(r.lobby);
      setTheme(r.theme ?? null);
      setQr(await QRCode.toDataURL(`${r.joinUrl}?pin=${r.lobby.pin}`, { margin: 1, width: 320 }));
    });
    s.on('host_state', (st) => {
      setState(st);
      setAnswered(st.answeredCount);
    });
    s.on('lobby_update', setLobby);
    s.on('question', (e) => {
      setQuestion(e.question);
      setDeadline(Date.now() + e.remainingMs);
      setReveal(null);
      setLeaderboard(null);
      setAnswered(0);
    });
    s.on('answer_count', (e) => setAnswered(e.answered));
    s.on('reveal', setReveal);
    s.on('leaderboard', (e) =>
      setLeaderboard((old) => {
        previousRanks.current = old ? new Map(old.top.map((x, i) => [x.nickname, i])) : undefined;
        return e;
      }),
    );
    s.on('game_over', setOver);
    s.on('paused', (e) => setPaused(e.paused));
    s.on('disconnect', () => setError(t('host.disconnected')));
    return () => {
      s.disconnect();
    };
  }, [gameId, t]);

  const cmd = useCallback(async (name: string, arg?: unknown) => {
    if (!sock.current) return;
    const r = arg === undefined ? await call(sock.current, name) : await call(sock.current, name, arg);
    setActionError(r.ok ? '' : r.error);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === '?') {
        e.preventDefault();
        setHelp(true);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        fullscreen.toggle();
      } else if (e.code === 'Space') {
        e.preventDefault();
        void cmd('next');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void cmd('reveal');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmd, fullscreen.toggle]);

  if (error && !state)
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6 text-fg">
        <div className="max-w-xl text-center">
          <Mascot pose="error" size={160} className="mx-auto mb-4" />
          <p className="text-2xl font-semibold" role="alert">
            {error}
          </p>
          <p className="mt-3 text-muted">{t('host.errorHint')}</p>
        </div>
      </div>
    );
  if (!state || !lobby) return <div className="min-h-screen bg-canvas" />;

  const phase = state.phase;
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      {phase === 'lobby' && (
        <>
          <HostButton onClick={() => cmd('start')} primary testId="host-start" icon={<Play aria-hidden="true" className="h-5 w-5" />}>
            {t('host.start')} <Kbd>{t('host.space')}</Kbd>
          </HostButton>
          <HostButton onClick={() => cmd('lock_lobby', { locked: !lobby.locked })} icon={lobby.locked ? <LockOpen aria-hidden="true" className="h-5 w-5" /> : <Lock aria-hidden="true" className="h-5 w-5" />}>
            {lobby.locked ? t('host.unlock') : t('host.lock')}
          </HostButton>
        </>
      )}
      {phase === 'question' && (
        <>
          <HostButton onClick={() => cmd('reveal')} primary testId="host-reveal">
            {t('host.reveal')} <Kbd>Enter</Kbd>
          </HostButton>
          <HostButton onClick={() => cmd('skip')} icon={<SkipForward aria-hidden="true" className="h-5 w-5" />}>
            {t('host.skip')}
          </HostButton>
        </>
      )}
      {(phase === 'reveal' || phase === 'leaderboard') && (
        <HostButton onClick={() => cmd('next')} primary testId="host-next">
          {t('host.next')} <Kbd>{t('host.space')}</Kbd>
        </HostButton>
      )}
      {phase !== 'finished' && (
        <HostButton
          icon={<Square aria-hidden="true" className="h-4 w-4" />}
          onClick={() => {
            if (confirm(t('host.confirmEnd'))) void cmd('end');
          }}
        >
          {t('host.end')}
        </HostButton>
      )}
      {phase === 'finished' && (
        <Link to={`/games/${gameId}`} className="inline-flex min-h-12 items-center rounded-md bg-primary px-5 text-lg font-semibold text-on-primary hover:bg-primary-hover">
          {t('host.results')}
        </Link>
      )}
    </div>
  );

  const shortcutKeys: [string, string][] = [
    [t('host.space'), t('game.keys.next')],
    ['Enter', t('game.keys.reveal')],
    ['T', t('game.keys.scheme')],
    ['F', t('game.keys.fullscreen')],
    ['?', t('game.keys.help')],
  ];

  return (
    <Stage theme={theme} seed={hashSeed(lobby.pin)} idleCursor testId="host-stage">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-[5vw] py-3">
        <Logo height={28} />
        <h1 className="mr-auto min-w-0 truncate text-xl font-bold">{title}</h1>
        {phase !== 'lobby' && phase !== 'finished' && (
          <span className="text-lg tabular">
            {t('host.questionOf', { n: state.index + 1, total: state.total })} · PIN <strong>{lobby.pin}</strong>
          </span>
        )}
        {controls}
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => setHelp(true)} aria-label={t('game.shortcutsHint')} title={t('game.shortcutsHint')} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-fg hover:bg-surface-2">
            <Keyboard aria-hidden="true" className="h-5 w-5" />
          </button>
          <FullscreenButton {...fullscreen} />
          <SchemeSwitcher hotkey />
        </span>
      </header>
      {(paused || error || actionError) && (
        <div role="alert" className="bg-accent px-[5vw] py-2 text-lg font-semibold text-on-accent">
          {paused ? t('host.paused') : error || actionError}
        </div>
      )}
      <ShortcutsDialog open={help} onClose={() => setHelp(false)} keys={shortcutKeys} />

      <main className="flex flex-1 flex-col px-[5vw] py-[4vh]">
        {phase === 'lobby' && (
          <div className="grid flex-1 content-center items-center gap-10 lg:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-6">
              <div className="rounded-lg bg-panel px-6 py-4">
                <p className="text-2xl text-muted">{t('host.joinAt')}</p>
                <p className="font-display text-4xl font-bold break-all text-primary">{joinUrl.replace(/^https?:\/\//, '')}</p>
              </div>
              <PinDisplay pin={lobby.pin} />
              {state.codeAlert && (
                <p role="alert" className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-lg font-semibold text-on-accent">
                  <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" /> {t('host.codeAlert')}
                </p>
              )}
            </div>
            {qr && <QrFrame src={qr} alt={t('game.qrAlt')} />}
            <section className="lg:col-span-2" aria-labelledby="players-heading">
              <p id="players-heading" className="mb-3 flex items-center gap-3 text-2xl font-semibold">
                <span className="rounded-pill bg-primary px-4 py-1 font-display text-3xl text-on-primary tabular">{lobby.players.length}</span>
                <span className="rounded-md bg-panel px-3 py-1">{t('host.players', { count: lobby.players.length })}</span>
                {lobby.locked && (
                  <span className="flex items-center gap-1 rounded-md bg-panel px-3 py-1 text-lg">
                    <Lock aria-hidden="true" className="h-4 w-4" /> {t('host.locked')}
                  </span>
                )}
              </p>
              {lobby.players.length === 0 && <p className="inline-block rounded-md bg-panel px-3 py-1 text-xl text-muted">{t('host.waiting')}</p>}
              <ul className="flex flex-wrap gap-3" aria-live="polite" data-testid="host-players">
                {lobby.players.map((p) => (
                  <li key={p.id} className="bubble flex items-center gap-1">
                    <span>
                      <button
                        className="rounded-pill bg-panel px-5 py-2 text-2xl font-semibold shadow-soft hover:bg-danger hover:text-on-danger"
                        title={t('host.kick')}
                        onClick={() => {
                          if (confirm(t('host.confirmKick', { nickname: p.nickname }))) void cmd('kick_player', { playerId: p.id });
                        }}
                      >
                        {p.nickname}
                        {p.guest ? ` (${t('host.guest')})` : ''}
                      </button>
                    </span>
                    {state.classGame && !p.guest && (
                      <button className="inline-flex h-11 w-11 items-center justify-center rounded-pill bg-panel hover:bg-surface-2" title={t('host.allowReturn')} aria-label={t('host.allowReturn')} onClick={() => void cmd('allow_return', { playerId: p.id })}>
                        <RotateCcw aria-hidden="true" className="h-5 w-5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {state.notJoined && state.notJoined.length > 0 && (
                <div className="mt-4 rounded-md bg-panel px-4 py-3 text-lg text-muted" data-testid="host-not-joined">
                  <p>{t('host.notJoined', { count: state.notJoined.length })}</p>
                  <p className="text-base">{state.notJoined.map((x) => x.name).join(', ')}</p>
                </div>
              )}
            </section>
          </div>
        )}

        {(phase === 'question' || phase === 'reveal') && question && (
          <div className="flex flex-1 flex-col gap-6">
            <div className="flex items-center gap-6">
              <p className="flex-1 rounded-lg bg-panel px-8 py-6 text-[clamp(1.75rem,3.2vw,3rem)] leading-tight font-bold shadow-soft" data-testid="host-prompt">
                {question.prompt}
              </p>
              {phase === 'question' && (
                <div className="flex flex-col items-center gap-2">
                  <TimerRing remaining={remaining} total={question.timeLimitSec} />
                  <span className="rounded-md bg-panel px-3 py-1 text-xl tabular" aria-label={t('host.answered', { answered, total: state.playerCount })}>
                    <strong className="font-display text-2xl">{answered}</strong>/{state.playerCount} {t('host.answeredShort')}
                  </span>
                </div>
              )}
            </div>
            {question.options.length > 0 && question.type !== 'order' && (
              <ul className="grid flex-1 auto-rows-fr grid-cols-2 gap-4">
                {question.options.map((o, i) => {
                  const correct = reveal?.correctDisplayed.includes(i);
                  const style = answerStyle(i);
                  return (
                    <li
                      key={i}
                      data-correct={reveal ? String(!!correct) : undefined}
                      className={`flex items-center gap-5 rounded-lg p-5 text-[clamp(1.5rem,2.6vw,2.5rem)] font-bold shadow-tile transition-opacity ${style.bg} ${style.fg} ${reveal && !correct ? 'opacity-40' : ''} ${correct ? 'reveal-pulse ring-4 ring-fg ring-offset-4 ring-offset-canvas' : ''}`}
                    >
                      <AnswerMark index={i} size="lg" />
                      <span className="flex-1">{o}</span>
                      {reveal && (
                        <span className="flex items-center gap-2 text-2xl">
                          {correct && (
                            <span className="flex items-center gap-1 rounded-pill bg-surface px-3 py-1 text-xl text-fg">
                              <Check aria-hidden="true" className="h-5 w-5 text-success" strokeWidth={3} />
                              {t('host.correctLabel')}
                            </span>
                          )}
                          <span className="tabular">{reveal.stats.distribution[i] ?? 0}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {question.type === 'order' && (
              <ol className="grid gap-3 text-3xl">
                {(reveal ? reveal.correctText : question.options).map((o, i) => (
                  <li key={i} className="rounded-lg bg-panel p-4 font-semibold shadow-soft">
                    {reveal ? `${i + 1}. ` : '• '}
                    {o}
                  </li>
                ))}
              </ol>
            )}
            {(question.type === 'short' || question.type === 'numeric') && !reveal && <p className="self-start rounded-lg bg-panel px-6 py-4 text-3xl text-muted">{t(`host.typeHint.${question.type}`)}</p>}
            {reveal && (
              <div className="pop-in rounded-lg bg-panel p-5 text-2xl shadow-soft" data-testid="host-reveal-box">
                {(question.type === 'short' || question.type === 'numeric') && (
                  <p className="reveal-pulse mb-2 flex items-center gap-2 text-4xl font-bold text-success">
                    <Check aria-hidden="true" className="h-9 w-9" strokeWidth={3} /> {reveal.correctText.join(' / ')}
                  </p>
                )}
                <p>{t('host.revealStats', { correct: reveal.stats.correct, total: reveal.stats.playerCount })}</p>
                {reveal.explanation && <p className="mt-2 text-muted">{reveal.explanation}</p>}
              </div>
            )}
          </div>
        )}

        {phase === 'leaderboard' && leaderboard && <Ranking title={t('host.leaderboard')} entries={leaderboard.top} previous={previousRanks.current} />}

        {phase === 'finished' && over && <Podium podium={over.podium} title={t('host.podium')} />}
      </main>
    </Stage>
  );
}

function HostButton({ children, onClick, primary, testId, icon }: { children: ReactNode; onClick: () => void; primary?: boolean; testId?: string; icon?: ReactNode }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`btn-press inline-flex min-h-12 items-center gap-2 rounded-md px-5 text-lg font-semibold ${primary ? 'bg-accent text-on-accent shadow-pop hover:brightness-95' : 'border border-line-strong bg-surface text-fg hover:bg-surface-2'}`}
    >
      {icon}
      {children}
    </button>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ml-1 rounded-sm border border-current px-1.5 text-sm opacity-80">{children}</kbd>;
}
