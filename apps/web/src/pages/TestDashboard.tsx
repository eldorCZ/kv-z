import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api, ApiError, download } from '../api';
import GuestsPanel from '../classes/GuestsPanel';
import { Badge, Button, ErrorBox, Modal, formatDate } from '../components/ui';

export interface DashboardStudent {
  attemptId: string;
  student: string;
  status: 'not_started' | 'in_progress' | 'submitted' | 'expired';
  answered: number;
  total: number;
  remainingSec: number | null;
  percent: number | null;
  startedAt: number | null;
  submittedAt: number | null;
  allowReturn: boolean;
  // leave guard (Dodatek 2)
  leaveCount?: number;
  leaveTotal?: number;
  awaySec?: number;
  locked?: boolean;
  guardExempt?: boolean;
  unconfirmedGap?: boolean;
  fullscreenSupported?: boolean | null;
  overLimit?: boolean;
}

export interface Dashboard {
  gameId: string;
  quizId: string;
  title: string;
  status: string;
  pin: string;
  joinUrl: string;
  qrUrl: string;
  closesAt: string | null;
  counts: { joined: number; notStarted: number; inProgress: number; submitted: number; locked?: number };
  classGame?: boolean;
  codeAlert?: boolean;
  notJoined?: { studentId: string; publicName: string }[];
  settings: { timeLimitMin: number | null; leaveGuard?: { mode: string; maxLeaves: number; onExceed: string; requireFullscreen: boolean } };
  students: DashboardStudent[];
}

interface Detail {
  student: string;
  status: string;
  percent: number | null;
  startedAt: number | null;
  submittedAt: number | null;
  questions: { number: number; prompt: string; answer: string | null; correct: boolean; fraction: number; correctText: string[] }[];
  events?: { type: string; reason: string | null; offsetSec: number; durationSec: number | null; counted: boolean }[];
}

