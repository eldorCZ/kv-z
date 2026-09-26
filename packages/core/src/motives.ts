/**
 * Built-in background motives (Dodatek 4, V6). Every motive is procedural SVG generated from a seed, so
 * the host and all students see the same picture, there are no external files and no third-party art.
 * Pure functions without DOM: the server validates ids, the web renders `data:` images, tests check size.
 */
import { luminance, over, parseHex, toHex } from './color.js';

export type MotiveCategory = 'klidne' | 'veda' | 'priroda' | 'hrave' | 'sezonni' | 'barvy';
export type Scheme = 'light' | 'dark';

export const MOTIVE_CATEGORIES: { id: MotiveCategory; name: string }[] = [
  { id: 'klidne', name: 'Klidné' },
  { id: 'veda', name: 'Věda a technika' },
  { id: 'priroda', name: 'Příroda' },
  { id: 'hrave', name: 'Hravé' },
  { id: 'sezonni', name: 'Sezónní' },
  { id: 'barvy', name: 'Barvy a přechody' },
];

export const MOTIVE_W = 1600;
export const MOTIVE_H = 900;

/** mulberry32 */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, for seeds derived from a PIN or an id. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface DrawCtx {
  r: () => number;
  /** random number in [a, b) */
  n: (a: number, b: number) => number;
  pick: <T>(list: readonly T[]) => T;
  /** palette without the background */
  c: string[];
  bg: string;
  dark: boolean;
  animate: boolean;
  w: number;
  h: number;
}

const f = (x: number) => (Math.round(x * 10) / 10).toString();

export interface MotiveDef {
  id: string;
  name: string;
  category: MotiveCategory;
  /** suitable for tests (calm, low contrast, never animated there) */
  calm: boolean;
  /** has slow decorative motion in the playful mood */
  animated: boolean;
  /** [background, ...colours] for each scheme; the background dominates the picture */
  palette: Record<Scheme, string[]>;
  draw: (x: DrawCtx) => string;
}

// ---------------------------------------------------------------- helpers

