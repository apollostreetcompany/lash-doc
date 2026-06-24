import { devices, expect, test, type Page } from '@playwright/test';

test.use({
  ...devices['iPhone 13 Mini'],
  viewport: { width: 375, height: 812 },
});

const waitForEditorReady = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

test.describe('mobile writing surface', () => {
  test('keeps document chrome inside the viewport while editing and reviewing', async ({ page }) => {
    await page.goto('/');
    await waitForEditorReady(page);

    const editor = page.getByTestId('lash-editor-content');
    await expect(editor).toBeVisible();

    const metrics = await page.evaluate(() => {
      const topbar = document.querySelector<HTMLElement>('.lash-topbar');
      const select = document.querySelector<HTMLElement>('[data-testid="document-open-select"]');
      const share = document.querySelector<HTMLElement>('[data-testid="topbar-share-button"]');
      if (!topbar || !select || !share) {
        throw new Error('Mobile chrome was not rendered');
      }
      const shareRect = share.getBoundingClientRect();
      const selectRect = select.getBoundingClientRect();
      return {
        shareLeft: shareRect.left,
        shareRight: shareRect.right,
        selectWidth: selectRect.width,
        topbarLeft: topbar.getBoundingClientRect().left,
        topbarRight: topbar.getBoundingClientRect().right,
        viewport: window.innerWidth,
      };
    });

    expect(metrics.topbarLeft).toBeGreaterThanOrEqual(0);
    expect(metrics.topbarRight).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.shareLeft).toBeGreaterThanOrEqual(0);
    expect(metrics.shareRight).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.selectWidth).toBeGreaterThanOrEqual(80);

    await editor.click();
    await page.keyboard.type(' Mobile idea');
    await expect(editor).toContainText('Mobile idea');

    await page.getByTestId('topbar-share-button').tap();
    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'true');
    await expect(page.getByTestId('share-panel')).toBeVisible();

    await page.getByTestId('rail-tab-chat').tap();
    await expect(page.getByTestId('doc-chat-panel')).toBeVisible();
    await expect(page.getByTestId('chat-create-thread')).toBeVisible();
  });
});
