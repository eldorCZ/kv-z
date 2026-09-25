import { decodeCsv } from '@kvizhub/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api, ApiError } from '../api';
import { Badge, Button, ErrorBox, Field, inputCls, Modal } from '../components/ui';
import CodesPanel from './CodesPanel';
import { fullName, type ClassDto, type CreatedCode, type StudentDto } from './types';

interface PreviewRow {
  line: number;
  familyName: string;
  givenName: string;
  rosterNo: number | null;
  publicName: string | null;
  error?: string;
}
interface Preview {
  rows: PreviewRow[];
  warnings: string[];
  valid: number;
  total: number;
}

/** Roster management (C4). */
export default function Roster({ cls, onChanged }: { cls: ClassDto; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'lines' | 'csv' | 'manual'>('lines');
  const [text, setText] = useState('');
  const [order, setOrder] = useState<'family-given' | 'given-family'>('family-given');
  const [manual, setManual] = useState({ familyName: '', givenName: '', rosterNo: '' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [codes, setCodes] = useState<CreatedCode[] | null>(null);
  const [editing, setEditing] = useState<StudentDto | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const canEdit = cls.status === 'active' && cls.role !== 'viewer';
  const students = cls.students ?? [];

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e as ApiError);
    }
  };

  const doPreview = () =>
    run(async () => {
      setPreview(await api<Preview>('POST', `/api/v1/classes/${cls.id}/students/preview`, { text, format: mode === 'csv' ? 'csv' : 'lines', order }));
    });

  const commit = (rows: { familyName: string; givenName: string; rosterNo: number | null }[]) =>
    run(async () => {
      const r = await api<{ created: CreatedCode[] }>('POST', `/api/v1/classes/${cls.id}/students`, { students: rows });
      setCodes(r.created);
      setPreview(null);
      setText('');
      setManual({ familyName: '', givenName: '', rosterNo: '' });
    });

  const onFile = async (f: File) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    setText(decodeCsv(bytes));
    setMode('csv');
    setPreview(null);
  };

  const rotate = (s: StudentDto) =>
    confirm(t('roster.rotateConfirm', { name: s.publicName })) &&
    run(async () => setCodes((await api<{ created: CreatedCode[] }>('POST', `/api/v1/classes/${cls.id}/students/${s.id}/rotate`)).created));

  const rotateAll = () =>
    confirm(t('roster.rotateAllConfirm')) && run(async () => setCodes((await api<{ created: CreatedCode[] }>('POST', `/api/v1/classes/${cls.id}/rotate-all`)).created));

  return (
    <div className="space-y-4">
      <ErrorBox error={error} onClose={() => setError(null)} />
      {codes && <CodesPanel classId={cls.id} className={cls.name} codes={codes} onClose={() => setCodes(null)} />}

      {canEdit && !codes && (
        <section className="no-print space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">{t('roster.add')}</h2>
          <div className="flex flex-wrap gap-2" role="tablist">
            {(['lines', 'csv', 'manual'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} className={`rounded-md border px-3 py-1.5 text-sm ${mode === m ? 'border-indigo-600 bg-indigo-50' : 'border-slate-300'}`} onClick={() => setMode(m)}>
                {t(`roster.modes.${m}`)}
              </button>
            ))}
          </div>
          {mode === 'manual' ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t('roster.familyName')}>
                <input className={inputCls} value={manual.familyName} maxLength={40} onChange={(e) => setManual({ ...manual, familyName: e.target.value })} />
              </Field>
              <Field label={t('roster.givenName')}>
                <input className={inputCls} value={manual.givenName} maxLength={40} onChange={(e) => setManual({ ...manual, givenName: e.target.value })} />
              </Field>
              <Field label={t('roster.rosterNo')}>
                <input className={`${inputCls} w-20`} type="number" min={1} max={99} value={manual.rosterNo} onChange={(e) => setManual({ ...manual, rosterNo: e.target.value })} />
              </Field>
              <Button variant="primary" disabled={!manual.familyName.trim()} onClick={() => commit([{ familyName: manual.familyName, givenName: manual.givenName, rosterNo: manual.rosterNo ? Number(manual.rosterNo) : null }])}>
                {t('roster.addOne')}
              </Button>
            </div>
          ) : (
            <>
              {mode === 'lines' ? (
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={order === 'family-given'} onChange={() => setOrder('family-given')} /> {t('roster.orderFamilyGiven')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={order === 'given-family'} onChange={() => setOrder('given-family')} /> {t('roster.orderGivenFamily')}
                  </label>
                </div>
              ) : (
                <label className="block text-sm">
                  {t('roster.csvFile')}{' '}
                  <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
                  <span className="block text-xs text-slate-500">{t('roster.csvHint')}</span>
                </label>
              )}
              <textarea className={`${inputCls} font-mono`} rows={6} value={text} placeholder={t('roster.linesPlaceholder')} onChange={(e) => setText(e.target.value)} data-testid="roster-text" />
              <p className="text-xs text-slate-500">{t('roster.pseudonymHint')}</p>
              <Button onClick={doPreview} disabled={!text.trim()} data-testid="roster-preview">
                {t('roster.preview')}
              </Button>
            </>
          )}
          {preview && (
            <div className="space-y-2" data-testid="roster-preview-table">
              {preview.warnings.map((w, i) => (
                <p key={i} className="rounded bg-amber-50 p-2 text-sm text-amber-900">
                  ⚠ {w}
                </p>
              ))}
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="p-1">#</th>
                    <th className="p-1">{t('roster.familyName')}</th>
                    <th className="p-1">{t('roster.givenName')}</th>
                    <th className="p-1">{t('roster.publicName')}</th>
                    <th className="p-1" />
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className={r.error ? 'bg-red-50' : ''}>
                      <td className="p-1">{r.rosterNo ?? ''}</td>
                      <td className="p-1">{r.familyName}</td>
                      <td className="p-1">{r.givenName}</td>
                      <td className="p-1">{r.publicName}</td>
                      <td className="p-1 text-red-700">{r.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button variant="primary" disabled={preview.valid === 0} onClick={() => commit(preview.rows.filter((r) => !r.error))} data-testid="roster-commit">
                {t('roster.confirmAdd', { count: preview.valid })}
              </Button>
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <h2 className="mr-auto font-semibold">{t('roster.title', { count: students.length })}</h2>
          {canEdit && students.length > 0 && <Button onClick={rotateAll}>{t('roster.rotateAll')}</Button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="roster-table">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">#</th>
                <th className="p-2">{t('roster.name')}</th>
                <th className="p-2">{t('roster.publicName')}</th>
                <th className="p-2">{t('roster.state')}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="p-2">{s.rosterNo ?? ''}</td>
                  <td className="p-2">
                    <Link to={`/classes/${cls.id}/students/${s.id}`} className="text-indigo-700 hover:underline">
                      {fullName(s)}
                    </Link>
                  </td>
                  <td className="p-2">{s.publicName}</td>
                  <td className="p-2">{s.active ? <Badge tone="ok">{t('roster.active')}</Badge> : <Badge tone="neutral">{t('roster.left', { date: s.leftAt })}</Badge>}</td>
                  <td className="p-2">
                    {canEdit && (
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button variant="ghost" onClick={() => setEditing(s)}>
                          {t('review.edit')}
                        </Button>
                        {s.active && (
                          <Button variant="ghost" onClick={() => rotate(s)}>
                            {t('roster.newCode')}
                          </Button>
                        )}
                        <Button variant="ghost" onClick={() => run(() => api('POST', `/api/v1/classes/${cls.id}/students/${s.id}/${s.active ? 'leave' : 'reactivate'}`))}>
                          {s.active ? t('roster.leave') : t('roster.reactivate')}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {students.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-3 text-slate-500">
                    {t('roster.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <EditStudent
          s={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) =>
            run(async () => {
              await api('PATCH', `/api/v1/classes/${cls.id}/students/${editing.id}`, patch);
              setEditing(null);
            })
          }
        />
      )}
    </div>
  );
}

function EditStudent({ s, onClose, onSave }: { s: StudentDto; onClose: () => void; onSave: (p: object) => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({ familyName: s.familyName, givenName: s.givenName, publicName: s.publicName, rosterNo: s.rosterNo ? String(s.rosterNo) : '', since: s.since });
  return (
    <Modal title={t('roster.editTitle')} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('roster.familyName')}>
          <input className={inputCls} value={v.familyName} maxLength={40} onChange={(e) => setV({ ...v, familyName: e.target.value })} />
        </Field>
        <Field label={t('roster.givenName')}>
          <input className={inputCls} value={v.givenName} maxLength={40} onChange={(e) => setV({ ...v, givenName: e.target.value })} />
        </Field>
        <Field label={t('roster.publicName')} hint={t('roster.publicNameHint')}>
          <input className={inputCls} value={v.publicName} maxLength={30} onChange={(e) => setV({ ...v, publicName: e.target.value })} />
        </Field>
        <Field label={t('roster.rosterNo')}>
          <input className={inputCls} type="number" min={1} max={99} value={v.rosterNo} onChange={(e) => setV({ ...v, rosterNo: e.target.value })} />
        </Field>
        <Field label={t('roster.since')}>
          <input className={inputCls} type="date" value={v.since} onChange={(e) => setV({ ...v, since: e.target.value })} />
        </Field>
      </div>
      <Button className="mt-4" variant="primary" onClick={() => onSave({ ...v, rosterNo: v.rosterNo ? Number(v.rosterNo) : null })}>
        {t('roster.save')}
      </Button>
    </Modal>
  );
}
