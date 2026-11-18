import { expect, test, type Locator, type Page } from '@playwright/test';

type Rect = { left: number; right: number; width: number };

const rectFor = async (locator: Locator): Promise<Rect> =>
  locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width };
  });

const expectFullyInside = (inner: Rect, outer: Rect) => {
  expect(inner.left).toBeGreaterThanOrEqual(outer.left);
  expect(inner.right).toBeLessThanOrEqual(outer.right);
  expect(inner.width).toBeGreaterThan(0);
};

const waitForDocument = async (page: Page) => {
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();
  await expect(page.getByTestId('lash-toolbar')).toBeVisible();
};

test('prioritizes structure before file transport in the phone toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/doc/prod-j19-prioritized-formatting-mobile');
  await waitForDocument(page);

  const toolbar = page.getByTestId('lash-toolbar');
  const heading1 = page.getByTestId('toolbar-btn-heading-1');
  const heading2 = page.getByTestId('toolbar-btn-heading-2');
  const heading3 = page.getByTestId('toolbar-btn-heading-3');
  const importMarkdown = page.getByTestId('markdown-import-button');
  const exportMarkdown = page.getByTestId('markdown-export-button');

  for (const control of [heading1, heading2, heading3, importMarkdown, exportMarkdown]) {
    await expect(control).toBeVisible();
  }

  const groups = toolbar.getByRole('group');
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0)).toHaveAccessibleName('Inline formatting');
  await expect(groups.nth(1)).toHaveAccessibleName('Structure');
  await expect(groups.nth(2)).toHaveAccessibleName('Markdown file actions');
  await expect(groups.nth(1).getByTestId('toolbar-btn-insert-table')).toBeVisible();
  await expect(groups.nth(2).getByTestId('markdown-import-button')).toBeVisible();
  await expect(groups.nth(2).getByTestId('markdown-export-button')).toBeVisible();

  const initialToolbar = await rectFor(toolbar);
  expectFullyInside(await rectFor(heading1), initialToolbar);
  expectFullyInside(await rectFor(heading2), initialToolbar);

  const heading3Rect = await rectFor(heading3);
  expect(heading3Rect.left).toBeLessThan(initialToolbar.right);
  expect(heading3Rect.right).toBeGreaterThan(initialToolbar.right);

  const insertTable = page.getByTestId('toolbar-btn-insert-table');
  await insertTable.focus();
  await expect(insertTable).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(importMarkdown).toBeFocused();
  await expect.poll(() => toolbar.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const scrolledToolbar = await rectFor(toolbar);
  await expect
    .poll(async () => (await rectFor(importMarkdown)).right)
    .toBeLessThanOrEqual(scrolledToolbar.right);
  expectFullyInside(await rectFor(importMarkdown), scrolledToolbar);
  await page.keyboard.press('Tab');
  await expect(exportMarkdown).toBeFocused();
  await expect
    .poll(async () => (await rectFor(exportMarkdown)).right)
    .toBeLessThanOrEqual(scrolledToolbar.right);
  expectFullyInside(await rectFor(exportMarkdown), scrolledToolbar);

  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test('keeps desktop file transport right-aligned inside the editor toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/doc/prod-j19-prioritized-formatting-desktop');
  await waitForDocument(page);

  const toolbar = page.getByTestId('lash-toolbar');
  const heading1 = page.getByTestId('toolbar-btn-heading-1');
  const heading2 = page.getByTestId('toolbar-btn-heading-2');
  const importMarkdown = page.getByTestId('markdown-import-button');
  const exportMarkdown = page.getByTestId('markdown-export-button');

  for (const control of [heading1, heading2, importMarkdown, exportMarkdown]) {
    await expect(control).toBeVisible();
  }

  const groups = toolbar.getByRole('group');
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0)).toHaveAccessibleName('Inline formatting');
  await expect(groups.nth(1)).toHaveAccessibleName('Structure');
  await expect(groups.nth(2)).toHaveAccessibleName('Markdown file actions');

  const toolbarRect = await rectFor(toolbar);
  expectFullyInside(await rectFor(heading1), toolbarRect);
  expectFullyInside(await rectFor(heading2), toolbarRect);
  expectFullyInside(await rectFor(importMarkdown), toolbarRect);
  const exportRect = await rectFor(exportMarkdown);
  expectFullyInside(exportRect, toolbarRect);
  expect(toolbarRect.right - exportRect.right).toBeLessThanOrEqual(8);

  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});
