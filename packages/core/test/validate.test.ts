import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateQuiz, validateQuestion, quizStats, MAX_IMAGE_LABELS } from '../src/index.js';

const dir = join(import.meta.dirname, '../../../fixtures/quizzes');
const load = (p: string) => JSON.parse(readFileSync(join(dir, p), 'utf8'));

describe('contract validation – valid fixtures', () => {
  for (const f of readdirSync(join(dir, 'valid'))) {
    it(`accepts ${f}`, () => {
      const r = validateQuiz(load(`valid/${f}`));
      if (!r.ok) console.error(r.errors);
      expect(r.ok).toBe(true);
    });
  }

  it('fills defaults and truefalse options', () => {
    const r = validateQuiz(load('valid/minimal.json'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.language).toBe('cs');
    expect(r.data.settings).toEqual({ shuffleQuestions: false, shuffleOptions: true });
    const q = r.data.questions[0]!;
    expect(q.options).toEqual(['Pravda', 'Nepravda']);
    expect(q.timeLimitSec).toBe(20);
    expect(q.points).toBe('standard');
    expect(q.qa).toEqual({ status: 'ok', notes: '' });
  });

  it('computes stats', () => {
    const r = validateQuiz(load('valid/optika.json'));
    if (!r.ok) throw new Error('invalid');
    expect(quizStats(r.data.questions)).toEqual({ total: 7, ok: 6, flagged: 1 });
  });
});

describe('contract validation – invalid fixtures', () => {
  const expected = load('invalid/_expected.json') as Record<string, { path: string; code: string }[]>;
  for (const [name, errs] of Object.entries(expected)) {
    it(`rejects ${name}`, () => {
      const r = validateQuiz(load(`invalid/${name}.json`));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      for (const e of errs) {
        expect(r.errors).toContainEqual(expect.objectContaining(e));
      }
      for (const e of r.errors) {
        expect(e.message.length).toBeGreaterThan(3);
        expect(e.message).toMatch(/[a-zá-ž]/i);
      }
      expect(r.errors.length).toBeLessThanOrEqual(50);
    });
  }

  it('reports the Czech out-of-range message from the contract example', () => {
    const r = validateQuiz(load('invalid/out-of-range-index.json'));
    if (r.ok) throw new Error('should fail');
    expect(r.errors[0]).toEqual({ path: 'questions[0].correctIndices[0]', code: 'out_of_range', message: 'Index 5 je mimo rozsah možností.' });
  });

  it('rejects duplicate correct indices and caps error count', () => {
    const r = validateQuestion({ type: 'multi', prompt: 'x', options: ['a', 'b', 'c', 'd'], correctIndices: [1, 1] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain('duplicate_index');
    const many = { schemaVersion: 1, title: 't', questions: Array.from({ length: 80 }, () => ({ type: 'single', prompt: '' })) };
    const r2 = validateQuiz(many);
    if (!r2.ok) expect(r2.errors.length).toBe(50);
  });

  it('prefixes question paths', () => {
    const r = validateQuestion({ type: 'single', prompt: 'x', options: ['a', 'b', 'c'], correctIndices: [7] }, ['questions', 2]);
    if (r.ok) throw new Error('should fail');
    expect(r.errors[0]!.path).toBe('questions[2].correctIndices[0]');
  });
});

describe('topic and tags (C10.1)', () => {
  it('tags and topics are optional and validated', () => {
    const ok = validateQuiz({ schemaVersion: 1, title: 't', tags: ['Fyzika', 'Optika'], questions: [{ type: 'truefalse', prompt: 'p', correctIndices: [0], topic: 'Lom světla' }] });
    expect(ok.ok).toBe(true);
    const bad = validateQuiz({ schemaVersion: 1, title: 't', tags: ['a', 'b', 'c', 'd', 'e', 'f'], questions: [{ type: 'truefalse', prompt: 'p', correctIndices: [0], topic: 'x'.repeat(61) }] });
    expect(bad.ok).toBe(false);
  });

  it('validates image-label questions with uploaded image id and labels', () => {
    const ok = validateQuestion({ type: 'image-label', prompt: 'Přiřaď města', imageId: '0123456789abcdef0123456789abcdef', imageLabels: [{ text: 'Zlín', x: 0.4, y: 0.6 }] });
    expect(ok.ok).toBe(true);
    const bad = validateQuestion({ type: 'image-label', prompt: 'Přiřaď města', imageLabels: [{ text: 'Zlín', x: 0.4, y: 0.6 }] });
    expect(bad.ok).toBe(false);
  });

  it('allows ten labels (a world map needs more than five), refuses the eleventh', () => {
    const pin = (i: number) => ({ text: `Místo ${i}`, x: 0.1 + i * 0.05, y: 0.5, radius: 0.1 });
    const q = (n: number) => ({
      type: 'image-label',
      prompt: 'Přiřaď názvy kontinentů',
      imageId: '0123456789abcdef0123456789abcdef',
      imageLabels: Array.from({ length: n }, (_, i) => pin(i)),
    });
    expect(validateQuestion(q(MAX_IMAGE_LABELS)).ok).toBe(true);
    expect(validateQuestion(q(MAX_IMAGE_LABELS + 1)).ok).toBe(false);
  });
});
