import { expect, test } from '@playwright/test';

import { openDevelopmentLoopbackShareFixture } from './development-loopback-fixture';

test('share-audit development fixture records create and access mechanics', async ({ page }) => {
  await openDevelopmentLoopbackShareFixture(page);
  await page.getByTestId('share-create-comment').click();

  await expect(page.getByTestId('share-audit-count')).toContainText('2 audit events');
  await expect(page.getByTestId('share-audit-event').first()).toContainText('share-link.created');
  await expect(page.getByTestId('share-audit-event').last()).toContainText('share-link.access');
});
