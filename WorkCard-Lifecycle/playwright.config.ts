import { defineConfig, devices } from '@playwright/test';

const hosted = process.env['QUALITY_HOSTED'] === '1';
const canonical = process.env['QUALITY_CANONICAL'] === '1';

if (!process.env['QUALITY_BASE_URL'] || (!hosted && !process.env['QUALITY_READ_URL']))
  throw new Error(
    'Use pnpm test:browser, or the hosted smoke runner with an IAM-protected HTTPS origin.',
  );

const scale = hosted ? 'hosted-smoke' : canonical ? 'canonical' : 'compact';
export default defineConfig({
  testDir: './quality/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // 250 cards require 750 separate UI lifecycle decisions plus read-back and navigation.
  // The hosted runner renews its audience-bound token out of process and keeps
  // the credential out of traces; allow for real Cloud Run/Cloud SQL latency.
  timeout: hosted ? 25 * 60_000 : canonical ? 15 * 60_000 : 120_000,
  expect: { timeout: 10_000 },
  outputDir: `test-results/${scale}`,
  reporter: [
    ['list'],
    ['html', { outputFolder: `playwright-report/${scale}`, open: 'never' }],
    ['json', { outputFile: `.quality-results/browser-${scale}.json` }],
  ],
  use: {
    baseURL: process.env['QUALITY_BASE_URL'],
    // A hosted context carries a short-lived IAM ID token. Never serialize its
    // request headers into a Playwright trace artifact.
    trace: hosted ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: hosted ? 'block' : 'allow',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
