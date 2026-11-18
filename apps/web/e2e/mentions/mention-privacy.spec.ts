import { expect, test } from './development-loopback-mention-fixture';

test('mention-privacy', async ({ page, openSyntheticMentionFixture }) => {
  await openSyntheticMentionFixture(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('@Secret');

  await expect(page.getByTestId('mention-suggestions')).not.toContainText('Secret Group');
  await expect(page.getByTestId('mention-anonymized')).toHaveText('@hidden-group');
});
