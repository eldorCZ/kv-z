import { expect, test, type Page } from '@playwright/test';
import { submitAuth } from './helpers';

const quiz = {
  schemaVersion: 1,
  title: 'E2E: Hlavní města',
  gradeLevel: '6. ročník',
  settings: { shuffleQuestions: false, shuffleOptions: true },
  questions: [
    {
      type: 'single',
      prompt: 'Jaké je hlavní město Česka?',
      options: ['Praha', 'Brno', 'Ostrava', 'Plzeň'],
      correctIndices: [0],
      explanation: 'Praha je hlavní město České republiky.',
      timeLimitSec: 30,
      sourceRef: { file: 'zemepis.pdf', locator: 'str. 2', quote: 'Hlavním městem je Praha.' },
    },
    {
      type: 'truefalse',
      prompt: 'Bratislava je hlavní město Slovenska.',
      correctIndices: [0],
      timeLimitSec: 20,
      qa: { status: 'flagged', notes: 'Slepé řešení si nebylo jisté.' },
    },
    {
      type: 'short',
      prompt: 'Jak se jmenuje hlavní město Rakouska?',
      acceptedAnswers: ['Vídeň', 'Wien'],
      explanation: 'SECRET_EXPLANATION_Q3',
      timeLimitSec: 30,
    },
    {
      type: 'single',
      prompt: 'Neschválená otázka',
      options: ['X1', 'X2', 'X3'],
      correctIndices: [2],
      qa: { status: 'flagged', notes: 'Citace nenalezena ve zdroji.' },
    },
  ],
};

const SECRET_KEYS = ['correctIndices', 'acceptedAnswers', 'numericAnswer', 'numericTolerance', 'explanation', 'sourceRef'];

async function joinAs(page: Page, pin: string, nickname: string, frames: string[]) {
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
  await page.goto(`/play?pin=${pin}`);
  await page.getByLabel('Přezdívka').fill(nickname);
  await page.getByRole('button', { name: 'Připojit se' }).click();
  await expect(page.getByTestId('player-lobby')).toBeVisible();
}

