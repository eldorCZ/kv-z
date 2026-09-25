import type { GameOverEvent, HostState, LeaderboardEvent, LobbyUpdate, PublicQuestion, RevealEvent } from '@kvizhub/core';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { ANSWER_STYLES, Shape } from '../components/Shapes';
import { call, createSocket, useCountdown, type GameSocket } from '../socket';

const keyStorage = (gameId: string) => `kvizhub-host-${gameId}`;

/** Projector + host controls. Optimised for 1280x720: high contrast, large type. */
export default function Host() {
  const { t } = useTranslation();
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
      const r = await call<{ state: HostState; lobby: LobbyUpdate; joinUrl: string; title: string }>(s, 'host_attach', { gameId, hostKey });
      if (!r.ok) return setError(r.error);
      setError('');
      setTitle(r.title);
      setJoinUrl(r.joinUrl);
      setState(r.state);
      setLobby(r.lobby);
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
    s.on('leaderboard', setLeaderboard);
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        void cmd('next');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void cmd('reveal');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmd]);

  if (error && !state)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-white">
        <div className="max-w-xl text-center">
          <p className="text-2xl font-semibold" role="alert">
            {error}
          </p>
          <p className="mt-3 text-slate-300">{t('host.errorHint')}</p>
        </div>
      </div>
    );
  if (!state || !lobby) return <div className="min-h-screen bg-slate-900" />;

  const phase = state.phase;
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      {phase === 'lobby' && (
        <>
          <HostButton onClick={() => cmd('start')} primary testId="host-start">
            ▶ {t('host.start')} <Kbd>{t('host.space')}</Kbd>
          </HostButton>
          <HostButton onClick={() => cmd('lock_lobby', { locked: !lobby.locked })}>{lobby.locked ? t('host.unlock') : t('host.lock')}</HostButton>
        </>
      )}
      {phase === 'question' && (
        <>
          <HostButton onClick={() => cmd('reveal')} primary testId="host-reveal">
            {t('host.reveal')} <Kbd>Enter</Kbd>
          </HostButton>
          <HostButton onClick={() => cmd('skip')}>{t('host.skip')}</HostButton>
        </>
      )}
      {(phase === 'reveal' || phase === 'leaderboard') && (
        <HostButton onClick={() => cmd('next')} primary testId="host-next">
          {t('host.next')} <Kbd>{t('host.space')}</Kbd>
        </HostButton>
      )}
      {phase !== 'finished' && (
        <HostButton
          onClick={() => {
            if (confirm(t('host.confirmEnd'))) void cmd('end');
          }}
        >
          {t('host.end')}
        </HostButton>
      )}
      {phase === 'finished' && (
        <Link to={`/games/${gameId}`} className="rounded-lg bg-white px-5 py-3 text-lg font-semibold text-slate-900">
          {t('host.results')}
        </Link>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white">
      <header className="flex flex-wrap items-center gap-4 bg-slate-950 px-6 py-3">
        <h1 className="mr-auto truncate text-xl font-semibold">{title}</h1>
        {phase !== 'lobby' && phase !== 'finished' && (
          <span className="text-lg">
            {t('host.questionOf', { n: state.index + 1, total: state.total })} · PIN <strong>{lobby.pin}</strong>
          </span>
        )}
        {controls}
      </header>
      {(paused || error || actionError) && (
        <div role="alert" className="bg-amber-400 px-6 py-2 text-lg font-semibold text-slate-900">
          {paused ? t('host.paused') : error || actionError}
        </div>
      )}

      <main className="flex flex-1 flex-col p-6">
        {phase === 'lobby' && (
          <div className="grid flex-1 items-center gap-8 md:grid-cols-[1fr_auto]">
            <div>
              <p className="text-3xl">{t('host.joinAt')}</p>
              <p className="mt-2 break-all text-4xl font-bold text-amber-300">{joinUrl.replace(/^https?:\/\//, '')}</p>
              <p className="mt-6 text-3xl">{t('host.pinLabel')}</p>
              <p className="text-8xl font-extrabold tracking-widest" data-testid="host-pin">
                {lobby.pin.replace(/(\d{3})(\d+)/, '$1 $2')}
              </p>
              <p className="mt-6 text-2xl">
                {t('host.players', { count: lobby.players.length })} {lobby.locked && `· 🔒 ${t('host.locked')}`}
              </p>
              <ul className="mt-3 flex flex-wrap gap-2" aria-live="polite">
                {lobby.players.map((p) => (
                  <li key={p.id}>
                    <button
                      className="rounded-full bg-white/10 px-4 py-2 text-xl hover:bg-red-600"
                      title={t('host.kick')}
                      onClick={() => {
                        if (confirm(t('host.confirmKick', { nickname: p.nickname }))) void cmd('kick_player', { playerId: p.id });
                      }}
                    >
                      {p.nickname}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {qr && <img src={qr} alt={t('game.qrAlt')} className="h-80 w-80 rounded-lg bg-white p-2" />}
          </div>
        )}

        {(phase === 'question' || phase === 'reveal') && question && (
          <div className="flex flex-1 flex-col gap-6">
            <div className="flex items-start gap-6">
              <p className="flex-1 text-4xl leading-tight font-bold" data-testid="host-prompt">
                {question.prompt}
              </p>
              {phase === 'question' && (
                <div className="flex flex-col items-center">
                  <span className="flex h-24 w-24 items-center justify-center rounded-full bg-indigo-600 text-5xl font-bold" aria-label={t('host.remaining')}>
                    {remaining}
                  </span>
                  <span className="mt-2 text-xl">{t('host.answered', { answered, total: state.playerCount })}</span>
                </div>
              )}
            </div>
            {question.options.length > 0 && question.type !== 'order' && (
              <ul className="grid flex-1 grid-cols-2 gap-4">
                {question.options.map((o, i) => {
                  const correct = reveal?.correctDisplayed.includes(i);
                  const style = ANSWER_STYLES[i % ANSWER_STYLES.length]!;
                  return (
                    <li key={i} className={`flex items-center gap-4 rounded-xl p-5 text-3xl font-semibold ${style.bg} ${reveal && !correct ? 'opacity-35' : ''}`}>
                      <Shape index={i} className="h-12 w-12 shrink-0" />
                      <span className="flex-1">{o}</span>
                      {reveal && (
                        <span className="text-2xl">
                          {correct && '✓ '}
                          {reveal.stats.distribution[i] ?? 0}
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
                  <li key={i} className="rounded-xl bg-white/10 p-4">
                    {reveal ? `${i + 1}. ` : '• '}
                    {o}
                  </li>
                ))}
              </ol>
            )}
            {(question.type === 'short' || question.type === 'numeric') && !reveal && <p className="text-3xl text-slate-300">{t(`host.typeHint.${question.type}`)}</p>}
            {reveal && (
              <div className="rounded-xl bg-white/10 p-5 text-2xl" data-testid="host-reveal-box">
                {(question.type === 'short' || question.type === 'numeric') && (
                  <p className="mb-2 text-4xl font-bold text-emerald-300">✓ {reveal.correctText.join(' / ')}</p>
                )}
                <p>{t('host.revealStats', { correct: reveal.stats.correct, total: reveal.stats.playerCount })}</p>
                {reveal.explanation && <p className="mt-2 text-slate-200">{reveal.explanation}</p>}
              </div>
            )}
          </div>
        )}

        {phase === 'leaderboard' && leaderboard && <Ranking title={t('host.leaderboard')} entries={leaderboard.top} />}

        {phase === 'finished' && over && (
          <div className="flex flex-1 flex-col items-center justify-center gap-8">
            <h2 className="text-5xl font-extrabold">{t('host.podium')}</h2>
            <div className="flex items-end gap-6" data-testid="podium">
              {[1, 0, 2].map((i) => {
                const p = over.podium[i];
                if (!p) return null;
                const h = ['h-64', 'h-48', 'h-36'][i];
                const medal = ['🥇', '🥈', '🥉'][i];
                return (
                  <div key={i} className="flex w-56 flex-col items-center">
                    <span className="mb-2 text-center text-3xl font-bold break-all">{p.nickname}</span>
                    <span className="mb-2 text-2xl">{p.score}</span>
                    <div className={`${h} flex w-full items-start justify-center rounded-t-xl bg-indigo-600 pt-4 text-6xl`}>{medal}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Ranking({ title, entries }: { title: string; entries: { nickname: string; score: number; rank: number }[] }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <h2 className="mb-6 text-center text-5xl font-extrabold">{title}</h2>
      <ol className="space-y-3">
        {entries.map((e, i) => (
          <li key={i} className="flex items-center gap-4 rounded-xl bg-white/10 px-6 py-4 text-3xl">
            <span className="w-12 font-bold">{e.rank}.</span>
            <span className="flex-1 truncate">{e.nickname}</span>
            <span className="font-mono">{e.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function HostButton({ children, onClick, primary, testId }: { children: React.ReactNode; onClick: () => void; primary?: boolean; testId?: string }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`rounded-lg px-5 py-3 text-lg font-semibold ${primary ? 'bg-amber-400 text-slate-900 hover:bg-amber-300' : 'bg-white/15 text-white hover:bg-white/25'}`}
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ml-2 rounded border border-current px-1.5 text-sm opacity-70">{children}</kbd>;
}
