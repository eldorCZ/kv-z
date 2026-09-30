import { useCallback, useEffect, useRef, useState } from 'react';
import { useTitle } from '../ui/useTitle';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { ArrowDownUp, Copy, LayoutGrid, List, ListChecks, MoreHorizontal, Plus, Search, TriangleAlert, Trash2, Upload } from 'lucide-react';
import { ErrorBox, formatDate } from '../components/ui';
import { QuizThumb } from '../components/QuizThumb';
import { AlertDialog, Badge, BlurFade, Button, Card, EmptyState, IconButton, Input, Menu, SelectMenu, SkeletonList, StatCard } from '../ui';

interface Item {
  id: string;
  title: string;
  questionCount: number;
  flaggedCount: number;
  updatedAt: number;
  theme?: { motive?: string; accent?: string; imageId?: string } | null;
}

type Razeni = 'nejnovejsi' | 'nejstarsi' | 'nazev';
type Zobrazeni = 'dlazdice' | 'seznam';

const VIEW_KEY = 'lore.kvizy.zobrazeni';
const readView = (): Zobrazeni => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'seznam' ? 'seznam' : 'dlazdice';
  } catch {
    return 'dlazdice';
  }
};

export default function Quizzes() {
  const { t } = useTranslation();
  useTitle(t('nav.quizzes'));
  const nav = useNavigate();
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState('');
  const [razeni, setRazeni] = useState<Razeni>('nejnovejsi');
  const [jenKeKontrole, setJenKeKontrole] = useState(false);
  // volba dlaždice/seznam je drobnost pro tenhle prohlížeč, proto localStorage a ne účet
  const [zobrazeni, setZobrazeni] = useState<Zobrazeni>(readView);
  const [smazat, setSmazat] = useState<Item | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const prepniZobrazeni = (v: Zobrazeni) => {
    setZobrazeni(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* soukromé okno: volba prostě nepřežije zavření */
    }
  };

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
    try {
      await api('DELETE', `/api/v1/quizzes/${item.id}`);
      await load(q);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSmazat(null);
    }
  };

  // řadíme a filtrujeme na klientu: server vrací jen filtr podle názvu a kvízů jsou desítky
  const vse = items ?? [];
  const serazene = vse
    .filter((it) => !jenKeKontrole || it.flaggedCount > 0)
    .sort((a, b) => (razeni === 'nazev' ? a.title.localeCompare(b.title, 'cs') : razeni === 'nejstarsi' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt));
  const otazekCelkem = vse.reduce((n, it) => n + it.questionCount, 0);
  const keKontrole = vse.reduce((n, it) => n + it.flaggedCount, 0);

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
      {/* přehled nad galerií: jen čísla, která opravdu máme z API, nic dopočítaného naslepo */}
      {items && items.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3" data-testid="quiz-stats">
          <StatCard label={t('quizzes.statQuizzes')} value={vse.length} icon={<LayoutGrid className="h-5 w-5" aria-hidden="true" />} />
          <StatCard label={t('quizzes.statQuestions')} value={otazekCelkem} icon={<ListChecks className="h-5 w-5" aria-hidden="true" />} />
          <StatCard label={t('quizzes.statFlagged')} value={keKontrole} icon={<TriangleAlert className="h-5 w-5" aria-hidden="true" />} hint={keKontrole > 0 ? t('quizzes.statFlaggedHint') : undefined} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel p-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input className="pl-9" type="search" placeholder={t('quizzes.search')} aria-label={t('quizzes.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="flex items-center gap-2">
          <ArrowDownUp className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <SelectMenu
            label={t('quizzes.sortLabel')}
            value={razeni}
            onChange={(v) => setRazeni(v as Razeni)}
            testId="quiz-sort"
            options={[
              { value: 'nejnovejsi', label: t('quizzes.sortNewest') },
              { value: 'nejstarsi', label: t('quizzes.sortOldest') },
              { value: 'nazev', label: t('quizzes.sortTitle') },
            ]}
          />
        </span>
        <SelectMenu
          label={t('quizzes.filterLabel')}
          value={jenKeKontrole ? 'kontrola' : 'vse'}
          onChange={(v) => setJenKeKontrole(v === 'kontrola')}
          testId="quiz-filter"
          options={[
            { value: 'vse', label: t('quizzes.filterAll') },
            { value: 'kontrola', label: t('quizzes.filterFlagged') },
          ]}
        />
        <div className="flex gap-1" role="group" aria-label={t('quizzes.viewLabel')}>
          {(
            [
              ['dlazdice', LayoutGrid, t('quizzes.viewGrid')],
              ['seznam', List, t('quizzes.viewList')],
            ] as const
          ).map(([v, Ikona, popis]) => (
            <IconButton
              key={v}
              label={popis}
              variant={zobrazeni === v ? 'primary' : 'secondary'}
              size="sm"
              className="min-h-11 min-w-11"
              aria-pressed={zobrazeni === v}
              data-testid={`quiz-view-${v}`}
              onClick={() => prepniZobrazeni(v)}
            >
              <Ikona className="h-5 w-5" aria-hidden="true" />
            </IconButton>
          ))}
        </div>
      </div>
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
      {items && items.length > 0 && serazene.length === 0 && <EmptyState pose="think" title={t('quizzes.noMatch')} />}
      {serazene.length > 0 && (
        <ul className={zobrazeni === 'dlazdice' ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-2'} data-testid="quiz-grid" data-view={zobrazeni}>
          {serazene.map((it, i) => (
            <li key={it.id}>
              {/* nástup se přehraje jen při prvním vykreslení, ne při každém písmenu v hledání */}
              <BlurFade delay={Math.min(i, 8) * 0.05}>
                <Card
                  hoverable
                  pressable
                  className={`group relative overflow-hidden ${zobrazeni === 'dlazdice' ? 'flex h-full flex-col' : 'flex items-center gap-4 p-2 pr-14'}`}
                >
                  <QuizThumb seed={it.id} theme={it.theme} className={zobrazeni === 'dlazdice' ? 'h-28 w-full' : 'h-14 w-20 shrink-0 rounded-lg'} />
                  <div className={`flex min-w-0 flex-1 flex-col gap-2 ${zobrazeni === 'dlazdice' ? 'p-4' : ''}`}>
                    <Link to={`/quizzes/${it.id}`} className="truncate font-display text-lg font-bold leading-snug text-fg after:absolute after:inset-0 hover:text-primary">
                      {it.title}
                    </Link>
                    <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{t('quizzes.questionCount', { count: it.questionCount })}</span>
                      {it.flaggedCount > 0 && <Badge tone="flagged">{t('quizzes.toReview', { count: it.flaggedCount })}</Badge>}
                      <span>{t('quizzes.updated', { date: formatDate(it.updatedAt) })}</span>
                    </div>
                  </div>
                  <div className={`absolute z-10 ${zobrazeni === 'dlazdice' ? 'right-2 top-2' : 'right-2 top-1/2 -translate-y-1/2'}`}>
                    <Menu
                      trigger={
                        <IconButton label={t('quizzes.actions', { title: it.title })} variant="secondary" size="sm" className="min-h-9 min-w-9 bg-surface">
                          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                        </IconButton>
                      }
                      items={[
                        { label: t('quizzes.clone'), icon: <Copy className="h-4 w-4" aria-hidden="true" />, onSelect: () => void clone(it.id) },
                        { label: t('common.delete'), icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, danger: true, onSelect: () => setSmazat(it) },
                      ]}
                    />
                  </div>
                </Card>
              </BlurFade>
            </li>
          ))}
        </ul>
      )}

      {smazat && (
        <AlertDialog
          title={t('quizzes.deleteTitle')}
          description={t('quizzes.confirmDelete', { title: smazat.title })}
          confirmLabel={t('common.delete')}
          onConfirm={() => void remove(smazat)}
          onClose={() => setSmazat(null)}
        />
      )}
    </div>
  );
}
