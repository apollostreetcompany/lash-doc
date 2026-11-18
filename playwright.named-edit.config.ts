import { defineConfig } from '@playwright/test';

import accountConfig from './playwright.account.config';

export default defineConfig({
  ...accountConfig,
  testMatch: '**/*.named-edit.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: { ...accountConfig.use, actionTimeout: 20_000 },
});
