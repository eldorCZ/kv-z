/**
 * Lorík – the Lore mascot, a living book (Dodatek 4B, L4). The six poses are finished artwork in
 * design/brand/mascot, served from /brand/mascot as plain images: decorative (empty alt), never recoloured,
 * never in tests, the lock or submit screens (D7, G5), at most one per screen. The optional "breathing"
 * runs only in the playful mood with motion allowed (CSS .mascot-breathe).
 */
export type MascotPose = 'hello' | 'think' | 'celebrate' | 'encourage' | 'sleep' | 'error';

const RATIO = 225 / 210;

export function Mascot({ pose, size = 160, className = '' }: { pose: MascotPose; size?: number; className?: string }) {
  const w = Math.min(320, Math.max(96, size));
  return (
    <img
      src={`/brand/mascot/lore-${pose}.svg`}
      alt=""
      aria-hidden="true"
      width={w}
      height={Math.round(w * RATIO)}
      loading="lazy"
      draggable={false}
      data-testid="mascot"
      data-pose={pose}
      className={`mascot-breathe select-none ${className}`}
    />
  );
}
