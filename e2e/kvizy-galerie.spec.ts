import { expect, test } from '@playwright/test';
import { registerAndToken } from './helpers';

const kviz = (title: string) => ({
  schemaVersion: 1,
  title,
  questions: [{ type: 'single', prompt: 'Kolik je 3 + 3?', options: ['5', '6', '7'], correctIndices: [1] }],
});

async function zalozKvizy(request: import('@playwright/test').APIRequestContext, token: string) {
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  for (const n of ['Magnetismus', 'Bezpečnost na internetu', 'Síla a pohyb']) await request.post('/api/v1/quizzes', { headers: h, data: kviz(n) });
}

test('galerie kvízů: statistiky, řazení přes Select a přepínač zobrazení', async ({ page, request }) => {
  const token = await registerAndToken(page);
  await zalozKvizy(request, token);
  await page.goto('/quizzes');

  await expect(page.getByTestId('quiz-stats')).toBeVisible();
  const seznam = page.getByTestId('quiz-grid');
  await expect(seznam).toHaveAttribute('data-view', 'dlazdice');

  // Select je tlačítko, ne nativní <select>: ovládá se klávesnicí
  await page.getByTestId('quiz-sort').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: 'Podle názvu' }).click();
  const poradi = async () => {
    const vse = await seznam.locator('li').allTextContents();
    return ['Bezpečnost na internetu', 'Magnetismus', 'Síla a pohyb'].map((n) => vse.findIndex((t) => t.includes(n)));
  };
  // nový účet má i ukázkový kvíz, proto porovnáváme jen vzájemné pořadí těch našich
  const [b, m, s] = await poradi();
  expect(b).toBeGreaterThanOrEqual(0);
  expect(b).toBeLessThan(m!);
  expect(m!).toBeLessThan(s!);

  await page.getByTestId('quiz-view-seznam').click();
  await expect(seznam).toHaveAttribute('data-view', 'seznam');
  await page.reload();
  await expect(page.getByTestId('quiz-grid')).toHaveAttribute('data-view', 'seznam');
});

test('mazání kvízu přes AlertDialog: Esc zavře, potvrzení smaže', async ({ page, request }) => {
  const token = await registerAndToken(page);
  await zalozKvizy(request, token);
  await page.goto('/quizzes');
  const seznam = page.getByTestId('quiz-grid');
  await expect(seznam.locator('li').first()).toBeVisible(); // až po dokreslení má smysl počítat
  const pred = await seznam.locator('li').count();

  await page.getByRole('button', { name: /Magnetismus/ }).first().click();
  await page.getByRole('menuitem', { name: 'Smazat' }).click();
  const dialog = page.getByTestId('alert-dialog');
  await expect(dialog).toBeVisible();
  // ohnisko startuje na „zrušit“, ať Enter omylem nesmaže
  await expect(page.getByTestId('alert-cancel')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(seznam.locator('li')).toHaveCount(pred);

  await page.getByRole('button', { name: /Magnetismus/ }).first().click();
  await page.getByRole('menuitem', { name: 'Smazat' }).click();
  await page.getByTestId('alert-confirm').click();
  await expect(dialog).toHaveCount(0);
  await expect(seznam.locator('li')).toHaveCount(pred - 1);
  expect(await page.content()).not.toContain('Magnetismus');
});

test('omezený pohyb: karty i čísla naskočí rovnou, bez animace', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const token = await registerAndToken(page);
  await zalozKvizy(request, token);
  await page.goto('/quizzes');

  expect(await page.evaluate(() => document.documentElement.getAttribute('data-motion'))).toBe('reduced');
  // BlurFade nesmí nechat kartu rozostřenou ani průhlednou a NumberTicker musí ukázat cíl hned
  const karta = page.getByTestId('quiz-grid').locator('li').first();
  await expect(karta).toBeVisible();
  const styl = await karta.evaluate((el) => {
    const d = el.querySelector('div');
    return d ? { opacity: getComputedStyle(d).opacity, filter: getComputedStyle(d).filter } : null;
  });
  expect(styl?.opacity).toBe('1');
  expect(styl?.filter === 'none' || styl?.filter === '').toBe(true);
  await expect(page.getByTestId('quiz-stats')).toContainText('4');
});
