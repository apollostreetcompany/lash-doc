import { expect, test } from '@playwright/test';

import { runEditorCompatibilitySmoke } from './helpers';

test('cb-firefox', async ({ page, browserName }) => {
  expect(test.info().project.name).toBe('cb-firefox');
  expect(browserName).toBe('firefox');
  await runEditorCompatibilitySmoke(page, 'Firefox');
});
