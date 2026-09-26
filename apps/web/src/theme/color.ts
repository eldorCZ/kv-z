/**
 * Small colour toolkit for the design system (Dodatek 4, V3.5, V3.6, V6.3):
 * WCAG contrast, alpha compositing, CIEDE2000 and colour-vision-deficiency simulation.
 * Pure functions, no DOM – used by the app, the contrast check and tests.
 */

export type RGB = [number, number, number]; // 0–255

export function parseHex(hex: string): RGB {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`invalid colour ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
}

export function toHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const unlin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function luminance(c: RGB | string): number {
  const [r, g, b] = typeof c === 'string' ? parseHex(c) : c;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio, 1–21. */
export function contrast(a: RGB | string, b: RGB | string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `top` with opacity `alpha` over `bottom` (sRGB, like the browser does). */
export function over(top: RGB | string, alpha: number, bottom: RGB | string): RGB {
  const t = typeof top === 'string' ? parseHex(top) : top;
  const b = typeof bottom === 'string' ? parseHex(bottom) : bottom;
  return [0, 1, 2].map((i) => t[i]! * alpha + b[i]! * (1 - alpha)) as RGB;
}

// ---------------------------------------------------------------- CIELAB and CIEDE2000

function toLab(c: RGB): [number, number, number] {
  const [r, g, b] = c.map(lin) as RGB;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 colour difference. */
export function deltaE00(c1: RGB | string, c2: RGB | string): number {
  const [L1, a1, b1] = toLab(typeof c1 === 'string' ? parseHex(c1) : c1);
  const [L2, a2, b2] = toLab(typeof c2 === 'string' ? parseHex(c2) : c2);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const v = Math.atan2(b, a) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1p = h(a1p, b1);
  const h2p = h(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lm = (L1 + L2) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hm = (h1p + h2p) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp;
  const Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

// ---------------------------------------------------------------- colour vision deficiency

export type Cvd = 'deuteranopia' | 'protanopia' | 'tritanopia';

/** Machado, Oliveira & Fernandes (2009), severity 1.0, applied in linear RGB. */
const CVD: Record<Cvd, number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

export function simulate(c: RGB | string, kind: Cvd): RGB {
  const [r, g, b] = (typeof c === 'string' ? parseHex(c) : c).map(lin) as RGB;
  const m = CVD[kind];
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    unlin(clamp(m[0]! * r + m[1]! * g + m[2]! * b)),
    unlin(clamp(m[3]! * r + m[4]! * g + m[5]! * b)),
    unlin(clamp(m[6]! * r + m[7]! * g + m[8]! * b)),
  ];
}
