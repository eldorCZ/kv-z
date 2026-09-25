import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api, ApiError } from '../api';
import { Badge, Button, ErrorBox, formatDate } from '../components/ui';
import { gameLink, pct, type ActivityDto, type ClassDto } from './types';

interface Makeup {
  gameId: string;
  pin: string;
  joinUrl: string;
  hostUrl: string;
  resultsUrl: string;
  audienceSize: number;
  reused: boolean;
}

function Distribution({ d }: { d: number[] }) {
  const max = Math.max(1, ...d);
  const labels = ['0–19', '20–39', '40–59', '60–79', '80–100'];
  return (
    <div className="flex h-10 items-end gap-0.5" role="img" aria-label={d.map((n, i) => `${labels[i]} %: ${n}`).join(', ')}>
      {d.map((n, i) => (
        <div key={i} className="w-4 bg-indigo-400" style={{ height: `${Math.max(2, (100 * n) / max)}%` }} title={`${labels[i]} %: ${n}`} />
      ))}
    </div>
  );
}

/** C8.2 "Aktivity": held class games and tests, makeups and counting into the records. */
export default function Activities({ cls }: { cls: ClassDto }) {
  const { t } = useTranslation();
  const [list, setList] = useState<ActivityDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [makeup, setMakeup] = useState<Makeup | null>(null);
  const canEdit = cls.status === 'active' && cls.role !== 'viewer';

  const load = useCallback(async () => {
    try {
      setList((await api<{ activities: ActivityDto[] }>('GET', `/api/v1/classes/${cls.id}/activities`)).activities);
    } catch (e) {
      setError(e as ApiError);
    }
  }, [cls.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e as ApiError);
    }
  };

  if (!list) return <ErrorBox error={error} />;
  return (
    <div className="space-y-3">
      <ErrorBox error={error} onClose={() => setError(null)} />
      {makeup && (
        <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-4 text-sm" data-testid="makeup-info">
          <p className="font-semibold">{makeup.reused ? t('overview.makeupReused') : t('overview.makeupCreated', { count: makeup.audienceSize })}</p>
          <p className="mt-1">
            PIN <strong className="font-mono text-lg">{makeup.pin}</strong> · {makeup.joinUrl}
          </p>
          <div className="mt-2 flex gap-2">
            <Link to={`/tests/${makeup.gameId}`} className="text-indigo-700 underline">
              {t('overview.openDashboard')}
            </Link>
            <button className="ml-auto text-slate-600" onClick={() => setMakeup(null)}>
              ✕
            </button>
          </div>
        </div>
      )}
      {list.length === 0 && <p className="text-slate-500">{t('overview.noActivities')}</p>}
      <ul className="space-y-2">
        {list.map((a) => (
          <li key={a.id} className="rounded-lg border border-slate-200 bg-white p-3" data-testid="activity">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {a.gameId ? (
                    <Link to={gameLink(a.kind, a.gameId)} className="text-indigo-700 hover:underline">
                      {a.label}
                    </Link>
                  ) : (
                    a.label
                  )}{' '}
                  <Badge tone={a.kind === 'test' ? 'approved' : 'neutral'}>{t(`overview.kinds.${a.kind}`)}</Badge> {!a.countInStats && <Badge tone="flagged">{t('overview.notCounted')}</Badge>}
                </p>
                <p className="text-xs text-slate-500">
                  {formatDate(a.playedAt)} · {a.quizTitle}
                  {a.makeups.length > 0 && ` · ${t('overview.makeups', { count: a.makeups.length })}`}
                </p>
                <p className="mt-1 text-sm">
                  {a.stats.n === 0
                    ? t('overview.notHeld')
                    : t('overview.activityStats', { n: a.stats.n, part: pct(a.stats.participationRate), avg: pct(a.stats.avg), median: pct(a.stats.median) })}
                  {a.missing !== null && a.missing > 0 && <span className="ml-2 font-medium text-red-700">{t('overview.missingCount', { count: a.missing })}</span>}
                </p>
              </div>
              {a.stats.n > 0 && <Distribution d={a.stats.distribution} />}
              {canEdit && (
                <div className="no-print flex flex-col items-end gap-1">
                  {a.kind === 'test' && (a.missing ?? 0) > 0 && (
                    <Button
                      variant="primary"
                      onClick={() => run(async () => setMakeup(await api<Makeup>('POST', `/api/v1/classes/${cls.id}/activities/${a.id}/makeup`)))}
                      data-testid="makeup"
                    >
                      {t('overview.makeup')}
                    </Button>
                  )}
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={a.countInStats} onChange={(e) => run(() => api('PATCH', `/api/v1/classes/${cls.id}/activities/${a.id}`, { countInStats: e.target.checked }))} />
                    {t('overview.countInStats')}
                  </label>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
