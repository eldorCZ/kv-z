// pnpm brand:build – the Lore brand from design/brand (Dodatek 4B, L3.1). design/brand is the source of truth;
// this copies the SVGs the browser needs to apps/web/public/brand and renders the PNG icons with sharp.
// Runs before every web build and dev server. The outputs are generated, not committed (.gitignore).
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const root = join(import.meta.dirname, '..');
const src = join(root, 'design/brand');
const pub = join(root, 'apps/web/public');
const brandOut = join(pub, 'brand');
const iconsOut = join(pub, 'icons');

rmSync(brandOut, { recursive: true, force: true });
mkdirSync(join(brandOut, 'mascot'), { recursive: true });
mkdirSync(iconsOut, { recursive: true });

// logo, mark and wordmark in all variants (the social preview source stays out of the browser)
for (const f of readdirSync(src)) {
  if (/^lore-(logo|mark|wordmark)(-dark|-mono)?\.svg$/.test(f)) copyFileSync(join(src, f), join(brandOut, f));
}
for (const f of readdirSync(join(src, 'mascot'))) if (f.endsWith('.svg')) copyFileSync(join(src, 'mascot', f), join(brandOut, 'mascot', f));
copyFileSync(join(src, 'favicon.svg'), join(pub, 'favicon.svg'));

// rasterise from the vector at the target size (density scales the 64-unit viewBox), never by upscaling
const png = async (file, out, width, height = width) => {
  const input = join(src, file);
  const meta = await sharp(input).metadata();
  const density = Math.ceil((72 * Math.max(width / meta.width, height / meta.height)) * 1.0001);
  await sharp(input, { density }).resize(width, height, { fit: 'fill' }).png({ compressionLevel: 9 }).toFile(join(iconsOut, out));
};
await png('favicon.svg', 'favicon-32.png', 32);
await png('lore-app-icon-square.svg', 'apple-touch-icon-180.png', 180);
await png('lore-app-icon.svg', 'icon-192.png', 192);
await png('lore-app-icon.svg', 'icon-512.png', 512);
await png('lore-app-icon-square.svg', 'icon-maskable-512.png', 512);
await png('lore-og.svg', 'og-image.png', 1200, 630);
console.log('brand: public/brand, public/favicon.svg, public/icons/*.png');
