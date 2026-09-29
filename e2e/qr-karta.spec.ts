import { expect, test } from '@playwright/test';
import { registerAndToken } from './helpers';

const kviz = {
  schemaVersion: 1,
  title: 'E2E: QR z karty',
  questions: [{ type: 'single', prompt: 'Kolik je 3 + 3?', options: ['5', '6', '7'], correctIndices: [1], timeLimitSec: 20 }],
};

test('QR z karty: kód se uloží a při dalším připojení stačí PIN', async ({ page, request, context }) => {
  const token = await registerAndToken(page);
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  // třída se dvěma žáky a kvíz
  await page.getByRole('link', { name: 'Třídy' }).click();
  await page.getByTestId('new-class').click();
  await page.getByTestId('class-name').fill('4.A QR');
  await page.getByTestId('create-class').click();
  await page.getByTestId('roster-text').fill('novak01\nmala02');
  await page.getByTestId('roster-preview').click();
  await page.getByTestId('roster-commit').click();
  const kod = (await page.getByTestId('plain-code').first().textContent())!.trim();
  const classId = new URL(page.url()).pathname.split('/').pop()!;

  const kvizId = (await (await request.post('/api/v1/quizzes', { headers: h, data: kviz })).json()).quizId;
  const hra = await (await request.post(`/api/v1/quizzes/${kvizId}/games`, { headers: h, data: { mode: 'live', settings: { classId } } })).json();

  // žák naskenuje QR z karty a kód si uloží
  const zak = await (await context.browser()!.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await zak.goto(`/kod#c=${kod.replace('-', '')}`);
  await expect(zak.getByText(kod)).toBeVisible();
  await zak.getByTestId('code-continue').click();
  await expect(zak.getByText('Kód je uložený', { exact: false })).toBeVisible();
  // kód nesmí zůstat v adrese
  expect(zak.url()).not.toContain('c=');

  // připojení: zadá jen PIN a rovnou potvrzuje totožnost, kód už neopisuje
  await zak.getByRole('link', { name: 'Připojit se ke hře' }).click();
  await zak.getByLabel('PIN hry').fill(hra.pin);
  await zak.getByLabel('Přezdívka').fill('Drak');
  await zak.locator('button[type=submit]').first().click();
  await expect(zak.getByTestId('roster-confirm')).toBeVisible();
  await expect(zak.getByText('novak01', { exact: false })).toBeVisible();
  // přezdívku zadal na první obrazovce – tady už se na ni neptáme podruhé
  await expect(zak.getByTestId('roster-nickname')).toHaveCount(0);
  await zak.getByTestId('roster-yes').click();
  await expect(zak.getByTestId('player-lobby')).toBeVisible();
  await expect(zak.getByTestId('player-name')).toHaveText('Drak');
});

test('QR z lobby s uloženým kódem: první obrazovka se přeskočí, na přezdívku se zeptáme v kroku s kódem', async ({ page, request, context }) => {
  const token = await registerAndToken(page);
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  await page.getByRole('link', { name: 'Třídy' }).click();
  await page.getByTestId('new-class').click();
  await page.getByTestId('class-name').fill('4.B QR lobby');
  await page.getByTestId('create-class').click();
  await page.getByTestId('roster-text').fill('svoboda01\nkralova02');
  await page.getByTestId('roster-preview').click();
  await page.getByTestId('roster-commit').click();
  const kod = (await page.getByTestId('plain-code').first().textContent())!.trim();
  const classId = new URL(page.url()).pathname.split('/').pop()!;

  const kvizId = (await (await request.post('/api/v1/quizzes', { headers: h, data: kviz })).json()).quizId;
  const hra = await (await request.post(`/api/v1/quizzes/${kvizId}/games`, { headers: h, data: { mode: 'live', settings: { classId } } })).json();

  const zak = await (await context.browser()!.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await zak.goto(`/kod#c=${kod.replace('-', '')}`);
  await zak.getByTestId('code-continue').click();
  await expect(zak.getByText('Kód je uložený', { exact: false })).toBeVisible();

  // QR z lobby nese PIN v adrese: obrazovka s PINem a přezdívkou se přeskočí
  // a uložený kód se použije sám, takže by žák jinak přezdívku nikdy nezadal
  await zak.goto(`/play?pin=${hra.pin}`);
  await expect(zak.getByTestId('roster-confirm')).toBeVisible();
  await zak.getByTestId('roster-nickname').fill('Sova');
  await zak.getByTestId('roster-yes').click();
  await expect(zak.getByTestId('player-lobby')).toBeVisible();
  await expect(zak.getByTestId('player-name')).toHaveText('Sova');
});