const grad = (id: string, stops: [number, string, number?][], x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`;
const radial = (id: string, stops: [number, string, number?][]) =>
  `<radialGradient id="${id}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</radialGradient>`;
/** slow drifting animation (≥ 20 s, transform only) */
const drift = (name: string, dx: number, dy: number, secs: number) =>
  `@keyframes ${name}{0%,100%{transform:translate(0,0)}50%{transform:translate(${dx}px,${dy}px)}}.${name}{animation:${name} ${secs}s ease-in-out infinite}`;
const fade = (name: string, lo: number, secs: number) => `@keyframes ${name}{0%,100%{opacity:1}50%{opacity:${lo}}}.${name}{animation:${name} ${secs}s ease-in-out infinite}`;
const style = (x: DrawCtx, css: string) => (x.animate ? `<style>${css}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` : '');

function wave(x: DrawCtx, y: number, amp: number, len: number, phase: number) {
  let d = `M0 ${f(y)}`;
  for (let px = 0; px <= x.w + len; px += len / 2) {
    const k = Math.round(px / (len / 2)) % 2 === 0 ? 1 : -1;
    d += ` Q${f(px + len / 4 + phase)} ${f(y + amp * k)} ${f(px + len / 2 + phase)} ${f(y)}`;
  }
  return d;
}

// ---------------------------------------------------------------- motives

const P = (light: string[], dark: string[]) => ({ light, dark });

const MOTIVES: MotiveDef[] = [
  // ---------- calm
  {
    id: 'papir',
    name: 'Papír',
    category: 'klidne',
    calm: true,
    animated: false,
    palette: P(['#fbfaf5', '#dcd8ea', '#c9c3e3'], ['#141036', '#2a2360', '#332a73']),
    draw: (x) => {
      let s = '';
      for (let px = 0; px <= x.w; px += 40) s += `<path d="M${px} 0V${x.h}" stroke="${px % 200 === 0 ? x.c[1] : x.c[0]}" stroke-width="${px % 200 === 0 ? 1.4 : 0.8}"/>`;
      for (let py = 0; py <= x.h; py += 40) s += `<path d="M0 ${py}H${x.w}" stroke="${py % 200 === 0 ? x.c[1] : x.c[0]}" stroke-width="${py % 200 === 0 ? 1.4 : 0.8}"/>`;
      return s;
    },
  },
  {
    id: 'mlha',
    name: 'Mlha',
    category: 'klidne',
    calm: true,
    animated: false,
    palette: P(['#f4f0ff', '#ffe3ef', '#dff3ff', '#fff1d6'], ['#120d33', '#2b1650', '#10284d', '#2d2140']),
    draw: (x) =>
      `<defs>${x.c.map((c, i) => radial(`m${i}`, [[0, c, 0.95], [1, c, 0]])).join('')}</defs>` +
      x.c.map((_, i) => `<ellipse cx="${f(x.n(0, x.w))}" cy="${f(x.n(0, x.h))}" rx="${f(x.n(500, 900))}" ry="${f(x.n(350, 600))}" fill="url(#m${i})"/>`).join(''),
  },
  {
    id: 'tecky',
    name: 'Tečky',
    category: 'klidne',
    calm: true,
    animated: false,
    palette: P(['#f7f5ff', '#d8d1f7'], ['#110c30', '#2e2570']),
    draw: (x) => {
      let s = '';
      for (let py = 30; py < x.h; py += 60) for (let px = (py / 60) % 2 ? 60 : 30; px < x.w; px += 60) s += `<circle cx="${px}" cy="${py}" r="4"/>`;
      return `<g fill="${x.c[0]}">${s}</g>`;
    },
  },
  {
    id: 'mekke-vlny',
    name: 'Měkké vlny',
    category: 'klidne',
    calm: true,
    animated: true,
    palette: P(['#f3f6ff', '#dde6ff', '#e8dcff', '#d7f1f0'], ['#0e0f33', '#1a2257', '#261a58', '#0f2f45']),
    draw: (x) =>
      style(x, drift('mv', 60, 0, 36)) +
      x.c
        .map((c, i) => {
          const y = x.h * (0.35 + i * 0.2);
          return `<path class="mv" d="${wave(x, y, 40 + i * 15, 700 - i * 120, -200)} V${x.h} H-200Z" fill="${c}" opacity="0.9"/>`;
        })
        .join(''),
  },
  // ---------- science and technology
  {
    id: 'atomy',
    name: 'Atomy',
    category: 'veda',
    calm: false,
    animated: true,
    palette: P(['#eef4ff', '#6b8cff', '#ff8fb1', '#8bd3c7'], ['#0b1233', '#5b7bff', '#ff6f9c', '#4fd1b9']),
    draw: (x) => {
      let s = style(x, `@keyframes spin{to{transform:rotate(360deg)}}.at{animation:spin 60s linear infinite;transform-box:fill-box;transform-origin:center}`);
      for (let i = 0; i < 7; i++) {
        const cx = x.n(100, x.w - 100);
        const cy = x.n(100, x.h - 100);
        const r = x.n(50, 130);
        const col = x.pick(x.c);
        s += `<g class="at" opacity="0.55" fill="none" stroke="${col}" stroke-width="3">${[0, 60, 120].map((a) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(r)}" ry="${f(r * 0.38)}" transform="rotate(${a} ${f(cx)} ${f(cy)})"/>`).join('')}<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.14)}" fill="${col}"/></g>`;
      }
      return s;
    },
  },
  {
    id: 'obvody',
    name: 'Obvody',
    category: 'veda',
    calm: false,
    animated: false,
    palette: P(['#eefaf4', '#7cc9a4', '#46a07a'], ['#081f1a', '#1f6b52', '#2fa37a']),
    draw: (x) => {
      let s = '';
      for (let i = 0; i < 38; i++) {
        let px = Math.round(x.n(0, x.w) / 40) * 40;
        let py = Math.round(x.n(0, x.h) / 40) * 40;
        let d = `M${px} ${py}`;
        for (let k = 0; k < 4; k++) {
          const horiz = x.r() < 0.5;
          const len = Math.round(x.n(2, 7)) * 40 * (x.r() < 0.5 ? -1 : 1);
          if (horiz) px += len;
          else py += len;
          d += ` L${px} ${py}`;
        }
        s += `<path d="${d}" fill="none" stroke="${x.c[0]}" stroke-width="4" stroke-linejoin="round"/><circle cx="${px}" cy="${py}" r="8" fill="${x.c[1]}"/>`;
      }
      return s;
    },
  },
  {
    id: 'vesmir',
    name: 'Vesmír',
    category: 'veda',
    calm: false,
    animated: true,
    palette: P(['#eef0ff', '#b9b3ff', '#ffd27a', '#8fd6ff'], ['#07061f', '#d6d0f2', '#ffd27a', '#7fc8ff']),
    draw: (x) => {
      let s = style(x, fade('tw', 0.25, 24));
      for (let i = 0; i < 140; i++) s += `<circle ${i % 5 === 0 ? 'class="tw" ' : ''}cx="${f(x.n(0, x.w))}" cy="${f(x.n(0, x.h))}" r="${f(x.n(1, 3.5))}" fill="${x.c[0]}"/>`;
      const px = x.n(250, x.w - 250);
      const py = x.n(200, x.h - 200);
      s += `<circle cx="${f(px)}" cy="${f(py)}" r="90" fill="${x.c[1]}" opacity="0.8"/><ellipse cx="${f(px)}" cy="${f(py)}" rx="160" ry="30" fill="none" stroke="${x.c[2]}" stroke-width="8" opacity="0.7" transform="rotate(-18 ${f(px)} ${f(py)})"/>`;
      return s;
    },
  },
  {
    id: 'krystaly',
    name: 'Krystaly',
    category: 'veda',
    calm: false,
    animated: false,
    palette: P(['#f2f7ff', '#b7d3ff', '#d4c3ff', '#a8ecf0'], ['#0b1030', '#2a4a8f', '#4a2f8f', '#1f6f7a']),
    draw: (x) => {
      let s = '';
      for (let i = 0; i < 26; i++) {
        const cx = x.n(0, x.w);
        const cy = x.n(0, x.h);
        const r = x.n(40, 140);
        const pts = [0, 1, 2, 3, 4, 5].map((k) => `${f(cx + r * Math.cos((k * Math.PI) / 3))},${f(cy + r * Math.sin((k * Math.PI) / 3) * 1.25)}`).join(' ');
        s += `<polygon points="${pts}" fill="${x.pick(x.c)}" opacity="${f(x.n(0.35, 0.7))}"/>`;
      }
      return s;
    },
  },
  {
    id: 'hranol',
    name: 'Světlo a hranol',
    category: 'veda',
    calm: false,
    animated: false,
    palette: P(['#f7f6ff', '#c9c4e8', '#ff6b6b', '#ffb020', '#ffe066', '#4cd97b', '#4c9bff', '#9b6bff'], ['#0d0a26', '#3d3670', '#ff6b6b', '#ffb020', '#ffe066', '#4cd97b', '#4c9bff', '#9b6bff']),
    draw: (x) => {
      const px = x.w * 0.42;
      const py = x.h * 0.55;
      let s = `<path d="M0 ${f(py - 40)} L${f(px - 60)} ${f(py)}" stroke="${x.c[0]}" stroke-width="10" opacity="0.8"/>`;
      s += `<polygon points="${f(px - 150)},${f(py + 150)} ${f(px + 150)},${f(py + 150)} ${f(px)},${f(py - 140)}" fill="${x.c[0]}" opacity="0.5"/>`;
      x.c.slice(1).forEach((c, i) => {
        s += `<polygon points="${f(px + 40)},${f(py - 10 + i * 6)} ${x.w},${f(py - 250 + i * 80)} ${x.w},${f(py - 190 + i * 80)} ${f(px + 40)},${f(py - 4 + i * 6)}" fill="${c}" opacity="0.55"/>`;
      });
      return s;
    },
  },
  {
    id: 'binarni',
    name: 'Binární kód',
    category: 'veda',
    calm: false,
    animated: false,
    palette: P(['#f1f5ff', '#aab6e8', '#8fb8ff'], ['#050a1f', '#2f4a8f', '#3d6fd6']),
    draw: (x) => {
      let s = `<g font-family="monospace" font-size="28" font-weight="700">`;
      for (let col = 0; col < 34; col++) {
        const px = col * 48 + 10;
        let t = '';
        for (let k = 0; k < 20; k++) t += x.r() < 0.5 ? '0' : '1';
        s += `<text x="${px}" y="${f(x.n(-200, 0))}" fill="${x.pick(x.c)}" opacity="${f(x.n(0.35, 0.8))}" writing-mode="tb">${t}</text>`;
      }
      return `${s}</g>`;
    },
  },
  {
    id: 'signal',
    name: 'Vlny a signál',
    category: 'veda',
    calm: false,
    animated: true,
    palette: P(['#f3f1ff', '#8c7bff', '#ff8fb1', '#57c7ff'], ['#0c0a2a', '#8c7bff', '#ff6f9c', '#3fb8f0']),
    draw: (x) =>
      style(x, drift('sg', -80, 0, 30)) +
      x.c
        .map((c, i) => {
          let d = '';
          for (let px = -100; px <= x.w + 100; px += 10) d += `${px === -100 ? 'M' : 'L'}${px} ${f(x.h * (0.3 + i * 0.2) + Math.sin(px / (60 + i * 25) + i) * (50 - i * 8))}`;
          return `<path class="sg" d="${d}" fill="none" stroke="${c}" stroke-width="6" opacity="0.6"/>`;
        })
        .join(''),
  },
  // ---------- nature
  {
    id: 'hory',
    name: 'Hory',
    category: 'priroda',
    calm: false,
    animated: false,
    palette: P(['#eef4ff', '#b8c8f0', '#8ea6de', '#6a82c4'], ['#0b1030', '#1f2a5c', '#27356e', '#33458a']),
    draw: (x) =>
      x.c
        .map((c, i) => {
          let d = `M0 ${x.h}`;
          const base = x.h * (0.45 + i * 0.17);
          for (let px = 0; px <= x.w; px += 160) d += ` L${px} ${f(base - x.n(40, 220 - i * 40))}`;
          return `<path d="${d} L${x.w} ${x.h}Z" fill="${c}"/>`;
        })
        .join('') + `<circle cx="${f(x.n(200, x.w - 200))}" cy="${f(x.h * 0.18)}" r="60" fill="${x.c[0]}" opacity="0.7"/>`,
  },
  {
    id: 'les',
    name: 'Les',
    category: 'priroda',
    calm: false,
    animated: false,
    palette: P(['#effaf2', '#a9dbb7', '#7bc293', '#4f9e6c'], ['#07170f', '#1b4a2f', '#226039', '#2c7a48']),
    draw: (x) => {
      let s = '';
      x.c.forEach((c, row) => {
        const base = x.h * (0.55 + row * 0.18);
        for (let px = -40; px < x.w + 40; px += x.n(60, 110)) {
          const hgt = x.n(160, 320) - row * 40;
          const wd = hgt * 0.42;
          s += `<polygon points="${f(px)},${f(base - hgt)} ${f(px + wd / 2)},${f(base)} ${f(px - wd / 2)},${f(base)}" fill="${c}"/>`;
        }
        s += `<rect x="0" y="${f(base)}" width="${x.w}" height="${x.h}" fill="${c}"/>`;
      });
      return s;
    },
  },
  {
    id: 'more',
    name: 'Moře',
    category: 'priroda',
    calm: false,
    animated: true,
    palette: P(['#eef8ff', '#b3def5', '#7cc4ea', '#4ea7d9'], ['#061328', '#12365e', '#164678', '#1c5891']),
    draw: (x) =>
      style(x, drift('sea', 70, 6, 28)) +
      x.c.map((c, i) => `<path class="sea" d="${wave(x, x.h * (0.4 + i * 0.18), 26 - i * 4, 320 - i * 40, -200)} V${x.h} H-200Z" fill="${c}"/>`).join(''),
  },
  {
    id: 'aurora',
    name: 'Polární záře',
    category: 'priroda',
    calm: false,
    animated: true,
    palette: P(['#f1f5ff', '#8ff0c8', '#a88cff', '#7fd3ff'], ['#050a1c', '#3be8a8', '#8f6bff', '#39b8ff']),
    draw: (x) =>
      style(x, fade('au', 0.45, 26) + drift('au2', 50, -20, 34)) +
      `<defs>${x.c.map((c, i) => grad(`a${i}`, [[0, c, 0], [0.5, c, 0.75], [1, c, 0]], 0, 1)).join('')}</defs>` +
      x.c
        .map((_, i) => `<path class="${i % 2 ? 'au' : 'au2'}" d="M-100 ${f(x.h * (0.15 + i * 0.12))} C${f(x.w * 0.3)} ${f(x.n(-50, 250))} ${f(x.w * 0.6)} ${f(x.n(300, 600))} ${x.w + 100} ${f(x.h * (0.2 + i * 0.1))} L${x.w + 100} ${f(x.h * (0.55 + i * 0.1))} C${f(x.w * 0.6)} ${f(x.n(500, 800))} ${f(x.w * 0.3)} ${f(x.n(200, 450))} -100 ${f(x.h * (0.5 + i * 0.1))}Z" fill="url(#a${i})"/>`)
        .join(''),
  },
  {
    id: 'poust',
    name: 'Poušť',
    category: 'priroda',
    calm: false,
    animated: false,
    palette: P(['#fff8ec', '#f6dcae', '#eec485', '#e0a95f'], ['#1a1208', '#4a3418', '#5e421d', '#7a5526']),
    draw: (x) =>
      x.c.map((c, i) => `<path d="${wave(x, x.h * (0.45 + i * 0.18), 60 - i * 12, 900 - i * 180, x.n(-300, 0))} V${x.h} H-400Z" fill="${c}"/>`).join('') +
      `<circle cx="${f(x.n(200, x.w - 200))}" cy="${f(x.h * 0.2)}" r="70" fill="${x.c[2]}" opacity="0.8"/>`,
  },
  // ---------- playful
  {
    id: 'konfety',
    name: 'Konfety',
    category: 'hrave',
    calm: false,
    animated: true,
    palette: P(['#fbf8ff', '#ff6b8b', '#ffb020', '#4cc38a', '#4c8dff', '#a07bff'], ['#0f0b2a', '#ff6b8b', '#ffb020', '#4cc38a', '#4c8dff', '#a07bff']),
    draw: (x) => {
      let s = style(x, drift('cf', 0, 40, 30));
      for (let i = 0; i < 110; i++) {
        const cx = x.n(0, x.w);
        const cy = x.n(0, x.h);
        const col = x.pick(x.c);
        const kind = x.r();
        const a = f(x.n(0, 180));
        s +=
          kind < 0.45
            ? `<rect${i % 4 === 0 ? ' class="cf"' : ''} x="${f(cx)}" y="${f(cy)}" width="22" height="9" rx="3" fill="${col}" transform="rotate(${a} ${f(cx)} ${f(cy)})" opacity="0.8"/>`
            : kind < 0.8
              ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(x.n(4, 9))}" fill="${col}" opacity="0.8"/>`
              : `<path d="M${f(cx)} ${f(cy)} q12 -14 24 0 t24 0" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" opacity="0.8"/>`;
      }
      return s;
    },
  },
  {
    id: 'bubliny',
    name: 'Bubliny',
    category: 'hrave',
    calm: false,
    animated: true,
    palette: P(['#f2f7ff', '#9ec5ff', '#c7a8ff', '#8ff0dc'], ['#08102c', '#3a6fd8', '#7a4fd8', '#2fb8a0']),
    draw: (x) => {
      let s = style(x, drift('bu', 0, -60, 24) + drift('bu2', 30, -30, 32));
      for (let i = 0; i < 40; i++) {
        const r = x.n(14, 90);
        s += `<circle class="${i % 2 ? 'bu' : 'bu2'}" cx="${f(x.n(0, x.w))}" cy="${f(x.n(0, x.h))}" r="${f(r)}" fill="${x.pick(x.c)}" fill-opacity="0.35" stroke="${x.pick(x.c)}" stroke-width="3" stroke-opacity="0.7"/>`;
      }
      return s;
    },
  },
  {
    id: 'memphis',
    name: 'Geometrie',
    category: 'hrave',
    calm: false,
    animated: false,
    palette: P(['#fff9f0', '#ff6b8b', '#2f7bff', '#ffb020', '#1fb57a'], ['#12102c', '#ff6b8b', '#4c8dff', '#ffb020', '#2fcf8f']),
    draw: (x) => {
      let s = '';
      for (let i = 0; i < 46; i++) {
        const cx = x.n(0, x.w);
        const cy = x.n(0, x.h);
        const col = x.pick(x.c);
        const k = i % 4;
        if (k === 0) s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(x.n(12, 30))}" fill="none" stroke="${col}" stroke-width="7"/>`;
        else if (k === 1) s += `<path d="M${f(cx)} ${f(cy)} l20 -20 l20 20 l20 -20 l20 20" fill="none" stroke="${col}" stroke-width="7" stroke-linejoin="round"/>`;
        else if (k === 2) s += `<rect x="${f(cx)}" y="${f(cy)}" width="36" height="36" fill="${col}" transform="rotate(${f(x.n(0, 90))} ${f(cx + 18)} ${f(cy + 18)})"/>`;
        else s += `<path d="M${f(cx)} ${f(cy)}h40M${f(cx + 20)} ${f(cy - 20)}v40" stroke="${col}" stroke-width="8" stroke-linecap="round"/>`;
      }
      return s;
    },
  },
  {
    id: 'pixely',
    name: 'Pixely',
    category: 'hrave',
    calm: false,
    animated: false,
    palette: P(['#f6f4ff', '#c8bdff', '#9fd8ff', '#ffd08a', '#ffb3c8'], ['#0f0b2a', '#4a3aa8', '#1f5fa0', '#8a5a14', '#8a2f55']),
    draw: (x) => {
      let s = '';
      for (let i = 0; i < 180; i++) {
        const cx = Math.floor(x.n(0, x.w / 40)) * 40;
        const cy = Math.floor(x.n(0, x.h / 40)) * 40;
        s += `<rect x="${cx}" y="${cy}" width="40" height="40" fill="${x.pick(x.c)}" opacity="${f(x.n(0.4, 0.9))}"/>`;
      }
      return s;
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    category: 'hrave',
    calm: false,
    animated: true,
    palette: P(['#f4f0ff', '#b69bff', '#ff8fd0', '#7ce8ff'], ['#07041a', '#8b5cff', '#ff4fb8', '#3fe0ff']),
    draw: (x) => {
      let s = style(x, fade('ne', 0.55, 22));
      const hz = x.h * 0.55;
      for (let k = 0; k < 12; k++) {
        const y = hz + (x.h - hz) * ((k / 11) ** 1.8);
        s += `<path d="M0 ${f(y)}H${x.w}" stroke="${x.c[0]}" stroke-width="2" opacity="0.7"/>`;
      }
      for (let k = -12; k <= 12; k++) s += `<path d="M${f(x.w / 2 + k * 30)} ${f(hz)}L${f(x.w / 2 + k * 190)} ${x.h}" stroke="${x.c[0]}" stroke-width="2" opacity="0.7"/>`;
      s += `<circle class="ne" cx="${x.w / 2}" cy="${f(hz - 60)}" r="150" fill="none" stroke="${x.c[1]}" stroke-width="10"/><circle cx="${x.w / 2}" cy="${f(hz - 60)}" r="110" fill="none" stroke="${x.c[2]}" stroke-width="6" opacity="0.8"/>`;
      return s;
    },
  },
  {
    id: 'komiks',
    name: 'Komiks',
    category: 'hrave',
    calm: false,
    animated: false,
    palette: P(['#fffaf0', '#ffc94a', '#ff8a8a', '#8ab8ff'], ['#15122e', '#8a6a14', '#8a2f3f', '#2f4f8f']),
    draw: (x) => {
      let s = '';
      for (let i = 0; i < 4; i++) {
        const cx = x.n(0, x.w);
        const cy = x.n(0, x.h);
        const col = x.pick(x.c);
        let dots = '';
        for (let dy = -240; dy <= 240; dy += 40) for (let dx = -240; dx <= 240; dx += 40) {
          const dist = Math.hypot(dx, dy);
          if (dist < 240) dots += `<circle cx="${f(cx + dx)}" cy="${f(cy + dy)}" r="${f(Math.max(2.5, 14 - dist / 20))}"/>`;
        }
        s += `<g fill="${col}" opacity="0.8">${dots}</g>`;
      }
      return s;
    },
  },
  // ---------- seasonal
  {
    id: 'podzim',
    name: 'Podzim',
    category: 'sezonni',
    calm: false,
    animated: true,
    palette: P(['#fff8f0', '#f29a4a', '#d96b3a', '#e8b84a', '#b5563a'], ['#1a0f0a', '#c26a22', '#a8452a', '#b8861f', '#8a3a24']),
    draw: (x) => {
      let s = style(x, drift('lf', 40, 60, 28));
      for (let i = 0; i < 44; i++) {
        const cx = x.n(0, x.w);
        const cy = x.n(0, x.h);
        const sc = x.n(0.7, 1.6);
        s += `<path${i % 3 === 0 ? ' class="lf"' : ''} d="M0 -30 C18 -18 18 12 0 30 C-18 12 -18 -18 0 -30Z M0 -30V30" fill="${x.pick(x.c)}" stroke="${x.bg}" stroke-width="2" opacity="0.85" transform="translate(${f(cx)} ${f(cy)}) rotate(${f(x.n(0, 360))}) scale(${f(sc)})"/>`;
      }
      return s;
    },
  },
  {
    id: 'zima',
    name: 'Zima',
    category: 'sezonni',
    calm: false,
    animated: true,
    palette: P(['#f2f8ff', '#b8d8f5', '#d8e8ff'], ['#081226', '#c8def5', '#7fa8d6']),
    draw: (x) => {
      let s = style(x, drift('sn', 20, 50, 30));
      for (let i = 0; i < 60; i++) {
        const cx = x.n(0, x.w);
        const cy = x.n(0, x.h);
        const r = x.n(8, 26);
        const col = x.pick(x.c);
        s += `<g${i % 3 === 0 ? ' class="sn"' : ''} stroke="${col}" stroke-width="3" stroke-linecap="round" opacity="0.8">${[0, 60, 120].map((a) => `<path d="M${f(cx - r)} ${f(cy)}H${f(cx + r)}" transform="rotate(${a} ${f(cx)} ${f(cy)})"/>`).join('')}</g>`;
      }
      return s;
    },
  },
];

