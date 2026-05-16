import { expect, test } from '@playwright/test';

import { runEditorCompatibilitySmoke } from './helpers';

test('cb-ipad', async ({ page, browserName }) => {
  expect(test.info().project.name).toBe('cb-ipad');
  expect(browserName).toBe('webkit');
  await runEditorCompatibilitySmoke(page, 'iPad');

  const viewport = page.viewportSize();
  expect(viewport?.width).toBeLessThanOrEqual(834);
  const userAgent = await page.evaluate(() => navigator.userAgent);
  expect(userAgent).toContain('iPad');
});
