import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { Copy, MoreHorizontal, Plus, Search, Trash2, Upload } from 'lucide-react';
import { ErrorBox, formatDate } from '../components/ui';
import { QuizThumb } from '../components/QuizThumb';
import { Badge, Button, EmptyState, IconButton, Input, Menu, SkeletonList } from '../ui';

interface Item {
  id: string;
  title: string;
  questionCount: number;
  flaggedCount: number;
  updatedAt: number;
  theme?: { motive?: string; accent?: string } | null;
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-3xl font-bold">{t('quizzes.title')}</h1>
        <Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={createEmpty}>
          {t('quizzes.create')}
        </Button>
        <Button icon={<Upload className="h-4 w-4" aria-hidden="true" />} onClick={() => fileRef.current?.click()}>
          {t('quizzes.uploadJson')}
        </Button>
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
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <Input className="pl-9" type="search" placeholder={t('quizzes.search')} aria-label={t('quizzes.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={error} onClose={() => setError(null)} />
      {items === null && !error && <SkeletonList rows={3} />}
      {items && items.length === 0 && (
        <EmptyState
          title={t('quizzes.empty')}
          text={t('quizzes.emptyHint')}
          action={
            <Button variant="primary" onClick={createEmpty}>
              {t('quizzes.create')}
            </Button>
          }
        />
      )}
      {items && items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="quiz-grid">
          {items.map((it) => (
            <li key={it.id} className="group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-soft transition-shadow hover:border-primary">
              <QuizThumb seed={it.id} theme={it.theme} className="h-28 w-full" />
              <div className="flex flex-1 flex-col gap-2 p-4">
                <Link to={`/quizzes/${it.id}`} className="font-display text-lg font-bold leading-snug text-fg after:absolute after:inset-0 hover:text-primary">
                  {it.title}
                </Link>
                <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{t('quizzes.questionCount', { count: it.questionCount })}</span>
                  {it.flaggedCount > 0 && <Badge tone="flagged">{t('quizzes.toReview', { count: it.flaggedCount })}</Badge>}
                  <span>{t('quizzes.updated', { date: formatDate(it.updatedAt) })}</span>
                </div>
              </div>
              <div className="absolute right-2 top-2 z-10">
                <Menu
                  trigger={
                    <IconButton label={t('quizzes.actions', { title: it.title })} variant="secondary" size="sm" className="min-h-9 min-w-9 bg-surface">
                      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                    </IconButton>
                  }
                  items={[
                    { label: t('quizzes.clone'), icon: <Copy className="h-4 w-4" aria-hidden="true" />, onSelect: () => void clone(it.id) },
                    { label: t('common.delete'), icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, danger: true, onSelect: () => void remove(it) },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
