import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { Badge, Button, ErrorBox, Field, formatDate, inputCls } from '../components/ui';

interface Card {
  id: string;
  name: string;
  schoolYear: string;
  subject: string | null;
  status: 'active' | 'archived';
  activeStudents: number;
  lastActivity: { label: string; playedAt: number } | null;
  lastTest: { label: string; avgPercent: number | null } | null;
}

/** C8.1 */
export default function ClassesPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [list, setList] = useState<Card[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [form, setForm] = useState<{ name: string; subject: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setList((await api<{ classes: Card[] }>('GET', '/api/v1/classes')).classes);
    } catch (e) {
      setError(e as ApiError);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const c = await api<{ id: string }>('POST', '/api/v1/classes', { name: form!.name, subject: form!.subject || null });
      nav(`/classes/${c.id}?tab=roster`);
    } catch (err) {
      setError(err as ApiError);
    }
  };

  const card = (c: Card) => (
    <li key={c.id} className="rounded-lg border border-line bg-surface p-4" data-testid="class-card">
      <Link to={`/classes/${c.id}`} className="text-lg font-semibold text-primary hover:underline">
        {c.name}
      </Link>
      <p className="text-sm text-muted">
        {c.schoolYear}
        {c.subject ? ` · ${c.subject}` : ''} · {t('classes.students', { count: c.activeStudents })}
      </p>
      <p className="mt-2 text-sm">
        {c.lastActivity ? t('classes.lastActivity', { label: c.lastActivity.label, date: formatDate(c.lastActivity.playedAt) }) : t('classes.noActivity')}
      </p>
      {c.lastTest && c.lastTest.avgPercent !== null && <p className="text-sm">{t('classes.lastTest', { label: c.lastTest.label, avg: c.lastTest.avgPercent })}</p>}
    </li>
  );

  const active = list?.filter((c) => c.status === 'active') ?? [];
  const archived = list?.filter((c) => c.status === 'archived') ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">{t('classes.title')}</h1>
        <Button variant="primary" onClick={() => setForm({ name: '', subject: '' })} data-testid="new-class">
          + {t('classes.new')}
        </Button>
      </div>
      <p className="max-w-3xl text-sm text-muted">{t('classes.intro')}</p>
      <ErrorBox error={error} onClose={() => setError(null)} />
      {form && (
        <form onSubmit={create} className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-4">
          <Field label={t('classes.name')} hint={t('classes.nameHint')}>
            <input className={inputCls} required maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="class-name" />
          </Field>
          <Field label={t('classes.subject')}>
            <input className={inputCls} maxLength={40} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </Field>
          <Button type="submit" variant="primary" data-testid="create-class">
            {t('classes.create')}
          </Button>
        </form>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{active.map(card)}</ul>
      {list?.length === 0 && <p className="text-muted">{t('classes.none')}</p>}
      {archived.length > 0 && (
        <>
          <h2 className="pt-4 text-lg font-semibold">
            {t('classes.archived')} <Badge tone="neutral">{archived.length}</Badge>
          </h2>
          <ul className="grid gap-3 opacity-80 sm:grid-cols-2 lg:grid-cols-3">{archived.map(card)}</ul>
        </>
      )}
    </div>
  );
}
