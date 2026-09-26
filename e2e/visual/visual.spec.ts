/**
 * Visual regression (Dodatek 4, V12): key screens in light and dark mode, tolerance 0.2 % of pixels.
 * Run: pnpm test:visual   ·   accept a deliberate change: pnpm test:visual -u
 * Everything random is fixed or masked: seed-independent motives, masked PINs, QR codes, timers and dates.
 */
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

const quiz = {
  schemaVersion: 1,
  title: 'Vizuální test: optika',
  gradeLevel: '8. ročník',
  theme: { motive: 'mekke-vlny' },
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'Jak se nazývá změna směru světla na rozhraní dvou prostředí?', options: ['Lom světla', 'Odraz světla', 'Ohyb světla', 'Rozklad světla'], correctIndices: [0], explanation: 'Lom.', timeLimitSec: 60 },
    { type: 'truefalse', prompt: 'Světlo se ve vakuu šíří rychlostí asi 300 000 km/s.', correctIndices: [0], timeLimitSec: 60 },
  ],
};

test.describe.configure({ mode: 'serial' });
let token = '';
let quizId = '';
let classId = '';

const masks = (p: Page): Locator[] => [
  p.getByTestId('host-pin'),
  p.getByTestId('pin'),
  p.getByTestId('timer'),
  p.getByTestId('time-bar'),
  p.getByTestId('test-timer'),
  p.locator('img[alt*="QR"]'),
  p.getByText(/PIN \d{6}/),
  p.getByText(/\d{1,2}\. ?\d{1,2}\. ?\d{4}/),
];

async function shot(p: Page, name: string) {
  // settle: fonts, lazy chunks, entrance animations
  await p.evaluate(() => document.fonts.ready);
  await p.waitForLoadState('networkidle');
  await expect(p).toHaveScreenshot(`${name}.png`, { mask: masks(p), animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 });
}

async function context(browser: Browser, scheme: 'light' | 'dark', viewport: { width: number; height: number }, storageState?: string) {
  return browser.newContext({ colorScheme: scheme, reducedMotion: 'reduce', viewport, ...(storageState ? { storageState } : {}) });
}

