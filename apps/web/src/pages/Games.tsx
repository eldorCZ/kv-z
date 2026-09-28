import { useEffect, useState } from 'react';
import { EmptyState } from '../ui/Feedback';
import { useTitle } from '../ui/useTitle';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api, ApiError } from '../api';
import { Button, ErrorBox, formatDate } from '../components/ui';

interface GameItem {
  id: string;
  quizTitle: string;
  pin: string;
  status: string;
  mode: string;
  createdAt: number;
}

export default function Games() {
  const { t } = useTranslation();
  useTitle(t('nav.games'));
  const [games, setGames] = useState<GameItem[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [mazu, setMazu] = useState<string | null>(null);
  const [hlaska, setHlaska] = useState('');

  useEffect(() => {
    api<{ games: GameItem[] }>('GET', '/api/v1/games')
      .then((r) => setGames(r.games))
      .catch((e) => setError(e as ApiError));
  }, []);

  /** Smazání je nevratné a bere s sebou odpovědi žáků, proto se ptáme jménem a datem. */
  const smaz = async (g: GameItem) => {
    const co = t(g.mode === 'test' ? 'games.deleteTest' : 'games.deleteGame');
    if (!confirm(t('games.deleteConfirm', { co, nazev: g.quizTitle, datum: formatDate(g.createdAt) }))) return;
    setError(null);
    setHlaska('');
    setMazu(g.id);
    try {
      await api('DELETE', `/api/v1/games/${g.id}`);
      setGames((old) => (old ?? []).filter((x) => x.id !== g.id));
      setHlaska(t('games.deleted'));
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setMazu(null);
    }
  };

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t('games.title')}</h1>
      <ErrorBox error={error} onClose={() => setError(null)} />
      {hlaska && (
        <p role="status" className="mb-3 rounded-md bg-success-soft px-3 py-2 text-sm text-success" data-testid="games-hlaska">
          {hlaska}
        </p>
      )}
      {games?.length === 0 && <EmptyState title={t('games.none')} />}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {games?.map((g) => {
          const bezi = g.status === 'lobby' || g.status === 'running';
          return (
            <li key={g.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <Link to={g.mode === 'test' ? `/tests/${g.id}` : `/games/${g.id}`} className="font-semibold text-primary hover:underline">
                  {g.quizTitle}
                </Link>
                {g.mode === 'test' && <span className="ml-2 rounded bg-info-soft px-1.5 py-0.5 text-xs font-semibold text-info">{t('games.testBadge')}</span>}
                <p className="text-xs text-muted">
                  {formatDate(g.createdAt)} · PIN {g.pin} · {t(`games.status.${g.status}`)}
                </p>
              </div>
              {g.mode !== 'test' && bezi && (
                <a className="text-sm text-primary hover:underline" href={`/host/${g.id}`} target="_blank" rel="noreferrer">
                  {t('games.openHost')}
                </a>
              )}
              {/* Nezakazujeme podle stavu v seznamu: hra může v „lobby" viset i po
                  restartu serveru, kdy už nikde neběží, a přesto by šla smazat.
                  O tom, jestli ještě běží, rozhoduje server a případně to odmítne. */}
              <Button
                variant="ghost"
                className="text-danger"
                disabled={mazu === g.id}
                onClick={() => void smaz(g)}
                data-testid={`delete-game-${g.id}`}
              >
                {t('games.delete')}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
