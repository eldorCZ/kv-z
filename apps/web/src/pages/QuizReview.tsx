import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api, ApiError } from '../api';
import ExportModal from '../components/ExportModal';
import QuestionEditor, { type EditableQuestion } from '../components/QuestionEditor';
import StartGameModal from '../components/StartGameModal';
import { Badge, Button, ErrorBox, inputCls } from '../components/ui';

export interface QuizDto {
  id: string;
  title: string;
  gradeLevel: string;
  language: string;
  settings: { shuffleQuestions: boolean; shuffleOptions: boolean };
  sourceFiles: { name: string; sha256: string }[];
  stats: { total: number; ok: number; flagged: number };
  questions: EditableQuestion[];
}

export default function QuizReview() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [quiz, setQuiz] = useState<QuizDto | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [modal, setModal] = useState<'game' | 'export' | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [titleState, setTitleState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const titleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    try {
      const q = await api<QuizDto>('GET', `/api/v1/quizzes/${id}`);
      setQuiz(q);
      setTitle((cur) => cur || q.title);
    } catch (e) {
      setError(e as ApiError);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e as ApiError);
    }
  };

  const saveTitle = (value: string) => {
    setTitle(value);
    clearTimeout(titleTimer.current);
    if (!value.trim()) return;
    setTitleState('saving');
    titleTimer.current = setTimeout(async () => {
      try {
        await api('PATCH', `/api/v1/quizzes/${id}`, { title: value });
        setTitleState('saved');
      } catch (e) {
        setError(e as ApiError);
        setTitleState('idle');
      }
    }, 700);
  };

  if (!quiz) return error ? <ErrorBox error={error} /> : <p className="text-slate-500">{t('common.loading')}</p>;

  const questions = onlyFlagged ? quiz.questions.filter((q) => q.qa.status === 'flagged') : quiz.questions;

  const move = (qid: string, targetId: string) => {
    if (qid === targetId) return;
    const target = quiz.questions.findIndex((q) => q.id === targetId);
    const ids = quiz.questions.map((q) => q.id).filter((x) => x !== qid);
    ids.splice(target, 0, qid);
    // optimistic reorder
    setQuiz({ ...quiz, questions: ids.map((i) => quiz.questions.find((q) => q.id === i)!) });
    void run(() => api('PUT', `/api/v1/quizzes/${id}/order`, { questionIds: ids }));
  };

  const shift = (qid: string, dir: -1 | 1) => {
    const ids = quiz.questions.map((q) => q.id);
    const i = ids.indexOf(qid);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setQuiz({ ...quiz, questions: ids.map((x) => quiz.questions.find((q) => q.id === x)!) });
    void run(() => api('PUT', `/api/v1/quizzes/${id}/order`, { questionIds: ids }));
  };

  const addQuestion = () =>
    run(async () => {
      const r = await api<{ question: { id: string } }>('POST', `/api/v1/quizzes/${id}/questions`, {
        type: 'single',
        prompt: t('review.newQuestionPrompt'),
        options: [t('review.optionN', { n: 1 }), t('review.optionN', { n: 2 }), t('review.optionN', { n: 3 })],
        correctIndices: [0],
      });
      setEditing(r.question.id);
    });

  const typeLabel = (type: string) => t(`types.${type}`);

  return (
    <div>
      <p className="mb-2 text-sm">
        <Link to="/quizzes" className="text-hra-700 hover:underline">
          ← {t('review.back')}
        </Link>
      </p>
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="quiz-title">
            {t('review.quizTitle')}
          </label>
          <input id="quiz-title" className={`${inputCls} text-xl font-bold`} value={title} maxLength={120} onChange={(e) => saveTitle(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500" aria-live="polite">
            {titleState === 'saving' ? t('editor.saving') : titleState === 'saved' ? t('editor.saved') : ''}
            {quiz.gradeLevel && ` ${quiz.gradeLevel}`}
            {quiz.sourceFiles.length > 0 && ` · ${t('review.sources')}: ${quiz.sourceFiles.map((f) => f.name).join(', ')}`}
          </p>
        </div>
        <Button variant="success" onClick={() => setModal('game')} data-testid="start-game">
          ▶ {t('review.startGame')}
        </Button>
        <Button onClick={() => setModal('export')}>{t('review.export')}</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <span>{t('review.stats', { total: quiz.stats.total, ok: quiz.stats.ok })}</span>
        {quiz.stats.flagged > 0 ? <Badge tone="flagged">⚠ {t('review.flaggedCount', { count: quiz.stats.flagged })}</Badge> : <Badge tone="ok">✓ {t('review.allOk')}</Badge>}
        <label className="ml-auto flex items-center gap-2">
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
          {t('review.onlyFlagged')}
        </label>
        <Button onClick={() => run(() => api('POST', `/api/v1/quizzes/${id}/approve-ok`))}>✓ {t('review.approveAllOk')}</Button>
        <Button variant="primary" onClick={addQuestion}>
          + {t('review.addQuestion')}
        </Button>
      </div>
      {quiz.stats.flagged > 0 && <p className="mb-3 text-sm text-amber-900">{t('review.flaggedInfo')}</p>}

      <ErrorBox error={error} onClose={() => setError(null)} />

      <ol className="space-y-3">
        {questions.map((q) => {
          const index = quiz.questions.indexOf(q);
          const isEditing = editing === q.id;
          return (
            <li
              key={q.id}
              data-testid="question"
              draggable={!isEditing && !onlyFlagged}
              onDragStart={() => setDragId(q.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragId) move(dragId, q.id);
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
              className={`rounded-lg border bg-white p-4 shadow-sm ${q.qa.status === 'flagged' ? 'border-amber-400' : 'border-slate-200'} ${dragId === q.id ? 'opacity-60' : ''}`}
            >
              <div className="flex flex-wrap items-start gap-3">
                {!onlyFlagged && (
                  <div className="flex flex-col items-center text-slate-400">
                    <button className="px-1 hover:text-slate-700" aria-label={t('review.moveUp')} onClick={() => shift(q.id, -1)}>
                      ▲
                    </button>
                    <span className="cursor-grab select-none" title={t('review.dragHint')} aria-hidden="true">
                      ⠿
                    </span>
                    <button className="px-1 hover:text-slate-700" aria-label={t('review.moveDown')} onClick={() => shift(q.id, 1)}>
                      ▼
                    </button>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-bold text-slate-700">{index + 1}.</span>
                    <span>{typeLabel(q.type)}</span>
                    <span>· {q.timeLimitSec} s</span>
                    {q.points !== 'standard' && <span>· {t(`points.${q.points}`)}</span>}
                    {q.qa.status === 'flagged' ? (
                      <Badge tone="flagged">⚠ {t('review.badgeFlagged')}</Badge>
                    ) : q.approvedAt ? (
                      <Badge tone="approved">✓✓ {t('review.badgeApproved')}</Badge>
                    ) : (
                      <Badge tone="ok">✓ {t('review.badgeOk')}</Badge>
                    )}
                    {q.difficulty && <span>· {t(`difficulty.${q.difficulty}`)}</span>}
                    {q.bloom && <span>· {t(`bloom.${q.bloom}`)}</span>}
                  </div>
                  <p className="font-medium">{q.prompt}</p>
                  {q.qa.status === 'flagged' && q.qa.notes && (
                    <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">
                      <strong>{t('review.qaNote')}:</strong> {q.qa.notes}
                    </p>
                  )}
                  {!isEditing && <AnswerPreview q={q} />}
                  {(q.sourceRef || q.explanation) && !isEditing && (
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer text-hra-700">{t('review.sourceAndExplanation')}</summary>
                      {q.sourceRef && (
                        <div className="mt-2 rounded bg-slate-50 p-2">
                          <p className="text-xs text-slate-500">
                            {t('review.source')}: {q.sourceRef.file}
                            {q.sourceRef.locator && `, ${q.sourceRef.locator}`}
                          </p>
                          {q.sourceRef.quote && <blockquote className="mt-1 border-l-4 border-slate-300 pl-2 italic">„{q.sourceRef.quote}“</blockquote>}
                        </div>
                      )}
                      {q.explanation && (
                        <p className="mt-2">
                          <strong>{t('review.explanation')}:</strong> {q.explanation}
                        </p>
                      )}
                    </details>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {q.qa.status === 'flagged' && (
                    <Button variant="success" onClick={() => run(() => api('POST', `/api/v1/quizzes/${id}/questions/${q.id}/approve`))}>
                      ✓ {t('review.approve')}
                    </Button>
                  )}
                  <Button onClick={() => setEditing(isEditing ? null : q.id)}>{isEditing ? t('review.closeEditor') : t('review.edit')}</Button>
                  <Button variant="ghost" onClick={() => run(() => api('POST', `/api/v1/quizzes/${id}/questions/${q.id}/duplicate`))}>
                    {t('review.duplicate')}
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-red-700"
                    onClick={() => {
                      if (quiz.questions.length <= 1) return setError(new Error(t('review.lastQuestion')));
                      if (confirm(t('review.confirmDelete'))) void run(() => api('DELETE', `/api/v1/quizzes/${id}/questions/${q.id}`));
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
              {isEditing && (
                <QuestionEditor
                  quizId={quiz.id}
                  question={q}
                  onSaved={(saved) => setQuiz((cur) => (cur ? { ...cur, questions: cur.questions.map((x) => (x.id === saved.id ? saved : x)) } : cur))}
                />
              )}
            </li>
          );
        })}
      </ol>
      {questions.length === 0 && <p className="text-slate-500">{t('review.noneFlagged')}</p>}

      {modal === 'game' && <StartGameModal quiz={quiz} onClose={() => setModal(null)} />}
      {modal === 'export' && <ExportModal quiz={quiz} onClose={() => setModal(null)} />}
    </div>
  );
}

function AnswerPreview({ q }: { q: EditableQuestion }) {
  const { t } = useTranslation();
  if (q.type === 'short') return <p className="mt-1 text-sm text-emerald-800">✓ {q.acceptedAnswers.join(' / ')}</p>;
  if (q.type === 'numeric')
    return (
      <p className="mt-1 text-sm text-emerald-800">
        ✓ {q.numericAnswer} {q.numericTolerance ? `± ${q.numericTolerance}` : ''}
      </p>
    );
  if (q.type === 'order')
    return (
      <ol className="mt-1 list-decimal pl-6 text-sm">
        {q.options.map((o, i) => (
          <li key={i}>{o}</li>
        ))}
      </ol>
    );
  return (
    <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
      {q.options.map((o, i) => {
        const ok = q.correctIndices.includes(i);
        return (
          <li key={i} className={`rounded px-2 py-1 ${ok ? 'bg-emerald-50 font-medium text-emerald-900' : 'bg-slate-50'}`}>
            {ok ? '✓ ' : '✗ '}
            {o}
            {ok && <span className="sr-only"> ({t('editor.correct')})</span>}
          </li>
        );
      })}
    </ul>
  );
}
