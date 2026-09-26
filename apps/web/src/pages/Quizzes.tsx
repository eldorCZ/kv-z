import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { Badge, Button, ErrorBox, formatDate, inputCls } from '../components/ui';

interface Item {
  id: string;
  title: string;
  questionCount: number;
  flaggedCount: number;
  updatedAt: number;
}

export default function Quizzes() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<ApiError | Error | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (search: string) => {
    try {
      const r = await api<{ quizzes: Item[] }>('GET', `/api/v1/quizzes?q=${encodeURIComponent(search)}`);
      setItems(r.quizzes);
    } catch (e) {
      setError(e as ApiError);
    }
  }, []);

  useEffect(() => {
    const h = setTimeout(() => void load(q), 250);
    return () => clearTimeout(h);
  }, [q, load]);

  const upload = async (file: File) => {
    setError(null);
    if (file.size > 2 * 1024 * 1024) return setError(new Error(t('quizzes.tooLarge')));
    let body: unknown;
    try {
      body = JSON.parse(await file.text());
    } catch {
      return setError(new Error(t('quizzes.invalidJson')));
    }
    try {
      const r = await api<{ quizId: string }>('POST', '/api/v1/quizzes', body);
      nav(`/quizzes/${r.quizId}`);
    } catch (e) {
      setError(e as ApiError);
    }
  };

  const createEmpty = async () => {
    try {
      const r = await api<{ quizId: string }>('POST', '/api/v1/quizzes', {
        schemaVersion: 1,
        title: t('quizzes.newTitle'),
        questions: [{ type: 'truefalse', prompt: t('quizzes.newQuestion'), correctIndices: [0] }],
      });
      nav(`/quizzes/${r.quizId}`);
    } catch (e) {
      setError(e as ApiError);
    }
  };

  const clone = async (id: string) => {
    try {
      await api('POST', `/api/v1/quizzes/${id}/clone`);
      await load(q);
    } catch (e) {
      setError(e as ApiError);
    }
  };

  const remove = async (item: Item) => {
    if (!confirm(t('quizzes.confirmDelete', { title: item.title }))) return;
    try {
      await api('DELETE', `/api/v1/quizzes/${item.id}`);
      await load(q);
    } catch (e) {
      setError(e as ApiError);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">{t('quizzes.title')}</h1>
        <Button variant="primary" onClick={createEmpty}>
          {t('quizzes.create')}
        </Button>
        <Button onClick={() => fileRef.current?.click()}>{t('quizzes.uploadJson')}</Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
      </div>
      <input className={`${inputCls} mb-4 max-w-md`} type="search" placeholder={t('quizzes.search')} aria-label={t('quizzes.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorBox error={error} onClose={() => setError(null)} />
      {items && items.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
          <p className="mb-2 font-medium">{t('quizzes.empty')}</p>
          <p className="text-sm">{t('quizzes.emptyHint')}</p>
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <Link to={`/quizzes/${it.id}`} className="font-semibold text-hra-700 hover:underline">
                  {it.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{t('quizzes.questionCount', { count: it.questionCount })}</span>
                  {it.flaggedCount > 0 && <Badge tone="flagged">{t('quizzes.toReview', { count: it.flaggedCount })}</Badge>}
                  <span>{t('quizzes.updated', { date: formatDate(it.updatedAt) })}</span>
                </div>
              </div>
              <Button variant="ghost" onClick={() => clone(it.id)}>
                {t('quizzes.clone')}
              </Button>
              <Button variant="ghost" className="text-red-700" onClick={() => remove(it)}>
                {t('common.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
