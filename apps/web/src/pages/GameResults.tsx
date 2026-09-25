import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api, ApiError, download } from '../api';
import { Button, ErrorBox } from '../components/ui';

interface TestResults {
  mode: 'test';
  status: string;
  quizId: string;
  summary: { students: number; submitted: number; avgPercent: number | null; medianPercent: number | null; leaveFlagged?: number };
  students: { student: string; attemptId: string; percent: number | null; status: string; submittedAt: number | null; leaveCount?: number; awaySec?: number; locked?: boolean }[];
  perQuestion: { questionId: string; number: number; prompt: string; answered: number; successRate: number }[];
}

interface Results {
  mode?: 'live';
  status: string;
  quizId: string;
  playerCount: number;
  ranking: { nickname: string; score: number; rank: number }[];
  perQuestion: { questionId: string; number: number; prompt: string; answered: number; correct: number; successRate: number; avgTimeMs: number | null }[];
}

export default function GameResults() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [res, setRes] = useState<Results | TestResults | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api<Results | TestResults>('GET', `/api/v1/games/${id}/results`)
      .then(setRes)
      .catch((e) => setError(e as ApiError));
  }, [id]);

  if (!res) return <ErrorBox error={error} />;
  if (res.mode === 'test') return <TestResultsView res={res} id={id!} onError={setError} error={error} />;
  const hardest = [...res.perQuestion].sort((a, b) => a.successRate - b.successRate).slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">{t('results.title')}</h1>
        <Link to={`/quizzes/${res.quizId}`} className="text-sm text-indigo-700 hover:underline">
          {t('results.toQuiz')}
        </Link>
        <Button onClick={() => download(`/api/v1/games/${id}/results.csv`).catch((e) => setError(e as ApiError))}>{t('results.csv')}</Button>
      </div>
      <ErrorBox error={error} />
      <p className="text-sm text-slate-600">{t('results.summary', { count: res.playerCount, status: t(`games.status.${res.status}`) })}</p>
      {res.perQuestion.length > 0 && res.playerCount > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <strong>{t('results.hardest')}:</strong> {hardest.map((q) => `${q.number} (${Math.round(q.successRate * 100)} %)`).join(', ')}
        </div>
      )}
      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('results.ranking')}</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">{t('results.nickname')}</th>
                <th className="p-3 text-right">{t('results.score')}</th>
              </tr>
            </thead>
            <tbody>
              {res.ranking.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="p-3">{r.rank}.</td>
                  <td className="p-3">{r.nickname}</td>
                  <td className="p-3 text-right font-mono">{r.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('results.perQuestion')}</h2>
        <ul className="space-y-2">
          {res.perQuestion.map((q) => {
            const pct = Math.round(q.successRate * 100);
            return (
              <li key={q.questionId} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{q.number}.</span>
                  <span className="flex-1">{q.prompt}</span>
                  <span className={`font-semibold ${pct < 50 ? 'text-red-700' : 'text-emerald-700'}`}>{pct} %</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100" aria-hidden="true">
                  <div className={`h-full ${pct < 50 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {t('results.answered', { answered: q.answered, correct: q.correct })}
                  {q.avgTimeMs !== null && ` · ${t('results.avgTime', { s: (q.avgTimeMs / 1000).toFixed(1) })}`}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function TestResultsView({ res, id, error, onError }: { res: TestResults; id: string; error: ApiError | null; onError: (e: ApiError) => void }) {
  const { t } = useTranslation();
  const hardest = [...res.perQuestion].sort((a, b) => a.successRate - b.successRate).slice(0, 3);
  const guard = res.students.some((s) => s.leaveCount !== undefined);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">{t('results.testTitle')}</h1>
        <Link to={`/tests/${id}`} className="text-sm text-indigo-700 hover:underline">
          {t('results.toDashboard')}
        </Link>
        <Button onClick={() => download(`/api/v1/games/${id}/results.csv`).catch((e) => onError(e as ApiError))}>{t('results.csv')}</Button>
      </div>
      <ErrorBox error={error} />
      <p className="text-sm text-slate-600" data-testid="test-summary">
        {t('results.testSummary', { submitted: res.summary.submitted, students: res.summary.students, avg: res.summary.avgPercent ?? '–', median: res.summary.medianPercent ?? '–' })}
        {res.summary.leaveFlagged ? ` · ${t('results.leaveFlagged', { count: res.summary.leaveFlagged })}` : ''}
      </p>
      {res.summary.submitted > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <strong>{t('results.hardest')}:</strong> {hardest.map((q) => `${q.number} (${Math.round(q.successRate * 100)} %)`).join(', ')}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3">{t('dash.student')}</th>
              <th className="p-3">{t('dash.status')}</th>
              <th className="p-3 text-right">{t('dash.percent')}</th>
              {guard && <th className="p-3 text-right">{t('dash.left')}</th>}
            </tr>
          </thead>
          <tbody>
            {[...res.students].sort((a, b) => a.student.localeCompare(b.student, 'cs')).map((s) => (
              <tr key={s.attemptId} className="border-t border-slate-100">
                <td className="p-3">{s.student}</td>
                <td className="p-3">{t(`dash.st.${s.status}`)}</td>
                <td className="p-3 text-right font-mono">{s.percent !== null ? `${s.percent} %` : '–'}</td>
                {guard && (
                  <td className="p-3 text-right text-xs">
                    {s.locked ? '🔒 ' : ''}
                    {t('dash.leftValue', { count: s.leaveCount ?? 0, sec: s.awaySec ?? 0 })}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('results.perQuestion')}</h2>
        <ul className="space-y-2">
          {res.perQuestion.map((q) => {
            const pct = Math.round(q.successRate * 100);
            return (
              <li key={q.questionId} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                <div className="flex gap-2">
                  <span className="font-bold">{q.number}.</span>
                  <span className="flex-1">{q.prompt}</span>
                  <span className={`font-semibold ${pct < 50 ? 'text-red-700' : 'text-emerald-700'}`}>{pct} %</span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
