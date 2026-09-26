import { SparkMark } from '../ui/Logo';

/**
 * Thumbnail of a quiz on its card (V7.2). Until motives exist (V-M2) it is a calm gradient derived from
 * the quiz id so that cards are easy to tell apart.
 */
export function QuizThumb({ seed, className = '' }: { seed: string; theme?: { motive?: string; accent?: string } | null; className?: string }) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      aria-hidden="true"
      ref={(el) => {
        el?.style.setProperty('background', `linear-gradient(135deg, hsl(${hue} 70% 62%), hsl(${(hue + 50) % 360} 75% 52%))`);
      }}
    >
      <SparkMark className="h-12 w-12 text-surface opacity-80" mono />
    </div>
  );
}
