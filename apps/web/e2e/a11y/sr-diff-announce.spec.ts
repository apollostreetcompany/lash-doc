import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

test('sr-diff-announce', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Alpha');
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 5000 });

  await page.keyboard.type(' beta');

  const diff = page.getByTestId('history-diff');
  await expect(diff).toBeVisible();
  await expect(diff).toHaveAttribute('aria-label', 'Version diff');
  await expect(diff).toHaveAttribute('aria-live', 'polite');
  await expect(diff).toHaveAttribute('aria-describedby', /history-diff-announcement-/);

  await expect(page.getByTestId('history-diff-announcement')).toContainText('inserted "beta"');
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute(
    'aria-label',
    'Inserted text by local-user as edit: beta',
  );
});
