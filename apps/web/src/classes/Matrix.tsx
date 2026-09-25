import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api, ApiError } from '../api';
import i18n from '../i18n';
import { Button, ErrorBox } from '../components/ui';
import { fullName, gameLink, pct, shortDate, TREND_ARROW, type ClassDto, type MatrixCell, type MatrixDto } from './types';

export interface PeriodState {
  period: string;
  from: string;
  to: string;
}
export function periodQuery(p: PeriodState): Record<string, string> {
  if (p.period !== 'custom') return { period: p.period };
  const q: Record<string, string> = {};
  if (p.from) q.from = p.from;
  if (p.to) q.to = p.to;
  return q;
}

export function PeriodFilter({ value, onChange, kind, setKind }: { value: PeriodState; onChange: (p: PeriodState) => void; kind: string; setKind: (k: string) => void }) {
  const { t } = useTranslation();
  const sel = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm';
  return (
    <div className="no-print flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-1">
        {t('overview.period')}
        <select className={sel} value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value })} data-testid="period">
          {['year', 'h1', 'h2', 'custom'].map((p) => (
            <option key={p} value={p}>
              {t(`overview.periods.${p}`)}
            </option>
          ))}
        </select>
      </label>
      {value.period === 'custom' && (
        <>
          <input type="date" className={sel} aria-label={t('overview.from')} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span>–</span>
          <input type="date" className={sel} aria-label={t('overview.to')} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </>
      )}
      <label className="flex items-center gap-1">
        {t('overview.kind')}
        <select className={sel} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="kind">
          {['', 'test', 'quiz'].map((k) => (
            <option key={k} value={k}>
              {t(`overview.kinds.${k || 'all'}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function PrintWarning() {
  const { t } = useTranslation();
  return <p className="print-only mb-2 text-xs font-semibold">{t('overview.printWarning')}</p>;
}

export function printOverview(classId: string) {
  if (!confirm(i18n.t('overview.printConfirm'))) return;
  void api('POST', `/api/v1/classes/${classId}/log`, { action: 'overview_print' }).catch(() => undefined);
  window.print();
}

function Cell({ c }: { c: MatrixCell | undefined }) {
  const { t } = useTranslation();
  if (!c || c.state === 'na') return <span className="text-slate-400" title={t('overview.cell.na')}>–</span>;
  if (c.state === 'missing')
    return (
      <span className="font-medium text-red-700" data-cell="missing">
        {t('overview.cell.missing')}
      </span>
    );
  if (c.state === 'excluded')
    return (
      <span className="text-slate-400 line-through" title={t('overview.cell.excluded')} data-cell="excluded">
        {c.percent}
      </span>
    );
  const tone = c.percent! < 50 ? 'text-amber-800' : 'text-slate-900';
  return (
    <span className={tone} data-cell="result">
      {c.percent}
      {c.makeup && (
        <sup className="text-indigo-700" title={t('overview.cell.makeup')}>
          d
        </sup>
      )}
    </span>
  );
}

/** C8.2 "Žáci": students x activities. */
export default function Matrix({ cls, showNames = true }: { cls: ClassDto; showNames?: boolean }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<PeriodState>({ period: 'year', from: '', to: '' });
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState<'number' | 'name' | 'avg' | 'trend'>('number');
  const [m, setM] = useState<MatrixDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const q = new URLSearchParams({ ...periodQuery(period), ...(kind ? { kind } : {}) });
    api<MatrixDto>('GET', `/api/v1/classes/${cls.id}/matrix?${q}`)
      .then(setM)
      .catch((e: ApiError) => setError(e));
  }, [cls.id, period, kind]);

  if (!m) return <ErrorBox error={error} />;
  const name = (s: MatrixDto['students'][number]) => (showNames ? fullName(s) : s.publicName);
  const coll = new Intl.Collator('cs');
  const TREND_ORDER = { falling: 0, stable: 1, rising: 2, little_data: 3 };
  const rows = [...m.students].sort((a, b) => {
    if (sort === 'name') return coll.compare(fullName(a), fullName(b));
    if (sort === 'avg') return (a.summary.testAvg ?? 101) - (b.summary.testAvg ?? 101) || coll.compare(fullName(a), fullName(b));
    if (sort === 'trend') return TREND_ORDER[a.summary.testTrend.label] - TREND_ORDER[b.summary.testTrend.label] || (a.summary.testTrend.delta ?? 0) - (b.summary.testTrend.delta ?? 0);
    return 0; // server order: roster number, family name
  });

  return (
    <div className="print-landscape space-y-3">
      <PrintWarning />
      <div className="flex flex-wrap items-center gap-2">
        <PeriodFilter value={period} onChange={setPeriod} kind={kind} setKind={setKind} />
        <label className="no-print flex items-center gap-1 text-sm">
          {t('overview.sort')}
          <select className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} data-testid="sort">
            {(['number', 'name', 'avg', 'trend'] as const).map((k) => (
              <option key={k} value={k}>
                {t(`overview.sorts.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="no-print ml-auto flex flex-wrap gap-2">
          <a className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100" href={`/api/v1/classes/${cls.id}/export.csv?sep=%3B`} download>
            {t('overview.csvExcel')}
          </a>
          <a className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100" href={`/api/v1/classes/${cls.id}/export.csv?sep=%2C`} download>
            {t('overview.csvComma')}
          </a>
          <Button onClick={() => printOverview(cls.id)}>{t('overview.print')}</Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">{t('overview.legend')}</p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full border-collapse text-sm" data-testid="matrix">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 p-2 text-left">{t('roster.name')}</th>
              {m.activities.map((a) => (
                <th key={a.id} className={`min-w-16 p-2 text-center font-medium ${a.kind === 'test' ? 'bg-sky-50' : ''} ${a.counted ? '' : 'text-slate-400'}`} title={a.counted ? a.label : `${a.label} – ${t('overview.notCounted')}`}>
                  <div className="max-w-24 truncate">
                    {a.gameId ? (
                      <Link to={gameLink(a.kind, a.gameId)} className="hover:underline">
                        {a.label}
                      </Link>
                    ) : (
                      a.label
                    )}
                  </div>
                  <div className="font-normal">
                    {a.kind === 'test' ? t('overview.kindShort.test') : t('overview.kindShort.quiz')} {shortDate(a.playedAt)}
                  </div>
                </th>
              ))}
              <th className="p-2">{t('overview.testAvg')}</th>
              <th className="p-2">{t('overview.quizAvg')}</th>
              <th className="p-2">{t('overview.trend')}</th>
              <th className="p-2">{t('overview.participation')}</th>
              <th className="p-2 text-left">{t('overview.watch')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-slate-100" data-testid="matrix-row">
                <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-white p-2 text-left font-medium">
                  <Link to={`/classes/${cls.id}/students/${s.id}`} className="text-indigo-700 hover:underline">
                    {name(s)}
                  </Link>
                  {!s.active && <span className="ml-1 text-xs text-slate-500">({t('roster.leftShort')})</span>}
                </th>
                {m.activities.map((a) => (
                  <td key={a.id} className={`p-2 text-center tabular-nums ${a.kind === 'test' ? 'bg-sky-50/60' : ''}`}>
                    <Cell c={s.cells[a.id]} />
                  </td>
                ))}
                <td className="p-2 text-center font-semibold tabular-nums">{pct(s.summary.testAvg)}</td>
                <td className="p-2 text-center tabular-nums">{pct(s.summary.quizAvg)}</td>
                <td className="whitespace-nowrap p-2 text-center" title={s.summary.testTrend.delta !== null ? t('overview.trendDelta', { delta: s.summary.testTrend.delta }) : ''}>
                  {TREND_ARROW[s.summary.testTrend.label]} {t(`overview.trends.${s.summary.testTrend.label}`)}
                </td>
                <td className="p-2 text-center tabular-nums">{pct(s.summary.participation)}</td>
                <td className="whitespace-nowrap p-2 text-xs">
                  {s.summary.flags.map((f) => (
                    <span key={f.rule} className="mr-1 inline-block whitespace-nowrap rounded bg-amber-100 px-1 text-amber-900" title={f.text} data-testid="flag">
                      ⚑ {t(`overview.flags.${f.rule}`)}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
            {m.students.length === 0 && (
              <tr>
                <td className="p-3 text-slate-500" colSpan={m.activities.length + 6}>
                  {t('roster.empty')}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-xs">
            <tr>
              <th className="sticky left-0 bg-slate-50 p-2 text-left">{t('overview.classRow')}</th>
              {m.activities.map((a) => (
                <td key={a.id} className="p-2 text-center tabular-nums" title={t('overview.medianTitle', { median: a.stats.median ?? '–' })}>
                  {pct(a.stats.avg)}
                </td>
              ))}
              <td className="p-2 text-center font-semibold">{pct(m.classSummary.testAvg)}</td>
              <td className="p-2 text-center">{pct(m.classSummary.quizAvg)}</td>
              <td />
              <td className="p-2 text-center">{pct(m.classSummary.participation)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {m.activities.length === 0 && <p className="text-sm text-slate-500">{t('overview.noActivities')}</p>}
      <p className="text-xs text-slate-500">{t('classes.settings.rulesText', { threshold: cls.settings.supportThresholdPercent, drop: cls.settings.trendDropPp, split: cls.settings.halfYearSplit })}</p>
    </div>
  );
}
