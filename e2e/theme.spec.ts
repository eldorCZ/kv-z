import { expect, test, type Page } from '@playwright/test';
import { registerAndToken } from './helpers';

const quiz = {
  schemaVersion: 1,
  title: 'Motivy',
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'Kolik nohou má pavouk?', options: ['6', '8', '10', '4'], correctIndices: [1], timeLimitSec: 30 },
    { type: 'single', prompt: 'Kolik nohou má moucha?', options: ['6', '8', '10', '4'], correctIndices: [0], timeLimitSec: 30 },
  ],
};

// one teacher for the file: registrations are rate limited per IP
test.describe.configure({ mode: 'serial' });
let token = '';
let teacher: Page;

test.beforeAll(async ({ browser }) => {
  teacher = await (await browser.newContext()).newPage();
  token = await registerAndToken(teacher);
});
test.afterAll(async () => teacher.context().close());

const auth = () => ({ authorization: `Bearer ${token}` });

test('teacher picks a look in the editor; the card, the host and the student show it; the game keeps its snapshot (V7)', async ({ browser }) => {
  const { quizId } = await (await teacher.request.post('/api/v1/quizzes', { headers: auth(), data: quiz })).json();
  await teacher.goto(`/quizzes/${quizId}`);
  await teacher.getByTestId('quiz-look').click();
  await expect(teacher.getByTestId('theme-picker')).toBeVisible();
  await teacher.getByTestId('theme-filter-veda').click();
  await teacher.getByTestId('motive-vesmir').click();
  await expect(teacher.getByTestId('motive-vesmir')).toHaveAttribute('aria-checked', 'true');
  await teacher.getByTestId('accent-modra').click();
  // the preview switches screens and follows the choice
  await teacher.getByTestId('preview-question').click();
  await expect(teacher.getByTestId('theme-chosen')).toHaveText('Vesmír · Modrá');
  await teacher.getByTestId('theme-save-quiz').click();
  await expect(teacher.getByTestId('theme-picker')).toBeHidden();
  expect((await (await teacher.request.get(`/api/v1/quizzes/${quizId}`, { headers: auth() })).json()).theme).toEqual({ motive: 'vesmir', accent: 'modra' });

  await teacher.goto('/quizzes');
  await expect(teacher.getByTestId('quiz-grid').locator('[data-motive="vesmir"]').first()).toBeVisible();

  // start a game with another look for this game only
  await teacher.goto(`/quizzes/${quizId}`);
  await teacher.getByTestId('start-game').click();
  await expect(teacher.getByTestId('game-look-name')).toContainText('Vesmír · Modrá · podle kvízu');
  await teacher.getByTestId('game-look').click();
  await teacher.getByTestId('motive-les').click();
  await teacher.getByTestId('theme-apply-game').click();
  await expect(teacher.getByTestId('game-look-name')).toContainText('Les · Modrá · jen pro tuto hru');
  await teacher.getByTestId('confirm-start').click();
  const pin = (await teacher.getByTestId('pin').textContent())!.replace(/\s/g, '');
  const hostHref = (await teacher.getByTestId('open-host').getAttribute('href'))!;
  // the quiz changes afterwards – the running game keeps its look
  await teacher.request.patch(`/api/v1/quizzes/${quizId}`, { headers: auth(), data: { theme: { motive: 'more' } } });

  const host = await teacher.context().newPage();
  await host.goto(hostHref);
  await expect(host.getByTestId('host-stage')).toHaveAttribute('data-motive', 'les');
  const accent = await host.getByTestId('host-stage').evaluate((el) => getComputedStyle(el).getPropertyValue('--primary').trim());
  expect(accent).not.toBe('');

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto(`/play?pin=${pin}`);
  // before joining: the default Lore look
  await expect(phone.getByTestId('play-stage')).toHaveAttribute('data-motive', 'mlha');
  await phone.getByLabel('Přezdívka').fill('novak12');
  await phone.getByRole('button', { name: 'Připojit se' }).click();
  await expect(phone.getByTestId('player-lobby')).toBeVisible();
  await expect(phone.getByTestId('play-stage')).toHaveAttribute('data-motive', 'les');
  await phone.context().close();
  await host.close();
});

