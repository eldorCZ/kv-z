import { expect, test } from '@playwright/test';
import { registerAndToken } from './helpers';

const kviz = {
  schemaVersion: 1,
  title: 'E2E: Kvíz ke smazání',
  questions: [
    { type: 'single', prompt: 'Kolik je 2 + 2?', options: ['3', '4', '5'], correctIndices: [1], timeLimitSec: 20 },
  ],
};

test('doběhlou hru jde smazat, ale až po potvrzení a jen když neběží', async ({ page, request }) => {
  const token = await registerAndToken(page);
  const hlavicky = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const kvizId = (await (await request.post('/api/v1/quizzes', { headers: hlavicky, data: kviz })).json()).quizId;
  const hra = await (await request.post(`/api/v1/quizzes/${kvizId}/games`, { headers: hlavicky, data: { mode: 'live' } })).json();

  await page.getByRole('link', { name: 'Hry a výsledky' }).click();
  const radek = page.locator('li', { hasText: 'E2E: Kvíz ke smazání' });
  await expect(radek).toHaveCount(1);

  // dokud hra běží, server smazání odmítne a učitel se to dozví
  const smazat = radek.getByRole('button', { name: 'Smazat' });
  page.once('dialog', (d) => void d.accept());
  await smazat.click();
  await expect(page.getByRole('alert')).toContainText('běží');
  await expect(radek).toHaveCount(1);

  const konec = await request.post(`/api/v1/games/${hra.gameId}/end`, { headers: hlavicky, data: {} });
  expect(konec.ok(), `${konec.status()} ${await konec.text()}`).toBe(true);
  await page.reload();

  // zamítnuté potvrzení nesmí nic smazat
  page.once('dialog', (d) => void d.dismiss());
  await smazat.click();
  await page.waitForTimeout(300);
  await expect(radek).toHaveCount(1);

  // potvrzení se ptá jménem kvízu
  let dotaz = '';
  page.once('dialog', (d) => {
    dotaz = d.message();
    void d.accept();
  });
  await smazat.click();
  await expect(radek).toHaveCount(0);
  expect(dotaz).toContain('E2E: Kvíz ke smazání');
  expect(dotaz).toContain('nepůjdou obnovit');
  await expect(page.getByTestId('games-hlaska')).toHaveText('Smazáno.');

  // a je pryč i po obnovení stránky
  await page.reload();
  await expect(page.locator('li', { hasText: 'E2E: Kvíz ke smazání' })).toHaveCount(0);
});
