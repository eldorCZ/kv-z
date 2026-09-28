import { expect, test } from '@playwright/test';

test('Logo component: variants, tone, accessibility, no layout shift on scheme switch (L7.3)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/_design');
  const logo = page.getByTestId('design-page').locator('header').getByRole('img', { name: 'Lore' });
  await expect(logo).toHaveAttribute('data-tone', 'light');
  const before = await logo.boundingBox();
  await page.getByTestId('scheme-switcher').click();
  await page.getByTestId('scheme-dark').click();
  await expect(logo).toHaveAttribute('data-tone', 'dark');
  expect(await logo.boundingBox()).toEqual(before);
  // dark variant uses the light-violet mark, the light one the primary violet
  expect(await logo.locator('g[fill]').first().getAttribute('fill')).toBe('#8B7BFF');
  await page.getByTestId('scheme-light').click();
  expect(await logo.locator('g[fill]').first().getAttribute('fill')).toBe('#5B3DF5');
  // every variant exists, mono uses currentColor
  const sheet = page.getByTestId('brand-light');
  for (const v of ['horizontal', 'mark', 'wordmark']) await expect(sheet.getByTestId(`logo-${v}`).first()).toBeVisible();
  const mono = sheet.locator('[data-tone="mono"]').first();
  expect(await mono.locator('[fill="currentColor"]').count()).toBeGreaterThan(0);
  expect(await mono.locator('[fill^="#"], [stroke^="#"]').count()).toBe(0);
  // dark sheet shows dark artwork even in the light scheme
  expect(await page.getByTestId('brand-dark').getByTestId('logo-mark').first().getAttribute('data-tone')).toBe('dark');
});

test('head: title, icons, manifest and a generic link preview with an absolute image (L3.2–L3.4, L7.4)', async ({ page, request, baseURL }) => {
  await page.goto('/play');
  await expect(page).toHaveTitle('Připojení ke hře · Lore');
  const og = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(og).toBe(`${baseURL}/icons/og-image.png`);
  expect(await page.locator('meta[property="og:title"]').getAttribute('content')).toBe('Lore');
  expect(await page.locator('meta[name="application-name"]').getAttribute('content')).toBe('Lore');
  const html = await (await request.get('/play?pin=123456')).text();
  expect(html).not.toContain('123456');
  for (const href of await page.locator('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')!))) {
    expect((await request.get(href)).status(), href).toBe(200);
  }
  const ico = await request.get('/favicon.ico');
  expect(ico.headers()['content-type']).toBe('image/png');
  const og200 = await request.get('/icons/og-image.png');
  expect(og200.status()).toBe(200);
  // the SVGs from /brand are served as images and never sniffed
  const svg = await request.get('/brand/mascot/lore-hello.svg');
  expect(svg.headers()['content-type']).toContain('image/svg+xml');
  expect(svg.headers()['x-content-type-options']).toBe('nosniff');
});

/**
 * Strop na grafiku přihlašovací obrazovky (L7.9). Původně 6 kB, zvednuto na 8 kB.
 *
 * Proč: od zavedení výběru postavy v lobby si žák vybírá z pěti Loríků, takže se
 * místo jednoho obrázku stahuje pět. Po drátě to dělá 3,7 kB (server je posílá
 * gzipované) a s vloženými logy je celek asi 5,2 kB — pořád pod 6 kB. Osm kB je
 * tedy rezerva na jednu další pózu, ne usmíření se současným stavem.
 *
 * Zároveň se opravilo měření: dřív se sčítaly NEKOMPRIMOVANÉ soubory a stejný
 * obrázek použitý dvakrát se počítal dvakrát, takže test hlásil 14,5 kB u něčeho,
 * co ve skutečnosti stojí 5,2 kB. Rozpočet má měřit to, co opravdu poteče po síti
 * třiceti mobilům na školní wifi.
 */
const STROP_GRAFIKY = 8 * 1024;

test('brand weight on the PIN screen: inline logo ≤ 2 kB, all brand graphics ≤ 8 kB (L7.9)', async ({ page, request }) => {
  await page.goto('/play');
  await expect(page.getByLabel('PIN hry')).toBeVisible();
  const inline = await page.locator('svg[data-testid^="logo-"]').evaluateAll((els) => els.map((e) => new Blob([e.outerHTML]).size));
  expect(inline.length).toBeGreaterThan(0);
  for (const n of inline) expect(n).toBeLessThanOrEqual(2048);
  // každý soubor jen jednou – prohlížeč ho podruhé vezme z cache
  const imgs = [...new Set(await page.locator('img[src^="/brand/"]').evaluateAll((els) => els.map((e) => e.getAttribute('src')!)))];
  let total = inline.reduce((a, b) => a + b, 0);
  for (const src of imgs) {
    const r = await request.get(src, { headers: { 'accept-encoding': 'gzip' } });
    total += Number(r.headers()['content-length'] ?? (await r.body()).length);
  }
  expect(total, `grafika přihlašovací obrazovky: ${total} B`).toBeLessThanOrEqual(STROP_GRAFIKY);
});
