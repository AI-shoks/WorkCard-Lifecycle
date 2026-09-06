import { defineConfig, devices } from '@playwright/test';

if (!process.env['QUALITY_BASE_URL'] || !process.env['QUALITY_READ_URL'])
  throw new Error(
    'Use pnpm test:browser; a disposable database and real SPA/API server are required.',
  );

const scale = process.env['QUALITY_CANONICAL'] === '1' ? 'canonical' : 'compact';
export default defineConfig({
  testDir: './quality/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // 250 cards require 750 separate UI lifecycle decisions plus read-back and navigation.
  timeout: scale === 'canonical' ? 15 * 60_000 : 120_000,
  expect: { timeout: 10_000 },
  outputDir: `test-results/${scale}`,
  reporter: [
    ['list'],
    ['html', { outputFolder: `playwright-report/${scale}`, open: 'never' }],
    ['json', { outputFile: `.quality-results/browser-${scale}.json` }],
  ],
  use: {
    baseURL: process.env['QUALITY_BASE_URL'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
