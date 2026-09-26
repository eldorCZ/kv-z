import { expect, type Page } from '@playwright/test';

/**
 * Submits the login or registration form. Logins and registrations are limited to 10 per minute and IP
 * (a security rule); the whole E2E suite runs from one IP, so wait as long as the server asks and retry.
 */
export async function submitAuth(page: Page, button: 'Vytvořit účet' | 'Přihlásit se') {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByRole('button', { name: button }).click();
    const limited = page.getByText(/Příliš mnoho pokusů.* Zkuste to za \d+ s/);
    const done = page.getByRole('heading', { name: 'Moje kvízy' });
    await expect(limited.or(done)).toBeVisible({ timeout: 10_000 });
    if (await done.isVisible()) return;
    const secs = Number(/za (\d+) s/.exec((await limited.textContent()) ?? '')?.[1] ?? 5);
    await page.waitForTimeout((secs + 1) * 1000);
  }
  await expect(page.getByRole('heading', { name: 'Moje kvízy' })).toBeVisible();
}

export async function registerAndToken(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /Zaregistrujte se/ }).click();
  await page.getByLabel('E-mail').fill(`ucitel${Date.now()}${Math.random().toString(36).slice(2, 6)}@skola.cz`);
  await page.getByLabel('Heslo').fill('bezpecne-heslo-123');
  await submitAuth(page, 'Vytvořit účet');
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
