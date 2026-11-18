import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  testMatch: '**/static-preview.journey.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.LASH_STATIC_PREVIEW_URL,
    trace: 'retain-on-failure',
  },
});
