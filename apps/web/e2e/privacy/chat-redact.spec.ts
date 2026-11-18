import { expect, test } from '@playwright/test';

import { openDevelopmentLoopbackShareFixture } from '../share/development-loopback-fixture';

test('chat-redact development fixture applies the selected redaction policy', async ({ page }) => {
  await openDevelopmentLoopbackShareFixture(page);
  await page.getByTestId('share-create-comment').click();

  await expect(page.getByTestId('chat-redaction')).toContainText('chat transcript redacted');
});
