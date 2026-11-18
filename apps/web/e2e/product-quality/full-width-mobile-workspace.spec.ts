import { expect, test, type Page } from '@playwright/test';

const mobileActionTestIds = [
  'topbar-mobile-menu',
  'new-document-button',
  'topbar-mobile-tools',
  'topbar-discussion-button',
  'topbar-share-button',
] as const;

const expectFullWidthWorkspace = async (page: Page) => {
  await expect(page.getByTestId('document-open-select')).toBeVisible();
  for (const testId of mobileActionTestIds) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }

  const metrics = await page.evaluate(() => {
    const rectFor = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing mobile workspace element: ${selector}`);
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    };

    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      topbar: rectFor('.lash-topbar'),
      canvas: rectFor('.lash-canvas'),
      switcher: rectFor('[data-testid="document-open-select"]'),
      actions: [
        rectFor('[data-testid="topbar-mobile-menu"]'),
        rectFor('[data-testid="new-document-button"]'),
        rectFor('[data-testid="topbar-mobile-tools"]'),
        rectFor('[data-testid="topbar-discussion-button"]'),
        rectFor('[data-testid="topbar-share-button"]'),
      ],
    };
  });

  expect(metrics.topbar.left).toBe(0);
  expect(metrics.topbar.right).toBe(metrics.viewport);
  expect(metrics.canvas.left).toBe(0);
  expect(metrics.canvas.right).toBe(metrics.viewport);
  expect(metrics.switcher.width).toBeGreaterThanOrEqual(80);
  expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
  for (const action of metrics.actions) {
    expect(action.left).toBeGreaterThanOrEqual(0);
    expect(action.right).toBeLessThanOrEqual(metrics.viewport);
  }
};

for (const width of [375, 390]) {
  test(`uses the full ${width}px phone workspace without hiding document actions`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 844 });
    await page.goto(`/doc/prod-j18-full-width-${width}`);
    await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();

    const app = page.locator('.lash-app');
    const menu = page.getByTestId('topbar-mobile-menu');
    await expect(app).toHaveAttribute('data-rail-open', 'false');
    await expectFullWidthWorkspace(page);

    await menu.click();
    await expect(app).toHaveAttribute('data-mobile-drawer', 'true');
    await expect(page.getByTestId('lash-sidebar')).toBeVisible();
    await page.getByTestId('sidebar-mobile-close').click();
    await expect(app).toHaveAttribute('data-mobile-drawer', 'false');
    await expect(menu).toBeFocused();
    await expectFullWidthWorkspace(page);
  });
}
