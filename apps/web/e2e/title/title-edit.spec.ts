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
    await expect(page.getByTestId('document-open-select').locator('option:checked')).toHaveText(
      'Launch memo',
    );

    await page.reload();
    await expect(page.getByTestId('lash-doc-title-input')).toHaveValue('Launch memo');
    await expect(page.getByTestId('document-open-select').locator('option:checked')).toHaveText(
      'Launch memo',
    );
  });

  test('keeps the editable title readable without overlapping document status on mobile', async ({
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
      const statusBox = document
        .querySelector('[aria-label="Document status"]')
        ?.getBoundingClientRect();
      if (!titleBox || !statusBox) {
        return null;
      }
      return {
        titleBottom: titleBox.bottom,
        statusTop: statusBox.top,
      };
    });

    expect(boxes).not.toBeNull();
    expect(boxes!.titleBottom).toBeLessThanOrEqual(boxes!.statusTop);
  });
});
