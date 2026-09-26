import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api, ApiError } from '../api';
import { ErrorBox, formatDate } from '../components/ui';

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
  const [games, setGames] = useState<GameItem[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    api<{ games: GameItem[] }>('GET', '/api/v1/games')
      .then((r) => setGames(r.games))
      .catch((e) => setError(e as ApiError));
  }, []);
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t('games.title')}</h1>
      <ErrorBox error={error} />
      {games?.length === 0 && <p className="text-muted">{t('games.none')}</p>}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {games?.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="flex-1">
              <Link to={g.mode === 'test' ? `/tests/${g.id}` : `/games/${g.id}`} className="font-semibold text-primary hover:underline">
                {g.quizTitle}
              </Link>
              {g.mode === 'test' && <span className="ml-2 rounded bg-info-soft px-1.5 py-0.5 text-xs font-semibold text-info">{t('games.testBadge')}</span>}
              <p className="text-xs text-muted">
                {formatDate(g.createdAt)} · PIN {g.pin} · {t(`games.status.${g.status}`)}
              </p>
            </div>
            {g.mode !== 'test' && (g.status === 'lobby' || g.status === 'running') && (
              <a className="text-sm text-primary hover:underline" href={`/host/${g.id}`} target="_blank" rel="noreferrer">
                {t('games.openHost')}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
