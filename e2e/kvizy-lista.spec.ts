import { expect, test } from '@playwright/test';
import { registerAndToken } from './helpers';

const kviz = (title: string) => ({
  schemaVersion: 1,
  title,
  questions: [{ type: 'single', prompt: 'Kolik je 3 + 3?', options: ['5', '6', '7'], correctIndices: [1] }],
});

test('seznam kvízů: řazení a přepínač dlaždice/seznam, volba přežije načtení', async ({ page, request }) => {
  const token = await registerAndToken(page);
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  for (const n of ['Magnetismus', 'Bezpečnost na internetu', 'Síla a pohyb']) await request.post('/api/v1/quizzes', { headers: h, data: kviz(n) });

  await page.goto('/quizzes');
  const seznam = page.getByTestId('quiz-grid');
  await expect(seznam).toHaveAttribute('data-view', 'dlazdice');

  // Řazení podle času úpravy tu netestujeme: tři kvízy vzniknou v téže milisekundě
  // a jejich vzájemné pořadí pak není dané. Podle názvu je jednoznačné.
  // nový účet má i ukázkový kvíz, proto porovnáváme jen vzájemné pořadí těch našich
  await page.getByTestId('quiz-sort').selectOption('nazev');
  const poradi = async () => {
    const vse = await seznam.locator('li').allTextContents();
    return ['Bezpečnost na internetu', 'Magnetismus', 'Síla a pohyb'].map((n) => vse.findIndex((t) => t.includes(n)));
  };
  const [bezpecnost, magnetismus, sila] = await poradi();
  expect(bezpecnost).toBeGreaterThanOrEqual(0);
  expect(bezpecnost).toBeLessThan(magnetismus!);
  expect(magnetismus!).toBeLessThan(sila!);

  // přepnutí na seznam si pamatuje i po načtení stránky
  await page.getByTestId('quiz-view-seznam').click();
  await expect(seznam).toHaveAttribute('data-view', 'seznam');
  await page.reload();
  await expect(page.getByTestId('quiz-grid')).toHaveAttribute('data-view', 'seznam');
});
