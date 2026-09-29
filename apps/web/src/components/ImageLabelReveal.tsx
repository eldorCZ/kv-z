export interface RevealPin {
  text: string;
  x: number;
  y: number;
  radius: number;
}

/**
 * Správné řešení otázky „přiřazování do obrázku".
 *
 * Samotný seznam názvů žákům nic neřekne — potřebují vidět, kam který patří.
 * Kreslíme proto obrázek a do něj terčík s názvem na místě každého špendlíku.
 * Souřadnice jsou podíly (0..1), takže sedí v jakékoli velikosti obrázku;
 * tolerance je nad podíly, na obrázku na výšku tedy vychází elipsa.
 */
export function ImageLabelReveal({ imageUrl, pins, size = 'lg' }: { imageUrl?: string | null; pins: RevealPin[]; size?: 'lg' | 'sm' }) {
  if (!imageUrl || pins.length === 0) return null;
  const velky = size === 'lg';
  return (
    <div className="relative mx-auto w-fit" data-testid="image-label-reveal">
      <img src={imageUrl} alt="" className={`${velky ? 'max-h-[52vh]' : 'max-h-56'} block w-auto max-w-full rounded-lg border border-line object-contain`} />
      {pins.map((p, i) => (
        <div key={i}>
          <span
            aria-hidden="true"
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.radius * 200}%`, height: `${p.radius * 200}%` }}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-dashed border-success bg-success/20"
          />
          <span
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-pill bg-success-strong px-3 py-1 font-semibold text-on-success shadow-pop ${velky ? 'text-xl' : 'text-xs'}`}
          >
            {p.text}
          </span>
        </div>
      ))}
    </div>
  );
}
