import { expect, test, type Browser, type Page } from '@playwright/test';
import { registerAndToken } from './helpers';

const quiz = {
  schemaVersion: 1,
  title: 'E2E třída: optika',
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'Co je lom světla?', options: ['změna směru', 'odraz', 'pohlcení'], correctIndices: [0], topic: 'Lom světla' },
    { type: 'single', prompt: 'Zrcadlo světlo…', options: ['odráží', 'láme', 'pohlcuje'], correctIndices: [0], topic: 'Zrcadla' },
  ],
};
const STUDENTS = ['adamek1', 'bila2', 'cibulka3', 'dvorak4', 'erbenova5'];

async function student(browser: Browser, pin: string, code: string, answers: number[], opts: { wrongFirst?: boolean; self?: string } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // phone
  const p = await ctx.newPage();
  await p.goto(`/play?pin=${pin}`);
  await expect(p).toHaveURL(/\/test\?pin=/);
  if (opts.wrongFirst) {
    await p.getByTestId('roster-code').fill('AAAA-BBBB');
    await p.getByTestId('roster-continue').click();
    await expect(p.getByText('Tento kód nepatří žádnému žákovi v této hře.', { exact: false })).toBeVisible();
    await p.getByTestId('roster-code').fill('');
  }
  await p.getByTestId('roster-code').fill(code.toLowerCase().replace('-', ' '));
  await p.getByTestId('roster-continue').click();
  await expect(p.getByTestId('roster-confirm')).toBeVisible();
  await p.getByTestId('roster-yes').click();
  await p.getByTestId('test-start').click();
  for (const [i, a] of answers.entries()) {
    await expect(p.getByTestId('test-prompt')).toHaveText(quiz.questions[i]!.prompt);
    await p.getByTestId(`test-option-${a}`).click();
    await expect(p.getByTestId('test-save-state')).toHaveText('✓ Uloženo');
    if (i < answers.length - 1) await p.getByTestId('test-next').click();
  }
  await p.getByTestId('test-submit').click();
  await p.getByTestId('test-confirm-submit').click();
  const percent = await p.getByTestId('test-percent').textContent();
  // in a test the student sees nobody else
  const html = await p.content();
  for (const other of STUDENTS.filter((x) => x !== opts.self)) expect(html).not.toContain(other);
  await ctx.close();
  return percent;
}

async function startFromReview(page: Page, reviewPath: string, className: string, mode: 'test' | 'live') {
  await page.goto(reviewPath);
  await page.getByTestId('start-game').click();
  if (mode === 'test') {
    await page.getByTestId('mode-test').check({ force: true });
    await page.getByTestId('guard-mode').selectOption('off');
  }
  await page.getByTestId('game-class').selectOption({ label: className });
  await page.getByTestId('confirm-start').click();
  return (await page.getByTestId('pin').textContent())!.replace(/\s/g, '');
}

