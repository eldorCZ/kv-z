import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { Button, ErrorBox, Field, inputCls } from '../components/ui';
import { PeriodFilter, PrintWarning } from './Matrix';
import type { ClassDto } from './types';

interface TopicsDto {
  topics: { topic: string; items: number; students: number; percent: number | null }[];
  weakQuestions: { questionId: string | null; prompt: string; topic: string | null; answers: number; successRate: number }[];
  minItems: number;
}

export function Bar({ percent }: { percent: number | null }) {
  if (percent === null) return null;
  const tone = percent < 50 ? 'bg-amber-500' : percent < 75 ? 'bg-indigo-400' : 'bg-emerald-500';
  return (
    <div className="h-2 w-full min-w-24 rounded bg-slate-100" aria-hidden>
      <div className={`h-2 rounded ${tone}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** C8.2 "Témata": topic mastery of the class, weakest questions, renaming and merging topics. */
export default function Topics({ cls }: { cls: ClassDto }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('year');
  const [kind, setKind] = useState('');
  const [data, setData] = useState<TopicsDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [rename, setRename] = useState<{ from: string; to: string } | null>(null);
  const canEdit = cls.status === 'active' && cls.role !== 'viewer';

  const load = useCallback(async () => {
    const q = new URLSearchParams({ period, ...(kind ? { kind } : {}) });
    try {
      setData(await api<TopicsDto>('GET', `/api/v1/classes/${cls.id}/topics?${q}`));
    } catch (e) {
      setError(e as ApiError);
    }
  }, [cls.id, period, kind]);
  useEffect(() => {
    void load();
  }, [load]);

  const doRename = async () => {
    if (!rename) return;
    setError(null);
    try {
      const url = `/api/v1/classes/${cls.id}/topics/rename`;
      const dry = await api<{ questions: number; items: number }>('POST', url, { ...rename, dryRun: true });
      if (!confirm(t('overview.renameConfirm', { from: rename.from, to: rename.to, questions: dry.questions, items: dry.items }))) return;
      await api('POST', url, rename);
      setRename(null);
      await load();
    } catch (e) {
      setError(e as ApiError);
    }
  };

  if (!data) return <ErrorBox error={error} />;
  return (
    <div className="space-y-4">
      <PrintWarning />
      <ErrorBox error={error} onClose={() => setError(null)} />
      <PeriodFilter period={period} setPeriod={setPeriod} kind={kind} setKind={setKind} />
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold">{t('overview.topicsTitle')}</h2>
        {data.topics.length === 0 ? (
          <p className="text-sm text-slate-500">{t('overview.noTopics')}</p>
        ) : (
          <table className="w-full text-sm" data-testid="topics">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="p-1">{t('overview.topic')}</th>
                <th className="p-1">{t('overview.mastery')}</th>
                <th className="w-1/3 p-1" />
                <th className="p-1">{t('overview.itemsStudents')}</th>
                {canEdit && <th className="no-print p-1" />}
              </tr>
            </thead>
            <tbody>
              {data.topics.map((x) => (
                <tr key={x.topic} className="border-t border-slate-100">
                  <td className="p-1 font-medium">{x.topic}</td>
                  <td className="p-1 tabular-nums">{x.percent === null ? <span className="text-slate-500">{t('overview.littleData')}</span> : `${x.percent} %`}</td>
                  <td className="p-1">
                    <Bar percent={x.percent} />
                  </td>
                  <td className="p-1 text-xs text-slate-500">
                    {x.items} / {x.students}
                  </td>
                  {canEdit && (
                    <td className="no-print p-1 text-right">
                      <Button variant="ghost" onClick={() => setRename({ from: x.topic, to: x.topic })}>
                        {t('overview.rename')}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-slate-500">{t('overview.topicRule', { min: data.minItems, items: 3 * data.minItems })}</p>
      </section>

      {rename && (
        <section className="no-print flex flex-wrap items-end gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
          <p className="w-full text-sm">{t('overview.renameHint', { from: rename.from })}</p>
          <Field label={t('overview.newTopic')}>
            <input className={inputCls} list="topic-names" value={rename.to} maxLength={60} onChange={(e) => setRename({ ...rename, to: e.target.value })} />
          </Field>
          <datalist id="topic-names">
            {data.topics.map((x) => (
              <option key={x.topic} value={x.topic} />
            ))}
          </datalist>
          <Button variant="primary" disabled={!rename.to.trim() || rename.to === rename.from} onClick={doRename}>
            {t('overview.renameDo')}
          </Button>
          <Button variant="ghost" onClick={() => setRename(null)}>
            {t('common.cancel')}
          </Button>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold">{t('overview.weakQuestions')}</h2>
        {data.weakQuestions.length === 0 ? (
          <p className="text-sm text-slate-500">{t('overview.noWeak', { min: data.minItems })}</p>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {data.weakQuestions.map((q, i) => (
              <li key={i}>
                <span className="font-medium">{q.successRate} %</span> – {q.prompt}
                <span className="text-xs text-slate-500">
                  {' '}
                  ({q.topic ?? t('overview.noTopic')}, {t('overview.answers', { count: q.answers })})
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