// ---------------------------------------------------------------- 12 colour and gradient presets (V6.2)

const PRESETS: [string, string, [string, string], [string, string]][] = [
  ['fialova', 'Fialová', ['#efe9ff', '#dcd0ff'], ['#140d3a', '#2a1a6a']],
  ['modra', 'Modrá', ['#e8f1ff', '#cfe0ff'], ['#0a1638', '#16306e']],
  ['azurova', 'Azurová', ['#e6f8fb', '#c8eef5'], ['#061f2a', '#0f3f52']],
  ['zelena', 'Zelená', ['#e9f8ef', '#cdeedb'], ['#07201a', '#124a36']],
  ['jantarova', 'Jantarová', ['#fff6e3', '#ffe6b3'], ['#241806', '#4a3208']],
  ['koralova', 'Korálová', ['#ffefeb', '#ffd6cc'], ['#2a0f0c', '#541d17']],
  ['ruzova', 'Růžová', ['#ffeef6', '#ffd3e8'], ['#2a0b1c', '#551738']],
  ['grafitova', 'Grafitová', ['#f1f1f5', '#dcdce6'], ['#111118', '#23232f']],
  ['svitani', 'Svítání', ['#fff1e6', '#e9e1ff'], ['#1f0f2e', '#0f1a3a']],
  ['oceán', 'Oceán', ['#e6f5ff', '#e0e8ff'], ['#051a2e', '#10134a']],
  ['limetka', 'Limetka', ['#f3fbe3', '#e0f5f0'], ['#10200a', '#0a2a24']],
  ['lilie', 'Lilie', ['#f7ecff', '#ffeaf3'], ['#1d0b33', '#2e0b23']],
];

