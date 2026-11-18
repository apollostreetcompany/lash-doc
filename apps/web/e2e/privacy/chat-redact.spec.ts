import { expect, test } from '../share/development-loopback-fixture';

test('chat-redact development fixture applies the selected redaction policy', async ({
  page,
  openDevelopmentLoopbackShareFixture,
}) => {
  await openDevelopmentLoopbackShareFixture();
  await page.getByTestId('share-create-comment').click();

  await expect(page.getByTestId('chat-redaction')).toContainText('chat transcript redacted');
});
