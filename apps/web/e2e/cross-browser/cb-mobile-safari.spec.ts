import { expect, test } from '@playwright/test';

import { runMobileShellSmoke } from './helpers';

test('cb-mobile-safari', async ({ page, browserName }) => {
  expect(test.info().project.name).toBe('cb-mobile-safari');
  expect(browserName).toBe('webkit');

  await runMobileShellSmoke(page);

  // iPhone 14 device profile: 390px logical width, iOS WebKit UA.
  const viewport = page.viewportSize();
  expect(viewport?.width).toBeLessThanOrEqual(428);
  const userAgent = await page.evaluate(() => navigator.userAgent);
  expect(userAgent).toContain('iPhone');
});
