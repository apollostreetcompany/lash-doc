import { expect, test, type Page } from '@playwright/test';

test.use({ hasTouch: true });

const clearLocalState = async (page: Page) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
};

const waitForEditableDocument = async (page: Page) => {
  const editable = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editable).toHaveAttribute('contenteditable', 'true');
  return editable;
};

const openEmptyDocument = async (page: Page, documentId: string) => {
  await clearLocalState(page);
  await page.goto(`/doc/${documentId}`);
  return waitForEditableDocument(page);
};

test.describe('stranger-visible responsive shell', () => {
  test('desktop has no mobile-menu focus target or dead dimming backdrop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEmptyDocument(page, 'stranger-shell-desktop');

    const mobileMenu = page.getByTestId('topbar-mobile-menu');
    await expect(mobileMenu).toBeHidden();
    expect(await mobileMenu.evaluate((button) => getComputedStyle(button).display)).toBe('none');
    expect(
      await mobileMenu.evaluate((button) => {
        (button as HTMLButtonElement).focus();
        return document.activeElement === button;
      }),
    ).toBe(false);

    const backdropDisplay = await page.locator('.lash-app').evaluate((app) => {
      app.setAttribute('data-mobile-drawer', 'true');
      const backdrop = app.querySelector<HTMLElement>('.lash-app-backdrop');
      return backdrop ? getComputedStyle(backdrop).display : null;
    });
    expect(backdropDisplay).toBe('none');
  });

  test('mobile menu is 44px, opens the real drawer, and restores focus on close', async ({
    page,
  }) => {
    const viewport = { width: 375, height: 812 };
    await page.setViewportSize(viewport);
    await openEmptyDocument(page, 'stranger-shell-mobile');

    const mobileMenu = page.getByTestId('topbar-mobile-menu');
    await expect(mobileMenu).toBeVisible();
    const layoutMinimum = await mobileMenu.evaluate((button) => {
      const { minWidth, minHeight } = getComputedStyle(button);
      return Math.min(Number.parseFloat(minWidth), Number.parseFloat(minHeight));
    });
    expect(layoutMinimum).toBeGreaterThanOrEqual(44);
    const box = await mobileMenu.boundingBox();
    if (!box) throw new Error('The mobile menu button has no visible bounding box.');
    // Chromium's viewport conversion can report an exact 44px box a fraction below 44.
    const roundingTolerance = 0.001;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44 - roundingTolerance);
    expect(Math.min(box.x, box.y)).toBeGreaterThanOrEqual(-roundingTolerance);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + roundingTolerance);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + roundingTolerance);

    await mobileMenu.tap();
    await expect(page.locator('.lash-app')).toHaveAttribute('data-mobile-drawer', 'true');
    await expect(page.locator('.lash-app-backdrop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.lash-app')).toHaveAttribute('data-mobile-drawer', 'false');
    await expect(mobileMenu).toBeFocused();
  });
});
