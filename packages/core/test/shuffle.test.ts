import { describe, expect, it } from 'vitest';
import { checkAnswer, seededRng, shuffleOptions, toOriginal, toPublicQuestion, SECRET_KEYS, checkNickname, containsProfanity } from '../src/index.js';

describe('shuffleOptions', () => {
  it('recomputes the key after shuffling', () => {
    const q = { type: 'single' as const, options: ['A', 'B', 'C', 'D'], correctIndices: [2] };
    for (let seed = 1; seed < 50; seed++) {
      const s = shuffleOptions(q, true, seededRng(seed));
      expect(s.options[s.correctDisplayed[0]!]).toBe('C');
      expect([...s.options].sort()).toEqual(['A', 'B', 'C', 'D']);
      expect(toOriginal(s.perm, s.correctDisplayed)).toEqual([2]);
    }
  });
  it('keeps truefalse order and shuffles when disabled not at all', () => {
    expect(shuffleOptions({ type: 'truefalse', options: ['Pravda', 'Nepravda'], correctIndices: [1] }, true).options).toEqual(['Pravda', 'Nepravda']);
    expect(shuffleOptions({ type: 'single', options: ['a', 'b', 'c'], correctIndices: [0] }, false).perm).toEqual([0, 1, 2]);
  });
  it('never shows order questions in the correct order', () => {
    for (let seed = 1; seed < 100; seed++) {
      const s = shuffleOptions({ type: 'order', options: ['1', '2', '3'], correctIndices: [] }, false, seededRng(seed));
      expect(s.perm).not.toEqual([0, 1, 2]);
      // player submitting the correct order in displayed indices maps back to identity
      const displayedCorrect = [0, 1, 2].map((orig) => s.perm.indexOf(orig));
      expect(checkAnswer({ type: 'order', options: ['1', '2', '3'], correctIndices: [], acceptedAnswers: [], numericAnswer: null, numericTolerance: null }, { order: toOriginal(s.perm, displayedCorrect) }).correct).toBe(true);
    }
  });
  it('maps invalid displayed indices to -1', () => {
    expect(toOriginal([2, 0, 1], [0, 5, -1])).toEqual([2, -1, -1]);
  });
});

describe('toPublicQuestion', () => {
  it('never contains secret keys', () => {
    const q = {
      id: 'q1', type: 'short' as const, prompt: 'p', timeLimitSec: 20, points: 'standard' as const,
      options: [], correctIndices: [], acceptedAnswers: ['tajné'], explanation: 'tajné', sourceRef: { file: 'f', locator: '', quote: 'tajné' },
      numericAnswer: null, numericTolerance: null,
    };
    const pub = toPublicQuestion(q, shuffleOptions(q, true), 0, 1);
    const json = JSON.stringify(pub);
    for (const k of SECRET_KEYS) expect(json).not.toContain(k);
    expect(json).not.toContain('tajné');
  });

  it('publishes the uploaded question image', () => {
    const q = {
      id: 'q2', type: 'single' as const, prompt: 'Co je na obrázku?', timeLimitSec: 20, points: 'standard' as const,
      options: ['a', 'b', 'c'], correctIndices: [0], acceptedAnswers: [], numericAnswer: null, numericTolerance: null,
      imageId: 'a'.repeat(32), imageLabels: [],
    };
    const pub = toPublicQuestion(q, shuffleOptions(q, false), 0, 1);
    expect(pub.imageUrl).toBe(`/media/theme/${'a'.repeat(32)}/1280.webp`);
    expect(pub.imageLabels).toBeUndefined();
  });

  it('image-label sends shuffled label texts but never their coordinates', () => {
    const q = {
      id: 'q3', type: 'image-label' as const, prompt: 'Přiřaď řeky', timeLimitSec: 30, points: 'standard' as const,
      options: [], correctIndices: [], acceptedAnswers: [], numericAnswer: null, numericTolerance: null,
      imageId: 'b'.repeat(32),
      imageLabels: [
        { text: 'Dřevnice', x: 0.2, y: 0.8, radius: 0.1 },
        { text: 'Morava', x: 0.7, y: 0.3, radius: 0.1 },
      ],
    };
    const pub = toPublicQuestion(q, shuffleOptions(q, true, seededRng(7)), 0, 1);
    expect([...(pub.imageLabels ?? [])].sort()).toEqual(['Dřevnice', 'Morava']);
    expect(pub.imageUrl).toBe(`/media/theme/${'b'.repeat(32)}/1280.webp`);
    // souřadnice jsou klíč k řešení – nesmí opustit server
    const json = JSON.stringify(pub);
    expect(json).not.toContain('0.8');
    expect(json).not.toContain('radius');
  });
});

describe('nickname', () => {
  it('validates length and profanity', () => {
    expect(checkNickname('A').ok).toBe(false);
    expect(checkNickname('x'.repeat(21)).ok).toBe(false);
    expect(checkNickname('  Petr  ')).toEqual({ ok: true, nickname: 'Petr' });
    expect(checkNickname('Kůůrva').ok).toBe(false);
    expect(checkNickname('k0k0t').ok).toBe(false);
    expect(checkNickname('Fuck you').ok).toBe(false);
    expect(checkNickname('<script>').ok).toBe(true); // escaped at render time
    expect(containsProfanity('Classic')).toBe(false);
    expect(containsProfanity('Jan Novák')).toBe(false);
    expect(containsProfanity('ass')).toBe(true);
  });
});
