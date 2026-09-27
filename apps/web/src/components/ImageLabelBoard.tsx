import { useRef, useState } from 'react';

export interface Placement {
  optionIndex: number;
  x: number;
  y: number;
}

/**
 * Přiřazování názvů do obrázku očima žáka.
 *
 * Název se bere prstem nebo myší a táhne na místo v obrázku. Tažení je hlavní
 * způsob, ale ne jediný: název jde i klepnutím vybrat a druhým klepnutím do
 * obrázku položit. Bez té druhé cesty by otázka nešla vyřešit z klávesnice ani
 * tam, kde tažení nefunguje spolehlivě.
 *
 * Už položený název jde chytit a přesunout jinam, nebo vrátit zpět dolů.
 */
export function ImageLabelBoard({
  imageUrl,
  labels,
  placements,
  onChange,
  disabled,
  testId = 'image-label-board',
}: {
  imageUrl?: string | null;
  labels: string[];
  placements: Placement[];
  onChange: (p: Placement[]) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const plocha = useRef<HTMLDivElement>(null);
  const [vybrany, setVybrany] = useState<number | null>(null);
  const [tazeny, setTazeny] = useState<number | null>(null);
  const [duch, setDuch] = useState<{ x: number; y: number } | null>(null);
  const polozeno = new Set(placements.map((p) => p.optionIndex));

  const vPloše = (clientX: number, clientY: number) => {
    const r = plocha.current?.getBoundingClientRect();
    if (!r) return null;
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    return { x, y, uvnitr: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
  };

  const poloz = (index: number, x: number, y: number) =>
    onChange([...placements.filter((p) => p.optionIndex !== index), { optionIndex: index, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }]);

  const zacniTahnout = (index: number) => (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setTazeny(index);
    setVybrany(index);
    setDuch({ x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const tahni = (e: React.PointerEvent) => {
    if (tazeny === null) return;
    setDuch({ x: e.clientX, y: e.clientY });
  };

  const pust = (index: number) => (e: React.PointerEvent) => {
    if (tazeny !== index) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const m = vPloše(e.clientX, e.clientY);
    setTazeny(null);
    setDuch(null);
    if (m?.uvnitr) {
      poloz(index, m.x, m.y);
      setVybrany(null);
    } else if (polozeno.has(index)) {
      // vytažení mimo obrázek = vrácení dolů mezi nepoužité názvy
      onChange(placements.filter((p) => p.optionIndex !== index));
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-3">
      <p className="self-start rounded-md bg-panel px-3 py-1 text-base">
        Přetáhni název na správné místo v obrázku. Můžeš ho taky klepnutím vybrat a pak klepnout do obrázku.
      </p>

      <div className="flex flex-wrap gap-2" data-testid="image-label-chips">
        {labels.map((label, i) =>
          polozeno.has(i) ? null : (
            <button
              key={i}
              type="button"
              disabled={disabled}
              aria-pressed={vybrany === i}
              data-testid={`label-${i}`}
              onPointerDown={zacniTahnout(i)}
              onPointerMove={tahni}
              onPointerUp={pust(i)}
              onClick={() => setVybrany(i)}   /* pointerdown už vybral; tohle drží i ovládání z klávesnice */
              className={`touch-none rounded-md px-3 py-2 text-sm font-bold shadow-soft ${vybrany === i ? 'bg-primary text-on-primary' : 'bg-panel'}`}
            >
              {label}
            </button>
          ),
        )}
        {polozeno.size === labels.length && <span className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">Všechny názvy jsou umístěné.</span>}
      </div>

      <div
        ref={plocha}
        data-testid={testId}
        onClick={(e) => {
          if (disabled || vybrany === null) return;
          const m = vPloše(e.clientX, e.clientY);
          if (m?.uvnitr) {
            poloz(vybrany, m.x, m.y);
            setVybrany(null);
          }
        }}
        // rámeček je přesně velký jako obrázek, aby 50 % u učitele znamenalo 50 % u žáka
        className={`relative mx-auto min-h-48 w-fit overflow-hidden rounded-lg border-2 border-dashed border-line bg-surface ${vybrany !== null ? 'cursor-crosshair border-primary' : ''}`}
      >
        {imageUrl && <img src={imageUrl} alt="" className="block max-h-80 w-auto max-w-full" draggable={false} />}
        {placements.map((p) => (
          <button
            key={p.optionIndex}
            type="button"
            disabled={disabled}
            data-testid={`placed-${p.optionIndex}`}
            aria-label={`${labels[p.optionIndex]} – přetažením přesuneš, vytažením ven vrátíš zpět`}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            onPointerDown={zacniTahnout(p.optionIndex)}
            onPointerMove={tahni}
            onPointerUp={pust(p.optionIndex)}
            onClick={(e) => e.stopPropagation()}
            className={`absolute -translate-x-1/2 -translate-y-1/2 touch-none rounded bg-primary px-2 py-1 text-sm font-bold text-on-primary shadow-pop ${tazeny === p.optionIndex ? 'opacity-40' : ''}`}
          >
            {labels[p.optionIndex]}
          </button>
        ))}
      </div>

      {/* název drží prst – ukazujeme ho pod kurzorem, ať je vidět, co se kam pokládá */}
      {duch && tazeny !== null && (
        <span
          aria-hidden="true"
          style={{ left: duch.x, top: duch.y }}
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded bg-primary px-2 py-1 text-sm font-bold text-on-primary shadow-pop"
        >
          {labels[tazeny]}
        </span>
      )}
    </div>
  );
}