test('tests stay calm: static motive, strong scrim, no confetti, podium, points or correctness (D7, V9.5)', async ({ browser }) => {
  const { quizId } = await (await teacher.request.post('/api/v1/quizzes', { headers: auth(), data: { ...quiz, theme: { motive: 'konfety' } } })).json();
  const game = await (await teacher.request.post(`/api/v1/quizzes/${quizId}/games`, { headers: auth(), data: { mode: 'test', settings: { test: { timeLimitMin: 10, showResultsToStudent: 'none' } } } })).json();
  const s = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await s.goto(`/test?pin=${game.pin}`);
  await expect(s.locator('img[src*="/brand/mascot/"]')).toHaveCount(0);
  await s.getByTestId('test-name').fill('Žák Test');
  await s.getByRole('button', { name: 'Pokračovat' }).click();
  await expect(s.getByTestId('test-intro')).toBeVisible();
  await expect(s.locator('img[src*="/brand/mascot/"]')).toHaveCount(0);
  await s.getByTestId('test-start').click();
  await expect(s.getByTestId('test-prompt')).toBeVisible();
  const stage = s.getByTestId('test-stage');
  await expect(stage).toHaveAttribute('data-mood', 'focus');
  await expect(stage).toHaveAttribute('data-motive', 'konfety');
  const src = await stage.locator('img').first().getAttribute('src');
  expect(decodeURIComponent(src!)).not.toMatch(/@keyframes|<animate/);
  const scrim = await stage.evaluate((el) => Number(getComputedStyle(el.children[1] as HTMLElement).opacity));
  expect(scrim).toBeGreaterThanOrEqual(0.6);
  const noMascot = () => expect(s.locator('img[src*="/brand/mascot/"]')).toHaveCount(0);
  await noMascot();
  await s.getByTestId('test-option-1').click();
  await s.getByTestId('test-next').click();
  await s.getByTestId('test-option-0').click();
  await s.getByTestId('test-submit').click();
  await noMascot();
  await s.getByTestId('test-confirm-submit').click();
  await expect(s.getByTestId('test-done')).toBeVisible();
  await noMascot();
  for (const id of ['confetti', 'podium', 'leaderboard', 'timer', 'player-reveal']) await expect(s.getByTestId(id)).toHaveCount(0);
  await expect(s.locator('body')).not.toContainText(/bodů|Správně!|Špatně|pořadí|série/i);
  const running = await s.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  expect(running).toBe(0);
  await s.context().close();
});

test('default look of new quizzes is a teacher setting (V7.3)', async () => {
  await teacher.goto('/settings/look');
  await teacher.getByTestId('default-look').click();
  await teacher.getByTestId('motive-more').click();
  await teacher.getByTestId('theme-save-default').click();
  await expect(teacher.getByTestId('default-look-name')).toHaveText('Moře');
  const { quizId } = await (await teacher.request.post('/api/v1/quizzes', { headers: auth(), data: quiz })).json();
  expect((await (await teacher.request.get(`/api/v1/quizzes/${quizId}`, { headers: auth() })).json()).theme).toEqual({ motive: 'more' });
  // back to the Lore default
  await teacher.getByTestId('default-look').click();
  await teacher.getByTestId('motive-default').click();
  await teacher.getByTestId('theme-save-default').click();
  await expect(teacher.getByTestId('default-look-name')).toHaveText('Výchozí vzhled');
});

test('keyboard only: a student joins and answers without a mouse (V11.1)', async ({ browser }) => {
  const { quizId } = await (await teacher.request.post('/api/v1/quizzes', { headers: auth(), data: quiz })).json();
  const game = await (await teacher.request.post(`/api/v1/quizzes/${quizId}/games`, { headers: auth(), data: { mode: 'live' } })).json();
  const host = await teacher.context().newPage();
  await host.goto(new URL(game.hostUrl).pathname + new URL(game.hostUrl).hash);
  await expect(host.getByTestId('host-pin')).toBeVisible();

  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p.goto('/play');
  await p.getByLabel('PIN hry').focus();
  await p.keyboard.type(game.pin);
  await p.keyboard.press('Tab');
  await expect(p.getByLabel('Přezdívka')).toBeFocused();
  await p.keyboard.type('mala4');
  await p.keyboard.press('Enter');
  await expect(p.getByTestId('player-lobby')).toBeVisible();
  await host.keyboard.press('Space');
  await expect(p.getByTestId('player-prompt')).toBeVisible();
  await p.keyboard.press('2');
  await expect(p.getByTestId('player-reveal')).toHaveAttribute('data-result', 'ok');
  // every interactive element has a visible focus ring
  await p.keyboard.press('Tab');
  const ring = await p.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(ring).not.toBe('none');
  await p.context().close();
  await host.close();
});

