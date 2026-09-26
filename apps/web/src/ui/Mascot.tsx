/**
 * Jiskřička – the Jiskra mascot (Dodatek 4, V-M5): our own spark with a face, six poses, pure SVG in the
 * current colours. Never used in tests (calm mood) and always decorative (aria-hidden).
 */
export type MascotPose = 'hello' | 'think' | 'cheer' | 'sad' | 'sleep' | 'point';

export function Mascot({ pose = 'hello', className = 'h-32 w-32' }: { pose?: MascotPose; className?: string }) {
  const eyesClosed = pose === 'sleep';
  const mouth = {
    hello: 'M44 46q6 6 12 0',
    think: 'M45 48h10',
    cheer: 'M42 44q8 11 16 0z',
    sad: 'M44 50q6-5 12 0',
    sleep: 'M46 48q4 3 8 0',
    point: 'M44 46q6 5 12 0',
  }[pose];
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" data-testid="mascot" data-pose={pose}>
      {/* body: our four-point spark */}
      <path
        d="M50 6c4 22 12 30 34 34-22 4-30 12-34 34-4-22-12-30-34-34 22-4 30-12 34-34z"
        transform={pose === 'sad' ? 'translate(0 4) scale(1 .96)' : undefined}
        fill="var(--accent)"
        stroke="var(--fg)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* eyes */}
      {eyesClosed ? (
        <g stroke="var(--fg)" strokeWidth="2.5" strokeLinecap="round" fill="none">
          <path d="M41 37q3 2 6 0" />
          <path d="M53 37q3 2 6 0" />
        </g>
      ) : (
        <g fill="var(--fg)">
          <circle cx="44" cy={pose === 'think' ? 35 : 37} r="3" />
          <circle cx="56" cy={pose === 'think' ? 35 : 37} r="3" />
        </g>
      )}
      <path d={mouth} fill={pose === 'cheer' ? 'var(--fg)' : 'none'} stroke="var(--fg)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* pose details */}
      {pose === 'hello' && <path d="M78 58q8-2 10-10m-4 14q9 0 12-7" fill="none" stroke="var(--fg)" strokeWidth="2.5" strokeLinecap="round" />}
      {pose === 'think' && <path d="M76 18q0-8 8-8t8 8q0 5-6 7v4m0 5v1" fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" />}
      {pose === 'cheer' && (
        <g fill="var(--primary)">
          <path d="M16 14l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
          <path d="M84 70l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" />
        </g>
      )}
      {pose === 'sad' && <path d="M59 40q2 5 0 7" fill="none" stroke="var(--info)" strokeWidth="2.5" strokeLinecap="round" />}
      {pose === 'sleep' && (
        <text x="70" y="24" fontSize="14" fontWeight="700" fill="var(--muted)">
          z z
        </text>
      )}
      {pose === 'point' && <path d="M84 40h12m-5-5 5 5-5 5" fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}
