import { expect, test, type Locator, type Page } from '@playwright/test';

const expectNoUnavailableDestinations = async (sidebar: Locator) => {
  await expect(sidebar.locator('button[data-disabled="true"]')).toHaveCount(0);
  await expect(sidebar).not.toContainText('Soon');
  await expect(sidebar).not.toContainText('coming soon');
};

const expectNoHorizontalOverflow = async (page: Page) => {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
};

test('keeps desktop navigation limited to real document actions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/doc/prod-j15-calm-sidebar-desktop');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.getByRole('button', { name: 'Heading 1' }).click();
  await page.keyboard.insertText('Launch plan');

  const app = page.locator('.lash-app');
  const sidebar = page.getByTestId('lash-sidebar');
  const outlineAccess = page.getByTestId('sidebar-outline-access');

  await expect(page.getByTestId('topbar-mobile-menu')).toBeHidden();
  await expect(page.getByTestId('topbar-mobile-tools')).toBeHidden();
  await expect(app).toHaveAttribute('data-sidebar-collapsed', 'true');
  await expect(sidebar.getByText('Current doc', { exact: true })).toHaveCount(1);
  await expect(outlineAccess).toBeHidden();
  await expect(page.getByTestId('lash-document-outline')).toBeVisible();
  await expectNoUnavailableDestinations(sidebar);

  await page.getByTestId('sidebar-collapse-toggle').click();
  await expect(app).toHaveAttribute('data-sidebar-collapsed', 'false');
  await expect(sidebar.getByText('Current doc', { exact: true })).toBeVisible();
  await expect(page.getByTestId('lash-document-outline')).toBeVisible();
  await expect(outlineAccess).toHaveCount(0);
  await expectNoUnavailableDestinations(sidebar);
  await expectNoHorizontalOverflow(page);
});

test('keeps one functional Outline disclosure when the document-side Outline is absent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/doc/prod-j15-calm-sidebar-medium');
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();

  const app = page.locator('.lash-app');
  const sidebar = page.getByTestId('lash-sidebar');
  const outlineAccess = page.getByTestId('sidebar-outline-access');

  await expect(app).toHaveAttribute('data-sidebar-collapsed', 'true');
  await expect(page.getByTestId('lash-document-outline')).toBeHidden();
  await expect(outlineAccess).toBeVisible();
  await outlineAccess.click();

  await expect(app).toHaveAttribute('data-sidebar-collapsed', 'false');
  await expect(page.getByTestId('lash-sidebar-outline-panel')).toBeVisible();
  await expect(sidebar.getByText('Current doc', { exact: true })).toBeVisible();
  await expectNoUnavailableDestinations(sidebar);
  await expectNoHorizontalOverflow(page);
});

test('opens a focused mobile drawer with the actual Outline and no placeholders', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/doc/prod-j15-calm-sidebar-mobile');
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();

  const app = page.locator('.lash-app');
  const sidebar = page.getByTestId('lash-sidebar');
  const menu = page.getByTestId('topbar-mobile-menu');

  await menu.click();
  await expect(app).toHaveAttribute('data-mobile-drawer', 'true');
  await expect(sidebar.getByText('Current doc', { exact: true })).toBeVisible();
  await expect(page.getByTestId('lash-sidebar-outline-panel')).toBeVisible();
  await expect(page.getByTestId('sidebar-outline-access')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-collapse-toggle')).toHaveCount(0);
  await expectNoUnavailableDestinations(sidebar);

  const close = page.getByTestId('sidebar-mobile-close');
  await expect(close).toBeVisible();
  expect(
    await close.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return Math.min(rect.width, rect.height);
    }),
  ).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);

  await close.click();
  await expect(app).toHaveAttribute('data-mobile-drawer', 'false');
  await expect(menu).toBeFocused();
});
