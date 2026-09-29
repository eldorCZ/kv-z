import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { usePrefs } from '../theme/prefs';

/**
 * Fade + un-blur entrance (Dodatek 5, point 6; pattern from Magic UI, own code). It plays only when `play`
 * is true at mount, so the parent decides "only the first render of the grid", and never with
 * data-motion="reduced": then the content is simply there.
 */
export function BlurFade({ children, delay = 0, play = true, className = '' }: { children: ReactNode; delay?: number; play?: boolean; className?: string }) {
  const { motion: pref } = usePrefs();
  const animate = play && pref !== 'reduced';
  return (
    <motion.div
      className={className}
      initial={animate ? { opacity: 0, y: 6, filter: 'blur(6px)' } : false}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={animate ? { duration: 0.35, delay, ease: 'easeOut' } : { duration: 0 }}
    >
      {children}
    </motion.div>
  );
}
