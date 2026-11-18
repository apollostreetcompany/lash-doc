import { expect, test, type Locator, type Page } from '@playwright/test';

const waitForDocument = async (page: Page) => {
  await expect(page.getByRole('textbox', { name: 'Document editor' })).toBeVisible();
  await expect(page.locator('.lash-editor-with-blame')).toBeVisible();
};

const layoutMetrics = async (editor: Locator) =>
  editor.evaluate((element) => {
    const container = element.closest('.lash-editor-with-blame');
    const title = document.querySelector<HTMLElement>('[aria-label="Document title"]');
    if (!(container instanceof HTMLElement) || !title) {
      throw new Error('Expected the editor layout container and document title.');
    }
    const editorRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    return {
      editorLeft: editorRect.left,
      editorWidth: editorRect.width,
      containerLeft: containerRect.left,
      containerWidth: containerRect.width,
      titleLeft: titleRect.left,
    };
  });

const expectFullReadingColumn = async (editor: Locator) => {
  const metrics = await layoutMetrics(editor);
  expect(Math.abs(metrics.editorLeft - metrics.containerLeft)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(metrics.editorLeft - metrics.titleLeft)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(metrics.editorWidth - metrics.containerWidth)).toBeLessThanOrEqual(0.5);
};

const openHistory = async (page: Page) => {
  await page.getByTestId('topbar-discussion-button').click();
  await page.getByTestId('rail-tab-history').click();
  await expect(page.getByTestId('history-panel')).toBeVisible();
  return page.getByTestId('history-authorship-toggle');
};

test('keeps the phone reading column full width until authorship is requested', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/doc/prod-j21-on-demand-authorship-mobile');
  await waitForDocument(page);

  const layout = page.locator('.lash-editor-with-blame');
  const gutter = page.getByTestId('blame-gutter');
  const editor = page.getByTestId('lash-editor-content');

  await expect(layout).toHaveAttribute('data-blame-on', 'false');
  await expect(gutter).toBeHidden();
  await expectFullReadingColumn(editor);

  await editor.click();
  await page.keyboard.type('Authorship should stay available without narrowing ordinary reading.');

  const toggle = await openHistory(page);
  await expect(toggle).toHaveAccessibleName('Show authorship in document');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.focus();
  await page.keyboard.press('Space');

  await expect(toggle).toHaveAccessibleName('Hide authorship in document');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(layout).toHaveAttribute('data-blame-on', 'true');
  await expect(gutter).toBeVisible();

  const attributedLine = page.getByTestId('blame-line');
  await expect(attributedLine).toHaveCount(1, { timeout: 15_000 });
  await expect(attributedLine).toHaveAttribute('data-author-id', 'local-user');
  const enabledMetrics = await layoutMetrics(editor);
  expect(enabledMetrics.editorLeft).toBeGreaterThan(enabledMetrics.containerLeft);

  await page.getByRole('button', { name: 'Close activity panel' }).click();
  await attributedLine.click();
  await expect(page.getByTestId('history-filter-author')).toContainText('local-user');

  const hideToggle = page.getByTestId('history-authorship-toggle');
  await hideToggle.click();
  await expect(hideToggle).toHaveAccessibleName('Show authorship in document');
  await expect(layout).toHaveAttribute('data-blame-on', 'false');
  await expect(gutter).toBeHidden();

  await page.getByRole('button', { name: 'Close activity panel' }).click();
  await expect(page.getByTestId('topbar-discussion-button')).toBeFocused();
  await expectFullReadingColumn(editor);
});

test('keeps the desktop canvas aligned while authorship is off', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/doc/prod-j21-on-demand-authorship-desktop');
  await waitForDocument(page);

  const layout = page.locator('.lash-editor-with-blame');
  const gutter = page.getByTestId('blame-gutter');
  const editor = page.getByTestId('lash-editor-content');

  await expect(layout).toHaveAttribute('data-blame-on', 'false');
  await expect(gutter).toBeHidden();
  await expectFullReadingColumn(editor);

  await editor.click();
  await page.keyboard.type('Desktop authorship should stay available on demand.');

  const toggle = await openHistory(page);
  await expect(toggle).toHaveAccessibleName('Show authorship in document');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Hide authorship in document');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(layout).toHaveAttribute('data-blame-on', 'true');
  await expect(gutter).toBeVisible();
  await expect(page.getByTestId('blame-line')).toHaveCount(1, { timeout: 15_000 });

  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Show authorship in document');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(layout).toHaveAttribute('data-blame-on', 'false');
  await expect(gutter).toBeHidden();
  await expectFullReadingColumn(editor);
});
