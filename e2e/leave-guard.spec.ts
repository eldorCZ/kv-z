import { expect, test, type Page } from '@playwright/test';
import { leaveWindow, registerAndToken } from './helpers';

const quiz = {
  schemaVersion: 1,
  title: 'E2E hlídání okna',
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'Hlavní město Česka?', options: ['Praha', 'Brno', 'Ostrava'], correctIndices: [0] },
    { type: 'truefalse', prompt: 'Dunaj teče Bratislavou.', correctIndices: [0] },
  ],
};

async function startStudent(page: Page, pin: string, name: string) {
  await page.goto(`/play?pin=${pin}`);
  await expect(page).toHaveURL(/\/test\?pin=/);
  await page.getByTestId('test-name').fill(name);
  await page.getByRole('button', { name: 'Pokračovat' }).click();
  await expect(page.getByTestId('guard-intro')).toContainText('Během testu nesmíš opustit toto okno.');
  await page.getByTestId('test-start').click();
  await expect(page.getByTestId('test-prompt')).toBeVisible();
}

test('leave guard: warning, highlight, lock enforced by the server, unlock and exemption', async ({ page, browser, request }) => {
  const token = await registerAndToken(page);
  const { reviewUrl } = await (await request.post('/api/v1/quizzes', { headers: { authorization: `Bearer ${token}` }, data: quiz })).json();
  await page.goto(new URL(reviewUrl).pathname);
  await page.getByTestId('start-game').click();
  await page.getByTestId('mode-test').check({ force: true });
  await expect(page.getByTestId('guard-settings')).toContainText('Nezabrání tomu');
  await page.getByTestId('guard-mode').selectOption('warn');
  await page.getByTestId('guard-max').fill('1');
  await page.getByTestId('guard-on-exceed').selectOption('lock');
  await page.getByTestId('confirm-start').click();
  const pin = (await page.getByTestId('pin').textContent())!.replace(/\s/g, '');
  await page.getByTestId('open-dashboard').click();

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const s = await ctx.newPage();
  await startStudent(s, pin, 'Jana Nováková');
  await expect(s.getByTestId('guard-intro')).toHaveCount(0);

  // 1st leave (tab switch, 1.5 s) -> warning that must be confirmed
  await leaveWindow(s, 'hidden', 1500);
  await expect(s.getByTestId('guard-warning')).toContainText('Opustil jsi okno testu (1×). Zbývá varování: 0.');
  await s.getByRole('button', { name: 'Rozumím' }).click();
  await expect(page.getByTestId('dash-left')).toContainText('1×');

  // a short blur (< 1 s) is recorded but does not count
  await leaveWindow(s, 'blur', 500);
  await s.waitForTimeout(600);
  await expect(s.getByTestId('guard-warning')).toHaveCount(0);

  // 2nd counted leave (focus loss) -> locked
  await leaveWindow(s, 'blur', 1500);
  await expect(s.getByTestId('test-locked')).toContainText('Test je zamčený');
  await expect(page.locator('[data-testid="dash-row"][data-flagged="true"]')).toHaveCount(1);
  await expect(page.getByTestId('dash-table')).toContainText('🔒');

  // the server refuses saving while locked
  const playerToken = await s.evaluate((p) => localStorage.getItem(`kvizhub-test-${p}`), pin);
  const blocked = await request.get('/play/test/attempt', { headers: { 'x-player-token': playerToken! } });
  expect(blocked.status()).toBe(423);

  // teacher unlocks with 2 minutes compensation
  page.once('dialog', (d) => d.accept('2'));
  await page.getByTestId('dash-unlock').click();
  await expect(s.getByTestId('test-prompt')).toBeVisible({ timeout: 10_000 });
  await s.getByTestId('test-option-0').click();
  await expect(s.getByTestId('test-save-state')).toHaveText('✓ Uloženo');

  // exemption: leaving is no longer tracked
  await page.getByTestId('dash-exempt').click();
  await expect(page.getByTestId('dash-left')).toContainText('nehlídá se');
  await s.waitForTimeout(5500); // next heartbeat brings guardExempt to the student
  await leaveWindow(s, 'hidden', 1500);
  await s.waitForTimeout(800);
  await expect(s.getByTestId('guard-warning')).toHaveCount(0);
  await expect(s.getByTestId('test-locked')).toHaveCount(0);

  // results: percent is not reduced by leaving; leave columns are present
  await s.getByTestId('test-next').click();
  await s.getByTestId('test-option-0').click();
  await expect(s.getByTestId('test-save-state')).toHaveText('✓ Uloženo');
  await s.getByTestId('test-submit').click();
  await s.getByTestId('test-confirm-submit').click();
  await expect(s.getByTestId('test-percent')).toHaveText('100 %');
  await page.getByRole('link', { name: 'Výsledky', exact: true }).click();
  await expect(page.getByTestId('test-summary')).toContainText('1 žák opustil okno nad limit');
});
