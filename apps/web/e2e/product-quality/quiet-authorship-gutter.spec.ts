import { expect, test, type Locator, type Page } from '@playwright/test';

const waitForDocument = async (page: Page) => {
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();
  await expect(page.getByTestId('blame-gutter')).toHaveCount(1);
};

const enableAuthorship = async (page: Page) => {
  await page.getByTestId('topbar-discussion-button').click();
  await page.getByTestId('rail-tab-history').click();
  const toggle = page.getByTestId('history-authorship-toggle');
  await expect(toggle).toHaveAccessibleName('Show authorship in document');
  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Hide authorship in document');
};

const expectQuietGutter = async (page: Page, gutter: Locator) => {
  await expect(gutter.locator('button')).toHaveCount(0);
  await expect(gutter).toHaveText('');
  await expect(page.getByRole('button', { name: '·', exact: true })).toHaveCount(0);
};

const canvasOffset = async (locator: Locator) =>
  locator.evaluate((element) => {
    const container = element.closest('.lash-editor-with-blame');
    if (!(container instanceof HTMLElement)) {
      throw new Error('Expected the document editor inside the blame-layout container.');
    }
    return element.getBoundingClientRect().left - container.getBoundingClientRect().left;
  });

test('keeps an unattributed phone canvas quiet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/doc/prod-j20-quiet-authorship-mobile');
  await waitForDocument(page);

  const gutter = page.getByTestId('blame-gutter');
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toHaveAttribute(
    'aria-placeholder',
    'Start writing…',
  );
  await enableAuthorship(page);
  await expect(gutter).toBeVisible();
  await expectQuietGutter(page, gutter);
});

test('reveals only real authorship without shifting the desktop canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/doc/prod-j20-quiet-authorship-desktop');
  await waitForDocument(page);

  const gutter = page.getByTestId('blame-gutter');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await enableAuthorship(page);
  await expect(gutter).toBeVisible();
  await expectQuietGutter(page, gutter);
  const editorOffsetBefore = await canvasOffset(editor);

  await editor.click();
  await page.keyboard.type('Attributed line');

  const attributedLine = page.getByTestId('blame-line');
  await expect(attributedLine).toHaveCount(1, { timeout: 15_000 });
  await expect(attributedLine).toHaveAttribute('data-author-id', 'local-user');
  await expect(attributedLine).toHaveAttribute('title', 'Line 1: local-user');
  await expect(attributedLine).toHaveText('local-user');
  expect(Math.abs((await canvasOffset(editor)) - editorOffsetBefore)).toBeLessThanOrEqual(0.5);

  await attributedLine.click();
  await expect(page.getByTestId('history-filter-author')).toContainText('local-user');
  await expect(page.getByTestId('history-filtered-counts')).toContainText(/matching versions?/);
});
