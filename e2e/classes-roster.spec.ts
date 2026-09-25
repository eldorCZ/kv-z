import { expect, test } from '@playwright/test';
import { registerAndToken } from './helpers';

test('roster: 25 students pasted, cards printed, codes are gone after reload', async ({ page }) => {
  await registerAndToken(page);
  await page.getByRole('link', { name: 'Třídy' }).click();
  await page.getByTestId('new-class').click();
  await page.getByTestId('class-name').fill('8.A Fyzika');
  await page.getByTestId('create-class').click();
  await expect(page.getByTestId('class-title')).toHaveText('8.A Fyzika');
  const list = Array.from({ length: 25 }, (_, i) => `${i + 1}. Příjmení${i} Jméno${i}`).join('\n');
  await page.getByTestId('roster-text').fill(list);
  await page.getByTestId('roster-preview').click();
  await expect(page.getByTestId('roster-preview-table')).toContainText('Jméno0 P.');
  await page.getByTestId('roster-commit').click();
  await expect(page.getByTestId('plain-code')).toHaveCount(25);
  const first = await page.getByTestId('plain-code').first().textContent();
  expect(first).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('print-cards').click();
  await expect(page.getByTestId('roster-table').locator('tbody tr')).toHaveCount(25);
  page.once('dialog', (d) => d.accept()); // beforeunload
  await page.reload();
  await page.getByTestId('tab-roster').click();
  await expect(page.getByTestId('roster-table').locator('tbody tr')).toHaveCount(25);
  await expect(page.getByTestId('plain-code')).toHaveCount(0);
  expect(await page.content()).not.toContain(first!);
});
