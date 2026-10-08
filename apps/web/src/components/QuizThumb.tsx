import { ACCENTS, getMotive } from '@kvizhub/core/client';
import { usePrefs } from '../theme/prefs';
import { Logo } from '../ui/Logo';
import { motiveThumb } from './ThemePicker';

/**
 * Thumbnail of a quiz on its card (V7.2). Pořadí: vlastní obrázek kvízu → obrázek
 * z jeho první obrázkové otázky → motiv → značka.
 *
 * `questionImageId` přibyl proto, že náhodný barevný přechod podle id vypadal sice
 * pestře, ale o kvízu neříkal nic — seznam pak působí jako šablona. Obrázek z vlastní
 * otázky je zadarmo a učitel pozná kvíz na první pohled.
 */
export function QuizThumb({
  theme,
  questionImageId,
  className = '',
}: {
  theme?: { motive?: string; accent?: string; imageId?: string } | null;
  questionImageId?: string | null;
  className?: string;
}) {
  const { theme: scheme } = usePrefs();
  const obrazek = theme?.imageId ?? (theme?.motive ? undefined : (questionImageId ?? undefined));
  if (obrazek)
    return (
      <div className={`relative overflow-hidden ${className}`} aria-hidden="true" data-image="true">
        <img src={`/media/theme/${obrazek}/640.webp`} alt="" loading="lazy" className="h-full w-full object-cover" />
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
  // Poslední možnost: klidná plocha se značkou. Dřív tu byl odstín spočítaný z id —
  // vedle sebe to dávalo duhu, ve které barva nic neznamenala.
  return (
    <div className={`relative flex items-center justify-center overflow-hidden bg-panel ${className}`} aria-hidden="true" data-fallback="brand">
      <Logo variant="mark" height={44} decorative className="opacity-40" />
    </div>
  );
}
