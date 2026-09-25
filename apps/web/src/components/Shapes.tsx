/** Answer buttons use colour AND shape so that colour-blind players can tell them apart. */
export const ANSWER_STYLES = [
  { name: 'triangle', bg: 'bg-red-600', ring: 'ring-red-300', label: 'trojúhelník' },
  { name: 'diamond', bg: 'bg-blue-700', ring: 'ring-blue-300', label: 'kosočtverec' },
  { name: 'circle', bg: 'bg-amber-600', ring: 'ring-amber-200', label: 'kruh' },
  { name: 'square', bg: 'bg-green-700', ring: 'ring-green-300', label: 'čtverec' },
  { name: 'star', bg: 'bg-purple-700', ring: 'ring-purple-300', label: 'hvězda' },
] as const;

export function Shape({ index, className = 'h-8 w-8' }: { index: number; className?: string }) {
  const name = ANSWER_STYLES[index % ANSWER_STYLES.length]!.name;
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="white">
      {name === 'triangle' && <polygon points="16,3 30,28 2,28" />}
      {name === 'diamond' && <polygon points="16,2 30,16 16,30 2,16" />}
      {name === 'circle' && <circle cx="16" cy="16" r="13" />}
      {name === 'square' && <rect x="4" y="4" width="24" height="24" />}
      {name === 'star' && <polygon points="16,2 20,12 31,12 22,19 25,30 16,23 7,30 10,19 1,12 12,12" />}
    </svg>
  );
}
