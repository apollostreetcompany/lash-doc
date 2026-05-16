import { expect, test } from '@playwright/test';

import { runEditorCompatibilitySmoke } from './helpers';

test('cb-chrome', async ({ page, browserName }) => {
  expect(test.info().project.name).toBe('cb-chrome');
  expect(browserName).toBe('chromium');
  await runEditorCompatibilitySmoke(page, 'Chrome');
});
