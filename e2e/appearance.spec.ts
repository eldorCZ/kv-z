import { expect, test } from '@playwright/test';
import { registerAndToken, submitAuth } from './helpers';

const theme = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));

test('appearance: light, dark and system, saved after reload (V5)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/play');
  expect(await theme(page)).toBe('light');
  await page.getByTestId('scheme-switcher').click();
  await page.getByTestId('scheme-dark').click();
  expect(await theme(page)).toBe('dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f0b2a');
  await page.reload();
  expect(await theme(page)).toBe('dark');
  // "system" follows the device, also when it changes while the page is open
  await page.getByTestId('scheme-switcher').click();
  await page.getByTestId('scheme-system').click();
  expect(await theme(page)).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => theme(page)).toBe('dark');
  // the choice is stored only in this device (no cookie)
  const cookies = await page.context().cookies();
  expect(cookies.filter((c) => !c.name.startsWith('kh_'))).toEqual([]);
});

test('no flash: data-theme is set before the app script runs (V5.4)', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'dark' });
  const page = await ctx.newPage();
  // hold back the application bundle: only theme-init.js can have run
  await page.route('**/assets/*.js', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto('/login', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.body !== null);
  const early = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    appRendered: (document.getElementById('root')?.childElementCount ?? 0) > 0,
  }));
  expect(early.appRendered).toBe(false);
  expect(early.theme).toBe('dark');
  await ctx.close();
});

test('reduced motion and readable font (V5.2)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/play');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-motion'))).toBe('reduced');
  await page.getByTestId('scheme-switcher').click();
  await page.getByTestId('motion-full').click();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-motion'))).toBe('full');
  await page.getByTestId('font-readable').click();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-font'))).toBe('readable');
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Atkinson');
});

test('the appearance panel stays inside the window, also from the bottom-left sidebar button', async ({ page }) => {
  // in the teacher layout the button sits at the bottom left; a panel anchored below it
  // used to open under the bottom edge of the window and off to the left
  await page.setViewportSize({ width: 1100, height: 620 });
  await registerAndToken(page);
  await page.getByTestId('scheme-switcher').click();
  const panel = page.getByTestId('appearance-popover');
  await expect(panel).toBeVisible();
  const uvnitr = async () => {
    const b = (await panel.boundingBox())!;
    const v = page.viewportSize()!;
    return { ok: b.x >= 0 && b.y >= 0 && b.x + b.width <= v.width && b.y + b.height <= v.height, b, v };
  };
  const siroke = await uvnitr();
  expect(siroke, JSON.stringify(siroke)).toMatchObject({ ok: true });
  // and on a phone, where the panel is as wide as the screen
  await page.setViewportSize({ width: 360, height: 740 });
  const uzke = await uvnitr();
  expect(uzke, JSON.stringify(uzke)).toMatchObject({ ok: true });
  await expect(panel).toBeVisible();
});

test("a teacher's appearance follows them to another device (V5.3)", async ({ page, browser }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await registerAndToken(page);
  const email = await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).teacher.email as string);
  await page.getByTestId('scheme-switcher').click();
  await page.getByTestId('scheme-dark').click();
  await expect.poll(async () => page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).uiPrefs.scheme)).toBe('dark');

  const other = await browser.newContext({ colorScheme: 'light' });
  const p2 = await other.newPage();
  await p2.goto('/login');
  expect(await theme(p2)).toBe('light');
  await p2.getByLabel('E-mail').fill(email);
  await p2.getByLabel('Heslo').fill('bezpecne-heslo-123');
  await submitAuth(p2, 'Přihlásit se');
  await expect.poll(() => theme(p2)).toBe('dark');
  await other.close();
});
