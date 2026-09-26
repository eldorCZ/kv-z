import { useEffect, useRef } from 'react';
import { usePrefs } from '../theme/prefs';

/** One-shot confetti on the podium (V9.3): own canvas, ≤ 60 particles, ~3 s, never with reduced motion. */
export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  const { motion } = usePrefs();
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g || motion !== 'full') return;
    const w = (c.width = innerWidth);
    const h = (c.height = innerHeight);
    const css = getComputedStyle(c);
    const cols = [1, 2, 3, 4, 5].map((n) => css.getPropertyValue(`--answer-${n}`).trim() || '#888');
    const ps = Array.from({ length: 60 }, (_, i) => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: -8 - Math.random() * 10,
      a: Math.random() * 6,
      s: 6 + Math.random() * 8,
      c: cols[i % cols.length]!,
    }));
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      g.clearRect(0, 0, w, h);
      g.globalAlpha = Math.max(0, 1 - t / 3000);
      for (const p of ps) {
        p.vy += 0.35;
        p.x += p.vx;
        p.y += p.vy;
        p.a += 0.1;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.a);
        g.fillStyle = p.c;
        g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        g.restore();
      }
      if (t < 3000) raf = requestAnimationFrame(tick);
      else g.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [motion]);
  if (motion !== 'full') return null;
  return <canvas ref={ref} aria-hidden="true" data-testid="confetti" className="pointer-events-none fixed inset-0 z-50 h-full w-full" />;
}
