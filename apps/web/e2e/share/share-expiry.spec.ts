import { expect, test } from '@playwright/test';

import { openDevelopmentLoopbackShareFixture } from './development-loopback-fixture';

test('share-expiry development fixture rejects an expired fixture token', async ({ page }) => {
  await openDevelopmentLoopbackShareFixture(page);
  await page.getByTestId('share-create-expired').click();

  await expect(page.getByTestId('share-validation')).toContainText('Denied: expired');
  await expect(page.getByTestId('share-audit-event').last()).toContainText('share-link.expired');
});