test('teacher flow + live game with 3 players', async ({ page, browser, request }) => {
  // ---------- teacher registers ----------
  await page.goto('/');
  await page.getByRole('button', { name: /Zaregistrujte se/ }).click();
  await page.getByLabel('E-mail').fill(`ucitel${Date.now()}@skola.cz`);
  await page.getByLabel('Heslo').fill('bezpecne-heslo-123');
  await submitAuth(page, 'Vytvořit účet');

  // ---------- creates an API token ----------
  await page.getByRole('link', { name: 'API tokeny' }).click();
  await page.getByRole('button', { name: 'Vytvořit token' }).click();
  const token = await page.getByTestId('new-token').inputValue();
  expect(token).toMatch(/^khp_/);

  // ---------- the agent posts a quiz through the API ----------
  const res = await request.post('/api/v1/quizzes', { headers: { authorization: `Bearer ${token}` }, data: quiz });
  expect(res.status()).toBe(201);
  const { reviewUrl, stats } = await res.json();
  expect(stats).toEqual({ total: 4, ok: 2, flagged: 2 });

  // ---------- teacher reviews: approves the flagged true/false question, edits another ----------
  await page.goto(new URL(reviewUrl).pathname);
  await expect(page.getByTestId('question')).toHaveCount(4);
  const tf = page.getByTestId('question').filter({ hasText: 'Bratislava' });
  await expect(tf.getByText('ke kontrole')).toBeVisible();
  await tf.getByText('Zdroj a vysvětlení').count();
  await tf.getByRole('button', { name: /Schválit/ }).click();
  await expect(tf.getByText('schváleno')).toBeVisible();

  const q1 = page.getByTestId('question').first();
  await q1.getByText('Zdroj a vysvětlení').click();
  await expect(q1.getByText('„Hlavním městem je Praha.“')).toBeVisible();
  await q1.getByRole('button', { name: 'Upravit' }).click();
  await q1.getByLabel('Text otázky').fill('Které město je hlavním městem Česka?');
  await expect(q1.getByTestId('save-state')).toHaveText('✓ Uloženo', { timeout: 5000 });
  await q1.getByRole('button', { name: 'Hotovo' }).click();
  await page.reload();
  await expect(page.getByText('Které město je hlavním městem Česka?')).toBeVisible();

  // ---------- starts a game ----------
  await page.getByTestId('start-game').click();
  await page.getByTestId('confirm-start').click();
  // živá hra se otevře rovnou do lobby v témže okně, žádný mezikrok s PINem
  const host = page;
  await expect(host.getByTestId('host-pin')).toBeVisible();
  const pin = (await host.getByTestId('host-pin').textContent())!.replace(/\s/g, '');
  expect(pin).toMatch(/^\d{6}$/);
  // host key is removed from the address bar (projector)
  expect(host.url()).not.toContain('key=');

  // ---------- 3 players join ----------
  const frames: Record<string, string[]> = { Adam: [], Běta: [], Cecil: [] };
  const players: Record<string, Page> = {};
  for (const nick of Object.keys(frames)) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    players[nick] = await ctx.newPage();
    await joinAs(players[nick], pin, nick, frames[nick]!);
  }
  await expect(host.getByText('3 hráči')).toBeVisible();

  // ---------- question 1 ----------
  await host.keyboard.press('Space');
  for (const p of Object.values(players)) await expect(p.getByTestId('player-prompt')).toHaveText('Které město je hlavním městem Česka?');
  await expect(host.getByTestId('host-prompt')).toBeVisible();
  await players.Adam!.getByRole('button', { name: /Praha/ }).click();
  await players.Běta!.getByRole('button', { name: /Brno/ }).click();
  await players.Cecil!.waitForTimeout(400);
  await players.Cecil!.getByRole('button', { name: /Praha/ }).click();
  await expect(players.Adam!.getByTestId('player-reveal')).toContainText('Správně!');
  await expect(players.Běta!.getByTestId('player-reveal')).toContainText('Špatně');
  await expect(host.getByTestId('host-reveal-box')).toContainText('Správně odpovědělo 2 z 3');

  // leaderboard, then question 2 (approved true/false)
  await host.keyboard.press('Space');
  await expect(host.getByText('Průběžné pořadí')).toBeVisible();
  await host.keyboard.press('Space');
  await expect(players.Adam!.getByTestId('player-prompt')).toHaveText('Bratislava je hlavní město Slovenska.');
  // Běta's Wi-Fi drops: reload keeps the sessionStorage token -> reconnect with score
  await players.Běta!.reload();
  await expect(players.Běta!.getByTestId('player-prompt')).toHaveText('Bratislava je hlavní město Slovenska.');
  for (const p of Object.values(players)) await p.getByRole('button', { name: /Pravda/ }).click();
  await expect(players.Běta!.getByTestId('player-reveal')).toContainText('Správně!');

  // question 3 (short), Enter reveals early
  await host.keyboard.press('Space');
  await host.keyboard.press('Space');
  await expect(players.Adam!.getByTestId('player-prompt')).toHaveText('Jak se jmenuje hlavní město Rakouska?');
  await players.Adam!.getByTestId('text-answer').fill('Viden');
  await players.Adam!.getByTestId('submit-answer').click();
  await players.Cecil!.getByTestId('text-answer').fill('Vídeň');
  await players.Cecil!.getByTestId('submit-answer').click();
  await expect(players.Adam!.getByTestId('player-answered')).toBeVisible();
  await host.keyboard.press('Enter');
  await expect(players.Adam!.getByTestId('player-reveal')).toContainText('Správně!');
  await expect(players.Běta!.getByTestId('player-reveal')).toContainText('Bez odpovědi');

  // podium – the flagged, unapproved question was skipped (3 questions only)
  await host.keyboard.press('Space');
  await expect(host.getByTestId('podium')).toBeVisible();
  await expect(players.Adam!.getByTestId('player-over')).toContainText('1.');
  const podium = await host.getByTestId('podium').textContent();
  expect(podium!.indexOf('Adam')).toBeGreaterThanOrEqual(0);

  // ---------- no correct answer reached a client before the reveal ----------
  for (const [nick, list] of Object.entries(frames)) {
    const revealed = new Set<string>();
    let sawQuestion = 0;
    for (const f of list) {
      const m = /^42(\[.*\])$/s.exec(f);
      if (!m) continue;
      const [ev, data] = JSON.parse(m[1]!) as [string, Record<string, unknown>];
      const body = JSON.stringify(data);
      if (ev === 'question') {
        sawQuestion++;
        for (const k of SECRET_KEYS) expect(body, `${nick}: question leaks ${k}`).not.toContain(`"${k}"`);
      }
      if (ev === 'reveal') revealed.add(String(data.questionId));
      if (!revealed.size || ev === 'question') {
        expect(body).not.toContain('Praha je hlavní město České republiky.');
      }
      if (revealed.size < 3) expect(body, `${nick}: ${ev}`).not.toContain('SECRET_EXPLANATION_Q3');
      expect(body).not.toContain('Neschválená otázka');
    }
    expect(sawQuestion).toBeGreaterThanOrEqual(3);
  }

  // ---------- results ----------
  await host.getByRole('link', { name: 'Zobrazit výsledky' }).click();
  await expect(host.getByRole('heading', { name: 'Výsledky hry' })).toBeVisible();
  const rows = host.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('Adam');
});
