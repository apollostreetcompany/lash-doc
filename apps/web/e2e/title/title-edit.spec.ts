import { expect, test } from '@playwright/test';

test.describe('title regression', () => {
  test('lets a user edit the document title and keeps it after reload', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.removeItem('lash:title:demo-document');
    });
    await page.reload();

    const title = page.getByTestId('lash-doc-title-input');
    await expect(title).toBeVisible();
    await expect(title).toHaveAttribute('aria-label', 'Document title');

    await title.fill('Launch memo');
    await expect(page.getByTestId('topbar-doc-title')).toHaveText('Launch memo');

    await page.reload();
    await expect(page.getByTestId('lash-doc-title-input')).toHaveValue('Launch memo');
    await expect(page.getByTestId('topbar-doc-title')).toHaveText('Launch memo');
  });

  test('keeps the editable title readable without overlapping metadata on mobile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.removeItem('lash:title:demo-document');
    });
    await page.reload();

    const title = page.getByTestId('lash-doc-title-input');
    await title.fill('A longer mobile launch memo title');

    const boxes = await page.evaluate(() => {
      const titleBox = document
        .querySelector('[data-testid="lash-doc-title-input"]')
        ?.getBoundingClientRect();
      const metaBox = document
        .querySelector('[data-testid="lash-doc-meta"]')
        ?.getBoundingClientRect();
      if (!titleBox || !metaBox) {
        return null;
      }
      return {
        titleBottom: titleBox.bottom,
        metaTop: metaBox.top,
      };
    });

    expect(boxes).not.toBeNull();
    expect(boxes!.titleBottom).toBeLessThanOrEqual(boxes!.metaTop);
  });
});
