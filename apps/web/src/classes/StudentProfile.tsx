import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api, ApiError } from '../api';
import { Badge, Button, ErrorBox } from '../components/ui';
import { printOverview, PrintWarning } from './Matrix';
import { Bar } from './Topics';
import { fullName, gameLink, pct, readShowNames, shortDate, TREND_ARROW, type ProfileDto, type SeriesPoint, type Summary } from './types';

/** Own small SVG line chart: the student's percent and the class median (dashed); a table follows as an alternative (C8.3). */
export function LineChart({ points, title }: { points: SeriesPoint[]; title: string }) {
  const { t } = useTranslation();
  if (points.length === 0) return <p className="text-sm text-slate-500">{t('overview.noData')}</p>;
  const W = 600;
  const H = 200;
  const pad = { l: 34, r: 26, t: 10, b: 24 };
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + ((100 - v) * (H - pad.t - pad.b)) / 100;
  const path = (key: 'percent' | 'classMedian') => {
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      const v = p[key];
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-2xl" role="img" aria-label={title}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#e2e8f0" />
            <text x={pad.l - 4} y={y(v) + 4} fontSize="10" textAnchor="end" fill="#64748b">
              {v}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <text key={p.activityId} x={x(i)} y={H - 6} fontSize="10" textAnchor="middle" fill="#64748b">
            {shortDate(p.playedAt)}
          </text>
        ))}
        <path d={path('classMedian')} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 4" />
        <path d={path('percent')} fill="none" stroke="#4f46e5" strokeWidth="2.5" />
        {points.map((p, i) =>
          p.percent === null ? null : (
            <circle key={p.activityId} cx={x(i)} cy={y(p.percent)} r="4" fill="#4f46e5">
              <title>{`${p.label}: ${p.percent} %`}</title>
            </circle>
          ),
        )}
      </svg>
      <figcaption className="text-xs text-slate-500">
        <span className="text-indigo-700">━</span> {t('overview.chartStudent')} · <span className="text-slate-400">╌</span> {t('overview.chartMedian')}
      </figcaption>
      <details className="mt-1 text-sm">
        <summary className="cursor-pointer text-xs text-slate-600">{t('overview.asTable')}</summary>
        <table className="mt-1 text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="pr-3">{t('overview.activity')}</th>
              <th className="pr-3">{t('overview.date')}</th>
              <th className="pr-3">{t('overview.student')}</th>
              <th>{t('overview.chartMedian')}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.activityId}>
                <td className="pr-3">{p.label}</td>
                <td className="pr-3">{shortDate(p.playedAt)}</td>
                <td className="pr-3">{pct(p.percent)}</td>
                <td>{pct(p.classMedian)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function SummaryBox({ s }: { s: Summary }) {
  const { t } = useTranslation();
  const box = 'rounded-lg border border-slate-200 bg-white p-3';
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className={box}>
        <p className="text-xs text-slate-500">{t('overview.testAvg')}</p>
        <p className="text-2xl font-bold" data-testid="profile-test-avg">
          {pct(s.testAvg)}
        </p>
        <p className="text-xs text-slate-500">{t('overview.countOf', { count: s.testCount })}</p>
      </div>
      <div className={box}>
        <p className="text-xs text-slate-500">{t('overview.quizAvg')}</p>
        <p className="text-2xl font-bold">{pct(s.quizAvg)}</p>
        <p className="text-xs text-slate-500">{t('overview.countOf', { count: s.quizCount })}</p>
      </div>
      <div className={box}>
        <p className="text-xs text-slate-500">{t('overview.trend')}</p>
        <p className="text-lg font-semibold">
          {TREND_ARROW[s.testTrend.label]} {t(`overview.trends.${s.testTrend.label}`)}
        </p>
        {s.testTrend.delta !== null && <p className="text-xs text-slate-500">{t('overview.trendDelta', { delta: s.testTrend.delta })}</p>}
      </div>
      <div className={box}>
        <p className="text-xs text-slate-500">{t('overview.participation')}</p>
        <p className="text-2xl font-bold">{pct(s.participation)}</p>
        <p className="text-xs text-slate-500">{t('overview.eligible', { count: s.eligibleCount })}</p>
      </div>
    </div>
  );
}

