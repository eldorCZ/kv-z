import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTitle } from '../ui/useTitle';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { Copy, FileUp, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import { ErrorBox, formatDate } from '../components/ui';
import { QuizThumb } from '../components/QuizThumb';
import { Badge, Button, EmptyState, IconButton, Input, Menu, PageHeader, SkeletonList, Toolbar } from '../ui';

interface Item {
  id: string;
  title: string;
  questionCount: number;
  flaggedCount: number;
  updatedAt: number;
  theme?: { motive?: string; accent?: string; imageId?: string } | null;
}

export default function Quizzes() {
  const { t } = useTranslation();
  useTitle(t('nav.quizzes'));
  const nav = useNavigate();
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'newest' | 'title' | 'review'>('newest');
  const [view, setView] = useState<'grid' | 'list'>('grid');
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

  const shown = useMemo(() => {
    if (!items) return null;
    return [...items].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'cs');
      if (sort === 'review') return b.flaggedCount - a.flaggedCount || b.updatedAt - a.updatedAt;
      return b.updatedAt - a.updatedAt;
    });
  }, [items, sort]);

  const totalQuestions = items?.reduce((sum, item) => sum + item.questionCount, 0) ?? 0;
  const ready = items?.filter((item) => item.flaggedCount === 0).length ?? 0;
  const toReview = items?.reduce((sum, item) => sum + item.flaggedCount, 0) ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('quizzes.title')}
        description={t('quizzes.description')}
        actions={
          <>
            <Button icon={<FileUp className="h-4 w-4" aria-hidden="true" />} onClick={() => fileRef.current?.click()}>
              {t('quizzes.uploadJson')}
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={createEmpty}>
              {t('quizzes.create')}
            </Button>
          </>
        }
      />
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
      {items && items.length > 0 && (
        <section className="grid gap-4 sm:grid-cols-3" aria-label={t('quizzes.summary')}>
          <div className="relative overflow-hidden rounded-lg border border-primary/15 bg-surface p-5 shadow-soft">
            <div className="absolute -right-6 -bottom-8 h-24 w-24 rounded-pill bg-primary-soft" aria-hidden="true" />
            <div className="relative flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-md bg-primary-soft font-display text-xl font-bold text-primary" aria-hidden="true">K</span>
              <div><p className="text-sm font-bold text-muted">{t('quizzes.active')}</p><p className="font-display text-3xl font-bold tabular">{items.length}</p></div>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-lg border border-success/15 bg-surface p-5 shadow-soft">
            <div className="absolute -right-6 -bottom-8 h-24 w-24 rounded-pill bg-success-soft" aria-hidden="true" />
            <div className="relative flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-md bg-success-soft text-xl font-bold text-success" aria-hidden="true">✓</span>
              <div><p className="text-sm font-bold text-muted">{t('quizzes.readyQuizzes')}</p><p className="font-display text-3xl font-bold tabular">{ready}</p></div>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-lg border border-accent/25 bg-surface p-5 shadow-soft">
            <div className="absolute -right-6 -bottom-8 h-24 w-24 rounded-pill bg-warning-soft" aria-hidden="true" />
            <div className="relative flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-md bg-warning-soft font-display text-xl font-bold text-warning" aria-hidden="true">Σ</span>
              <div><p className="text-sm font-bold text-muted">{t('quizzes.totalQuestions')}</p><p className="font-display text-3xl font-bold tabular">{totalQuestions}</p></div>
            </div>
          </div>
        </section>
      )}
      <Toolbar meta={items ? t('quizzes.quizCount', { count: items.length }) : undefined}>
        <div className="relative w-full sm:max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input className="border-transparent bg-surface-sunken pl-9 shadow-none focus:bg-surface" type="search" placeholder={t('quizzes.search')} aria-label={t('quizzes.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="relative flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-fg">
          <span className="sr-only">{t('quizzes.sort')}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="appearance-none bg-transparent pr-5 outline-none">
            <option value="newest">{t('quizzes.sortNewest')}</option>
            <option value="title">{t('quizzes.sortTitle')}</option>
            <option value="review">{t('quizzes.sortReview')}</option>
          </select>
        </label>
        <div className="flex rounded-md border border-line bg-surface p-1" aria-label={t('quizzes.view')}>
          <button type="button" onClick={() => setView('grid')} aria-pressed={view === 'grid'} aria-label={t('quizzes.grid')} className={`flex h-9 w-9 items-center justify-center rounded-sm text-lg font-bold leading-none ${view === 'grid' ? 'bg-primary text-on-primary' : 'text-muted hover:bg-surface-2'}`}><span aria-hidden="true">▦</span></button>
          <button type="button" onClick={() => setView('list')} aria-pressed={view === 'list'} aria-label={t('quizzes.list')} className={`flex h-9 w-9 items-center justify-center rounded-sm text-lg font-bold leading-none ${view === 'list' ? 'bg-primary text-on-primary' : 'text-muted hover:bg-surface-2'}`}><span aria-hidden="true">☰</span></button>
        </div>
      </Toolbar>
      <ErrorBox error={error} onClose={() => setError(null)} />
      {items === null && !error && <SkeletonList rows={3} />}
      {items && items.length === 0 && q.trim() !== '' && <EmptyState pose="think" title={t('quizzes.noMatch')} />}
      {items && items.length === 0 && q.trim() === '' && (
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
      {shown && shown.length > 0 && (
        <ul className={view === 'grid' ? 'grid gap-5 md:grid-cols-2 xl:grid-cols-3' : 'grid gap-3'} data-testid="quiz-grid">
          {shown.map((it) => (
            <li key={it.id} className={`group relative overflow-hidden rounded-lg border border-line bg-surface transition-[border-color,box-shadow,transform] duration-[var(--motion-base)] hover:-translate-y-1 hover:border-primary/45 hover:shadow-raised ${view === 'list' ? 'grid min-h-36 sm:grid-cols-[14rem_1fr]' : 'flex min-h-[20rem] flex-col'}`}>
              <QuizThumb seed={it.id} theme={it.theme} className={view === 'list' ? 'h-32 w-full sm:h-full' : 'h-40 w-full'} />
              <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
                <div className="pr-10">
                  <p className="mb-1 text-xs font-extrabold tracking-[0.08em] text-primary uppercase">{it.flaggedCount > 0 ? t('quizzes.needsReview') : t('quizzes.ready')}</p>
                  <Link to={`/quizzes/${it.id}`} className="font-display text-xl font-bold leading-snug text-fg after:absolute after:inset-0 group-hover:text-primary">
                  {it.title}
                  </Link>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
                  <span className="font-semibold text-fg">{t('quizzes.questionCount', { count: it.questionCount })}</span>
                  <span aria-hidden="true" className="text-line-strong">•</span>
                  <span>{t('quizzes.updated', { date: formatDate(it.updatedAt) })}</span>
                </div>
                <div className="mt-auto flex min-h-7 items-end justify-between gap-3">
                  <div>{it.flaggedCount > 0 ? <Badge tone="flagged">{t('quizzes.toReview', { count: it.flaggedCount })}</Badge> : <Badge tone="ok">{t('quizzes.ready')}</Badge>}</div>
                  {toReview > 0 && <span className="text-xs font-semibold text-muted">{t('quizzes.reviewSummary', { count: toReview })}</span>}
                </div>
              </div>
              <div className="absolute right-3 top-3 z-10">
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
