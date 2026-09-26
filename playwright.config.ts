import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.E2E_PORT ?? 3210);
const dbDir = mkdtempSync(join(tmpdir(), 'lore-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  // visual regression runs on its own: pnpm test:visual (-u to accept changes)
  testIgnore: process.env.VISUAL ? [] : ['visual/**'],
  snapshotPathTemplate: '{testDir}/visual/__screens__/{arg}{ext}',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },
  webServer: {
    // requires `pnpm build` (web) – the server serves apps/web/dist
    command: 'npx tsx apps/server/src/index.ts',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      APP_PORT: String(PORT),
      BIND_ADDR: '127.0.0.1',
      PUBLIC_URL: `http://127.0.0.1:${PORT}`,
      DB_PATH: join(dbDir, 'e2e.db'),
      SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0123456789',
      LOG_LEVEL: 'warn',
      JOIN_RATE_LIMIT: '100',
      CODE_PEPPER: 'e2e-pepper-0123456789abcdef0123456789abcdef',
      DESIGN_PAGE: '1',
    },
  },
});
