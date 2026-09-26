import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { api, ApiError } from '../api';
import { Badge, Button, ErrorBox, formatDate } from '../components/ui';
import Activities from './Activities';
import Matrix from './Matrix';
import Roster from './Roster';
import Topics from './Topics';
import { readShowNames, writeShowNames, type ClassDto } from './types';

const TABS = ['students', 'activities', 'topics', 'roster', 'settings'] as const;
type Tab = (typeof TABS)[number];

/** Class overview with tabs (C8.2). */
export default function ClassDetail() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'students') as Tab;
  const [cls, setCls] = useState<ClassDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [showNames, setShowNames] = useState(() => readShowNames(true));

  const load = useCallback(async () => {
    try {
      setCls(await api<ClassDto>('GET', `/api/v1/classes/${id}`));
    } catch (e) {
      setError(e as ApiError);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!cls) return <ErrorBox error={error} />;

  return (
    <div className="space-y-4">
      <p className="no-print text-sm">
        <Link to="/classes" className="text-hra-700 hover:underline">
          ← {t('classes.title')}
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold" data-testid="class-title">
          {cls.name}
        </h1>
        <span className="text-slate-600">
          {cls.schoolYear}
          {cls.subject ? ` · ${cls.subject}` : ''}
        </span>
        {cls.status === 'archived' && <Badge tone="neutral">{t('classes.archivedBadge')}</Badge>}
        <label className="no-print ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!showNames}
            onChange={(e) => {
              setShowNames(!e.target.checked);
              writeShowNames(!e.target.checked);
            }}
            data-testid="hide-names"
          />
          {t('classes.hideNames')}
        </label>
      </div>
      {cls.anonymizeAt && <p className="text-xs text-slate-500">{t('classes.anonymizeAt', { date: formatDate(cls.anonymizeAt) })}</p>}
      <nav className="no-print flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
        {TABS.map((tb) => (
          <button
            key={tb}
            role="tab"
            aria-selected={tab === tb}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === tb ? 'border-hra-600 text-hra-700' : 'border-transparent text-slate-600'}`}
            onClick={() => setParams({ tab: tb })}
            data-testid={`tab-${tb}`}
          >
            {t(`classes.tabs.${tb}`)}
          </button>
        ))}
      </nav>
      <ErrorBox error={error} onClose={() => setError(null)} />
      {tab === 'students' && <Matrix cls={cls} showNames={showNames} />}
      {tab === 'activities' && <Activities cls={cls} />}
      {tab === 'topics' && <Topics cls={cls} />}
      {tab === 'roster' && <Roster cls={cls} onChanged={load} />}
      {tab === 'settings' && <Settings cls={cls} onChanged={load} />}
    </div>
  );
}

function Settings({ cls, onChanged }: { cls: ClassDto; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const [log, setLog] = useState<{ at: number; action: string; teacher: string; itemCount: number | null }[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const owner = cls.role === 'owner';
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e as ApiError);
    }
  };
  useEffect(() => {
    if (owner) api<{ entries: typeof log }>('GET', `/api/v1/classes/${cls.id}/access-log`).then((r) => setLog(r.entries)).catch(() => undefined);
  }, [cls.id, owner]);

  return (
    <div className="space-y-4">
      <ErrorBox error={error} onClose={() => setError(null)} />
      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 className="mb-2 font-semibold">{t('classes.settings.rules')}</h2>
        <p>{t('classes.settings.rulesText', { threshold: cls.settings.supportThresholdPercent, drop: cls.settings.trendDropPp, split: cls.settings.halfYearSplit })}</p>
        {cls.anonymizeAt && <p className="mt-2">{t('classes.anonymizeAt', { date: formatDate(cls.anonymizeAt) })}</p>}
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <label className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{t('classes.settings.leaderboardNames')}</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
            value={cls.settings.leaderboardNames}
            disabled={cls.role === 'viewer' || cls.status !== 'active'}
            onChange={(e) => run(() => api('PATCH', `/api/v1/classes/${cls.id}`, { settings: { leaderboardNames: e.target.value } }))}
            data-testid="leaderboard-names"
          >
            <option value="account">{t('classes.settings.lbAccount')}</option>
            <option value="number">{t('classes.settings.lbNumber')}</option>
          </select>
        </label>
        <p className="mt-1 text-xs text-slate-500">{t('classes.settings.lbHint')}</p>
      </section>
      {owner && (
        <section className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-4">
          {cls.status === 'active' && (
            <Button onClick={() => confirm(t('classes.settings.archiveConfirm')) && run(() => api('POST', `/api/v1/classes/${cls.id}/archive`))}>{t('classes.settings.archive')}</Button>
          )}
          <Button
            onClick={() => {
              const n = prompt(t('classes.settings.anonymizeConfirm', { name: cls.name }));
              if (n) void run(() => api('POST', `/api/v1/classes/${cls.id}/anonymize`, { confirmName: n }));
            }}
          >
            {t('classes.settings.anonymizeNow')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const n = prompt(t('classes.settings.deleteConfirm', { name: cls.name }));
              if (n) void run(async () => {
                await api('DELETE', `/api/v1/classes/${cls.id}`, { confirmName: n });
                window.location.href = '/classes';
              });
            }}
          >
            {t('classes.settings.delete')}
          </Button>
        </section>
      )}
      {log && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">{t('classes.settings.accessLog')}</h2>
          <ul className="max-h-80 space-y-1 overflow-y-auto text-xs">
            {log.map((e, i) => (
              <li key={i}>
                {formatDate(e.at)} · {e.teacher} · {t(`classes.log.${e.action}`, { defaultValue: e.action })}
                {e.itemCount ? ` (${e.itemCount})` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
