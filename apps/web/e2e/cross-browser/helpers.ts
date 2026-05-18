import { expect, type Page } from '@playwright/test';

export const waitForEditorReady = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

export const runEditorCompatibilitySmoke = async (page: Page, label: string) => {
  await page.goto('/');
  await waitForEditorReady(page);

  const editor = page.getByTestId('lash-editor-content');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('ai-panel')).toBeVisible();

  await editor.click();
  await page.keyboard.type(`${label} compatibility`);

  await expect(editor).toContainText(`${label} compatibility`);
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 10_000 });
};

/**
 * Mobile shell smoke — verifies the responsive chrome works on a narrow
 * viewport: hamburger opens the sidebar drawer, Escape closes it, and the
 * share button opens the right-rail drawer.
 *
 * Shared by `cb-mobile-safari` (WebKit / iPhone) and `cb-mobile-chrome`
 * (Chromium / Pixel) projects.
 */
export const runMobileShellSmoke = async (page: Page) => {
  await page.goto('/');
  await waitForEditorReady(page);
  await expect(page.getByTestId('lash-editor-content')).toBeVisible();

  const app = page.locator('.lash-app');
  await expect(app).toBeVisible();

  const hamburger = page.getByTestId('topbar-mobile-menu');
  await expect(hamburger).toBeVisible();
  await hamburger.tap();
  await expect(app).toHaveAttribute('data-mobile-drawer', 'true');

  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-mobile-drawer', 'false');

  await page.getByTestId('topbar-share-button').tap();
  await expect(app).toHaveAttribute('data-rail-mobile', 'true');
};
