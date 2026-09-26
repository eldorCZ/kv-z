/**
 * Rename to Lore (Dodatek 4B, L1.7, L7.6): no earlier product name in the user-facing sources.
 * Internal identifiers that keep the old name on purpose (L1.4) are recognised by their shape: part of a
 * package, variable, file, header or storage key (@kvizhub/…, KVIZHUB_…, kvizhub.db, x-kvizhub-signature,
 * kvizhub-… / jiskra.… storage keys migrated once in legacy-storage.ts and theme-init.js).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../..');
const ROOTS = ['apps/web/src', 'apps/server/src', 'packages/core/src', 'packages/export/src', 'apps/web/public', 'apps/web/index.html', 'README.md', 'docs/NAVOD-PRO-UCITELE.md'];
const SKIP = /(^|\/)(fonts|brand|icons)\//;

function* files(p: string): Generator<string> {
  const abs = join(root, p);
  if (statSync(abs).isFile()) return yield abs;
  for (const e of readdirSync(abs)) {
    const child = join(p, e);
    if (SKIP.test(child + '/')) continue;
    yield* files(child);
  }
}

/** The old name as a word (not as part of an identifier such as @kvizhub/core, KVIZHUB_URL or kvizhub-data). */
export function offending(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/kvizhub[\p{L}\d_]*|jisk[rř][\p{L}\d_]*/giu)) {
    const before = text[m.index - 1] ?? ' ';
    const after = text[m.index + m[0].length] ?? ' ';
    const next = text[m.index + m[0].length + 1] ?? ' ';
    const identifier = /[@/_.-]/.test(before) || /[-_/]/.test(after) || (after === '.' && /[a-z'"`]/.test(next)) || /^KVIZHUB/.test(m[0]);
    if (!identifier) out.push(m[0]);
  }
  return out;
}

describe('the product is called Lore everywhere (L7.6)', () => {
  it('recognises prose and leaves identifiers alone', () => {
    expect(offending('Přihlaste se do KvizHubu. Jiskra svítí. Jiskřička mává.')).toEqual(['KvizHubu', 'Jiskra', 'Jiskřička']);
    expect(offending("import '@kvizhub/core'; KVIZHUB_URL=x; data/kvizhub.db; X-KvizHub-Signature; 'kvizhub-draft-'; 'jiskra.ui'")).toEqual([]);
    expect(offending('používáme aplikaci Jiskra.')).toEqual(['Jiskra']);
  });

  it('no earlier product name in src, i18n, public, index.html, README and the teacher guide', () => {
    const found: string[] = [];
    for (const r of ROOTS)
      for (const f of files(r)) {
        if (!/\.(ts|tsx|js|mjs|css|json|html|md|webmanifest|svg|txt)$/.test(f)) continue;
        for (const hit of offending(readFileSync(f, 'utf8'))) found.push(`${relative(root, f)}: ${hit}`);
      }
    expect(found).toEqual([]);
  });
});
