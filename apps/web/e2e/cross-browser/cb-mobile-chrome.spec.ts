import { expect, test } from '@playwright/test';

import { runMobileShellSmoke } from './helpers';

test('cb-mobile-chrome', async ({ page, browserName }) => {
  expect(test.info().project.name).toBe('cb-mobile-chrome');
  expect(browserName).toBe('chromium');

  await runMobileShellSmoke(page);

  // Pixel 7 device profile: 412px logical width, Android Chrome UA.
  const viewport = page.viewportSize();
  expect(viewport?.width).toBeLessThanOrEqual(412);
  const userAgent = await page.evaluate(() => navigator.userAgent);
  expect(userAgent).toContain('Android');
});
