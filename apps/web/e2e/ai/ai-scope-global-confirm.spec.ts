import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

test('ai-scope-global-confirm', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('First sentence. Second sentence.');
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 5000 });

  await page.getByTestId('ai-global-rewrite').click();
  await expect(page.getByTestId('ai-status')).toContainText('Global edit requires confirmation');
  await expect(page.getByTestId('ai-fallback')).toContainText('No mutation was applied');
  await expect(page.getByTestId('lash-editor-content')).toContainText(
    'First sentence. Second sentence.',
  );

  await page.getByTestId('ai-global-confirm').check();
  await page.getByTestId('ai-global-rewrite').click();
  await expect(page.getByTestId('ai-patch-json')).toContainText('"allowGlobal": true');
  await page.getByTestId('ai-accept-button').click();

  await expect(page.getByTestId('lash-editor-content')).toContainText(
    'Polished draft: First sentence',
  );
});
