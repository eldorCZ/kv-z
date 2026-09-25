import { QUESTION_TYPES, TIME_LIMITS, validateQuestion, type ContractError, type QuestionType } from '@kvizhub/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { Button, Field, inputCls } from './ui';

export interface EditableQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options: string[];
  correctIndices: number[];
  acceptedAnswers: string[];
  numericAnswer: number | null;
  numericTolerance: number | null;
  explanation: string;
  timeLimitSec: number;
  points: 'standard' | 'double' | 'none';
  bloom?: string | null;
  difficulty?: string | null;
  sourceRef?: { file: string; locator: string; quote: string } | null;
  qa: { status: 'ok' | 'flagged'; notes: string };
  approvedAt: number | null;
}

type Draft = Omit<EditableQuestion, 'id' | 'approvedAt' | 'qa'>;

const EDITABLE_KEYS = ['type', 'prompt', 'options', 'correctIndices', 'acceptedAnswers', 'numericAnswer', 'numericTolerance', 'explanation', 'timeLimitSec', 'points'] as const;

function toDraft(q: EditableQuestion): Draft {
  const { id: _id, approvedAt: _a, qa: _qa, ...rest } = q;
  return rest;
}

/** Adapt type specific fields when the teacher changes the question type. */
function changeType(d: Draft, type: QuestionType): Draft {
  const opts = d.options.length ? d.options : ['', '', ''];
  switch (type) {
    case 'single': {
      const o = opts.slice(0, 4);
      while (o.length < 3) o.push('');
      return { ...d, type, options: o, correctIndices: [0], acceptedAnswers: [], numericAnswer: null, numericTolerance: null };
    }
    case 'multi': {
      const o = [...opts];
      while (o.length < 4) o.push('');
      return { ...d, type, options: o.slice(0, 5), correctIndices: [0, 1], acceptedAnswers: [], numericAnswer: null, numericTolerance: null };
    }
    case 'truefalse':
      return { ...d, type, options: ['Pravda', 'Nepravda'], correctIndices: [0], acceptedAnswers: [], numericAnswer: null, numericTolerance: null };
    case 'short':
      return { ...d, type, options: [], correctIndices: [], acceptedAnswers: d.acceptedAnswers.length ? d.acceptedAnswers : [''], numericAnswer: null, numericTolerance: null };
    case 'numeric':
      return { ...d, type, options: [], correctIndices: [], acceptedAnswers: [], numericAnswer: d.numericAnswer ?? 0, numericTolerance: d.numericTolerance ?? 0 };
    case 'order': {
      const o = [...opts];
      while (o.length < 3) o.push('');
      return { ...d, type, options: o.slice(0, 5), correctIndices: [], acceptedAnswers: [], numericAnswer: null, numericTolerance: null };
    }
  }
}

const draftKey = (qid: string) => `kvizhub-draft-${qid}`;

