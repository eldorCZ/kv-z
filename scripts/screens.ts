/**
 * pnpm docs:screens – reader screenshots of key screens in light and dark mode into docs/screens
 * (Dodatek 4, V12). Needs a built web app (pnpm build). Starts a throw-away server with the sample quiz
 * and the demo class (pseudonyms), never touches a real database.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../apps/server/src/app.js';
import { loadConfig } from '../apps/server/src/config.js';
import { createDemoClass } from './demo-class.js';

const OUT = join(import.meta.dirname, '../docs/screens');
const EMAIL = 'ucitel@lore.example';
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
  {
    name: 'ucitel-vyber-vzhledu',
    go: async (p, c) => {
      await p.goto(`${c.url}/quizzes/${c.quizId}`);
      await p.getByTestId('quiz-look').click();
      await p.getByTestId('motive-vesmir').click();
      await p.getByTestId('accent-azurova').click();
      await p.getByTestId('theme-preview').waitFor();
    },
  },
  { name: 'ucitel-vychozi-vzhled', go: async (p, c) => void (await p.goto(`${c.url}/settings/look`), await p.getByTestId('default-look').waitFor()) },
  {
    name: 'ucitel-prirazovani-do-obrazku',
    viewport: { width: 1280, height: 1000 },
    go: async (p, c) => {
      // Obrázek si nakreslíme v prohlížeči, ať v repozitáři nemusí ležet binárka.
      // Nahrání i vložení kvízu jde přes relaci učitele – nahrávat obrázky tokenem nelze.
      const quizId = await p.evaluate(async () => {
        // scripts/ se překládá bez DOM knihovny, proto si tvary popíšeme ručně
        type Kresba = { fillStyle: string; strokeStyle: string; lineWidth: number; fillRect(a: number, b: number, c: number, d: number): void; strokeRect(a: number, b: number, c: number, d: number): void; beginPath(): void; arc(x: number, y: number, r: number, o: number, k: number): void; fill(): void; stroke(): void };
        type Platno = { width: number; height: number; getContext(t: '2d'): Kresba; toBlob(cb: (b: unknown) => void, typ: string): void };
        const dok = (globalThis as unknown as { document: { createElement(t: string): Platno } }).document;
        const plátno = dok.createElement('canvas');
        plátno.width = 900;
        plátno.height = 520;
        const k = plátno.getContext('2d');
        k.fillStyle = '#eef2ff';
        k.fillRect(0, 0, 900, 520);
        k.strokeStyle = '#3730a3';
        k.lineWidth = 6;
        k.strokeRect(40, 40, 820, 440);
        const části: [string, number, number][] = [['kořen', 180, 380], ['stonek', 450, 260], ['list', 700, 150]];
        for (const [, x, y] of části) {
          k.beginPath();
          k.arc(x, y, 46, 0, Math.PI * 2);
          k.fillStyle = '#a5b4fc';
          k.fill();
          k.stroke();
        }
        const blob: unknown = await new Promise((hotovo) => plátno.toBlob((b: unknown) => hotovo(b), 'image/png'));
        const { csrfToken } = (await (await fetch('/api/auth/me')).json()) as { csrfToken: string };
        const nahrané = await fetch('/api/theme-images', {
          method: 'POST',
          headers: { 'content-type': 'image/png', 'x-csrf-token': csrfToken },
          body: blob as NonNullable<Parameters<typeof fetch>[1]>['body'],
        });
        if (!nahrané.ok) throw new Error(`nahrání obrázku selhalo: ${nahrané.status} ${await nahrané.text()}`);
        const { id } = (await nahrané.json()) as { id: string };

        const kvíz = await fetch('/api/v1/quizzes', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify({
            schemaVersion: 1,
            title: 'Části rostliny',
            subject: 'Přírodopis',
            questions: [
              {
                type: 'image-label',
                prompt: 'Přiřaď názvy částí rostliny do obrázku.',
                imageId: id,
                timeLimitSec: 60,
                imageLabels: [
                  { text: 'kořen', x: 0.2, y: 0.73, radius: 0.09 },
                  { text: 'stonek', x: 0.5, y: 0.5, radius: 0.09 },
                  { text: 'list', x: 0.78, y: 0.29, radius: 0.09 },
                ],
              },
            ],
          }),
        });
        if (!kvíz.ok) throw new Error(`vložení kvízu selhalo: ${kvíz.status} ${await kvíz.text()}`);
        return ((await kvíz.json()) as { quizId: string }).quizId;
      });
      await p.goto(`${c.url}/quizzes/${quizId}`);
      await p.getByTestId('question').first().getByRole('button', { name: 'Upravit' }).click();
      await p.getByTestId('pin-plocha').waitFor();
      await p.getByTestId('pin-plocha').scrollIntoViewIfNeeded();
      await p.waitForTimeout(300);
    },
  },
  { name: 'ucitel-trida-matice', go: async (p, c) => void (await p.goto(`${c.url}/classes/${c.classId}`), await p.getByTestId('matrix').waitFor()) },
  { name: 'ucitel-trida-temata', go: async (p, c) => void (await p.goto(`${c.url}/classes/${c.classId}?tab=topics`), await p.getByTestId('topics').waitFor()) },
  { name: 'ucitel-profil-zaka', go: async (p, c) => void (await p.goto(`${c.url}/classes/${c.classId}/students/${c.studentId}`), await p.getByTestId('profile-name').waitFor()) },
  { name: 'ucitel-api-tokeny', go: async (p, c) => void (await p.goto(`${c.url}/settings/tokens`), await p.getByRole('heading', { name: 'API tokeny' }).waitFor()) },
];

const brandShots: Shot[] = [
  {
    name: 'znacka-lore',
    viewport: { width: 1280, height: 820 },
    go: async (p, c) => {
      await p.goto(`${c.url}/_design`);
      const sheet = p.getByTestId('brand-sheet');
      await sheet.scrollIntoViewIfNeeded();
      await p.evaluate('Promise.all([...document.images].map((i) => i.decode().catch(() => null)))');
    },
  },
];

const studentShots: Shot[] = [{ name: 'zak-zadani-pinu', viewport: { width: 390, height: 844 }, go: async (p, c) => void (await p.goto(`${c.url}/play`), await p.getByLabel('PIN hry').waitFor()) }];

export const SHOTS = { teacherShots, studentShots, brandShots };

const PROJECTOR = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

/** A short live game: projector at 1280x720 and three phones (V9.3, V9.4). */
async function gameShots(browser: Browser, teacher: Page, ctx: ScreenCtx, scheme: 'light' | 'dark', shot: (p: Page, name: string) => Promise<void>) {
  await teacher.setViewportSize({ width: 1280, height: 800 });
  await teacher.goto(`${ctx.url}/quizzes/${ctx.quizId}`);
  await teacher.getByTestId('start-game').click();
  await teacher.getByTestId('confirm-start').click();
  const pin = (await teacher.getByTestId('pin').textContent())!.replace(/\s/g, '');
  const hostHref = (await teacher.getByTestId('open-host').getAttribute('href'))!;
  const host = await teacher.context().newPage();
  await host.setViewportSize(PROJECTOR);
  await host.goto(new URL(hostHref, ctx.url).href);
  await host.getByTestId('host-pin').waitFor();

  const phones: Page[] = [];
  for (const nick of ['novak12', 'mala4', 'erben7']) {
    const c = await browser.newContext({ viewport: PHONE, colorScheme: scheme, reducedMotion: 'reduce' });
    const p = await c.newPage();
    await p.goto(`${ctx.url}/play?pin=${pin}`);
    await p.getByLabel('Přezdívka').fill(nick);
    await p.getByRole('button', { name: 'Připojit se' }).click();
    await p.getByTestId('player-lobby').waitFor();
    phones.push(p);
  }
  await host.getByText('3 hráči').waitFor();
  await shot(host, 'hra-lobby');
  await shot(phones[0]!, 'zak-lobby');

  await host.keyboard.press('Space');
  await host.getByTestId('host-prompt').waitFor();
  await phones[0]!.getByTestId('player-prompt').waitFor();
  await shot(phones[0]!, 'zak-otazka');
  // two players answer, the projector shows the running question
  const options = phones[0]!.locator('[data-testid^="option-"]');
  if (await options.count()) {
    await options.first().click();
    await phones[1]!.locator('[data-testid^="option-"]').nth(1).click();
    await phones[1]!.getByTestId('player-answered').waitFor();
  }
  await host.waitForTimeout(300);
  await shot(host, 'hra-otazka');
  await shot(phones[1]!, 'zak-odeslano');
  await host.keyboard.press('Enter');
  await host.getByTestId('host-reveal-box').waitFor();
  await phones[0]!.getByTestId('player-reveal').waitFor();
  await host.waitForTimeout(700);
  await shot(host, 'hra-odhaleni');
  await shot(phones[0]!, 'zak-vysledek');
  await host.keyboard.press('Space');
  await host.getByTestId('leaderboard').waitFor();
  await host.waitForTimeout(900);
  await shot(host, 'hra-poradi');
  host.once('dialog', (d) => void d.accept());
  await host.getByRole('button', { name: 'Ukončit' }).click();
  await host.getByTestId('podium').waitFor();
  await host.waitForTimeout(900);
  await shot(host, 'hra-podium');
  for (const p of phones) await p.context().close();
  await host.close();

  // a test on a phone: calm, static motive under a strong scrim (V9.5)
  const created = await teacher.evaluate(async (quizId) => {
    const me = (await (await fetch('/api/auth/me')).json()) as { csrfToken: string };
    const csrf = me.csrfToken;
    const r = await fetch(`/api/v1/quizzes/${quizId}/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ mode: 'test', settings: { theme: { motive: 'krystaly' }, test: { timeLimitMin: 20 } } }),
    });
    return (await r.json()) as { pin: string };
  }, ctx.quizId);
  const tc = await browser.newContext({ viewport: PHONE, colorScheme: scheme, reducedMotion: 'reduce' });
  const tp = await tc.newPage();
  await tp.goto(`${ctx.url}/test?pin=${created.pin}`);
  await tp.getByTestId('test-name').fill('Žák Ukázka');
  await tp.getByRole('button', { name: 'Pokračovat' }).click();
  await tp.getByTestId('test-start').click();
  await tp.getByTestId('test-option-1').click();
  await tp.getByTestId('test-save-state').filter({ hasText: /\S/ }).waitFor();
  await shot(tp, 'zak-test');
  await tc.close();
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'lore-screens-'));
  const cfg = loadConfig({} as NodeJS.ProcessEnv, {
    dbPath: join(dir, 'screens.db'),
    logLevel: 'warn',
    apiRateLimit: 100_000,
    joinRateLimit: 100_000,
    seedSampleQuiz: true,
    designPage: true,
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
    for (const shot of [...teacherShots, ...studentShots, ...brandShots]) {
      await page.setViewportSize(shot.viewport ?? { width: 1280, height: 800 });
      await shot.go(page, ctx);
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(OUT, `${shot.name}-${scheme === 'light' ? 'svetly' : 'tmavy'}.png`), fullPage: shot.fullPage ?? false });
      await page.keyboard.press('Escape');
    }
    const suffix = scheme === 'light' ? 'svetly' : 'tmavy';
    await gameShots(browser, page, ctx, scheme, async (p, name) => void (await p.screenshot({ path: join(OUT, `${name}-${suffix}.png`) })));
    await context.close();
  }
  await browser.close();
  await app.close();
  console.log(`Snímky uloženy do ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