test.beforeAll(async ({ browser }) => {
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto('/login');
  await p.getByRole('button', { name: /Zaregistrujte se/ }).click();
  await p.getByLabel('E-mail').fill('vizual@lore.example');
  await p.getByLabel('Heslo').fill('vizualni-heslo-123');
  await p.getByRole('button', { name: 'Vytvořit účet' }).click();
  await expect(p.getByRole('heading', { name: 'Moje kvízy' })).toBeVisible();
  const csrf = await p.evaluate(async () => (await (await fetch('/api/auth/me')).json()).csrfToken as string);
  token = (await (await p.request.post('/api/tokens', { headers: { 'x-csrf-token': csrf }, data: { name: 'vizual', scopes: ['quizzes:write', 'quizzes:read', 'games:write', 'games:read', 'classes:read'] } })).json()).token;
  quizId = (await (await p.request.post('/api/v1/quizzes', { headers: { authorization: `Bearer ${token}` }, data: quiz })).json()).quizId;
  // delete the sample quiz so the list is stable
  const list = (await (await p.request.get('/api/v1/quizzes', { headers: { authorization: `Bearer ${token}` } })).json()).quizzes as { id: string }[];
  for (const q of list) if (q.id !== quizId) await p.request.delete(`/api/v1/quizzes/${q.id}`, { headers: { authorization: `Bearer ${token}` } });
  classId = (await (await p.request.post('/api/v1/classes', { headers: { 'x-csrf-token': csrf }, data: { name: '8.A Fyzika' } })).json()).id;
  await p.request.post(`/api/v1/classes/${classId}/students`, { headers: { 'x-csrf-token': csrf }, data: { students: [{ accountName: 'novak12', rosterNo: 1 }, { accountName: 'mala4', rosterNo: 2 }] } });
  await c.storageState({ path: 'test-results/visual-teacher.json' });
  await c.close();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Lore brand sheet: logo variants and Lorík (${scheme})`, async ({ browser }) => {
    const c = await context(browser, scheme, { width: 1280, height: 900 });
    const p = await c.newPage();
    await p.goto('/_design');
    const sheet = p.getByTestId('brand-sheet');
    await expect(sheet).toBeVisible();
    await p.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = r))))));
    await expect(sheet).toHaveScreenshot(`znacka-${scheme}.png`, { animations: 'disabled', maxDiffPixelRatio: 0.002 });
    await c.close();
  });

  test(`teacher screens (${scheme})`, async ({ browser }) => {
    const c = await context(browser, scheme, { width: 1280, height: 720 }, 'test-results/visual-teacher.json');
    const p = await c.newPage();
    await p.goto('/quizzes');
    await expect(p.getByTestId('quiz-grid')).toBeVisible();
    await shot(p, `ucitel-kvizy-${scheme}`);
    await p.goto(`/quizzes/${quizId}`);
    await expect(p.getByTestId('question').first()).toBeVisible();
    await shot(p, `ucitel-kontrola-${scheme}`);
    await p.getByTestId('question').first().getByRole('button', { name: 'Upravit' }).click();
    await expect(p.getByTestId('student-preview')).toBeVisible();
    await shot(p, `ucitel-editor-${scheme}`);
    await p.goto(`/quizzes/${quizId}`);
    await p.getByTestId('quiz-look').click();
    await expect(p.getByTestId('theme-picker')).toBeVisible();
    await shot(p, `ucitel-vzhled-${scheme}`);
    await p.keyboard.press('Escape');
    await p.getByTestId('start-game').click();
    await expect(p.getByTestId('mode-live')).toBeVisible();
    await shot(p, `ucitel-spusteni-${scheme}`);
    await p.keyboard.press('Escape');
    await p.goto('/settings/look');
    await expect(p.getByTestId('default-look')).toBeVisible();
    await shot(p, `ucitel-nastaveni-vzhledu-${scheme}`);
    await p.goto(`/classes/${classId}`);
    await expect(p.getByTestId('matrix')).toBeVisible();
    await shot(p, `ucitel-trida-${scheme}`);
    await p.goto('/neexistuje');
    await expect(p.getByTestId('not-found')).toBeVisible();
    await shot(p, `stranka-404-${scheme}`);
    await c.close();
  });

  test(`live game: projector and phone (${scheme})`, async ({ browser }) => {
    const game = await (await (await browser.newContext()).request.post(`/api/v1/quizzes/${quizId}/games`, { headers: { authorization: `Bearer ${token}` }, data: { mode: 'live' } })).json();
    const hc = await context(browser, scheme, { width: 1280, height: 720 });
    const host = await hc.newPage();
    await host.goto(new URL(game.hostUrl).pathname + new URL(game.hostUrl).hash);
    await expect(host.getByTestId('host-pin')).toBeVisible();
    const pc = await context(browser, scheme, { width: 390, height: 844 });
    const phone = await pc.newPage();
    await phone.goto('/play');
    await expect(phone.getByLabel('PIN hry')).toBeVisible();
    await shot(phone, `zak-pin-${scheme}`);
    await phone.getByLabel('PIN hry').fill(game.pin);
    await phone.getByLabel('Přezdívka').fill('novak12');
    await phone.getByRole('button', { name: 'Připojit se' }).click();
    await expect(phone.getByTestId('player-lobby')).toBeVisible();
    await expect(host.getByTestId('host-players')).toContainText('novak12');
    await shot(phone, `zak-lobby-${scheme}`);
    await shot(host, `projektor-lobby-${scheme}`);
    await host.keyboard.press('Space');
    await expect(phone.getByTestId('player-prompt')).toBeVisible();
    await shot(phone, `zak-otazka-${scheme}`);
    await shot(host, `projektor-otazka-${scheme}`);
    await phone.getByTestId('option-0').click();
    await expect(phone.getByTestId('player-reveal')).toBeVisible();
    await expect(host.getByTestId('host-reveal-box')).toBeVisible();
    await shot(phone, `zak-vysledek-${scheme}`);
    await shot(host, `projektor-odhaleni-${scheme}`);
    await host.keyboard.press('Space');
    await expect(host.getByTestId('leaderboard')).toBeVisible();
    await shot(host, `projektor-poradi-${scheme}`);
    host.once('dialog', (d) => void d.accept());
    await host.getByRole('button', { name: 'Ukončit' }).click();
    await expect(host.getByTestId('podium')).toBeVisible();
    await shot(host, `projektor-podium-${scheme}`);
    await hc.close();
    await pc.close();
  });

  test(`test on a phone (${scheme})`, async ({ browser }) => {
    const game = await (
      await (await browser.newContext()).request.post(`/api/v1/quizzes/${quizId}/games`, {
        headers: { authorization: `Bearer ${token}` },
        data: { mode: 'test', settings: { theme: { motive: 'papir' }, test: { timeLimitMin: 20, showResultsToStudent: 'score' } } },
      })
    ).json();
    const c = await context(browser, scheme, { width: 390, height: 844 });
    const s = await c.newPage();
    await s.goto(`/test?pin=${game.pin}`);
    await s.getByTestId('test-name').fill('Žák Vizuál');
    await s.getByRole('button', { name: 'Pokračovat' }).click();
    await expect(s.getByTestId('test-intro')).toBeVisible();
    await shot(s, `test-uvod-${scheme}`);
    await s.getByTestId('test-start').click();
    await s.getByTestId('test-option-0').click();
    await expect(s.getByTestId('test-save-state')).toHaveText(/Uloženo/);
    await shot(s, `test-otazka-${scheme}`);
    await s.getByTestId('test-next').click();
    await s.getByTestId('test-option-0').click();
    await s.getByTestId('test-submit').click();
    await s.getByTestId('test-confirm-submit').click();
    await expect(s.getByTestId('test-done')).toBeVisible();
    await shot(s, `test-odevzdano-${scheme}`);
    await c.close();
  });
}
