/** Lore brand files (Dodatek 4B, L7 points 1, 2 and 4). A failing hash means the file was changed: fix the file, not the test. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../..');
const brand = join(root, 'design/brand');

export const BRAND_SHA256: Record<string, string> = {
  'lore-mark.svg': '067926c1031a8f6c245a87c47231422ddd83bf14e2fa2f3d83813897e88f9e6d',
  'lore-mark-dark.svg': 'bfa8b4503812c7786a591ae17c38431038e4549914004f51a48ed6f9442390d4',
  'lore-mark-mono.svg': '412d32688fc0c493abc8f43142a9c1635c1609422f54659550da9b951a788f0c',
  'lore-wordmark.svg': '0aed8470ba8f754ef1956fca98e135c6f490d6b2d26f9137712fcce91832099c',
  'lore-wordmark-dark.svg': 'fe1a000b15cf45a676c390bca23c18c3ea6c4d9f5030dec8a55c8a860911d452',
  'lore-wordmark-mono.svg': '685dddd958ae148bc8f304a65bbfbb1613fe4baddf0d036a74bc8bc7db752d48',
  'lore-logo.svg': '7f3452a63d2ad526a5dfc717a587cb65826472b133fccb09cdbf2d336870ca22',
  'lore-logo-dark.svg': '20fb28a5c96a81013afad61cbeca02c476a177fd671632867571a10f60d12903',
  'lore-logo-mono.svg': 'ddc4b48f0be9e7c4f8e686fc4d73cecec5c6cb950cb90eed52e4246ba2a3420f',
  'lore-app-icon.svg': '7e12c409730fc2b1030545f94c123025659a3e3a9186be74acb3f3cd900dd5fe',
  'lore-app-icon-square.svg': '59cc9514b6de3afd5f239d84138969146a4581c9a693cc5501bcb003f1d3c225',
  'favicon.svg': '0dc244716aa9126be606f0f706e71d000740afc9b3fcdf715e59cc338104c7d9',
  'lore-og.svg': 'b87b4c5d5efe196323769e999e5e9ebb47963936446f8e4889b7c1d2347e481e',
  'mascot/lore-hello.svg': 'dd9f974e2d160cb536aa85d8305ea0e0b59f977f1754123062f15e43932d612b',
  'mascot/lore-think.svg': 'dd916f8940c9f21c26a4482a4a716b1d9e081d6b845e72c023d23d5351d9c111',
  'mascot/lore-celebrate.svg': '5bc04919676bb6ae9e0e2aa9d27980ddf00c5537a6335b4cce57144f19fe982e',
  'mascot/lore-encourage.svg': '2281fdf6ac55ae77100eb343c5004fba79b7ae7c8082c67e01b5fb32f5a9fc31',
  'mascot/lore-sleep.svg': '2c920d4a30cb2a532fc0acf95326f15ee3896b000527b3770edd66ddd5c67be3',
  'mascot/lore-error.svg': 'e64c6dacfe24930048e42e95666b2ed5e30b95ebbd02b9e082f11d4017fcd430',
};

/** Minimal XML well-formedness check (no dependency): balanced tags, quoted attributes, one root. */
export function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  let roots = 0;
  const re = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<!--[\s\S]*?-->/g;
  let last = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (/[<>]/.test(xml.slice(last, m.index))) return false;
    last = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    const [, close, name, , self] = m;
    if (close) {
      if (stack.pop() !== name) return false;
    } else if (!self) {
      if (stack.length === 0) roots++;
      stack.push(name!);
    } else if (stack.length === 0) roots++;
  }
  return stack.length === 0 && roots === 1 && !/[<>]/.test(xml.slice(last));
}

describe('brand files (L7.1, L7.2)', () => {
  it('all 19 files are byte-identical to appendix A', () => {
    expect(Object.keys(BRAND_SHA256)).toHaveLength(19);
    for (const [file, sha] of Object.entries(BRAND_SHA256)) {
      const bytes = readFileSync(join(brand, file));
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(sha);
    }
  });

  it('every SVG is safe, well-formed, has a viewBox and stays small', () => {
    expect(wellFormed('<svg><g></svg>')).toBe(false);
    for (const file of Object.keys(BRAND_SHA256)) {
      const svg = readFileSync(join(brand, file), 'utf8');
      expect(wellFormed(svg.trim()), file).toBe(true);
      expect(svg, file).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[\d. ]+"/);
      expect(svg, file).not.toMatch(/<(text|script|image|foreignObject|style|use|a)[\s>/]/);
      expect(svg, file).not.toMatch(/\son\w+=|\sstyle=|href=/);
      for (const u of svg.matchAll(/url\(([^)]*)\)/g)) expect(u[1], file).toMatch(/^#[\w-]+$/);
      const limit = file.startsWith('mascot/') ? 3 * 1024 : 4 * 1024;
      expect(Buffer.byteLength(svg), file).toBeLessThanOrEqual(limit);
    }
  });
});

describe('pnpm brand:build (L3.1, L7.4)', () => {
  const pub = join(root, 'apps/web/public');
  beforeAll(() => {
    execFileSync(process.execPath, [join(root, 'scripts/brand-build.mjs')], { stdio: 'ignore' });
  }, 60_000);

  it('renders every icon in its size', async () => {
    const sizes: Record<string, [number, number]> = {
      'favicon-32.png': [32, 32],
      'apple-touch-icon-180.png': [180, 180],
      'icon-192.png': [192, 192],
      'icon-512.png': [512, 512],
      'icon-maskable-512.png': [512, 512],
      'og-image.png': [1200, 630],
    };
    for (const [f, [w, h]] of Object.entries(sizes)) {
      const meta = await sharp(join(pub, 'icons', f)).metadata();
      expect([meta.format, meta.width, meta.height], f).toEqual(['png', w, h]);
    }
    // copies are identical to the source of truth; the social preview source is not served
    expect(readFileSync(join(pub, 'favicon.svg'))).toEqual(readFileSync(join(brand, 'favicon.svg')));
    expect(readFileSync(join(pub, 'brand/mascot/lore-hello.svg'))).toEqual(readFileSync(join(brand, 'mascot/lore-hello.svg')));
    expect(existsSync(join(pub, 'brand/lore-og.svg'))).toBe(false);
  });

  it('index.html and the manifest point at existing files', () => {
    const html = readFileSync(join(root, 'apps/web/index.html'), 'utf8');
    for (const m of html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g)) expect(existsSync(join(pub, m[1]!)), m[1]).toBe(true);
    expect(html).toContain('<meta property="og:image" content="%PUBLIC_URL%/icons/og-image.png" />');
    expect(html).toContain('<meta property="og:description" content="Kvízy a testy pro třídu." />');
    const cs = JSON.parse(readFileSync(join(root, 'apps/web/src/locales/cs.json'), 'utf8'));
    expect(cs.brand.description).toBe('Kvízy a testy pro třídu.');
    const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8'));
    expect(manifest).toMatchObject({ name: 'Lore', short_name: 'Lore', start_url: '/', display: 'standalone', theme_color: '#5B3DF5', background_color: '#F7F5FF' });
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const i of manifest.icons as { src: string }[]) expect(existsSync(join(pub, i.src)), i.src).toBe(true);
  });
});
