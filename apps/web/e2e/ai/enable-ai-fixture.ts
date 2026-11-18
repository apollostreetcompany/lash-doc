import type { Page } from '@playwright/test';

export async function enableAiFixture(page: Page) {
  await page.addInitScript(() => {
    (window as Window & { __lashAiFixture?: boolean }).__lashAiFixture = true;
  });
}
