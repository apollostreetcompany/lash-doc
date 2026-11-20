import { expect, test } from '@playwright/test';

test('a failed document-list update preserves the saved draft and its history', async ({ page }) => {
  const documentId = 'document-index-retry';
  const draft = 'The document body is saved.';
  await page.goto(`/doc/${documentId}`);
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toBeEditable();

  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    window.sessionStorage.setItem('test:reject-document-index', 'true');
    Storage.prototype.setItem = function (key, value) {
      if (
        this === window.localStorage &&
        key === 'lash:documents' &&
        window.sessionStorage.getItem('test:reject-document-index') === 'true'
      ) {
        throw new DOMException('Only the document index failed.', 'QuotaExceededError');
      }
      return setItem.call(this, key, value);
    };
  });
  await editor.click();
  await page.keyboard.insertText(draft);

  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  const storedBody = await page.evaluate((id) => window.localStorage.getItem(`lash:body:${id}`), documentId);
  expect(storedBody).toContain(draft);
  await expect(page.getByTestId('local-body-notice')).toHaveCount(0);

  const indexNotice = page.getByTestId('document-index-notice');
  await expect(indexNotice).toContainText('Lash couldn’t update the document list.');
  await page.getByTestId('document-history-button').click();
  await expect(page.getByTestId('history-diff-insert')).toHaveText(draft);

  await page.evaluate(() => window.sessionStorage.removeItem('test:reject-document-index'));
  await indexNotice.getByRole('button', { name: 'Retry updating the list' }).click();
  await expect(indexNotice).toHaveCount(0);
  await expect(editor.locator('p')).toHaveText(draft);
});
