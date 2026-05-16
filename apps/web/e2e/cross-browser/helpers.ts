import { expect, type Page } from '@playwright/test';

export const runEditorCompatibilitySmoke = async (page: Page, label: string) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

  const editor = page.getByTestId('lash-editor-content');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('ai-panel')).toBeVisible();

  await editor.click();
  await page.keyboard.type(`${label} compatibility`);

  await expect(editor).toContainText(`${label} compatibility`);
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 10_000 });
};
