import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'cd apps/web && pnpm start',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /cross-browser\//,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'cb-chrome',
      testMatch: /cross-browser\/cb-chrome\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'cb-edge',
      testMatch: /cross-browser\/cb-edge\.spec\.ts/,
      use: { ...devices['Desktop Edge'] },
    },
    {
      name: 'cb-firefox',
      testMatch: /cross-browser\/cb-firefox\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'cb-safari',
      testMatch: /cross-browser\/cb-safari\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'cb-ipad',
      testMatch: /cross-browser\/cb-ipad\.spec\.ts/,
      use: { ...devices['iPad Pro 11'] },
    },
    {
      name: 'cb-mobile-safari',
      testMatch: /cross-browser\/cb-mobile-safari\.spec\.ts/,
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'cb-mobile-chrome',
      testMatch: /cross-browser\/cb-mobile-chrome\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
});