function mmss(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** Teacher's live overview of a test (D8.2). Names are shown only here and in results, never on a projector. */
export default function TestDashboard() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [d, setD] = useState<Dashboard | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  // C6.2: public names by default, full names only on request (this browser only)
  const [fullNames, setFullNames] = useState(() => {
    try {
      return localStorage.getItem('kvizhub-panel-names') === '1';
    } catch {
      return false;
    }
  });

  const load = useCallback(async () => {
    try {
      setD(await api<Dashboard>('GET', `/api/v1/games/${id}/dashboard${fullNames ? '?names=full' : ''}`));
    } catch (e) {
      setError(e as ApiError);
    }
  }, [id, fullNames]);

  useEffect(() => {
    void load();
    const i = setInterval(() => void load(), 3000);
    return () => clearInterval(i);
  }, [load]);

  useEffect(() => {
    if (d?.qrUrl && !qr) void QRCode.toDataURL(d.qrUrl, { margin: 1, width: 200 }).then(setQr);
  }, [d?.qrUrl, qr]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e as ApiError);
    }
  };

  if (!d) return <ErrorBox error={error} />;
  const running = d.status === 'running';
  const guard = d.settings.leaveGuard;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <p className="text-sm text-slate-500">{t('dash.test')}</p>
          <h1 className="text-2xl font-bold">{d.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {running ? t('dash.running') : t('dash.finished')} · {d.closesAt && t('dash.closesAt', { date: formatDate(Date.parse(d.closesAt)) })}
            {d.settings.timeLimitMin ? ` · ${t('dash.limit', { min: d.settings.timeLimitMin })}` : ''}
          </p>
          <p className="mt-3 text-sm">
            {t('dash.joinAt')} <strong>{d.joinUrl}</strong> · PIN{' '}
            <strong className="text-2xl tracking-widest" data-testid="dash-pin">
              {d.pin}
            </strong>
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Badge tone="neutral">{t('dash.countJoined', { count: d.counts.joined })}</Badge>
            <Badge tone="neutral">{t('dash.countInProgress', { count: d.counts.inProgress })}</Badge>
            <Badge tone="ok">{t('dash.countSubmitted', { count: d.counts.submitted })}</Badge>
            {!!d.counts.locked && <Badge tone="flagged">🔒 {t('dash.countLocked', { count: d.counts.locked })}</Badge>}
          </div>
        </div>
        {qr && running && <img src={qr} alt={t('game.qrAlt')} className="h-36 w-36 rounded border bg-white p-1" />}
      </div>
      <div className="flex flex-wrap gap-2">
        {running && (
          <Button variant="danger" onClick={() => confirm(t('dash.confirmEnd')) && act(() => api('POST', `/api/v1/games/${id}/end`, {}))} data-testid="dash-end">
            {t('dash.end')}
          </Button>
        )}
        <Link to={`/games/${id}`} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100">
          {t('dash.results')}
        </Link>
        <Button onClick={() => download(`/api/v1/games/${id}/results.csv`).catch((e) => setError(e as ApiError))}>{t('results.csv')}</Button>
      </div>
      {d.classGame && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={fullNames}
              onChange={(e) => {
                setFullNames(e.target.checked);
                try {
                  localStorage.setItem('kvizhub-panel-names', e.target.checked ? '1' : '0');
                } catch {
                  /* ignore */
                }
              }}
              data-testid="full-names"
            />
            {t('dash.fullNames')}
          </label>
          {d.codeAlert && (
            <p role="alert" className="rounded bg-amber-100 p-2 text-sm text-amber-900">
              ⚠ {t('host.codeAlert')}
            </p>
          )}
          {d.notJoined && d.notJoined.length > 0 && (
            <p className="text-sm text-slate-600" data-testid="dash-not-joined">
              <strong>{t('host.notJoined', { count: d.notJoined.length })}:</strong> {d.notJoined.map((x) => x.publicName).join(', ')}
            </p>
          )}
        </div>
      )}
      {guard && guard.mode !== 'off' && <p className="text-xs text-slate-500">{t('dash.guardInfo', { mode: t(`guard.mode.${guard.mode}`), max: guard.maxLeaves })}</p>}
      <ErrorBox error={error} onClose={() => setError(null)} />
      {d.classGame && <GuestsPanel gameId={id!} showNames={fullNames} />}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm" data-testid="dash-table">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="p-2">{t('dash.student')}</th>
              <th className="p-2">{t('dash.status')}</th>
              <th className="p-2">{t('dash.answered')}</th>
              <th className="p-2">{t('dash.remaining')}</th>
              <th className="p-2">{t('dash.percent')}</th>
              {guard && guard.mode !== 'off' && <th className="p-2">{t('dash.left')}</th>}
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {d.students.map((s) => {
              const warn = s.locked || s.overLimit;
              return (
                <tr key={s.attemptId} className={`border-t border-slate-100 ${s.locked ? 'bg-red-50' : warn ? 'bg-amber-50' : ''}`} data-testid="dash-row" data-flagged={warn ? 'true' : 'false'}>
                  <td className="p-2 font-medium">
                    {s.locked && <span aria-label={t('dash.locked')}>🔒 </span>}
                    {!s.locked && s.overLimit && <span aria-label={t('dash.overLimit')}>⚠ </span>}
                    {s.student}
                  </td>
                  <td className="p-2">{t(`dash.st.${s.status}`)}</td>
                  <td className="p-2">
                    {s.answered}/{s.total}
                  </td>
                  <td className="p-2 font-mono">{s.remainingSec !== null ? mmss(s.remainingSec) : '–'}</td>
                  <td className="p-2 font-mono">{s.percent !== null ? `${s.percent} %` : '–'}</td>
                  {guard && guard.mode !== 'off' && (
                    <td className="p-2 text-xs" data-testid="dash-left">
                      {s.guardExempt ? (
                        <span className="text-slate-500">{t('dash.exempt')}</span>
                      ) : (
                        <>
                          {t('dash.leftValue', { count: s.leaveTotal ?? 0, sec: s.awaySec ?? 0 })}
                          {s.unconfirmedGap && <span className="ml-1 text-slate-500" title={t('dash.gapHint')}>· ⏸ {t('dash.gap')}</span>}
                          {guard.requireFullscreen && s.fullscreenSupported === false && <span className="ml-1 text-slate-500">· {t('dash.noFullscreen')}</span>}
                        </>
                      )}
                    </td>
                  )}
                  <td className="p-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="ghost" onClick={() => act(async () => setDetail(await api<Detail>('GET', `/api/v1/games/${id}/attempts/${s.attemptId}`)))}>
                        {t('dash.detail')}
                      </Button>
                      {s.locked && running && (
                        <Button
                          variant="success"
                          data-testid="dash-unlock"
                          onClick={() => {
                            const extra = prompt(t('dash.unlockPrompt'), '0');
                            if (extra === null) return;
                            void act(() => api('POST', `/api/v1/games/${id}/attempts/${s.attemptId}/unlock`, { extraMinutes: Number(extra) || 0 }));
                          }}
                        >
                          {t('dash.unlock')}
                        </Button>
                      )}
                      {guard && guard.mode !== 'off' && running && (s.status === 'in_progress' || s.status === 'not_started') && (
                        <Button variant="ghost" data-testid="dash-exempt" onClick={() => act(() => api('POST', `/api/v1/games/${id}/attempts/${s.attemptId}/exempt`, { exempt: !s.guardExempt }))}>
                          {s.guardExempt ? t('dash.guardOn') : t('dash.guardOff')}
                        </Button>
                      )}
                      {running && (
                        <Button variant="ghost" disabled={s.allowReturn} onClick={() => act(() => api('POST', `/api/v1/games/${id}/attempts/${s.attemptId}/allow-return`))}>
                          {s.allowReturn ? t('dash.returnAllowed') : t('dash.allowReturn')}
                        </Button>
                      )}
                      {running && (s.status === 'submitted' || s.status === 'expired') && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            const m = prompt(t('dash.reopenPrompt'), '10');
                            if (m) void act(() => api('POST', `/api/v1/games/${id}/attempts/${s.attemptId}/reopen`, { minutes: Number(m) }));
                          }}
                        >
                          {t('dash.reopen')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {d.students.length === 0 && (
              <tr>
                <td className="p-3 text-slate-500" colSpan={7}>
                  {t('dash.none')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <Modal title={detail.student} onClose={() => setDetail(null)}>
          <p className="mb-3 text-sm text-slate-600">
            {t(`dash.st.${detail.status}`)}
            {detail.percent !== null && ` · ${detail.percent} %`}
            {detail.submittedAt && ` · ${formatDate(detail.submittedAt)}`}
          </p>
          <ol className="space-y-2 text-sm">
            {detail.questions.map((q) => (
              <li key={q.number} className={`rounded border p-2 ${q.answer === null ? 'border-slate-200' : q.correct ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
                <p className="font-medium">
                  {q.number}. {q.prompt}
                </p>
                <p>
                  {q.answer === null ? t('test.noAnswer') : `${q.correct ? '✓' : q.fraction > 0 ? '½' : '✗'} ${q.answer}`}
                </p>
                {!q.correct && <p className="text-slate-600">{t('play.correctWas')}: {q.correctText.join(' / ')}</p>}
              </li>
            ))}
          </ol>
          {detail.events && (
            <section className="mt-4" data-testid="dash-timeline">
              <h3 className="mb-2 font-semibold">{t('dash.timeline')}</h3>
              {detail.events.length === 0 ? (
                <p className="text-sm text-slate-500">{t('dash.noEvents')}</p>
              ) : (
                <ol className="space-y-1 text-sm">
                  {detail.events.map((e, i) => (
                    <li key={i} className={e.type === 'gap' ? 'text-slate-500' : ''}>
                      {mmss(Math.max(0, Math.round(e.offsetSec)))} –{' '}
                      {e.type === 'gap' ? t('dash.eventGap') : t(`guard.reason.${e.reason ?? 'hidden'}`)}
                      {e.durationSec !== null ? `, ${t('dash.duration', { sec: e.durationSec })}` : `, ${t('dash.stillAway')}`}
                      {e.type !== 'gap' && !e.counted && ` (${t('dash.notCounted')})`}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </Modal>
      )}
    </div>
  );
}
