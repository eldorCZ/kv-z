import { motion } from 'framer-motion';
import { useRef, type ReactNode } from 'react';
import { usePrefs } from '../theme/prefs';

/**
 * Nástup obsahu: rozostření + prolnutí (Dodatek 5/6).
 *
 * Dvě věci, které framer-motion sám nedělá a musely se dopsat:
 *
 * 1. **Při `data-motion="reduced"` se nic neanimuje** — vykreslí se rovnou cílový stav.
 *    Není to jen vkus: pro část lidí je pohyb na obrazovce nevolnost nebo migréna.
 * 2. **Animace proběhne jen při prvním vykreslení.** V galerii se překresluje při každém
 *    psaní do hledání; bez tohohle by karty problikávaly při každém písmenu.
 */
export function BlurFade({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const { motion: rezim } = usePrefs();
  const uzBezelo = useRef(false);

  if (rezim === 'reduced' || uzBezelo.current) return <div className={className}>{children}</div>;
  uzBezelo.current = true;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, filter: 'blur(6px)', y: 6 }}
      animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
      transition={{ duration: 0.35, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
