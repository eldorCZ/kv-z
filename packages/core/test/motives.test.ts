import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  DEFAULT_ACCENT,
  DEFAULT_LIVE_MOTIVE,
  DEFAULT_TEST_MOTIVE,
  MOTIVE_CATEGORIES,
  MOTIVE_LIST,
  accentVars,
  getMotive,
  hashSeed,
  motiveDataUrl,
  renderMotive,
  scrimAlpha,
} from '../src/index.js';

const SEEDS = [0, 1, 42, hashSeed('123456'), hashSeed('987654'), 0xffffffff];

describe('motives (V6.1)', () => {
  it('at least 20 motives with unique ids, known categories and 12 colour presets', () => {
    expect(MOTIVE_LIST.length).toBeGreaterThanOrEqual(20 + 12);
    expect(new Set(MOTIVE_LIST.map((m) => m.id)).size).toBe(MOTIVE_LIST.length);
    const cats = new Set(MOTIVE_CATEGORIES.map((c) => c.id));
    for (const m of MOTIVE_LIST) {
      expect(cats.has(m.category)).toBe(true);
      expect(m.id).toMatch(/^[a-z0-9-]{2,24}$/);
    }
    expect(MOTIVE_LIST.filter((m) => m.category === 'barvy')).toHaveLength(12);
    expect(MOTIVE_LIST.filter((m) => m.category !== 'barvy').length).toBeGreaterThanOrEqual(20);
    expect(getMotive(DEFAULT_LIVE_MOTIVE)).toBeDefined();
    expect(getMotive(DEFAULT_TEST_MOTIVE)?.calm).toBe(true);
  });

  it('is deterministic for a seed; most pictures change with the seed', () => {
    let varying = 0;
    for (const m of MOTIVE_LIST) {
      const a = renderMotive(m.id, { seed: 7, scheme: 'light' });
      expect(renderMotive(m.id, { seed: 7, scheme: 'light' })).toBe(a);
      if (renderMotive(m.id, { seed: 8, scheme: 'light' }) !== a) varying++;
    }
    expect(varying).toBeGreaterThanOrEqual(15);
  });

  it('produces a valid, self-contained SVG within 30 KB in every variant (V11.2)', () => {
    for (const m of MOTIVE_LIST) {
      for (const scheme of ['light', 'dark'] as const) {
        for (const seed of SEEDS) {
          for (const animate of [false, true]) {
            const svg = renderMotive(m.id, { seed, scheme, animate });
            expect(svg.length, `${m.id} ${scheme} ${seed}`).toBeLessThanOrEqual(30 * 1024);
            expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
            expect(svg.endsWith('</svg>')).toBe(true);
            // no scripts, no external references, no event handlers, no NaN coordinates
            expect(svg).not.toMatch(/<script|href=|url\((?!#)|\son\w+=|NaN|undefined|Infinity/);
            // balanced tags
            const open = (svg.match(/<(?!\/)[a-zA-Z][^>]*[^/]>|<[a-zA-Z]+>/g) ?? []).length;
            const close = (svg.match(/<\/[a-zA-Z]+>/g) ?? []).length;
            expect(open, m.id).toBe(close);
          }
        }
      }
    }
  });

  it('animates only animated motives, slowly and with transform or opacity only (V6.4)', () => {
    for (const m of MOTIVE_LIST) {
      const still = renderMotive(m.id, { seed: 1, scheme: 'light', animate: false });
      const moving = renderMotive(m.id, { seed: 1, scheme: 'light', animate: true });
      expect(still).not.toMatch(/<animate|@keyframes|animation/);
      if (!m.animated) expect(moving).toBe(still);
      for (const d of moving.matchAll(/dur="(\d+(?:\.\d+)?)s"/g)) expect(Number(d[1])).toBeGreaterThanOrEqual(20);
      for (const d of moving.matchAll(/animation:[^;"]*?(\d+(?:\.\d+)?)s/g)) expect(Number(d[1])).toBeGreaterThanOrEqual(20);
      for (const a of moving.matchAll(/<animate(?!Transform)[^>]*attributeName="([^"]+)"/g)) expect(a[1]).toBe('opacity');
    }
  });

  it('unknown ids fall back to the default motive; data URLs are encoded', () => {
    expect(renderMotive('neexistuje', { seed: 1, scheme: 'dark' })).toBe(renderMotive(DEFAULT_LIVE_MOTIVE, { seed: 1, scheme: 'dark' }));
    expect(motiveDataUrl('papir', { seed: 1, scheme: 'light' })).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  });

  it('calm screens get a strong scrim', () => {
    for (const m of MOTIVE_LIST) {
      expect(scrimAlpha(m.id, 'light', 'focus')).toBeGreaterThanOrEqual(0.75);
      expect(scrimAlpha(m.id, 'dark', 'play')).toBeGreaterThan(0);
    }
  });
});

describe('accents (V6.2)', () => {
  it('8 accents, fialová is the default and changes nothing', () => {
    expect(ACCENTS.map((a) => a.id)).toEqual(['fialova', 'modra', 'azurova', 'zelena', 'jantarova', 'koralova', 'ruzova', 'grafitova']);
    expect(accentVars(DEFAULT_ACCENT, 'light')).toEqual({});
    expect(accentVars('nic', 'dark')).toEqual({});
    expect(accentVars('modra', 'dark')['--primary']).toMatch(/^#[0-9a-f]{6}$/);
  });
});
