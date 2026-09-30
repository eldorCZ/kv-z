import { animate, useInView } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { usePrefs } from '../theme/prefs';

/**
 * Číslo, které se při najetí do zorného pole dopočítá nahoru (Dodatek 5/6).
 *
 * Při `data-motion="reduced"` se rovnou vypíše cílová hodnota — bez toho by to byl
 * pohyb navíc pro někoho, kdo si ho výslovně vypnul.
 *
 * Pro odečítač obrazovky je tu konečná hodnota ve skrytém `<span>`, viditelné počítadlo
 * je před ním schované. `aria-label` by tu byl chybně — na obyčejném `<span>` bez role
 * ho ARIA nepovoluje a axe to hlásí jako vážnou závadu.
 */
export function NumberTicker({ value, suffix = '', className = '' }: { value: number; suffix?: string; className?: string }) {
  const { motion: rezim } = usePrefs();
  const prvek = useRef<HTMLSpanElement>(null);
  const videt = useInView(prvek, { once: true, amount: 0.5 });
  const [zobrazene, setZobrazene] = useState(rezim === 'reduced' ? value : 0);

  useEffect(() => {
    if (rezim === 'reduced') {
      setZobrazene(value);
      return;
    }
    if (!videt) return;
    const ovladani = animate(0, value, {
      duration: 0.9,
      ease: 'easeOut',
      onUpdate: (v) => setZobrazene(Math.round(v)),
    });
    return () => ovladani.stop();
  }, [videt, value, rezim]);

  return (
    <span ref={prvek} className={`tabular ${className}`}>
      <span className="sr-only">
        {value}
        {suffix}
      </span>
      <span aria-hidden="true">
        {zobrazene}
        {suffix}
      </span>
    </span>
  );
}
