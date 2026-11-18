import { expect, test } from '@playwright/test';

type TitleTestWindow = Window & { releaseDocumentFrames?: () => Promise<void> };

test.describe('title regression', () => {
  test('keeps typing in the title when a new editor finishes initializing', async ({ page }) => {
    // Deliver the new document's startup frames between ordinary title keypresses.
    await page.addInitScript(() => {
      const request = window.requestAnimationFrame.bind(window);
      const cancel = window.cancelAnimationFrame.bind(window);
      const queued = new Map<number, FrameRequestCallback>();
      let waiting = true;
      let id = -1;
      window.requestAnimationFrame = (callback) => {
        if (!waiting || !location.pathname.startsWith('/doc/')) return request(callback);
        queued.set(id, callback);
        return id--;
      };
      window.cancelAnimationFrame = (frameId) => {
        if (frameId < 0) queued.delete(frameId);
        else cancel(frameId);
      };
      const testWindow = window as TitleTestWindow;
      testWindow.releaseDocumentFrames = async () => {
        waiting = false;
        for (const callback of queued.values()) request(callback);
        queued.clear();
        await new Promise<void>((resolve) => request(() => request(() => resolve())));
      };
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'New document', exact: true }).click();
    await expect(page).toHaveURL(/\/doc\/[^/]+$/u);

    const title = page.getByRole('textbox', { name: 'Document title' });
    const editor = page.getByRole('textbox', { name: 'Document editor' });
    await expect(title).toBeEditable();
    await title.click({ force: true });
    await expect(title).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Launch');
    await expect(title).toHaveValue('Launch');

    await page.evaluate(async () => {
      const releaseDocumentFrames = (window as TitleTestWindow).releaseDocumentFrames;
      if (!releaseDocumentFrames) throw new Error('New document frame control is unavailable.');
      await releaseDocumentFrames();
    });
    await page.keyboard.type(' notes');
    await expect(title).toHaveValue('Launch notes');
    await expect(title).toBeFocused();
    await expect(editor).toHaveText('');

    await page.reload();
    await expect(title).toHaveValue('Launch notes');
    await expect(editor).toHaveText('');
  });

  test('focuses the writing area when no other control was chosen on a new document', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New document', exact: true }).click();
    await expect(page).toHaveURL(/\/doc\/[^/]+$/u);
    const editor = page.getByRole('textbox', { name: 'Document editor' });
    await expect(editor).toBeEditable();
    await expect(editor).toBeFocused();

    await page.keyboard.type('Draft agenda');
    await expect(editor).toHaveText('Draft agenda');
    await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue(
      'Untitled document',
    );
  });

  test('lets a user edit the document title and keeps it after reload', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.removeItem('lash:title:demo-document');
    });
    await page.reload();

    const title = page.getByTestId('lash-doc-title-input');
    await expect(title).toBeVisible();
    await expect(title).toHaveAttribute('aria-label', 'Document title');

    await title.fill('Launch memo');
    await expect(page.getByTestId('document-open-select').locator('option:checked')).toHaveText(
      'Launch memo',
    );

    await page.reload();
    await expect(page.getByTestId('lash-doc-title-input')).toHaveValue('Launch memo');
    await expect(page.getByTestId('document-open-select').locator('option:checked')).toHaveText(
      'Launch memo',
    );
  });

  test('keeps the editable title readable without overlapping document status on mobile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.removeItem('lash:title:demo-document');
    });
    await page.reload();

    const title = page.getByTestId('lash-doc-title-input');
    await title.fill('A longer mobile launch memo title');

    const boxes = await page.evaluate(() => {
      const titleBox = document
        .querySelector('[data-testid="lash-doc-title-input"]')
        ?.getBoundingClientRect();
      const statusBox = document
        .querySelector('[aria-label="Document status"]')
        ?.getBoundingClientRect();
      if (!titleBox || !statusBox) {
        return null;
      }
      return {
        titleBottom: titleBox.bottom,
        statusTop: statusBox.top,
      };
    });

    expect(boxes).not.toBeNull();
    expect(boxes!.titleBottom).toBeLessThanOrEqual(boxes!.statusTop);
  });
});
