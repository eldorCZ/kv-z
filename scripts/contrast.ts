/**
 * pnpm check:contrast – verifies the colour tokens (Dodatek 4, V3.5, V3.6).
 * Reads apps/web/src/theme/tokens.css, resolves the variables for every combination of
 * theme (light, dark) × mood (focus, play) × contrast (normal, more) and checks the manifest of
 * colour pairs against WCAG thresholds; answer colours must stay distinguishable (ΔE00 ≥ 10) under
 * simulated deuteranopia, protanopia and tritanopia. Exit code 1 on any failure.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrast, deltaE00, simulate, type Cvd } from '../apps/web/src/theme/color.js';

export type Vars = Record<string, string>;
type Kind = 'text' | 'large' | 'ui';
export const THRESHOLD: Record<Kind, number> = { text: 4.5, large: 3, ui: 3 };

/** fg token, bg token, kind – what is drawn on what */
export const MANIFEST: [string, string, Kind][] = [
  ...['canvas', 'surface', 'surface-2'].flatMap((bg) => [
    ['fg', bg, 'text'] as [string, string, Kind],
    ['muted', bg, 'text'] as [string, string, Kind],
    ['primary', bg, 'text'] as [string, string, Kind],
    ['danger', bg, 'text'] as [string, string, Kind],
    ['line-strong', bg, 'ui'] as [string, string, Kind],
    ['focus', bg, 'ui'] as [string, string, Kind],
  ]),
  ['on-primary', 'primary', 'text'],
  ['on-primary', 'primary-hover', 'text'],
  ['on-primary-soft', 'primary-soft', 'text'],
  ['fg', 'primary-soft', 'text'],
  ['muted', 'primary-soft', 'text'],
  ['on-accent', 'accent', 'text'],
  ['success', 'surface', 'text'],
  ['success', 'success-soft', 'text'],
  ['on-success', 'success-strong', 'text'],
  ['warning', 'surface', 'text'],
  ['warning', 'warning-soft', 'text'],
  ['danger', 'danger-soft', 'text'],
  ['on-danger', 'danger', 'text'],
  ['info', 'surface', 'text'],
  ['info', 'info-soft', 'text'],
  ...['success-soft', 'warning-soft', 'danger-soft', 'info-soft'].map((bg) => ['fg', bg, 'text'] as [string, string, Kind]),
  ['primary', 'surface', 'ui'],
  ['warning-line', 'surface', 'ui'],
  ...[1, 2, 3, 4, 5].map((n) => [`on-answer-${n}`, `answer-${n}`, 'text'] as [string, string, Kind]),
];

/** Parses `selector { --a: b; }` blocks, including blocks nested in `@media (prefers-contrast: more)`. */
export function parseTokens(css: string): { blocks: Map<string, Vars>; more: Map<string, Vars> } {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const read = (body: string): Vars => Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
  const collect = (text: string) => {
    const out = new Map<string, Vars>();
    for (const m of text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      for (const sel of m[1]!.split(',').map((s) => s.trim()).filter(Boolean)) out.set(sel, { ...(out.get(sel) ?? {}), ...read(m[2]!) });
    }
    return out;
  };
  const media = /@media\s*\(prefers-contrast:\s*more\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/.exec(clean);
  const top = media ? clean.replace(media[0], '') : clean;
  return { blocks: collect(top.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')), more: media ? collect(media[1]!) : new Map() };
}

export interface Context {
  name: string;
  vars: Vars;
}

export function contexts(css: string): Context[] {
  const { blocks, more } = parseTokens(css);
  const get = (m: Map<string, Vars>, s: string) => m.get(s) ?? {};
  const out: Context[] = [];
  for (const theme of ['light', 'dark'] as const) {
    for (const mood of ['focus', 'play'] as const) {
      for (const hc of [false, true]) {
        let v: Vars = { ...get(blocks, ':root') };
        if (hc) v = { ...v, ...get(more, ':root') };
        if (theme === 'dark') {
          v = { ...v, ...get(blocks, "[data-theme='dark']") };
          if (hc) v = { ...v, ...get(more, "[data-theme='dark']") };
        }
        v = { ...v, ...get(blocks, `[data-mood='${mood}']`) };
        if (theme === 'dark') v = { ...v, ...get(blocks, `[data-theme='dark'] [data-mood='${mood}']`) };
        out.push({ name: `${theme}/${mood}${hc ? '/more' : ''}`, vars: v });
      }
    }
  }
  return out;
}

function resolve(vars: Vars, name: string): string {
  let v = vars[name];
  for (let i = 0; v && v.startsWith('var(') && i < 5; i++) v = vars[v.slice(6, -1)];
  if (!v || !v.startsWith('#')) throw new Error(`token --${name} is not a hex colour (${v})`);
  return v;
}

export interface Failure {
  context: string;
  pair: string;
  ratio: number;
  need: number;
}

export function checkContrast(ctxs: Context[]): { failures: Failure[]; worst: number } {
  const failures: Failure[] = [];
  let worst = Infinity;
  for (const c of ctxs) {
    for (const [fg, bg, kind] of MANIFEST) {
      const ratio = contrast(resolve(c.vars, fg), resolve(c.vars, bg));
      worst = Math.min(worst, ratio / THRESHOLD[kind]);
      if (ratio < THRESHOLD[kind]) failures.push({ context: c.name, pair: `--${fg} na --${bg} (${kind})`, ratio, need: THRESHOLD[kind] });
    }
  }
  return { failures, worst };
}

const CVDS: (Cvd | 'normal')[] = ['normal', 'deuteranopia', 'protanopia', 'tritanopia'];

/** Adjacent answer colours must differ by ΔE00 ≥ 10 for normal vision and every simulated deficiency. */
export function checkAnswers(ctxs: Context[], minDelta = 10): string[] {
  const out: string[] = [];
  for (const c of ctxs.filter((x) => x.name.endsWith('/focus'))) {
    const answers = [1, 2, 3, 4, 5].map((n) => resolve(c.vars, `answer-${n}`));
    for (const kind of CVDS) {
      const seen = answers.map((a) => (kind === 'normal' ? a : simulate(a, kind)));
      for (let i = 0; i < seen.length; i++) {
        for (let j = i + 1; j < seen.length; j++) {
          const d = deltaE00(seen[i]!, seen[j]!);
          if (d < minDelta) out.push(`${c.name} ${kind}: odpovědi ${String.fromCharCode(65 + i)} a ${String.fromCharCode(65 + j)} ΔE00 = ${d.toFixed(1)}`);
        }
      }
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const css = readFileSync(join(import.meta.dirname, '../apps/web/src/theme/tokens.css'), 'utf8');
  const ctxs = contexts(css);
  const { failures } = checkContrast(ctxs);
  const cvd = checkAnswers(ctxs);
  for (const f of failures) console.error(`✗ ${f.context}: ${f.pair} = ${f.ratio.toFixed(2)}:1 (potřeba ${f.need}:1)`);
  for (const f of cvd) console.error(`✗ ${f}`);
  if (failures.length || cvd.length) {
    console.error(`Kontrast: ${failures.length} chyb, barvoslepost: ${cvd.length} chyb.`);
    process.exit(1);
  }
  console.log(`Kontrast v pořádku: ${ctxs.length} kontextů × ${MANIFEST.length} dvojic; odpovědi rozlišitelné i při deuteranopii, protanopii a tritanopii.`);
}
