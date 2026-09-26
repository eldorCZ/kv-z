import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { Button, ErrorBox } from '../components/ui';

interface GuestsDto {
  guests: { playerId: string; nickname: string }[];
  candidates: { studentId: string; accountName: string; rosterNo: number | null }[];
}

/** Class games: guests without a code can be assigned to a student afterwards (C6.3). Hidden when there are none. */
export default function GuestsPanel({ gameId }: { gameId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<GuestsDto | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<GuestsDto>('GET', `/api/v1/games/${gameId}/guests`));
    } catch {
      setData(null); // not a class game or no editor access
    }
  }, [gameId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data || data.guests.length === 0) return null;
  const assign = async (playerId: string) => {
    setError(null);
    try {
      setData(await api<GuestsDto>('POST', `/api/v1/games/${gameId}/guests/${playerId}/assign`, { studentId: pick[playerId] }));
    } catch (e) {
      setError(e as ApiError);
    }
  };
  return (
    <section className="no-print rounded-lg border border-warning-line bg-warning-soft p-3 text-sm" data-testid="guests-panel">
      <h2 className="font-semibold">{t('guests.title', { count: data.guests.length })}</h2>
      <p className="text-xs text-warning">{t('guests.hint')}</p>
      <ErrorBox error={error} onClose={() => setError(null)} />
      <ul className="mt-2 space-y-2">
        {data.guests.map((g) => (
          <li key={g.playerId} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{g.nickname}</span>
            <span>→</span>
            <select className="rounded-md border border-line-strong bg-surface px-2 py-1" value={pick[g.playerId] ?? ''} onChange={(e) => setPick({ ...pick, [g.playerId]: e.target.value })}>
              <option value="">{t('guests.choose')}</option>
              {data.candidates.map((c) => (
                <option key={c.studentId} value={c.studentId}>
                  {c.rosterNo ? `${c.rosterNo}. ` : ''}
                  {c.accountName}
                </option>
              ))}
            </select>
            <Button disabled={!pick[g.playerId]} onClick={() => void assign(g.playerId)}>
              {t('guests.assign')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
