import { ACCENTS, getMotive } from '@kvizhub/core/client';
import { usePrefs } from '../theme/prefs';
import { SparkMark } from '../ui/Logo';
import { motiveThumb } from './ThemePicker';

/**
 * Thumbnail of a quiz on its card (V7.2): the quiz's motive, drawn by the same function as the background.
 * Quizzes with the default look get a calm gradient derived from the id, so cards stay easy to tell apart.
 */
export function QuizThumb({ seed, theme, className = '' }: { seed: string; theme?: { motive?: string; accent?: string; imageId?: string } | null; className?: string }) {
  const { theme: scheme } = usePrefs();
  if (theme?.imageId)
    return (
      <div className={`relative overflow-hidden ${className}`} aria-hidden="true" data-image="true">
        <img src={`/media/theme/${theme.imageId}/640.webp`} alt="" loading="lazy" className="h-full w-full object-cover" />
      </div>
    );
  const motive = getMotive(theme?.motive);
  const accent = ACCENTS.find((a) => a.id === theme?.accent);
  if (motive)
    return (
      <div className={`relative overflow-hidden ${className}`} aria-hidden="true" data-motive={motive.id}>
        <img src={motiveThumb(motive.id, scheme)} alt="" loading="lazy" className="h-full w-full object-cover" />
        {accent && <span className="absolute right-2 bottom-2 h-4 w-4 rounded-pill border-2 border-surface" style={{ background: accent.tokens[scheme].primary }} />}
      </div>
    );
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      aria-hidden="true"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 62%), hsl(${(hue + 50) % 360} 75% 52%))` }}
    >
      <SparkMark className="h-12 w-12 text-surface opacity-80" mono />
    </div>
  );
}
