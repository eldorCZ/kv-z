import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTitle } from '../ui/useTitle';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { BookOpen, ClipboardCheck, Copy, MoreHorizontal, Plus, Search, Target, Trash2, Upload } from 'lucide-react';
import { ErrorBox, formatDate } from '../components/ui';
import { QuizThumb } from '../components/QuizThumb';
import { usePrefs } from '../theme/prefs';
import {
  AlertDialog,
  Badge,
  BlurFade,
  Button,
  Card,
  CardGlow,
  EmptyState,
  IconButton,
  Input,
  Menu,
  NumberTicker,
  Progress,
  Select,
  SkeletonList,
  StatCard,
} from '../ui';

interface Item {
  id: string;
  title: string;
  questionCount: number;
  flaggedCount: number;
  updatedAt: number;
  theme?: { motive?: string; accent?: string; imageId?: string } | null;
  tags?: string[];
  avgSuccess?: number | null;
  classes?: { id: string; name: string }[];
}

export default function Quizzes() {
  const { t } = useTranslation();
  useTitle(t('nav.quizzes'));
  const nav = useNavigate();
  const { motion } = usePrefs();
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState('');
  const [subject, setSubject] = useState('');
  const [classId, setClassId] = useState('');
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  // the entrance plays only for the first render of the grid, never after filtering (Dodatek 5, point 6)
  const [intro, setIntro] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastMenu = useRef<string | null>(null);

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

  useEffect(() => {
    if (intro && items && items.length > 0) setIntro(false);
  }, [intro, items]);

  const subjects = useMemo(() => [...new Set((items ?? []).flatMap((it) => it.tags ?? []))].sort((a, b) => a.localeCompare(b, 'cs')), [items]);
  const classes = useMemo(() => {
    const byId = new Map<string, string>();
    for (const it of items ?? []) for (const c of it.classes ?? []) byId.set(c.id, c.name);
    return [...byId].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'cs'));
  }, [items]);
  const visible = useMemo(
    () => (items ?? []).filter((it) => (!subject || it.tags?.includes(subject)) && (!classId || it.classes?.some((c) => c.id === classId))),
    [items, subject, classId],
  );
  const stats = useMemo(() => {
    const played = visible.filter((it) => typeof it.avgSuccess === 'number');
    return {
      total: visible.length,
      toReview: visible.filter((it) => it.flaggedCount > 0).length,
      avg: played.length ? Math.round(played.reduce((s, it) => s + (it.avgSuccess as number), 0) / played.length) : null,
    };
  }, [visible]);
  // the most recently edited quiz gets the pointer glow (point 7); the list comes sorted by updatedAt
  const recentId = visible[0]?.id;

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

      {items && items.length > 0 && (
        <section aria-label={t('quizzes.stats.label')} className="grid gap-3 sm:grid-cols-3" data-testid="quiz-stats">
          <StatCard testId="stat-total" icon={<BookOpen className="h-5 w-5" aria-hidden="true" />} label={t('quizzes.stats.total')} value={<NumberTicker value={stats.total} />} />
          <StatCard testId="stat-review" icon={<ClipboardCheck className="h-5 w-5" aria-hidden="true" />} label={t('quizzes.stats.toReview')} value={<NumberTicker value={stats.toReview} />} />
          <StatCard
            testId="stat-success"
            icon={<Target className="h-5 w-5" aria-hidden="true" />}
            label={t('quizzes.stats.avgSuccess')}
            value={stats.avg === null ? <span className="text-base font-semibold text-muted">{t('quizzes.stats.none')}</span> : <NumberTicker value={stats.avg} suffix=" %" />}
          />
        </section>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input className="pl-9" type="search" placeholder={t('quizzes.search')} aria-label={t('quizzes.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {subjects.length > 0 && (
          <Select
            className="w-48"
            testId="filter-subject"
            label={t('quizzes.filter.subject')}
            value={subject}
            onChange={setSubject}
            options={[{ value: '', label: t('quizzes.filter.all') }, ...subjects.map((s) => ({ value: s, label: s }))]}
          />
        )}
        {classes.length > 0 && (
          <Select
            className="w-48"
            testId="filter-class"
            label={t('quizzes.filter.class')}
            value={classId}
            onChange={setClassId}
            options={[{ value: '', label: t('quizzes.filter.all') }, ...classes]}
          />
        )}
      </div>
      <ErrorBox error={error} onClose={() => setError(null)} />
      {items === null && !error && <SkeletonList rows={3} />}
      {items && visible.length === 0 && (q.trim() !== '' || subject || classId) && <EmptyState pose="think" title={t('quizzes.noMatch')} />}
      {items && items.length === 0 && q.trim() === '' && !subject && !classId && (
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
      {visible.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="quiz-grid">
          {visible.map((it, i) => (
            <li key={it.id}>
              <BlurFade play={intro} delay={Math.min(i, 10) * 0.05} className="h-full">
                <CardGlow className="h-full" enabled={it.id === recentId && motion === 'full'}>
                  <Card hoverable pressable className="group relative flex h-full flex-col overflow-hidden hover:border-primary">
                    <QuizThumb seed={it.id} theme={it.theme} className="h-28 w-full" />
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <Link to={`/quizzes/${it.id}`} className="font-display text-lg font-bold leading-snug text-fg after:absolute after:inset-0 hover:text-primary">
                        {it.title}
                      </Link>
                      {typeof it.avgSuccess === 'number' ? (
                        <div className="flex items-center gap-3 text-sm" data-testid="quiz-success">
                          <Progress value={it.avgSuccess} label={t('quizzes.successOf', { title: it.title })} className="flex-1" />
                          <NumberTicker value={it.avgSuccess} suffix=" %" className="font-semibold" />
                        </div>
                      ) : (
                        <p className="text-sm text-muted">{t('quizzes.notPlayed')}</p>
                      )}
                      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span>{t('quizzes.questionCount', { count: it.questionCount })}</span>
                        {it.flaggedCount > 0 && <Badge tone="flagged">{t('quizzes.toReview', { count: it.flaggedCount })}</Badge>}
                        <span>{t('quizzes.updated', { date: formatDate(it.updatedAt) })}</span>
                      </div>
                    </div>
                    <div className="absolute right-2 top-2 z-10">
                      <Menu
                        trigger={
                          <IconButton label={t('quizzes.actions', { title: it.title })} variant="secondary" size="sm" className="min-h-9 min-w-9 bg-surface" data-quiz-menu={it.id}>
                            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                          </IconButton>
                        }
                        items={[
                          { label: t('quizzes.clone'), icon: <Copy className="h-4 w-4" aria-hidden="true" />, onSelect: () => void clone(it.id) },
                          {
                            label: t('common.delete'),
                            icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
                            danger: true,
                            testId: 'quiz-delete',
                            onSelect: () => {
                              lastMenu.current = it.id;
                              setPendingDelete(it);
                            },
                          },
                        ]}
                      />
                    </div>
                  </Card>
                </CardGlow>
              </BlurFade>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog
        open={pendingDelete !== null}
        title={t('quizzes.deleteTitle')}
        description={pendingDelete ? t('quizzes.confirmDelete', { title: pendingDelete.title }) : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={async () => {
          if (pendingDelete) await remove(pendingDelete);
        }}
        onClose={() => setPendingDelete(null)}
        // back to the card's menu button; after a delete that card is gone, so the search field takes it
        returnFocus={() =>
          document.querySelector<HTMLElement>(`[data-quiz-menu="${lastMenu.current}"]`) ?? document.querySelector<HTMLElement>('input[type="search"]')
        }
      />
    </div>
  );
}
