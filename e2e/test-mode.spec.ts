import { expect, test } from '@playwright/test';
import { registerAndToken } from './helpers';

const quiz = {
  schemaVersion: 1,
  title: 'E2E test: zeměpis',
  settings: { shuffleQuestions: false, shuffleOptions: false },
  questions: [
    { type: 'single', prompt: 'Hlavní město Česka?', options: ['Praha', 'Brno', 'Ostrava'], correctIndices: [0], explanation: 'TAJNE_VYSVETLENI' },
    { type: 'short', prompt: 'Hlavní město Rakouska?', acceptedAnswers: ['Vídeň'] },
    { type: 'truefalse', prompt: 'Dunaj teče Bratislavou.', correctIndices: [0] },
  ],
};

test('test mode: teacher starts a test, two students submit, dashboard and results', async ({ page, browser, request }) => {
  const token = await registerAndToken(page);
  const res = await request.post('/api/v1/quizzes', { headers: { authorization: `Bearer ${token}` }, data: quiz });
  const { reviewUrl } = await res.json();
  await page.goto(new URL(reviewUrl).pathname);
  await page.getByTestId('start-game').click();
  await page.getByTestId('mode-test').check({ force: true });
  // headless prohlížeč celou obrazovku nedá, jinak by dialog blokoval psaní
  await page.getByTestId('guard-fullscreen').uncheck();
  await page.getByTestId('test-limit').fill('15');
  await page.getByTestId('confirm-start').click();
  const pin = (await page.getByTestId('pin').textContent())!.replace(/\s/g, '');
  await page.getByTestId('open-dashboard').click();
  await expect(page.getByTestId('dash-pin')).toHaveText(pin);

  // ---------- student 1: all correct, reloads in the middle ----------
  const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const s1 = await ctx1.newPage();
  const frames: string[] = [];
  s1.on('response', async (r) => {
    if (r.url().includes('/play/test/') && r.request().method() !== 'OPTIONS') frames.push(await r.text().catch(() => ''));
  });
  await s1.goto(`/play?pin=${pin}`);
  await expect(s1).toHaveURL(/\/test\?pin=/);
  await s1.getByTestId('test-name').fill('Jana Nováková');
  await s1.getByRole('button', { name: 'Pokračovat' }).click();
  await expect(s1.getByTestId('test-intro')).toContainText('15 minut');
  await s1.getByTestId('test-start').click();
  await expect(s1.getByTestId('test-prompt')).toHaveText('Hlavní město Česka?');
  await s1.getByTestId('test-option-0').click();
  await expect(s1.getByTestId('test-save-state')).toHaveText('✓ Uloženo');
  await s1.getByTestId('test-next').click();
  await s1.getByTestId('test-text-answer').fill('Viden');
  await expect(s1.getByTestId('test-save-state')).toHaveText('✓ Uloženo');
  await s1.reload();
  await expect(s1.getByTestId('test-prompt')).toBeVisible();
  await s1.getByRole('button', { name: 'Otázka 3' }).click();
  await s1.getByTestId('test-option-0').click();
  await expect(s1.getByTestId('test-save-state')).toHaveText('✓ Uloženo');
  await s1.getByTestId('test-submit').click();
  await expect(s1.getByText('Všechny otázky jsou zodpovězené.')).toBeVisible();
  await s1.getByTestId('test-confirm-submit').click();
  await expect(s1.getByTestId('test-percent')).toHaveText('100 %');

  // ---------- student 2: joins via the PIN form, answers one wrong ----------
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const s2 = await ctx2.newPage();
  await s2.goto('/play');
  await s2.getByLabel('PIN hry').fill(pin);
  await s2.getByLabel('Přezdívka').fill('Petr Svoboda');
  await s2.getByRole('button', { name: 'Připojit se' }).click();
  await expect(s2).toHaveURL(/\/test\?pin=/);
  await s2.getByRole('button', { name: 'Pokračovat' }).click();
  await s2.getByTestId('test-start').click();
  await s2.getByTestId('test-option-1').click();
  await expect(s2.getByTestId('test-save-state')).toHaveText('✓ Uloženo');

  // dashboard shows both students
  await expect(page.getByTestId('dash-row')).toHaveCount(2);
  await expect(page.getByTestId('dash-table')).toContainText('Jana Nováková');
  await expect(page.getByTestId('dash-table')).toContainText('100 %');
  await expect(page.getByTestId('dash-table')).toContainText('píše');

  // the teacher ends the test -> student 2 is submitted
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('dash-end').click();
  await expect(page.getByText('Ukončeno')).toBeVisible();
  await s2.reload();
  await expect(s2.getByTestId('test-done')).toContainText('0 %');

  // key and explanation never reached the student before submitting (showResults = score)
  for (const f of frames) {
    expect(f).not.toContain('correctIndices');
    expect(f).not.toContain('acceptedAnswers');
    expect(f).not.toContain('TAJNE_VYSVETLENI');
  }

  await page.getByRole('link', { name: 'Výsledky', exact: true }).click();
  await expect(page.getByTestId('test-summary')).toContainText('Odevzdalo 2 z 2 žáků · průměr 50 %');
});
