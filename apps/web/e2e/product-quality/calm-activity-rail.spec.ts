import { expect, test, type Page } from '@playwright/test';

const expectNoHorizontalOverflow = async (page: Page) => {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));

  expect(
    widths.document,
    'activity rail must not introduce horizontal overflow',
  ).toBeLessThanOrEqual(widths.viewport);
};

test('keeps desktop activity calm, reversible, and keyboard reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/doc/prod-j14-calm-activity');

  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();

  const rail = page.getByTestId('lash-rail');
  const discussion = page.getByTestId('topbar-discussion-button');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  const editorBefore = await editor.evaluate((element) => element.innerHTML);
  const canvasScrollBefore = await page.locator('.lash-canvas').evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));

  await expect(rail).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await expect(discussion).toBeVisible();
  await expect(discussion).toHaveAccessibleName('Discussion');
  await expect(discussion).toHaveAttribute('aria-expanded', 'false');

  await discussion.focus();
  await page.keyboard.press('Enter');

  await expect(rail).toBeVisible();
  await expect(rail).toHaveAccessibleName('Document activity');
  await expect(discussion).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('tablist', { name: 'Discussion sections' })).toBeVisible();
  await expect(page.getByTestId('rail-tab-chat')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#rail-section-chat')).toBeVisible();
  await expect(page.locator('#rail-section-history')).toBeHidden();
  await expect(page.locator('#rail-section-ai')).toBeHidden();
  await expect(page.getByTestId('ai-run-invalid')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Close activity panel' }).click();
  await expect(rail).toHaveCount(0);
  await expect(discussion).toHaveAttribute('aria-expanded', 'false');
  await expect(discussion).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(rail).toBeVisible();
  await expect(discussion).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('rail-tab-chat')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#rail-section-chat')).toBeVisible();

  const historyTab = page.getByTestId('rail-tab-history');
  await historyTab.click();
  await expect(historyTab).toHaveAttribute('aria-selected', 'true');
  await expect(discussion).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#rail-section-chat')).toBeHidden();
  await expect(page.locator('#rail-section-history')).toBeVisible();
  await expect(page.locator('#rail-section-ai')).toBeHidden();

  const aiTab = page.getByTestId('rail-tab-ai');
  await aiTab.click();
  await expect(aiTab).toHaveAttribute('aria-selected', 'true');
  await expect(discussion).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#rail-section-chat')).toBeHidden();
  await expect(page.locator('#rail-section-history')).toBeHidden();
  await expect(page.locator('#rail-section-ai')).toBeVisible();
  await expect(page.getByTestId('ai-run-invalid')).toHaveCount(0);
  await expect(editor).toHaveJSProperty('innerHTML', editorBefore);
  await expect
    .poll(() =>
      page.locator('.lash-canvas').evaluate((element) => ({
        left: element.scrollLeft,
        top: element.scrollTop,
      })),
    )
    .toEqual(canvasScrollBefore);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Close activity panel' }).click();
  await page.getByRole('button', { name: 'Enter focus mode' }).click();
  await expect(page.locator('.lash-app')).toHaveAttribute('data-focus-mode', 'true');
  await expect(discussion).toBeVisible();
  await expect(discussion).toHaveAttribute('aria-expanded', 'false');
  await expect(discussion).not.toHaveAttribute('aria-controls');

  await discussion.focus();
  await page.keyboard.press('Enter');

  await expect(page.locator('.lash-app')).toHaveAttribute('data-focus-mode', 'false');
  await expect(rail).toBeVisible();
  await expect(discussion).toHaveAttribute('aria-expanded', 'true');
  await expect(discussion).toHaveAttribute('aria-controls', 'lash-rail');
  await expect(page.getByTestId('rail-tab-chat')).toHaveAttribute('aria-selected', 'true');
  await expectNoHorizontalOverflow(page);
});
