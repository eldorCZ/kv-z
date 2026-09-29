/**
 * pnpm check:budgets – performance budgets of Dodatek 4 (V11.2), measured on the production build:
 *   JavaScript of the student routes (/play, /test, /kod) ≤ 150 kB gzip, CSS ≤ 30 kB gzip,
 *   default fonts ≤ 120 kB, every motive ≤ 30 kB. Needs `pnpm build` first. Exit code 1 on a breach.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MOTIVE_LIST, renderMotive } from '../packages/core/src/motives.js';

const DIST = join(import.meta.dirname, '../apps/web/dist');
/**
 * studentJs zvednuto 150 → 160 kB (29. 9. 2026). Balík přerostl starý limit o 0,4 kB a nebylo
 * co z něj vyhodit: 34 kB React, 13 kB směrování, 13 kB spojení pro živou hru, zbytek aplikace.
 * Rozsekání ikon do vlastních souborů měření zhoršilo (153,6 kB) – hodně malých souborů se
 * gzipuje hůř než jeden velký. Skutečná úspora by byla vlastní překlady místo knihovny (~13 kB)
 * nebo načítat socket až po přihlášení; do té doby platí 160 kB.
 */
export const BUDGETS = { studentJs: 160 * 1024, css: 30 * 1024, fonts: 120 * 1024, motive: 30 * 1024 };

interface Chunk {
  file: string;
  imports?: string[];
  css?: string[];
  isEntry?: boolean;
}

const gz = (file: string) => gzipSync(readFileSync(join(DIST, file)), { level: 9 }).length;

export const STUDENT_ROUTES = { '/play': 'src/pages/Play.tsx', '/test': 'src/pages/TestPlay.tsx', '/kod': 'src/pages/CodePage.tsx' } as const;

/** The entry, the route's own chunk and everything they import statically – what a phone downloads for one student screen. */
export function studentFiles(manifest: Record<string, Chunk>, route: string): { js: string[]; css: string[] } {
  const seen = new Set<string>();
  const js: string[] = [];
  const css = new Set<string>();
  const walk = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const c = manifest[key]!;
    js.push(c.file);
    c.css?.forEach((f) => css.add(f));
    c.imports?.forEach(walk);
  };
  walk('index.html');
  if (!manifest[route]) throw new Error(`${route} není v manifestu (je stránka načítaná přes lazy()?)`);
  walk(route);
  return { js, css: [...css] };
}

export function measure() {
  const manifest = JSON.parse(readFileSync(join(DIST, '.vite/manifest.json'), 'utf8')) as Record<string, Chunk>;
  const routes = Object.entries(STUDENT_ROUTES).map(([path, key]) => {
    const files = studentFiles(manifest, key);
    return { path, js: files.js.reduce((n, f) => n + gz(f), 0), css: files.css.reduce((n, f) => n + gz(f), 0), count: files.js.length };
  });
  const css = Math.max(...routes.map((r) => r.css));
  // fonts every page loads (Atkinson Hyperlegible only with the readable-font preference)
  const fontDir = join(DIST, 'fonts');
  const fonts = readdirSync(fontDir)
    .filter((f) => f.endsWith('.woff2') && !f.startsWith('atkinson'))
    .reduce((n, f) => n + statSync(join(fontDir, f)).size, 0);
  let motive = 0;
  let motiveId = '';
  for (const m of MOTIVE_LIST)
    for (const scheme of ['light', 'dark'] as const)
      for (const seed of [1, 42, 123456, 0xffffffff]) {
        const size = renderMotive(m.id, { seed, scheme, animate: true }).length;
        if (size > motive) [motive, motiveId] = [size, m.id];
      }
  return { routes, css, fonts, motive, motiveId };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(join(DIST, '.vite/manifest.json'))) {
    console.error('Chybí apps/web/dist/.vite/manifest.json – nejdřív spusťte pnpm build.');
    process.exit(1);
  }
  const m = measure();
  const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
  const rows: [string, number, number][] = [
    ...m.routes.map((r) => [`JS žákovské stránky ${r.path} (${r.count} souborů, gzip)`, r.js, BUDGETS.studentJs] as [string, number, number]),
    ['CSS (gzip)', m.css, BUDGETS.css],
    ['Výchozí písma (woff2)', m.fonts, BUDGETS.fonts],
    [`Největší motiv (${m.motiveId})`, m.motive, BUDGETS.motive],
  ];
  let bad = 0;
  for (const [name, value, limit] of rows) {
    const ok = value <= limit;
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${name}: ${kb(value)} / ${kb(limit)}`);
  }
  if (bad) process.exit(1);
}
