import { expect, test } from '@playwright/test';

import { runEditorCompatibilitySmoke } from './helpers';

test('cb-edge', async ({ page, browserName }) => {
  expect(test.info().project.name).toBe('cb-edge');
  expect(browserName).toBe('chromium');
  await runEditorCompatibilitySmoke(page, 'Edge');

  const userAgent = await page.evaluate(() => navigator.userAgent);
  expect(userAgent).toContain('Edg/');
});
