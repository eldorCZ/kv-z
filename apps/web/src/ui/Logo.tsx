import type { FunctionComponent, SVGProps } from 'react';
import LogoDark from '../../../../design/brand/lore-logo-dark.svg?react';
import LogoMono from '../../../../design/brand/lore-logo-mono.svg?react';
import LogoLight from '../../../../design/brand/lore-logo.svg?react';
import MarkDark from '../../../../design/brand/lore-mark-dark.svg?react';
import MarkMono from '../../../../design/brand/lore-mark-mono.svg?react';
import MarkLight from '../../../../design/brand/lore-mark.svg?react';
import WordDark from '../../../../design/brand/lore-wordmark-dark.svg?react';
import WordMono from '../../../../design/brand/lore-wordmark-mono.svg?react';
import WordLight from '../../../../design/brand/lore-wordmark.svg?react';
import { appName } from '../app-config';
import { usePrefs } from '../theme/prefs';

type Svg = FunctionComponent<SVGProps<SVGSVGElement>>;
export type LogoVariant = 'horizontal' | 'mark' | 'wordmark';

/** The finished Lore artwork from design/brand (Dodatek 4B, L2, L3.5): never redrawn, recoloured or restyled. */
const ART: Record<LogoVariant, { light: Svg; dark: Svg; mono: Svg; ratio: number; min: number }> = {
  horizontal: { light: LogoLight, dark: LogoDark, mono: LogoMono, ratio: 373 / 120, min: 24 },
  mark: { light: MarkLight, dark: MarkDark, mono: MarkMono, ratio: 1, min: 16 },
  wordmark: { light: WordLight, dark: WordDark, mono: WordMono, ratio: 261 / 120, min: 20 },
};

/**
 * Lore logo. tone="auto" follows the resolved scheme (data-theme, so the manual switcher works too) with
 * the same box in both schemes, so switching never moves the layout; tone="mono" is the currentColor variant
 * for coloured surfaces. `decorative` hides it from screen readers when the name stands next to it.
 */
export function Logo({
  variant = 'horizontal',
  tone = 'auto',
  height = 32,
  decorative = false,
  className = '',
  scheme,
}: {
  variant?: LogoVariant;
  tone?: 'auto' | 'mono';
  /** only for the /_design brand sheet: show one scheme regardless of the current one */
  scheme?: 'light' | 'dark';
  height?: number;
  decorative?: boolean;
  className?: string;
}) {
  const prefs = usePrefs();
  const theme = scheme ?? prefs.theme;
  const art = ART[variant];
  const h = Math.max(height, art.min);
  const Art = tone === 'mono' ? art.mono : theme === 'dark' ? art.dark : art.light;
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': appName };
  return (
    <Art
      {...a11y}
      width={Math.round(h * art.ratio)}
      height={h}
      className={`shrink-0 ${className}`}
      data-testid={`logo-${variant}`}
      data-tone={tone === 'mono' ? 'mono' : theme}
    />
  );
}