/** C8.3 student profile. Visible only to teachers of the class; every view is in the access log. */
export default function StudentProfile() {
  const { t } = useTranslation();
  const { id = '', sid = '' } = useParams();
  const [p, setP] = useState<ProfileDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [showNames] = useState(() => readShowNames(true));

  const load = useCallback(async () => {
    try {
      setP(await api<ProfileDto>('GET', `/api/v1/classes/${id}/students/${sid}/profile`));
    } catch (e) {
      setError(e as ApiError);
    }
  }, [id, sid]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (resultId: string, excluded: boolean) => {
    let reason: string | null = null;
    if (excluded) {
      const technical = confirm(t('overview.excludeReason'));
      reason = technical ? 'technical' : 'other';
    }
    try {
      await api('PATCH', `/api/v1/classes/${id}/results/${resultId}`, { excluded, reason });
      await load();
    } catch (e) {
      setError(e as ApiError);
    }
  };

  if (!p) return <ErrorBox error={error} />;
  const s = p.student;
  return (
    <div className="space-y-4">
      <PrintWarning />
      <p className="no-print text-sm">
        <Link to={`/classes/${id}`} className="text-indigo-700 hover:underline">
          ← {t('overview.backToClass')}
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold" data-testid="profile-name">
          {showNames ? fullName(s) : s.publicName}
        </h1>
        {!s.active && <Badge tone="neutral">{t('roster.left', { date: s.leftAt })}</Badge>}
        <div className="no-print ml-auto flex gap-2">
          <a className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100" href={`/api/v1/classes/${id}/students/${sid}/export.csv?sep=%3B`} download>
            {t('overview.csvExcel')}
          </a>
          <Button onClick={() => printOverview(id)}>{t('overview.print')}</Button>
        </div>
      </div>
      <ErrorBox error={error} onClose={() => setError(null)} />
      <SummaryBox s={p.summary} />
      {p.summary.flags.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">{t('overview.watch')}</p>
          <ul className="list-disc pl-5">
            {p.summary.flags.map((f) => (
              <li key={f.rule}>{f.text}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">{t('overview.flagNote')}</p>
        </div>
      )}
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold">{t('overview.testsChart')}</h2>
        <LineChart points={p.tests} title={t('overview.testsChart')} />
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold">{t('overview.quizzesChart')}</h2>
        <LineChart points={p.quizzes} title={t('overview.quizzesChart')} />
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold">{t('overview.topicsTitle')}</h2>
        {p.topics.length === 0 ? (
          <p className="text-sm text-slate-500">{t('overview.noTopics')}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {p.topics.map((x) => (
                <tr key={x.topic} className="border-t border-slate-100">
                  <td className="p-1 font-medium">{x.topic}</td>
                  <td className="p-1 tabular-nums">{x.percent === null ? <span className="text-slate-500">{t('overview.littleData')}</span> : `${x.percent} %`}</td>
                  <td className="w-1/2 p-1">
                    <Bar percent={x.percent} />
                  </td>
                  <td className="p-1 text-xs text-slate-500">{t('overview.answers', { count: x.items })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-1 text-xs text-slate-500">{t('overview.topicMin', { min: p.minItems })}</p>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold">{t('overview.mistakes')}</h2>
        {p.mistakes.length === 0 ? (
          <p className="text-sm text-slate-500">{t('overview.noMistakes')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {p.mistakes.map((m, i) => (
              <li key={i}>
                <span className="font-semibold">{m.count}×</span> {m.prompt} {m.topic && <span className="text-xs text-slate-500">({m.topic})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold">{t('overview.results')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="profile-results">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="p-1">{t('overview.date')}</th>
                <th className="p-1">{t('overview.activity')}</th>
                <th className="p-1">%</th>
                <th className="p-1" />
                <th className="no-print p-1" />
              </tr>
            </thead>
            <tbody>
              {p.results.map((r) => (
                <tr key={r.resultId} className={`border-t border-slate-100 ${r.excluded ? 'text-slate-400' : ''}`}>
                  <td className="p-1 whitespace-nowrap">{shortDate(r.playedAt)}</td>
                  <td className="p-1">
                    {r.gameId ? (
                      <Link to={gameLink(r.kind, r.gameId)} className="text-indigo-700 hover:underline">
                        {r.label}
                      </Link>
                    ) : (
                      r.label
                    )}{' '}
                    <span className="text-xs text-slate-500">{t(`overview.kinds.${r.kind}`)}</span>
                  </td>
                  <td className={`p-1 tabular-nums ${r.excluded ? 'line-through' : ''}`}>{r.percent}</td>
                  <td className="p-1 text-xs">
                    {[r.makeup && t('overview.cell.makeup'), r.excluded && t('overview.cell.excluded'), !r.counted && t('overview.notCounted'), r.status === 'auto_submitted' && t('overview.autoSubmitted')].filter(Boolean).join(', ')}
                  </td>
                  <td className="no-print p-1 text-right">
                    <Button variant="ghost" onClick={() => toggle(r.resultId, !r.excluded)}>
                      {r.excluded ? t('overview.include') : t('overview.exclude')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
