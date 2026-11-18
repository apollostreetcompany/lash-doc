import { expect, test } from './development-loopback-mention-fixture';

test('mention-anonymized', async ({ page, openSyntheticMentionFixture }) => {
  await openSyntheticMentionFixture(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('@Secret');

  await expect(page.getByTestId('mention-anonymized')).toHaveText('@hidden-group');
});
