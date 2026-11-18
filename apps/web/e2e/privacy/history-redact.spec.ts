import { expect, test } from '../share/development-loopback-fixture';

test('history-redact development fixture applies the selected redaction policy', async ({
  page,
  openDevelopmentLoopbackShareFixture,
}) => {
  await openDevelopmentLoopbackShareFixture();
  await page.getByTestId('share-create-comment').click();

  await expect(page.getByTestId('history-redaction')).toContainText('history redacted 1 of 1');
});
