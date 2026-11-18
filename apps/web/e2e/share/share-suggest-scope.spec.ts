import { expect, test } from './development-loopback-fixture';

test('share-suggest-scope development fixture maps suggest capabilities', async ({
  page,
  openDevelopmentLoopbackShareFixture,
}) => {
  await openDevelopmentLoopbackShareFixture();
  await page.getByTestId('share-create-suggest').click();

  await expect(page.getByTestId('share-validation')).toContainText('Access granted: suggest');
  await expect(page.getByTestId('share-can-comment')).toContainText('yes');
  await expect(page.getByTestId('share-can-suggest')).toContainText('yes');
  await expect(page.getByTestId('share-can-edit')).toContainText('no');
  await expect(page.getByTestId('share-can-accept')).toContainText('no');
});
