import { defineConfig, devices } from '@playwright/test';

// PW_CHANNEL=msedge (or chrome) runs the tests in an installed browser instead of the downloaded one.
const channel = process.env['PW_CHANNEL'];
const browser = channel ? { channel } : {};

// `pnpm e2e:live` (scripts/e2e-live.mjs) sets E2E_LIVE and the Supabase variables, and runs only
// the tests that need the local back end, against a separate build on port 4180.
const live = process.env['E2E_LIVE'] === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // The live tests share one database and the same stations' reports: one at a time.
  ...(live && { workers: 1 }),
  reporter: 'list',
  use: { trace: 'on-first-retry', locale: 'ja-JP' },
  projects: live
    ? [
        {
          name: 'live',
          testMatch: /\.live\.spec\.ts$/,
          use: { ...devices['Desktop Chrome'], ...browser, baseURL: 'http://localhost:4180' },
        },
      ]
    : [
        {
          name: 'chromium',
          testIgnore: /\.live\.spec\.ts$/,
          use: { ...devices['Desktop Chrome'], ...browser, baseURL: 'http://localhost:4173' },
        },
        {
          name: 'mobile',
          testIgnore: /\.live\.spec\.ts$/,
          use: { ...devices['Pixel 7'], ...browser, baseURL: 'http://localhost:4173' },
        },
      ],
  webServer: live
    ? {
        command:
          'node scripts/sync-data.mjs && tsc -b && vite build --outDir dist-live && vite preview --outDir dist-live --port 4180 --strictPort',
        url: 'http://localhost:4180',
        reuseExistingServer: false,
        timeout: 180_000,
      }
    : {
        command: 'pnpm build && pnpm preview',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env['CI'],
        timeout: 120_000,
      },
});
