import { describe, expect, it } from 'vitest';
import { resolveMotion, resolveTheme, sanitizeUiPrefs } from '../src/index.js';

describe('appearance preferences (V5)', () => {
  it('the user choice wins over the system, "system" follows it', () => {
    expect(resolveTheme({ scheme: 'light' }, true)).toBe('light');
    expect(resolveTheme({ scheme: 'dark' }, false)).toBe('dark');
    expect(resolveTheme({ scheme: 'system' }, true)).toBe('dark');
    expect(resolveTheme({ scheme: 'system' }, false)).toBe('light');
    expect(resolveMotion({ motion: 'reduce' }, false)).toBe('reduced');
    expect(resolveMotion({ motion: 'full' }, true)).toBe('full');
    expect(resolveMotion({ motion: 'system' }, true)).toBe('reduced');
  });
  it('unknown values and keys are ignored', () => {
    expect(sanitizeUiPrefs({ scheme: 'purple', motion: 'reduce', font: 1, x: 'y' })).toEqual({ scheme: 'system', motion: 'reduce', font: 'default' });
    expect(sanitizeUiPrefs(null)).toEqual({ scheme: 'system', motion: 'system', font: 'default' });
    expect(sanitizeUiPrefs('dark')).toEqual({ scheme: 'system', motion: 'system', font: 'default' });
    expect(sanitizeUiPrefs([1])).toEqual({ scheme: 'system', motion: 'system', font: 'default' });
  });
});
