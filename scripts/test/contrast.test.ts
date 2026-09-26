import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, deltaE00, over, parseHex, simulate } from '../../apps/web/src/theme/color.js';
import { checkAnswers, checkContrast, contexts, parseTokens } from '../contrast.js';

const css = readFileSync(join(import.meta.dirname, '../../apps/web/src/theme/tokens.css'), 'utf8');

describe('colour math (V3.5, V3.6)', () => {
  it('WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
  it('alpha compositing and hex parsing', () => {
    expect(over('#ffffff', 0.5, '#000000').map(Math.round)).toEqual([128, 128, 128]);
    expect(parseHex('#abc')).toEqual([170, 187, 204]);
    expect(() => parseHex('red')).toThrow();
  });
  it('CIEDE2000 and colour vision simulation', () => {
    expect(deltaE00('#123456', '#123456')).toBe(0);
    expect(deltaE00('#ff0000', '#00ff00')).toBeGreaterThan(50);
    // red and green become hard to tell apart with deuteranopia
    expect(deltaE00(simulate('#d42a42', 'deuteranopia'), simulate('#0f7d51', 'deuteranopia'))).toBeLessThan(deltaE00('#d42a42', '#0f7d51'));
  });
});

describe('pnpm check:contrast', () => {
  it('parses the token blocks including prefers-contrast', () => {
    const { blocks, more } = parseTokens(css);
    expect(blocks.get(':root')!.surface).toBe('#ffffff');
    expect(blocks.get("[data-theme='dark']")!.canvas).toBe('#0f0b2a');
    expect(more.get(':root')!['line-strong']).toBeDefined();
    expect(contexts(css).map((c) => c.name)).toContain('dark/play/more');
  });
  it('the real tokens pass', () => {
    const ctxs = contexts(css);
    expect(checkContrast(ctxs).failures).toEqual([]);
    expect(checkAnswers(ctxs)).toEqual([]);
  });
  it('a weak pair and indistinguishable answers are reported', () => {
    const bad = css.replace('--muted: #56517c;', '--muted: #b0acc8;').replace('--answer-5: #b79cff;', '--answer-5: #1f63d9;');
    const ctxs = contexts(bad);
    expect(checkContrast(ctxs).failures.some((f) => f.pair.startsWith('--muted') && f.context.startsWith('light'))).toBe(true);
    expect(checkAnswers(ctxs).some((x) => x.includes('B a E'))).toBe(true);
  });
});
