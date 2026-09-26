/**
 * Answers are told apart by SHAPE, LETTER and COLOUR (Dodatek 4, V3.4); shape and letter are the primary
 * signal, colour only adds to it. The shapes are our own set: spark, hexagon, drop, half circle, plus.
 */
export const ANSWER_STYLES = [
  { name: 'spark', letter: 'A', bg: 'bg-answer-1', fg: 'text-on-answer-1', ring: 'ring-answer-1', label: 'hvězda' },
  { name: 'hexagon', letter: 'B', bg: 'bg-answer-2', fg: 'text-on-answer-2', ring: 'ring-answer-2', label: 'šestiúhelník' },
  { name: 'drop', letter: 'C', bg: 'bg-answer-3', fg: 'text-on-answer-3', ring: 'ring-answer-3', label: 'kapka' },
  { name: 'dome', letter: 'D', bg: 'bg-answer-4', fg: 'text-on-answer-4', ring: 'ring-answer-4', label: 'půlkruh' },
  { name: 'plus', letter: 'E', bg: 'bg-answer-5', fg: 'text-on-answer-5', ring: 'ring-answer-5', label: 'plus' },
] as const;

export const answerStyle = (i: number) => ANSWER_STYLES[i % ANSWER_STYLES.length]!;

/** The shape in the current text colour (use inside an element with text-on-answer-N). */
export function Shape({ index, className = 'h-8 w-8' }: { index: number; className?: string }) {
  const name = answerStyle(index).name;
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="currentColor">
      {name === 'spark' && <path d="M16 1.5c1.2 8.6 4.6 12.1 13.2 13.3v2.4c-8.6 1.2-12 4.7-13.2 13.3h-.1c-1.2-8.6-4.6-12.1-13.2-13.3v-2.4C11.3 13.6 14.7 10.1 15.9 1.5z" />}
      {name === 'hexagon' && <path d="M16 2.5 28 9.3v13.4L16 29.5 4 22.7V9.3z" strokeLinejoin="round" />}
      {name === 'drop' && <path d="M16 2.5s10.5 11.7 10.5 18a10.5 10.5 0 0 1-21 0C5.5 14.2 16 2.5 16 2.5z" />}
      {name === 'dome' && <path d="M3 22a13 13 0 0 1 26 0v3.5a1.5 1.5 0 0 1-1.5 1.5h-23A1.5 1.5 0 0 1 3 25.5z" />}
      {name === 'plus' && (
        <>
          <rect x="11" y="3" width="10" height="26" rx="5" />
          <rect x="3" y="11" width="26" height="10" rx="5" />
        </>
      )}
    </svg>
  );
}

/** Shape + letter, the primary signal of an answer. */
export function AnswerMark({ index, size = 'md' }: { index: number; size?: 'sm' | 'md' | 'lg' }) {
  const s = answerStyle(index);
  const dims = { sm: ['h-5 w-5', 'text-sm'], md: ['h-8 w-8', 'text-lg'], lg: ['h-12 w-12', 'text-3xl'] }[size];
  return (
    <span className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
      <Shape index={index} className={dims[0]} />
      <span className={`font-display font-bold leading-none ${dims[1]}`}>{s.letter}</span>
    </span>
  );
}
