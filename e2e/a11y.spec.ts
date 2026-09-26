import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { registerAndToken } from './helpers';

const quiz = {
  schemaVersion: 1,
  title: 'Přístupnost: optika',
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'Co je lom světla?', options: ['změna směru', 'odraz', 'pohlcení', 'rozptyl'], correctIndices: [0], topic: 'Lom světla' },
    { type: 'multi', prompt: 'Které jevy souvisejí se světlem?', options: ['lom', 'odraz', 'var', 'ohyb', 'tání'], correctIndices: [0, 1, 3] },
  ],
};

/** No serious or critical axe violations (V11.1, V12). */
async function audit(page: Page, name: string) {
  // measure the settled screen, not a fade-in in progress
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${name}: ${v.id} – ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')})`)).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`teacher screens have no serious a11y issues (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/login');
    await audit(page, 'login');
    const token = await registerAndToken(page);
    const { quizId } = await (await page.request.post('/api/v1/quizzes', { headers: { authorization: `Bearer ${token}` }, data: quiz })).json();
    const csrf = await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).csrfToken as string);
    const cls = await (await page.request.post('/api/v1/classes', { headers: { 'x-csrf-token': csrf }, data: { name: '8.A Fyzika' } })).json();
    await page.request.post(`/api/v1/classes/${cls.id}/students`, { headers: { 'x-csrf-token': csrf }, data: { students: [{ accountName: 'novak12', rosterNo: 1 }, { accountName: 'mala4', rosterNo: 2 }] } });

    await page.goto('/quizzes');
    await expect(page.getByTestId('quiz-grid')).toBeVisible();
    await audit(page, 'quizzes');
    await page.goto(`/quizzes/${quizId}`);
    await expect(page.getByTestId('question').first()).toBeVisible();
    await audit(page, 'review');
    await page.getByTestId('question').first().getByRole('button', { name: 'Upravit' }).click();
    await expect(page.getByTestId('student-preview')).toBeVisible();
    await audit(page, 'editor');
    await page.getByTestId('start-game').click();
    await expect(page.getByTestId('mode-live')).toBeVisible();
    await audit(page, 'start-game');
    await page.keyboard.press('Escape');
    await page.getByTestId('quiz-look').click();
    await expect(page.getByTestId('theme-picker')).toBeVisible();
    await audit(page, 'theme-picker');
    await page.keyboard.press('Escape');
    await page.goto('/settings/look');
    await expect(page.getByTestId('default-look')).toBeVisible();
    await audit(page, 'look-settings');
    await page.goto('/games');
    await audit(page, 'games');
    await page.goto('/settings/tokens');
    await audit(page, 'tokens');
    await page.goto('/classes');
    await audit(page, 'classes');
    await page.goto(`/classes/${cls.id}`);
    await expect(page.getByTestId('matrix')).toBeVisible();
    await audit(page, 'class-matrix');
    await page.getByTestId('tab-roster').click();
    await audit(page, 'class-roster');
  });

  test(`student screens have no serious a11y issues (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/play');
    await audit(page, 'play-join');
    await page.goto('/kod#c=K7MQ2XRT');
    await audit(page, 'kod');
    await page.goto('/neexistuje');
    await expect(page.getByTestId('not-found')).toBeVisible();
    await audit(page, '404');
  });
}

test('live game screens have no serious a11y issues (light and dark)', async ({ page, browser }) => {
  const token = await registerAndToken(page);
  const auth = { authorization: `Bearer ${token}` };
  const { quizId } = await (await page.request.post('/api/v1/quizzes', { headers: auth, data: quiz })).json();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const game = await (await page.request.post(`/api/v1/quizzes/${quizId}/games`, { headers: auth, data: { mode: 'live' } })).json();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(new URL(game.hostUrl).pathname + new URL(game.hostUrl).hash);
    await expect(page.getByTestId('host-pin')).toBeVisible();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
    const phone = await ctx.newPage();
    await phone.goto(`/play?pin=${game.pin}`);
    await phone.getByLabel('Přezdívka').fill('novak12');
    await phone.getByRole('button', { name: 'Připojit se' }).click();
    await expect(phone.getByTestId('player-lobby')).toBeVisible();
    await expect(page.getByTestId('host-players')).toContainText('novak12');
    await audit(page, `${scheme} host-lobby`);
    await audit(phone, `${scheme} player-lobby`);
    await page.keyboard.press('Space');
    await expect(phone.getByTestId('player-prompt')).toBeVisible();
    await audit(page, `${scheme} host-question`);
    await audit(phone, `${scheme} player-question`);
    await phone.getByTestId('option-1').click();
    await expect(phone.getByTestId('player-reveal')).toBeVisible();
    await expect(page.getByTestId('host-reveal-box')).toBeVisible();
    await audit(page, `${scheme} host-reveal`);
    await audit(phone, `${scheme} player-reveal`);
    await ctx.close();
  }
});
