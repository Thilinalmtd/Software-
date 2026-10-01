import { defineConfig } from '@playwright/test';

// UI tests run the app in demo mode (no database needed).
// Locally you can point at a pre-installed Chromium with PW_CHROMIUM_PATH.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:1420',
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
    timezoneId: 'Asia/Colombo',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite --port 1420 --strictPort',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
