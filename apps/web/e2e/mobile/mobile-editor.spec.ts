import { devices, expect, test } from '@playwright/test';

test.use({
  ...devices['iPhone 13 Mini'],
  viewport: { width: 375, height: 812 },
});

test.describe('mobile writing surface', () => {
  test('keeps document chrome inside the viewport while editing and reviewing', async ({
    page,
  }) => {
    await page.goto('/');
    const editor = page.getByRole('textbox', { name: 'Document editor' });
    await expect(editor).toHaveAttribute('contenteditable', 'true');

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

    await editor.tap();
    await page.keyboard.type(' Mobile idea');
    await expect(editor).toContainText('Mobile idea');

    const shareTrigger = page.getByRole('button', { name: 'Share document' });
    await shareTrigger.tap();
    const share = page.getByRole('dialog', { name: /^Share/ });
    await expect(share).toBeVisible();
    await share.getByRole('button', { name: 'Close sharing' }).tap();
    await expect(share).toBeHidden();
    await expect(shareTrigger).toBeFocused();

    await page.getByRole('button', { name: 'Discussion', exact: true }).tap();
    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Chat' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select text in document' })).toBeVisible();
    await page.getByRole('button', { name: 'Close activity panel' }).tap();
    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'false');
    await expect(editor).toContainText('Mobile idea');
  });
});
