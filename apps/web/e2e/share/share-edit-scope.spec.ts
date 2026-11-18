import { expect, test } from '@playwright/test';

import { openDevelopmentLoopbackShareFixture } from './development-loopback-fixture';

test('share-edit-scope development fixture maps edit capabilities', async ({ page }) => {
  await openDevelopmentLoopbackShareFixture(page);
  await page.getByTestId('share-create-edit').click();

  await expect(page.getByTestId('share-validation')).toContainText('Access granted: edit');
  await expect(page.getByTestId('share-can-edit')).toContainText('yes');
  await expect(page.getByTestId('share-can-accept')).toContainText('yes');
  await expect(page.getByTestId('history-redaction')).toContainText('0 of 1');
});
