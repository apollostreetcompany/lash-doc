import { expect, test, type Page } from '@playwright/test';

const expectNoHorizontalOverflow = async (page: Page) => {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
};

test('reveals the desktop Outline when a heading is added without shifting the paper', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/doc/prod-j16-empty-outline-desktop');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(page.locator('.lash-app')).not.toHaveAttribute('data-entrance', 'true');

  const outline = page.getByTestId('lash-document-outline');
  await expect(outline).toBeHidden();

  const paper = page.getByRole('article');
  const writingColumn = await paper.boundingBox();
  expect(writingColumn).not.toBeNull();
  await editor.click();
  await page.getByRole('button', { name: 'Heading 1' }).click();
  await page.keyboard.insertText('Launch plan');

  await expect(outline).toBeVisible();
  await expect(outline.getByRole('button', { name: 'Jump to Launch plan' })).toBeVisible();
  const withOutline = await paper.boundingBox();
  expect(Math.abs(withOutline!.x - writingColumn!.x)).toBeLessThan(0.5);
  expect(Math.abs(withOutline!.width - writingColumn!.width)).toBeLessThan(0.5);

  await page.getByRole('button', { name: 'Heading 1' }).click();
  await expect(outline).toBeHidden();
  const afterRemoval = await paper.boundingBox();
  expect(Math.abs(afterRemoval!.x - writingColumn!.x)).toBeLessThan(0.5);
  expect(Math.abs(afterRemoval!.width - writingColumn!.width)).toBeLessThan(0.5);
  await expectNoHorizontalOverflow(page);
});

test('keeps an empty mobile Outline focused on document context', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/doc/prod-j16-empty-outline-mobile');
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();

  await page.getByTestId('topbar-mobile-menu').click();

  const outline = page.getByTestId('lash-sidebar-outline-panel');
  await expect(outline).toBeVisible();
  await expect(outline.getByRole('heading', { name: 'Outline' })).toBeVisible();
  await expect(outline.getByRole('button', { name: 'Expand all headings' })).toHaveCount(0);
  await expect(page.getByTestId('sidebar-mobile-close')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