for (const [id, name, light, dark] of PRESETS) {
  const safeId = id.normalize('NFD').replace(/\p{M}/gu, '');
  MOTIVES.push({
    id: safeId,
    name,
    category: 'barvy',
    calm: true,
    animated: false,
    palette: P(light, dark),
    draw: (x) => `<defs>${grad('pg', [[0, x.bg], [1, x.c[0]!]], 1, 1)}</defs><rect width="${x.w}" height="${x.h}" fill="url(#pg)"/>`,
  });
}

export const MOTIVE_LIST: readonly MotiveDef[] = MOTIVES;
const BY_ID = new Map(MOTIVES.map((m) => [m.id, m]));
export const getMotive = (id: string | null | undefined): MotiveDef | undefined => (id ? BY_ID.get(id) : undefined);

export const DEFAULT_LIVE_MOTIVE = 'mlha';
export const DEFAULT_TEST_MOTIVE = 'papir';

export interface RenderOptions {
  seed: number;
  scheme: Scheme;
  /** slow animation (only animated motives, only in the playful mood, never with reduced motion) */
  animate?: boolean;
}

/** Complete SVG document of a motive (1600 × 900, scaled with `slice` to cover any screen). */
export function renderMotive(id: string, o: RenderOptions): string {
  const m = BY_ID.get(id) ?? BY_ID.get(DEFAULT_LIVE_MOTIVE)!;
  const [bg, ...colours] = m.palette[o.scheme];
  const r = rng(o.seed ^ hashSeed(m.id));
  const ctx: DrawCtx = {
    r,
    n: (a, b) => a + (b - a) * r(),
    pick: (list) => list[Math.floor(r() * list.length)]!,
    c: colours,
    bg: bg!,
    dark: o.scheme === 'dark',
    animate: !!o.animate && m.animated,
    w: MOTIVE_W,
    h: MOTIVE_H,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MOTIVE_W} ${MOTIVE_H}" preserveAspectRatio="xMidYMid slice"><rect width="${MOTIVE_W}" height="${MOTIVE_H}" fill="${bg}"/>${m.draw(ctx)}</svg>`;
}

export function motiveDataUrl(id: string, o: RenderOptions): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderMotive(id, o))}`;
}

/**
 * Opacity of the scrim between the motive and the content (V6.3): calm screens always get a strong scrim;
 * playful ones more when the motive's brightness fights the scheme (a dark motive in light mode and vice versa).
 */
export function scrimAlpha(id: string, scheme: Scheme, mood: 'play' | 'focus'): number {
  const m = BY_ID.get(id);
  if (!m) return mood === 'focus' ? 0.75 : 0.3;
  if (mood === 'focus') return 0.75;
  const [bg, ...cs] = m.palette[scheme];
  // brightness of the picture: background dominates, the colours add a fifth
  const mix = cs.reduce((acc, c) => over(c, 0.2 / cs.length, acc), parseHex(bg!));
  const luma = luminance(toHex(mix));
  const fights = scheme === 'light' ? luma < 0.45 : luma > 0.12;
  return fights ? 0.6 : 0.35;
}

/** All colours that can appear under a text surface (for the worst-case contrast test, V12). */
export function motiveColours(id: string, scheme: Scheme): string[] {
  return BY_ID.get(id)?.palette[scheme] ?? [];
}
