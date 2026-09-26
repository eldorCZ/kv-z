/**
 * pnpm check:lighthouse – Lighthouse (mobile, simulated slow 4G) on the student entry screens (Dodatek 4, V11.2):
 * the PIN screen and the student lobby after joining. Goals: performance ≥ 85, accessibility ≥ 95, CLS < 0.05.
 * Needs `pnpm build`. Runs a throw-away server with a live game; exit code 1 when a goal is missed.
 */
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { navigation } from 'lighthouse';
import { buildApp } from '../apps/server/src/app.js';
import { loadConfig } from '../apps/server/src/config.js';

// puppeteer-core comes with lighthouse; no extra dependency
const require = createRequire(createRequire(import.meta.url).resolve('lighthouse'));
type Page = NonNullable<Parameters<typeof navigation>[0]>;
const puppeteer = require('puppeteer-core') as { launch: (o: object) => Promise<{ newPage: () => Promise<Page>; close: () => Promise<void> }> };

// the Chromium Playwright already installed (CI: playwright install chromium)
const CHROME = process.env.CHROME_PATH ?? chromium.executablePath();
export const GOALS = { performance: 0.85, accessibility: 0.95, cls: 0.05 };

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'lore-lh-'));
  const cfg = loadConfig({} as NodeJS.ProcessEnv, { dbPath: join(dir, 'lh.db'), logLevel: 'warn', joinRateLimit: 1000, apiRateLimit: 10_000, seedSampleQuiz: true, codePepper: 'lh-pepper-0123456789abcdef0123456789abcdef' });
  const { app, services } = await buildApp(cfg);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  services.cfg.publicUrl = url;
  const t = services.accounts.createTeacher('lighthouse@lore.example', null);
  const { seedSampleQuiz } = await import('../apps/server/src/seed.js');
  seedSampleQuiz(services.quizzes, t.id);
  const quiz = services.quizzes.get(services.quizzes.list(t.id)[0]!.id)!;
  const game = services.gameService.create(quiz, { mode: 'live', settings: { showLeaderboard: true, streakBonus: false, partialMulti: false, allowLateJoin: false, ignoreDiacritics: true, allowGuests: false, countInStats: true } });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const results: { name: string; performance: number; accessibility: number; cls: number; lcp: number; tbt: number }[] = [];
  const run = async (name: string, target: string, prepare?: (page: Page) => Promise<void>) => {
    const page = await browser.newPage();
    if (prepare) await prepare(page);
    const r = await navigation(page, target, { flags: { onlyCategories: ['performance', 'accessibility'], disableStorageReset: !!prepare } });
    const lhr = r!.lhr;
    results.push({
      name,
      performance: lhr.categories.performance!.score ?? 0,
      accessibility: lhr.categories.accessibility!.score ?? 0,
      cls: Number(lhr.audits['cumulative-layout-shift']!.numericValue ?? 0),
      lcp: Number(lhr.audits['largest-contentful-paint']!.numericValue ?? 0),
      tbt: Number(lhr.audits['total-blocking-time']!.numericValue ?? 0),
    });
    await page.close();
  };

  await run('Zadání PINu (/play)', `${url}/play`);
  // the lobby: join first, then measure a reload of /play in the same tab (the game token stays in sessionStorage)
  await run('Lobby žáka', `${url}/play`, async (page) => {
    await page.goto(`${url}/play?pin=${game.pin}`);
    await page.waitForSelector('input[aria-label="Přezdívka"]');
    await page.type('input[aria-label="Přezdívka"]', 'novak12');
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="player-lobby"]');
  });
  await browser.close();
  await app.close();

  let bad = 0;
  for (const r of results) {
    const ok = r.performance >= GOALS.performance && r.accessibility >= GOALS.accessibility && r.cls < GOALS.cls;
    if (!ok) bad++;
    console.log(
      `${ok ? '✓' : '✗'} ${r.name}: výkon ${Math.round(r.performance * 100)}, přístupnost ${Math.round(r.accessibility * 100)}, CLS ${r.cls.toFixed(3)}, LCP ${(r.lcp / 1000).toFixed(1)} s, TBT ${Math.round(r.tbt)} ms`,
    );
  }
  if (bad) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
