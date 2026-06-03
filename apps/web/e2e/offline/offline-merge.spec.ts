import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __lashEditor?: unknown; __lashOffline?: unknown }).__lashEditor &&
        (window as unknown as { __lashEditor?: unknown; __lashOffline?: unknown }).__lashOffline,
    ),
  );

const focusEditorEnd = async (page: Page) => {
  await page.evaluate(() => {
    (
      window as unknown as {
        __lashEditor?: { chain: () => { focus: (position: 'end') => { run: () => boolean } } };
      }
    ).__lashEditor
      ?.chain()
      .focus('end')
      .run();
  });
  await page.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'));
};

test('offline-merge', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.getByTestId('offline-disconnect').click();
  await focusEditorEnd(page);
  await page.keyboard.type('Offline draft');
  await expect(page.getByTestId('offline-queue-depth')).toContainText(/Queue: [1-9][0-9]*/);
  await expect(page.getByTestId('lash-editor-content')).toContainText('Offline draft');

  await page.getByTestId('offline-reconnect').click();

  await expect(page.getByTestId('offline-status')).toHaveText('Online');
  await expect(page.getByTestId('offline-queue-depth')).toHaveText('Queue: 0');
  await expect(page.getByTestId('offline-merge-status')).toContainText('Offline draft');
  await expect(page.getByTestId('lash-editor-content')).toContainText('Offline draft');
});
