import { expect, test, type Page } from '@playwright/test';

const waitForEditableDocument = async (page: Page) => {
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();
  await expect(page.locator('[data-body-mutation-locked="false"]')).toBeVisible();
};

const expectSelectedDocumentTitle = async (page: Page, title: string) => {
  const switcher = page.getByRole('combobox', { name: 'Open document' });
  await expect(switcher).toBeVisible();
  await expect(switcher.locator('option:checked')).toHaveText(title);
};

test('keeps one editable title and one navigational title on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/doc/prod-j17-single-identity-desktop');
  await waitForEditableDocument(page);

  const title = page.getByRole('textbox', { name: 'Document title' });
  await expect(title).toHaveValue('Untitled document');
  await expectSelectedDocumentTitle(page, 'Untitled document');
  await expect(page.getByTestId('topbar-doc-title')).toHaveCount(0);

  await title.fill('Launch brief');
  await title.blur();
  await expectSelectedDocumentTitle(page, 'Launch brief');

  await page.reload();
  await waitForEditableDocument(page);
  await expect(title).toHaveValue('Launch brief');
  await expectSelectedDocumentTitle(page, 'Launch brief');
  await expect(page.getByTestId('topbar-doc-title')).toHaveCount(0);
});

test('does not retain a hidden title echo in the mobile top bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/doc/prod-j17-single-identity-mobile');
  await waitForEditableDocument(page);

  const title = page.getByRole('textbox', { name: 'Document title' });
  await title.fill('Pocket notes');
  await title.blur();

  await expectSelectedDocumentTitle(page, 'Pocket notes');
  await expect(page.getByTestId('topbar-doc-title')).toHaveCount(0);

  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});
