import { expect, type Page } from '@playwright/test';

export async function registerAndToken(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /Zaregistrujte se/ }).click();
  await page.getByLabel('E-mail').fill(`ucitel${Date.now()}${Math.random().toString(36).slice(2, 6)}@skola.cz`);
  await page.getByLabel('Heslo').fill('bezpecne-heslo-123');
  await page.getByRole('button', { name: 'Vytvořit účet' }).click();
  await expect(page.getByRole('heading', { name: 'Moje kvízy' })).toBeVisible();
  await page.getByRole('link', { name: 'API tokeny' }).click();
  await page.getByRole('button', { name: 'Vytvořit token' }).click();
  return page.getByTestId('new-token').inputValue();
}

/** Simulate leaving the test window: page hidden (tab switch) or window blur. */
export async function leaveWindow(page: Page, how: 'hidden' | 'blur', ms: number) {
  await page.evaluate((h) => {
    if (h === 'hidden') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    } else {
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
      window.dispatchEvent(new Event('blur'));
    }
  }, how);
  await page.waitForTimeout(ms);
  await page.evaluate((h) => {
    if (h === 'hidden') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    } else {
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
      window.dispatchEvent(new Event('focus'));
    }
  }, how);
}