export default function QuestionEditor({ quizId, question, onSaved }: { quizId: string; question: EditableQuestion; onSaved: (q: EditableQuestion) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => {
    // restore an unsaved local draft (e.g. after a lost connection)
    try {
      const saved = localStorage.getItem(draftKey(question.id));
      if (saved) return { ...toDraft(question), ...JSON.parse(saved) };
    } catch {
      /* ignore */
    }
    return toDraft(question);
  });
  const [state, setState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [errors, setErrors] = useState<ContractError[]>([]);
  const [serverError, setServerError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState('dirty');
    try {
      localStorage.setItem(draftKey(question.id), JSON.stringify(draft));
    } catch {
      /* storage may be unavailable */
    }
    const v = validateQuestion({ ...draft, qa: question.qa, sourceRef: question.sourceRef ?? null });
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors([]);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setState('saving');
      try {
        const body = Object.fromEntries(EDITABLE_KEYS.map((k) => [k, draft[k]]));
        const r = await api<{ question: EditableQuestion }>('PATCH', `/api/v1/quizzes/${quizId}/questions/${question.id}`, body);
        localStorage.removeItem(draftKey(question.id));
        setState('saved');
        setServerError('');
        onSaved(r.question);
      } catch (e) {
        setState('error');
        const err = e as ApiError;
        if (err.errors?.length) setErrors(err.errors);
        setServerError(err.message);
      }
    }, 800);
    return () => clearTimeout(timer.current);
  }, [draft]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const errFor = (prefix: string) => errors.filter((e) => e.path === prefix || e.path.startsWith(`${prefix}[`) || e.path.startsWith(`${prefix}.`));
  const ErrList = ({ path }: { path: string }) => (
    <>
      {errFor(path).map((e, i) => (
        <p key={i} className="mt-1 text-xs text-red-700">
          {e.message}
        </p>
      ))}
    </>
  );

  const choice = draft.type === 'single' || draft.type === 'multi' || draft.type === 'truefalse';
  const maxOptions = draft.type === 'single' ? 4 : 5;
  const minOptions = draft.type === 'multi' ? 4 : 3;

  const setOption = (i: number, v: string) => set('options', draft.options.map((o, j) => (j === i ? v : o)));
  const removeOption = (i: number) => {
    setDraft((d) => ({
      ...d,
      options: d.options.filter((_, j) => j !== i),
      correctIndices: d.correctIndices.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c)),
    }));
  };
  const moveOption = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.options.length) return;
    const o = [...draft.options];
    [o[i], o[j]] = [o[j]!, o[i]!];
    set('options', o);
  };
  const toggleCorrect = (i: number) => {
    if (draft.type === 'multi') set('correctIndices', draft.correctIndices.includes(i) ? draft.correctIndices.filter((c) => c !== i) : [...draft.correctIndices, i].sort());
    else set('correctIndices', [i]);
  };

  const status = {
    idle: '',
    dirty: errors.length ? t('editor.invalid') : t('editor.pending'),
    saving: t('editor.saving'),
    saved: t('editor.saved'),
    error: t('editor.error', { message: serverError }),
  }[state];

  return (
    <div className="mt-4 space-y-4 border-t border-slate-200 pt-4" data-testid="editor">
      <div className="flex flex-wrap gap-3">
        <Field label={t('editor.type')}>
          <select className={inputCls} value={draft.type} onChange={(e) => setDraft((d) => changeType(d, e.target.value as QuestionType))}>
            {QUESTION_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`types.${ty}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('editor.time')}>
          <select className={inputCls} value={draft.timeLimitSec} onChange={(e) => set('timeLimitSec', Number(e.target.value))}>
            {TIME_LIMITS.map((v) => (
              <option key={v} value={v}>
                {v} s
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('editor.points')}>
          <select className={inputCls} value={draft.points} onChange={(e) => set('points', e.target.value as Draft['points'])}>
            {(['standard', 'double', 'none'] as const).map((p) => (
              <option key={p} value={p}>
                {t(`points.${p}`)}
              </option>
            ))}
          </select>
        </Field>
        <p className={`ml-auto self-end text-sm ${state === 'error' || errors.length ? 'text-red-700' : 'text-slate-500'}`} aria-live="polite" data-testid="save-state">
          {status}
        </p>
      </div>

      <Field label={t('editor.prompt')} hint={t('editor.promptHint', { count: draft.prompt.length })}>
        <textarea className={inputCls} rows={2} maxLength={300} value={draft.prompt} onChange={(e) => set('prompt', e.target.value)} />
        <ErrList path="prompt" />
      </Field>

      {(choice || draft.type === 'order') && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">{draft.type === 'order' ? t('editor.orderItems') : t('editor.options')}</legend>
          <ul className="space-y-2">
            {draft.options.map((o, i) => (
              <li key={i} className="flex items-center gap-2">
                {choice && (
                  <input
                    type={draft.type === 'multi' ? 'checkbox' : 'radio'}
                    name={`correct-${question.id}`}
                    className="h-5 w-5"
                    checked={draft.correctIndices.includes(i)}
                    onChange={() => toggleCorrect(i)}
                    aria-label={t('editor.markCorrect', { n: i + 1 })}
                  />
                )}
                {draft.type === 'order' && <span className="w-6 text-right text-sm text-slate-500">{i + 1}.</span>}
                <input
                  className={inputCls}
                  value={o}
                  maxLength={120}
                  disabled={draft.type === 'truefalse'}
                  onChange={(e) => setOption(i, e.target.value)}
                  aria-label={t('editor.optionN', { n: i + 1 })}
                />
                {draft.type === 'order' && (
                  <>
                    <Button type="button" variant="ghost" onClick={() => moveOption(i, -1)} aria-label={t('review.moveUp')}>
                      ▲
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => moveOption(i, 1)} aria-label={t('review.moveDown')}>
                      ▼
                    </Button>
                  </>
                )}
                {draft.type !== 'truefalse' && draft.options.length > minOptions && (
                  <Button type="button" variant="ghost" className="text-red-700" onClick={() => removeOption(i)} aria-label={t('editor.removeOption', { n: i + 1 })}>
                    ✕
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {draft.type !== 'truefalse' && draft.options.length < maxOptions && (
            <Button type="button" className="mt-2" onClick={() => set('options', [...draft.options, ''])}>
              + {t('editor.addOption')}
            </Button>
          )}
          <p className="mt-1 text-xs text-slate-500">{draft.type === 'order' ? t('editor.orderHint') : draft.type === 'multi' ? t('editor.multiHint') : t('editor.singleHint')}</p>
          <ErrList path="options" />
          <ErrList path="correctIndices" />
        </fieldset>
      )}

      {draft.type === 'short' && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">{t('editor.acceptedAnswers')}</legend>
          <ul className="space-y-2">
            {draft.acceptedAnswers.map((a, i) => (
              <li key={i} className="flex gap-2">
                <input
                  className={inputCls}
                  value={a}
                  maxLength={60}
                  onChange={(e) => set('acceptedAnswers', draft.acceptedAnswers.map((x, j) => (j === i ? e.target.value : x)))}
                  aria-label={t('editor.acceptedN', { n: i + 1 })}
                />
                {draft.acceptedAnswers.length > 1 && (
                  <Button type="button" variant="ghost" className="text-red-700" onClick={() => set('acceptedAnswers', draft.acceptedAnswers.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {draft.acceptedAnswers.length < 5 && (
            <Button type="button" className="mt-2" onClick={() => set('acceptedAnswers', [...draft.acceptedAnswers, ''])}>
              + {t('editor.addAccepted')}
            </Button>
          )}
          <p className="mt-1 text-xs text-slate-500">{t('editor.shortHint')}</p>
          <ErrList path="acceptedAnswers" />
        </fieldset>
      )}

      {draft.type === 'numeric' && (
        <div className="flex flex-wrap gap-3">
          <Field label={t('editor.numericAnswer')}>
            <input className={inputCls} type="number" step="any" value={draft.numericAnswer ?? ''} onChange={(e) => set('numericAnswer', e.target.value === '' ? null : Number(e.target.value))} />
            <ErrList path="numericAnswer" />
          </Field>
          <Field label={t('editor.numericTolerance')}>
            <input className={inputCls} type="number" step="any" min={0} value={draft.numericTolerance ?? ''} onChange={(e) => set('numericTolerance', e.target.value === '' ? null : Number(e.target.value))} />
            <ErrList path="numericTolerance" />
          </Field>
        </div>
      )}

      <Field label={t('editor.explanation')}>
        <textarea className={inputCls} rows={2} maxLength={300} value={draft.explanation} onChange={(e) => set('explanation', e.target.value)} />
        <ErrList path="explanation" />
      </Field>
      {errors.filter((e) => !/^(prompt|options|correctIndices|acceptedAnswers|numeric|explanation)/.test(e.path)).map((e, i) => (
        <p key={i} className="text-xs text-red-700">
          {e.path}: {e.message}
        </p>
      ))}
    </div>
  );
}