test('classes: roster, class test with codes, makeup, matrix, live class game', async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const token = await registerAndToken(page);

  // ---------- roster: 5 students, codes shown once ----------
  await page.getByRole('link', { name: 'Třídy' }).click();
  await page.getByTestId('new-class').click();
  await page.getByTestId('class-name').fill('8.B Fyzika');
  await page.getByTestId('create-class').click();
  await page.getByTestId('roster-text').fill(STUDENTS.map((a, i) => `${i + 1} ${a}`).join('\n'));
  await page.getByTestId('roster-preview').click();
  await page.getByTestId('roster-commit').click();
  await expect(page.getByTestId('plain-code')).toHaveCount(5);
  const codes: Record<string, string> = {};
  for (const li of await page.getByTestId('codes-panel').locator('li').all()) {
    const code = (await li.getByTestId('plain-code').textContent())!.trim();
    codes[(await li.locator('span').first().textContent())!.trim()] = code;
  }
  expect(Object.keys(codes).sort()).toEqual(STUDENTS);
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('print-cards').click();
  page.once('dialog', (d) => d.accept()); // beforeunload
  await page.reload();
  await page.getByTestId('tab-roster').click();
  await expect(page.getByTestId('roster-table').locator('tbody tr')).toHaveCount(5);
  await expect(page.getByTestId('plain-code')).toHaveCount(0);
  expect(await page.content()).not.toContain(codes.adamek1!);

  // ---------- class test: 3 students log in by code (one wrong first), 2 are missing ----------
  const created = await (await request.post('/api/v1/quizzes', { headers: { authorization: `Bearer ${token}` }, data: quiz })).json();
  const reviewPath = new URL(created.reviewUrl).pathname;
  const pin = await startFromReview(page, reviewPath, '8.B Fyzika', 'test');
  await page.getByTestId('open-dashboard').click();
  await expect(page.getByTestId('dash-not-joined')).toContainText('adamek1');

  expect(await student(browser, pin, codes.adamek1!, [0, 0], { wrongFirst: true, self: 'adamek1' })).toBe('100 %');
  expect(await student(browser, pin, codes.bila2!, [0, 1], { self: 'bila2' })).toBe('50 %');
  expect(await student(browser, pin, codes.cibulka3!, [1, 1], { self: 'cibulka3' })).toBe('0 %');

  // dashboard: account names
  await expect(page.getByTestId('dash-row')).toHaveCount(3);
  await expect(page.getByTestId('dash-table')).toContainText('adamek1');
  await expect(page.getByTestId('dash-not-joined')).toContainText('dvorak4');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('dash-end').click();
  await expect(page.getByText('Ukončeno')).toBeVisible();

  // ---------- makeup for the 2 missing, Dan writes it ----------
  await page.getByRole('link', { name: 'Třídy' }).click();
  await page.getByText('8.B Fyzika').first().click();
  await page.getByTestId('tab-activities').click();
  await expect(page.getByTestId('activity')).toContainText('chybí 2 žáci');
  await page.getByTestId('makeup').click();
  await expect(page.getByTestId('makeup-info')).toContainText('2 žáků');
  const makeupPin = (await page.getByTestId('makeup-info').locator('strong').textContent())!.replace(/\s/g, '');
  expect(await student(browser, makeupPin, codes.dvorak4!, [0, 0], { self: 'dvorak4' })).toBe('100 %');

  // ---------- matrix ----------
  await page.getByTestId('tab-students').click();
  const rows = page.getByTestId('matrix-row');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('100');
  await expect(rows.nth(1)).toContainText('50');
  await expect(rows.nth(2).locator('[data-cell="result"]')).toHaveText('0');
  await expect(rows.nth(3).locator('[data-cell="result"]')).toContainText('100d');
  await expect(rows.nth(4).locator('[data-cell="missing"]')).toHaveText('chybí');
  await expect(rows.nth(0)).toContainText('adamek1');
  // one click hides the names (projector): "Žák <číslo>"
  await page.getByTestId('hide-names').check();
  await expect(rows.nth(0)).toContainText('Žák 1');
  await expect(page.getByTestId('matrix')).not.toContainText('adamek1');
  await page.getByTestId('hide-names').uncheck();

  // ---------- live class game: the projector shows account names only, never codes ----------
  const livePin = await startFromReview(page, reviewPath, '8.B Fyzika', 'live');
  const hostUrl = await page.getByTestId('open-host').getAttribute('href');
  const projector = await browser.newPage();
  await projector.goto(hostUrl!);
  await expect(projector.getByTestId('host-pin')).toHaveText(new RegExp(livePin.slice(0, 3)));
  await expect(projector.getByTestId('host-not-joined')).toContainText('erbenova5');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sp = await phone.newPage();
  await sp.goto(`/play?pin=${livePin}`);
  await sp.getByTestId('roster-code').fill(codes.erbenova5!);
  await sp.getByTestId('roster-continue').click();
  await expect(sp.getByTestId('roster-confirm')).toContainText('erbenova5');
  await sp.getByTestId('roster-yes').click();
  await expect(sp.getByTestId('player-lobby')).toBeVisible();
  await expect(projector.locator('body')).toContainText('erbenova5');
  const projHtml = await projector.content();
  for (const c of Object.values(codes)) expect(projHtml).not.toContain(c);
  await phone.close();
  await projector.close();
});
