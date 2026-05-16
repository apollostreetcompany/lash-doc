import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

test('mention-privacy', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('@Secret');

  await expect(page.getByTestId('mention-suggestions')).not.toContainText('Secret Group');
  await expect(page.getByTestId('mention-anonymized')).toHaveText('@hidden-group');
});