// 32x18 blue PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAASCAIAAAC1qksFAAAAH0lEQVR4nGPQqDhBU8QwasGoBaMWjFowasGoBfSwAAB6mSouDcYAfgAAAABJRU5ErkJggg==', 'base64');

test('a teacher uploads an own background; the projector shows it (V8)', async () => {
  const { quizId } = await (await teacher.request.post('/api/v1/quizzes', { headers: auth(), data: quiz })).json();
  await teacher.goto(`/quizzes/${quizId}`);
  await teacher.getByTestId('quiz-look').click();
  await teacher.getByTestId('theme-image-input').setInputFiles({ name: 'tabule.png', mimeType: 'image/png', buffer: PNG });
  await expect(teacher.getByTestId('image-0')).toHaveAttribute('aria-checked', 'true');
  await expect(teacher.getByTestId('theme-preview').locator('img').first()).toHaveAttribute('src', /\/media\/theme\/[0-9a-f]{32}\/640\.webp/);
  await teacher.getByTestId('theme-save-quiz').click();
  await expect(teacher.getByTestId('theme-picker')).toBeHidden();
  const game = await (await teacher.request.post(`/api/v1/quizzes/${quizId}/games`, { headers: auth(), data: { mode: 'live' } })).json();
  const host = await teacher.context().newPage();
  await host.goto(new URL(game.hostUrl).pathname + new URL(game.hostUrl).hash);
  await expect(host.getByTestId('host-stage').locator('img').first()).toHaveAttribute('src', /\/media\/theme\/[0-9a-f]{32}\/1280\.webp/);
  await expect.poll(() => host.getByTestId('host-stage').locator('img').first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await host.close();
});

test('Lorík: where he belongs in a live game, still under reduced motion, breathing otherwise (L4, L7.5)', async ({ browser }) => {
  const { quizId } = await (await teacher.request.post('/api/v1/quizzes', { headers: auth(), data: quiz })).json();
  const game = await (await teacher.request.post(`/api/v1/quizzes/${quizId}/games`, { headers: auth(), data: { mode: 'live' } })).json();
  const host = await teacher.context().newPage();
  await host.goto(new URL(game.hostUrl).pathname + new URL(game.hostUrl).hash);
  await expect(host.getByTestId('host-pin')).toBeVisible();
  const running = (p: import('@playwright/test').Page) =>
    p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && (a.effect as KeyframeEffect | null)?.target instanceof HTMLImageElement && ((a.effect as KeyframeEffect).target as HTMLImageElement).dataset.testid === 'mascot').length);
  const phones = [];
  for (const [nick, motion] of [['mala4', 'reduce'], ['erben7', 'no-preference']] as const) {
    const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: motion })).newPage();
    await p.goto(`/play?pin=${game.pin}`);
    // PIN screen: hello, a single figure
    await expect(p.getByTestId('mascot')).toHaveCount(1);
    await expect(p.getByTestId('mascot')).toHaveAttribute('data-pose', 'hello');
    await expect(p.getByTestId('mascot')).toHaveAttribute('alt', '');
    await p.getByLabel('Přezdívka').fill(nick);
    await p.getByRole('button', { name: 'Připojit se' }).click();
    await expect(p.getByTestId('player-lobby').getByTestId('mascot')).toHaveAttribute('data-pose', 'hello');
    await p.getByTestId('mascot').evaluate((i: HTMLImageElement) => i.decode());
    phones.push(p);
  }
  expect(await running(phones[0]!)).toBe(0);
  expect(await running(phones[1]!)).toBe(1);
  await host.keyboard.press('Space');
  await expect(phones[0]!.getByTestId('player-prompt')).toBeVisible();
  // a wrong answer: encouragement, small and still
  await phones[0]!.getByTestId('option-0').click();
  await phones[1]!.getByTestId('option-1').click();
  await expect(phones[0]!.getByTestId('encourage')).toContainText('Nevadí, další je tvoje.');
  await expect(phones[0]!.getByTestId('mascot')).toHaveAttribute('data-pose', 'encourage');
  await expect(phones[1]!.getByTestId('encourage')).toHaveCount(0);
  host.once('dialog', (d) => void d.accept());
  await host.getByRole('button', { name: 'Ukončit' }).click();
  await expect(host.getByTestId('podium').locator('..').getByTestId('mascot')).toHaveAttribute('data-pose', 'celebrate');
  await expect(phones[1]!.getByTestId('player-over').getByTestId('mascot')).toHaveAttribute('data-pose', 'celebrate');
  for (const p of phones) await p.context().close();
  await host.close();
});
