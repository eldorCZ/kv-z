// Renders the PNG icons from public/favicon.svg with the bundled Chromium: node scripts/render-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const pub = join(import.meta.dirname, '../apps/web/public');
const svg = readFileSync(join(pub, 'favicon.svg'), 'utf8');
const b = await chromium.launch();
for (const [size, name] of [[32, 'favicon-32.png'], [180, 'apple-touch-icon.png'], [512, 'icon-512.png']]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: join(pub, name), omitBackground: true });
  await p.close();
}
await b.close();
