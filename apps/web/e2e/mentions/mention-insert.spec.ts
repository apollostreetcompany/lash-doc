import { expect, test } from './development-loopback-mention-fixture';

test('mention-insert', async ({ page, openSyntheticMentionFixture }) => {
  await openSyntheticMentionFixture(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('@Ada');
  await page.getByTestId('mention-suggestion').click();

  await expect(page.getByTestId('mention-chip')).toContainText('Ada Lovelace');
  await expect(page.getByTestId('mention-chip')).toHaveAttribute('data-kind', 'user');
  await expect(page.getByTestId('lash-editor-content')).toContainText('Ada Lovelace');
});
