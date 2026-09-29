import { useRef, useState } from 'react';
import { Button, inputCls } from './ui';

export interface ImagePin {
  text: string;
  x: number;
  y: number;
  radius: number;
}

const MAX_PINS = 5;
const KROK = 0.01;

/**
 * Umisťování špendlíků do obrázku (typ otázky „image-label").
 *
 * Učitel klepne do obrázku a vznikne špendlík, kterým jde pak táhnout. Souřadnice
 * se nepíšou ručně — ukládají se jako podíl šířky a výšky (0..1), takže sedí
 * v jakékoli velikosti obrázku.
 *
 * Tolerance se porovnává jako `hypot(dx, dy) <= radius` nad TĚMITO podíly, ne nad
 * pixely. Na obrázku na výšku je proto zásah ve skutečnosti elipsa — a přesně tak
 * ji tady i kreslíme, ať učitel vidí pravdu, ne hezčí kolečko.
 */
export function ImagePinEditor({
  src,
  pins,
  onChange,
  disabled,
}: {
  src: string;
  pins: ImagePin[];
  onChange: (p: ImagePin[]) => void;
  disabled?: boolean;
}) {
  const plocha = useRef<HTMLDivElement>(null);
  const [vybrany, setVybrany] = useState<number | null>(null);
  const tahne = useRef<number | null>(null);

  const zPolohy = (clientX: number, clientY: number) => {
    const r = plocha.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (clientY - r.top) / r.height)),
    };
  };

  const uprav = (i: number, zmena: Partial<ImagePin>) => onChange(pins.map((p, j) => (j === i ? { ...p, ...zmena } : p)));

  const pridej = (e: React.MouseEvent) => {
    // Příznak spotřebujeme hned: kdyby se konec tahu někdy neohlásil, přijdeme
    // nanejvýš o jedno klepnutí místo o celý editor.
    const poTahu = tahne.current !== null;
    tahne.current = null;
    if (disabled || poTahu || pins.length >= MAX_PINS) return;
    const { x, y } = zPolohy(e.clientX, e.clientY);
    onChange([...pins, { text: '', x, y, radius: 0.12 }]);
    setVybrany(pins.length);
  };

  const naKlavesu = (e: React.KeyboardEvent, i: number) => {
    const posun: Record<string, [number, number]> = {
      ArrowLeft: [-KROK, 0],
      ArrowRight: [KROK, 0],
      ArrowUp: [0, -KROK],
      ArrowDown: [0, KROK],
    };
    const d = posun[e.key];
    if (!d) return;
    e.preventDefault();
    uprav(i, {
      x: Math.max(0, Math.min(1, pins[i]!.x + d[0])),
      y: Math.max(0, Math.min(1, pins[i]!.y + d[1])),
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Klepni do obrázku a vznikne špendlík — pak s ním můžeš táhnout nebo ho posouvat šipkami. Přerušovaná oblast je tolerance:
        žák se trefí, když bod umístí dovnitř.
      </p>

      <div
        ref={plocha}
        onClick={pridej}
        data-testid="pin-plocha"
        className={`relative mx-auto w-fit select-none overflow-hidden rounded-md border border-line ${pins.length < MAX_PINS && !disabled ? 'cursor-crosshair' : ''}`}
      >
        {/* rámeček se smrští přesně na obrázek – jinak by šlo špendlík položit vedle něj
            a souřadnice by neseděly s tím, co vidí žák */}
        <img src={src} alt="" className="block max-h-[420px] w-auto max-w-full" draggable={false} />
        {pins.map((p, i) => (
          <div key={i}>
            <span
              aria-hidden="true"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.radius * 200}%`, height: `${p.radius * 200}%` }}
              className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-dashed ${vybrany === i ? 'border-primary bg-primary/15' : 'border-line-strong bg-fg/5'}`}
            />
            <button
              type="button"
              disabled={disabled}
              data-testid={`pin-${i}`}
              aria-label={`Špendlík ${i + 1}${p.text ? `: ${p.text}` : ''} – šipkami posuneš`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              onPointerDown={(e) => {
                if (disabled) return;
                e.stopPropagation();
                tahne.current = i;
                setVybrany(i);
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (tahne.current !== i) return;
                const { x, y } = zPolohy(e.clientX, e.clientY);
                uprav(i, { x, y });
              }}
              // Konec tahu hlídáme přes ztrátu zachycení, ne přes pointerup: ten nepřijde,
              // když tah skončí mimo okno nebo ho prohlížeč zruší (pointercancel). Dřív
              // kvůli tomu zůstal příznak tahu viset a do obrázku už nešlo klepnout.
              onLostPointerCapture={() => {
                // kliknutí na plochu přijde hned po puštění – ať nevznikne špendlík navíc
                setTimeout(() => (tahne.current = null), 0);
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => naKlavesu(e, i)}
              className={`absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full border-2 text-xs font-bold shadow-pop ${
                vybrany === i ? 'border-fg bg-primary text-on-primary' : 'border-fg bg-surface text-fg'
              }`}
            >
              {i + 1}
            </button>
          </div>
        ))}
      </div>

      <ul className="space-y-2">
        {pins.map((p, i) => (
          <li
            key={i}
            onFocusCapture={() => setVybrany(i)}
            className={`grid items-center gap-2 rounded-md border p-2 sm:grid-cols-[28px_1fr_210px_auto] ${vybrany === i ? 'border-primary' : 'border-line'}`}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-fg bg-surface text-xs font-bold">{i + 1}</span>
            <input
              className={inputCls}
              value={p.text}
              maxLength={60}
              placeholder="Název místa"
              disabled={disabled}
              onChange={(e) => uprav(i, { text: e.target.value })}
              aria-label={`Název špendlíku ${i + 1}`}
              data-testid={`pin-text-${i}`}
            />
            <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
              tolerance
              <input
                type="range"
                min={3}
                max={30}
                value={Math.round(p.radius * 100)}
                disabled={disabled}
                onChange={(e) => uprav(i, { radius: Number(e.target.value) / 100 })}
                aria-label={`Tolerance špendlíku ${i + 1} v procentech`}
                className="flex-1"
              />
              <span className="w-10 shrink-0 tabular">{Math.round(p.radius * 100)} %</span>
            </label>
            <Button type="button" variant="ghost" className="text-danger" disabled={disabled} onClick={() => { onChange(pins.filter((_, j) => j !== i)); setVybrany(null); }}>
              Smazat
            </Button>
          </li>
        ))}
      </ul>

      {pins.length === 0 && <p className="rounded-md bg-panel px-3 py-2 text-sm text-muted">Zatím tu není žádný špendlík. Klepni do obrázku.</p>}
      {pins.length >= MAX_PINS && <p className="text-xs text-muted">Víc než {MAX_PINS} špendlíků do jedné otázky nejde.</p>}
    </div>
  );
}
