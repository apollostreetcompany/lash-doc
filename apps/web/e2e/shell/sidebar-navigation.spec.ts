import { expect, test, type Page } from '@playwright/test';

type LashTestWindow = Window & {
  __lashEditor?: import('@tiptap/core').Editor;
};

const openDocument = async (page: Page, documentId: string) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(`/doc/${documentId}`);
  await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
};

test.describe('FLOW-05 desktop shell navigation', () => {
  test('desktop exposes a working sidebar disclosure without a mobile dimming action', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDocument(page, 'flow-05-desktop');

    const app = page.locator('.lash-app');
    const mobileMenu = page.getByTestId('topbar-mobile-menu');
    const backdrop = page.locator('.lash-app-backdrop');
    const sidebarToggle = page.getByTestId('sidebar-collapse-toggle');

    await expect(mobileMenu).toBeHidden();
    await expect(backdrop).toBeHidden();
    expect(
      await mobileMenu.evaluate((button) => {
        button.focus();
        return document.activeElement === button;
      }),
    ).toBe(false);

    await expect(app).toHaveAttribute('data-sidebar-collapsed', 'true');
    await sidebarToggle.click();
    await expect(app).toHaveAttribute('data-sidebar-collapsed', 'false');
    await expect(page.getByText('Current doc', { exact: true })).toBeVisible();
    await expect(
      page.getByTestId('lash-sidebar').locator('button[data-disabled="true"]'),
    ).toHaveCount(0);
    await expect(page.getByTestId('lash-document-outline')).toBeHidden();
    await expect(backdrop).toBeHidden();

    await sidebarToggle.click();
    await expect(app).toHaveAttribute('data-sidebar-collapsed', 'true');
    await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();
  });
});
