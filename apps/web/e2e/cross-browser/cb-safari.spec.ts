import { expect, test } from '@playwright/test';

import { runEditorCompatibilitySmoke } from './helpers';

test('cb-safari', async ({ page, browserName }) => {
  expect(test.info().project.name).toBe('cb-safari');
  expect(browserName).toBe('webkit');
  await runEditorCompatibilitySmoke(page, 'Safari');

  const userAgent = await page.evaluate(() => navigator.userAgent);
  expect(userAgent).toContain('Safari/');
});
