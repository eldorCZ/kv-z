import { expect, test, type Page } from '@playwright/test';
import { registerAndToken } from './helpers';

/** Quiz gallery, Dodatek 5: stats, Radix Select filters, AlertDialog, entrance effects and reduced motion. */
const quiz = (title: string, tags: string[]) => ({
  schemaVersion: 1,
  title,
  tags,
  questions: [{ type: 'single', prompt: 'Kolik je 1 + 1?', options: ['2', '3', '4'], correctIndices: [0] }],
});

test.describe.configure({ mode: 'serial' });
let token = '';
let teacher: Page;

test.beforeAll(async ({ browser }) => {
  teacher = await (await browser.newContext()).newPage();
  token = await registerAndToken(teacher);
  const auth = { authorization: `Bearer ${token}` };
  await teacher.request.post('/api/v1/quizzes', { headers: auth, data: quiz('Optika', ['Fyzika']) });
  const { quizId } = await (await teacher.request.post('/api/v1/quizzes', { headers: auth, data: quiz('Vyjmenovaná slova', ['Čeština']) })).json();
  // a finished test with 100 % so the gallery has a success rate
  const g = await (await teacher.request.post(`/api/v1/quizzes/${quizId}/games`, { headers: auth, data: { mode: 'test', settings: { test: { timeLimitMin: 10 } } } })).json();
  const s = await (await teacher.request.post('/play/test/join', { data: { pin: g.pin, name: 'Žák' } })).json();
  const view = await (await teacher.request.post('/play/test/start', { headers: { 'x-player-token': s.playerToken } })).json();
  const q = view.questions[0];
  await teacher.request.put(`/play/test/answers/${q.id}`, { headers: { 'x-player-token': s.playerToken }, data: { payload: { indices: [q.options.indexOf('2')] } } });
  await teacher.request.post('/play/test/submit', { headers: { 'x-player-token': s.playerToken } });
  await teacher.request.post(`/api/v1/games/${g.gameId}/end`, { headers: auth });
});
test.afterAll(async () => teacher.context().close());

test('stats, success bar and the subject filter with the keyboard (points 4, 5, 8)', async () => {
  await teacher.goto('/quizzes');
  await expect(teacher.getByTestId('quiz-grid')).toBeVisible();
  // 3 quizzes: the sample quiz and the two above
  await expect(teacher.getByTestId('stat-total').getByTestId('number-ticker')).toHaveAttribute('data-value', '3');
  await expect(teacher.getByTestId('stat-success')).toContainText('100 %');
  const card = teacher.getByTestId('quiz-grid').locator('li').filter({ hasText: 'Vyjmenovaná slova' });
  await expect(card.getByRole('progressbar', { name: /Úspěšnost kvízu Vyjmenovaná slova/ })).toHaveAttribute('aria-valuenow', '100');
  await expect(card.getByRole('progressbar')).toHaveAttribute('data-tone', 'success');
  await expect(card.getByTestId('number-ticker')).toHaveText(/100 %/);

  // Select: label via aria, arrows + Enter choose, Esc closes without change
  const trigger = teacher.getByTestId('filter-subject');
  await expect(teacher.getByRole('combobox', { name: /Předmět/ })).toBeVisible();
  await trigger.focus();
  await teacher.keyboard.press('Enter');
  await expect(teacher.getByRole('listbox')).toBeVisible();
  await teacher.keyboard.press('Escape');
  await expect(teacher.getByRole('listbox')).toBeHidden();
  await expect(trigger).toBeFocused();
  await teacher.keyboard.press('ArrowDown');
  await expect(teacher.getByRole('listbox')).toBeVisible();
  // options: Vše, Čeština, Fyzika – the arrows move the highlight, End jumps to Fyzika
  await teacher.keyboard.press('ArrowDown');
  await expect(teacher.getByRole('option', { name: 'Čeština' })).toBeFocused();
  await teacher.keyboard.press('End');
  await expect(teacher.getByRole('option', { name: 'Fyzika' })).toBeFocused();
  await teacher.keyboard.press('Enter');
  await expect(trigger).toContainText('Fyzika');
  await expect(teacher.getByTestId('quiz-grid').locator('li')).toHaveCount(1);
  await expect(teacher.getByTestId('quiz-grid')).toContainText('Optika');
  await expect(teacher.getByTestId('stat-total').getByTestId('number-ticker')).toHaveAttribute('data-value', '1');
});

test('AlertDialog replaces window.confirm: Esc closes, Tab stays inside, focus returns (point 3)', async () => {
  await teacher.goto('/quizzes');
  let nativeConfirm = false;
  teacher.on('dialog', (d) => {
    nativeConfirm = true;
    void d.dismiss();
  });
  const card = teacher.getByTestId('quiz-grid').locator('li').filter({ has: teacher.getByRole('link', { name: 'Optika', exact: true }) });
  const menu = card.getByRole('button', { name: 'Akce pro kvíz Optika', exact: true });
  await menu.click();
  await teacher.getByTestId('quiz-delete').click();
  const dialog = teacher.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Opravdu smazat kvíz „Optika“');
  // focus starts on Cancel and Tab cycles inside the dialog
  await expect(dialog.getByRole('button', { name: 'Zrušit' })).toBeFocused();
  for (let i = 0; i < 4; i++) {
    await teacher.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await teacher.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();
  await expect(card).toBeVisible();
  // confirm deletes
  await menu.click();
  await teacher.getByTestId('quiz-delete').click();
  await teacher.getByTestId('alert-confirm').click();
  await expect(card).toHaveCount(0);
  expect(nativeConfirm).toBe(false);
});

test('reduced motion: no entrance and the final numbers at once (point 6)', async ({ browser }) => {
  for (const reducedMotion of ['reduce', 'no-preference'] as const) {
    const ctx = await browser.newContext({ reducedMotion, storageState: await teacher.context().storageState() });
    const p = await ctx.newPage();
    await p.goto('/quizzes');
    await expect(p.getByTestId('quiz-grid')).toBeVisible();
    const first = await p.getByTestId('quiz-grid').locator('li > div').first().evaluate((el) => ({ opacity: getComputedStyle(el).opacity, filter: getComputedStyle(el).filter }));
    const ticker = await p.getByTestId('stat-total').getByTestId('number-ticker').locator('[aria-hidden="true"]').textContent();
    if (reducedMotion === 'reduce') {
      // the final state straight away: fully opaque, no blur (framer writes it as blur(0px))
      expect(first.opacity).toBe('1');
      expect(['none', 'blur(0px)']).toContain(first.filter);
      expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
      expect(ticker).toBe('2');
      expect(await p.getByTestId('card-glow').count()).toBe(0);
    } else {
      // the entrance starts hidden and blurred, then settles
      await expect.poll(() => p.getByTestId('quiz-grid').locator('li > div').first().evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      await expect(p.getByTestId('stat-total').getByTestId('number-ticker').locator('[aria-hidden="true"]')).toHaveText('2');
      await expect(p.getByTestId('card-glow')).toHaveCount(1);
    }
    await ctx.close();
  }
});
