import { expect, test, type Browser } from '@playwright/test';
import { registerAndToken } from './helpers';

const quiz = {
  schemaVersion: 1,
  title: 'Vzhled hry',
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'Kolik nohou má pavouk?', options: ['6', '8', '10', '4'], correctIndices: [1], timeLimitSec: 30 },
    { type: 'multi', prompt: 'Která zvířata jsou savci?', options: ['pes', 'kapr', 'netopýr', 'vrabec'], correctIndices: [0, 2], timeLimitSec: 30 },
  ],
};

// one teacher for the whole file: registrations are rate limited per IP (10/min)
let token = '';
test.describe.configure({ mode: 'serial' });

async function newGame(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  token ||= await registerAndToken(page);
  const auth = { authorization: `Bearer ${token}` };
  const { quizId } = await (await request.post('/api/v1/quizzes', { headers: auth, data: quiz })).json();
  const game = await (await request.post(`/api/v1/quizzes/${quizId}/games`, { headers: auth, data: { mode: 'live' } })).json();
  return game as { pin: string; hostUrl: string };
}

async function phone(browser: Browser, pin: string, nick: string, reducedMotion: 'reduce' | 'no-preference') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion });
  const p = await ctx.newPage();
  await p.goto(`/play?pin=${pin}`);
  await p.getByLabel('Přezdívka').fill(nick);
  await p.getByRole('button', { name: 'Připojit se' }).click();
  await expect(p.getByTestId('player-lobby')).toContainText(`Jste ve hře, ${nick}`);
  return p;
}

test('projector 1280x720 and phone: motive layers, keyboard control, podium with confetti (V9.3, V9.4)', async ({ page, browser, request }) => {
  const { pin, hostUrl } = await newGame(page, request);
  const host = await page.context().newPage();
  await host.setViewportSize({ width: 1280, height: 720 });
  await host.goto(new URL(hostUrl).pathname + new URL(hostUrl).hash);
  await expect(host.getByTestId('host-pin')).toBeVisible();
  // motive → scrim → content; default motive for a live game, animated with full motion
  const stage = host.getByTestId('host-stage');
  await expect(stage).toHaveAttribute('data-motive', 'mlha');
  await expect(stage).toHaveAttribute('data-mood', 'play');
  // nothing overflows the projector
  expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // shortcuts dialog
  await host.keyboard.press('?');
  await expect(host.getByTestId('shortcuts')).toBeVisible();
  await host.keyboard.press('Escape');
  await expect(host.getByTestId('shortcuts')).toBeHidden();

  const p1 = await phone(browser, pin, 'novak12', 'no-preference');
  await expect(host.getByTestId('host-players')).toContainText('novak12');
  await host.keyboard.press('Space');
  await expect(p1.getByTestId('player-prompt')).toHaveText('Kolik nohou má pavouk?');
  await expect(host.getByTestId('timer')).toBeVisible();
  // the phone answers with the keyboard: B
  await p1.keyboard.press('b');
  await expect(p1.getByTestId('player-reveal')).toHaveAttribute('data-result', 'ok');
  await expect(host.locator('[data-correct="true"]')).toContainText('Správně');

  // leaderboard, then multi-select with 1 and 3, confirmed with Enter
  await host.keyboard.press('Space');
  await expect(host.getByTestId('leaderboard')).toContainText('novak12');
  await host.keyboard.press('Space');
  await expect(p1.getByTestId('player-prompt')).toHaveText('Která zvířata jsou savci?');
  await p1.keyboard.press('1');
  await p1.keyboard.press('3');
  await expect(p1.getByTestId('option-0')).toHaveAttribute('aria-pressed', 'true');
  await expect(p1.getByTestId('option-2')).toHaveAttribute('aria-pressed', 'true');
  await p1.keyboard.press('Enter');
  await expect(p1.getByTestId('player-reveal')).toHaveAttribute('data-result', 'ok');

  await host.keyboard.press('Space');
  await expect(host.getByTestId('podium')).toContainText('novak12');
  await expect(host.getByTestId('confetti')).toHaveCount(1);
});

test('reduced motion: static motive, no confetti, no running animations (V10)', async ({ browser, request }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const { pin, hostUrl } = await newGame(page, request);
  await page.goto(new URL(hostUrl).pathname + new URL(hostUrl).hash);
  await expect(page.getByTestId('host-pin')).toBeVisible();
  const src = await page.getByTestId('host-stage').locator('img').first().getAttribute('src');
  expect(decodeURIComponent(src!)).not.toMatch(/@keyframes|<animate/);
  const p1 = await phone(browser, pin, 'mala4', 'reduce');
  await page.keyboard.press('Space');
  await expect(p1.getByTestId('player-prompt')).toBeVisible();
  await p1.getByTestId('option-1').click();
  await expect(p1.getByTestId('player-reveal')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Ukončit' }).click();
  await expect(page.getByTestId('podium')).toBeVisible();
  await expect(page.getByTestId('confetti')).toHaveCount(0);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getTiming().duration) > 1).length);
  expect(running).toBe(0);
  await ctx.close();
});
