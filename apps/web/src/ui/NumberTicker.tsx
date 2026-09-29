import { animate, useInView } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { usePrefs } from '../theme/prefs';

/**
 * Counts up to `value` when it scrolls into view (Dodatek 5, point 6; pattern from Magic UI, own code).
 * With data-motion="reduced" it shows the final value at once. Screen readers always get the final value.
 */
export function NumberTicker({ value, suffix = '', className = '' }: { value: number; suffix?: string; className?: string }) {
  const { motion } = usePrefs();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = motion === 'reduced';
  const [shown, setShown] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    if (!inView) return;
    const controls = animate(0, value, { duration: 0.9, ease: 'easeOut', onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [inView, reduced, value]);

  return (
    <span className={`tabular ${className}`} data-testid="number-ticker" data-value={value}>
      <span ref={ref} aria-hidden="true">
        {shown}
        {suffix}
      </span>
      <span className="sr-only">
        {value}
        {suffix}
      </span>
    </span>
  );
}
