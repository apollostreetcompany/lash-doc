import { expect, test, type Page } from '@playwright/test';

test.use({ hasTouch: true });

const openDocument = async (page: Page, documentId: string) => {
  await page.goto(`/doc/${documentId}`);
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();
};

test('VIS-02 closed mobile drawers are absent from focus and opening establishes a modal focus path', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openDocument(page, 'vis-02-focus');

  const app = page.locator('.lash-app');
  const sidebar = page.locator('#lash-sidebar');
  const rail = page.locator('#lash-rail');
  const menu = page.getByTestId('topbar-mobile-menu');
  const discussion = page.getByTestId('topbar-discussion-button');

  await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
  await expect(sidebar).toHaveAttribute('inert', '');
  await expect(rail).toHaveCount(0);
  await expect(menu).toHaveAttribute('aria-controls', 'lash-sidebar');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(discussion).not.toHaveAttribute('aria-controls', 'lash-rail');
  await expect(discussion).toHaveAttribute('aria-expanded', 'false');

  expect(
    await page.getByTestId('sidebar-collapse-toggle').evaluate((button) => {
      (button as HTMLButtonElement).focus();
      return document.activeElement === button;
    }),
  ).toBe(false);

  await menu.tap();
  await expect(app).toHaveAttribute('data-mobile-drawer', 'true');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('dialog', { name: 'Workspace navigation' })).toHaveAttribute(
    'aria-modal',
    'true',
  );
  const sidebarClose = page.getByTestId('sidebar-mobile-close');
  await expect(sidebarClose).toBeFocused();
  await expect(page.getByTestId('lash-topbar')).toHaveAttribute('inert', '');

  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(
        () => document.activeElement?.closest('#lash-sidebar')?.id === 'lash-sidebar',
      ),
    ).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-mobile-drawer', 'false');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();

  await discussion.tap();
  await expect(app).toHaveAttribute('data-rail-mobile', 'true');
  await expect(rail).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Document activity' })).toHaveAttribute(
    'aria-modal',
    'true',
  );
  await expect(discussion).toHaveAttribute('aria-expanded', 'true');
  await expect(discussion).toHaveAttribute('aria-controls', 'lash-rail');
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.closest('#lash-rail')?.id === 'lash-rail'),
    )
    .toBe(true);
  if (process.env.LASH_B43_VISUAL_OUTPUT) {
    await page.screenshot({
      path: process.env.LASH_B43_VISUAL_OUTPUT,
      animations: 'disabled',
      fullPage: false,
    });
  }
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => document.activeElement?.closest('#lash-rail')?.id === 'lash-rail'),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-rail-mobile', 'false');
  await expect(discussion).toHaveAttribute('aria-expanded', 'false');
  await expect(discussion).not.toHaveAttribute('aria-controls', 'lash-rail');
  await expect(rail).toHaveCount(0);
  await expect(discussion).toBeFocused();
});

test('resizing an open mobile drawer releases the editor and restores visible focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openDocument(page, 'mobile-drawer-resize');
  const menu = page.getByTestId('topbar-mobile-menu');
  const discussion = page.getByRole('button', { name: 'Discussion' });
  const canvas = page.locator('#lash-main');

  await menu.tap();
  await expect(page.getByRole('dialog', { name: 'Workspace navigation' })).toBeVisible();
  await expect(page.getByTestId('sidebar-mobile-close')).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('link', { name: 'Documents' })).toBeFocused();
  await expect(canvas).not.toHaveAttribute('inert');

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await discussion.tap();
  await expect(page.getByRole('dialog', { name: 'Document activity' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Chat' })).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(discussion).toBeFocused();
  await expect(page.getByRole('complementary', { name: 'Document activity' })).toBeVisible();
  await expect(canvas).not.toHaveAttribute('inert');

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(discussion).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute('inert');
});
