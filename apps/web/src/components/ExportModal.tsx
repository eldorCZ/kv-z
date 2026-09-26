import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, download } from '../api';
import type { QuizDto } from '../pages/QuizReview';
import { Button, ErrorBox, Modal } from './ui';

interface Summary {
  total: number;
  exported: number;
  message: string;
  skippedNumbers: Record<string, number[]>;
  tooLong: { number: number; field: string; length: number; limit: number }[];
}

type Format = 'kahoot' | 'gift' | 'json';

export default function ExportModal({ quiz, onClose }: { quiz: QuizDto; onClose: () => void }) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<Format>('kahoot');
  const [includeFlagged, setIncludeFlagged] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    setSummary(null);
    api<Summary>('GET', `/api/v1/quizzes/${quiz.id}/export-summary?format=${format}${includeFlagged ? '&includeFlagged=1' : ''}`)
      .then(setSummary)
      .catch((e) => setError(e as ApiError));
  }, [quiz.id, format, includeFlagged]);

  const url = (f: Format) => `/api/v1/quizzes/${quiz.id}?format=${f}${f === 'json' ? '&download=1' : ''}${includeFlagged ? '&includeFlagged=1' : ''}`;
  const get = async (f: Format) => {
    try {
      await download(url(f));
    } catch (e) {
      setError(e as ApiError);
    }
  };

  return (
    <Modal title={t('export.title')} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('export.format')}>
          {(['kahoot', 'gift', 'json'] as const).map((f) => (
            <label key={f} className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${format === f ? 'border-hra-600 bg-indigo-50' : 'border-slate-300'}`}>
              <input type="radio" className="sr-only" name="format" checked={format === f} onChange={() => setFormat(f)} />
              {t(`export.formats.${f}`)}
            </label>
          ))}
        </div>
        {format !== 'json' ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeFlagged} onChange={(e) => setIncludeFlagged(e.target.checked)} />
            {t('export.includeFlagged')}
          </label>
        ) : (
          <p className="text-sm text-slate-600">{t('export.jsonInfo')}</p>
        )}
        {summary && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="export-summary">
            <p className="font-medium">{summary.message}</p>
            {Object.entries(summary.skippedNumbers)
              .filter(([, v]) => v.length)
              .map(([k, v]) => (
                <p key={k} className="text-slate-600">
                  {t(`export.reasons.${k}`)}: {v.map((n) => `#${n}`).join(', ')}
                </p>
              ))}
            {summary.tooLong.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-amber-900">
                {summary.tooLong.map((x, i) => (
                  <li key={i}>{t('export.tooLongItem', { number: x.number, field: t(`export.fields.${x.field}`), length: x.length, limit: x.limit })}</li>
                ))}
              </ul>
            )}
            {format === 'kahoot' && <p className="mt-2 text-xs text-slate-500">{t('export.kahootNote')}</p>}
          </div>
        )}
        <ErrorBox error={error} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => get(format)} disabled={!summary || summary.exported === 0}>
            {t('export.download')}
          </Button>
          {format === 'kahoot' && <Button onClick={() => get('json')}>{t('export.downloadFullJson')}</Button>}
        </div>
      </div>
    </Modal>
  );
}
