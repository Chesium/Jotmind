import { defineConfig, devices } from '@playwright/test';

/**
 * Two e2e modes (US-034):
 *
 * - Default (`pnpm test:e2e`): no-infra smoke only. Starts just the Vite dev
 *   server; requires no DB/API. This is what `pnpm verify` runs, keeping verify
 *   green without infrastructure.
 * - Real (`pnpm test:e2e:real`, sets `E2E_REAL_API=1`): boots the real Express
 *   API (against `DATABASE_URL`) + Vite dev server and runs the `*.real.spec.ts`
 *   critical-flow coverage (AC4). The API is forced onto the deterministic local
 *   `mock` AI provider so AI/embedding assertions never touch a remote provider.
 */
const realApi = process.env.E2E_REAL_API === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: !realApi,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  globalSetup: realApi ? './e2e/global-setup.ts' : undefined,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /.*\.real\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    ...(realApi
      ? [
          {
            name: 'real-chromium',
            testMatch: /.*\.real\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
  ],
  webServer: realApi
    ? [
        {
          command: 'pnpm --filter @jotmind/api start',
          url: 'http://127.0.0.1:3001/api/health',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            DATABASE_URL:
              process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/jotmind',
            WORKER_INLINE: 'true',
            AI_PROVIDER_CONFIG: JSON.stringify({
              kind: 'mock',
              name: 'E2E Mock',
              dimensions: 8,
            }),
            AI_DEMO_EXTRACTION: 'true',
          },
        },
        {
          command: 'pnpm dev',
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ]
    : {
        command: 'pnpm dev',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
