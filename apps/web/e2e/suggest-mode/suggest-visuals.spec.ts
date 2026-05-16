import { expect, test } from '@playwright/test';

test('suggest-visuals', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  await page.getByTestId('suggest-mode-toggle').click();
  await expect(page.getByTestId('suggest-mode-toggle')).toHaveAttribute('data-active', 'true');

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('Suggested wording');

  await expect(page.getByTestId('history-suggestion-status')).toContainText('Pending suggestion');
  await expect(page.getByTestId('history-diff-insert')).toContainText('Suggested wording');
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute('data-intent', 'suggest');
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute(
    'title',
    /local-user \| suggest/,
  );
});
