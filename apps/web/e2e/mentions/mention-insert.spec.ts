import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

test('mention-insert', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('@Ada');
  await page.getByTestId('mention-suggestion').click();

  await expect(page.getByTestId('mention-chip')).toContainText('Ada Lovelace');
  await expect(page.getByTestId('mention-chip')).toHaveAttribute('data-kind', 'user');
  await expect(page.getByTestId('lash-editor-content')).toContainText('Ada Lovelace');
});
