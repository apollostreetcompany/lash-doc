import { expect, test } from './development-loopback-mention-fixture';

test('mention-rbac-hide', async ({ page, openSyntheticMentionFixture }) => {
  await openSyntheticMentionFixture(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('@Secret');

  await expect(page.getByTestId('mention-suggestion')).toHaveCount(0);
  await expect(page.getByTestId('mention-anonymized')).toContainText('@hidden-group');
});
