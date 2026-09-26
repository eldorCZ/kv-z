/**
 * pnpm docs:screens – reader screenshots of key screens in light and dark mode into docs/screens
 * (Dodatek 4, V12). Needs a built web app (pnpm build). Starts a throw-away server with the sample quiz
 * and the demo class (pseudonyms), never touches a real database.
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../apps/server/src/app.js';
import { loadConfig } from '../apps/server/src/config.js';
import { createDemoClass } from './demo-class.js';

const OUT = join(import.meta.dirname, '../docs/screens');
const EMAIL = 'ucitel@jiskra.example';
const PASSWORD = 'ukazka-heslo-1234';

export interface Shot {
  name: string;
  viewport?: { width: number; height: number };
  /** navigate and prepare the screen; the screenshot is taken afterwards */
  go: (page: Page, ctx: ScreenCtx) => Promise<void>;
  fullPage?: boolean;
}

export interface ScreenCtx {
  url: string;
  quizId: string;
  classId: string;
  studentId: string;
}

const teacherShots: Shot[] = [
  { name: 'ucitel-kvizy', go: async (p, c) => void (await p.goto(`${c.url}/quizzes`), await p.getByTestId('quiz-grid').waitFor()) },
  { name: 'ucitel-kontrola-kvizu', go: async (p, c) => void (await p.goto(`${c.url}/quizzes/${c.quizId}`), await p.getByTestId('question').first().waitFor()) },
  {
    name: 'ucitel-editor-nahled',
    go: async (p, c) => {
      await p.goto(`${c.url}/quizzes/${c.quizId}`);
      await p.getByTestId('question').first().getByRole('button', { name: 'Upravit' }).click();
      await p.getByTestId('student-preview').waitFor();
    },
  },
  {
    name: 'ucitel-spusteni-hry',
    go: async (p, c) => {
      await p.goto(`${c.url}/quizzes/${c.quizId}`);
      await p.getByTestId('start-game').click();
      await p.getByTestId('mode-live').waitFor();
    },
  },
  { name: 'ucitel-trida-matice', go: async (p, c) => void (await p.goto(`${c.url}/classes/${c.classId}`), await p.getByTestId('matrix').waitFor()) },
  { name: 'ucitel-trida-temata', go: async (p, c) => void (await p.goto(`${c.url}/classes/${c.classId}?tab=topics`), await p.getByTestId('topics').waitFor()) },
  { name: 'ucitel-profil-zaka', go: async (p, c) => void (await p.goto(`${c.url}/classes/${c.classId}/students/${c.studentId}`), await p.getByTestId('profile-name').waitFor()) },
  { name: 'ucitel-api-tokeny', go: async (p, c) => void (await p.goto(`${c.url}/settings/tokens`), await p.getByRole('heading', { name: 'API tokeny' }).waitFor()) },
];

const studentShots: Shot[] = [{ name: 'zak-zadani-pinu', viewport: { width: 390, height: 844 }, go: async (p, c) => void (await p.goto(`${c.url}/play`), await p.getByLabel('PIN hry').waitFor()) }];

export const SHOTS = { teacherShots, studentShots };

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'jiskra-screens-'));
  const cfg = loadConfig({} as NodeJS.ProcessEnv, {
    dbPath: join(dir, 'screens.db'),
    logLevel: 'warn',
    apiRateLimit: 100_000,
    joinRateLimit: 100_000,
    seedSampleQuiz: true,
    codePepper: 'screens-pepper-0123456789abcdef0123456789abcdef',
  });
  const { app, services } = await buildApp(cfg);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  services.cfg.publicUrl = url;
  await fetch(`${url}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const teacher = services.accounts.findTeacherByEmail(EMAIL)!;
  const { cls, created } = createDemoClass(services, teacher.id);
  const quizId = services.quizzes.list(teacher.id)[0]!.id;
  const ctx: ScreenCtx = { url, quizId, classId: cls.id, studentId: created[3]!.student.id };

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${url}/login`);
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByLabel('Heslo').fill(PASSWORD);
    await page.getByRole('button', { name: 'Přihlásit se' }).click();
    await page.getByRole('heading', { name: 'Moje kvízy' }).waitFor();
    for (const shot of [...teacherShots, ...studentShots]) {
      await page.setViewportSize(shot.viewport ?? { width: 1280, height: 800 });
      await shot.go(page, ctx);
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(OUT, `${shot.name}-${scheme === 'light' ? 'svetly' : 'tmavy'}.png`), fullPage: shot.fullPage ?? false });
      await page.keyboard.press('Escape');
    }
    await context.close();
  }
  await browser.close();
  await app.close();
  console.log(`Snímky uloženy do ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
