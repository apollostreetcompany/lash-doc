import { expect, test } from '@playwright/test';

type LashTestWindow = Window & {
  __lashEditor?: {
    commands: {
      focus: (position?: 'start' | 'end') => boolean;
      setContent: (content: string) => boolean;
    };
  };
};

const waitForEditor = async (page: import('@playwright/test').Page) => {
  await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
  await expect(page.getByTestId('lash-editor-content')).toBeVisible();
};

const seedEmptyDoc = async (page: import('@playwright/test').Page) => {
  await waitForEditor(page);
  await page.evaluate(() => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.setContent('<p></p>');
  });
};

test.describe('durable suggestions', () => {
  test('accepted suggestion resolution survives reload', async ({ page }) => {
    const docId = `bead-35-suggestion-accept-${Date.now()}`;
    await page.goto(`/doc/${docId}`);
    await seedEmptyDoc(page);

    await page.getByTestId('suggest-mode-toggle').click();
    await page.getByTestId('lash-editor-content').click();
    await page.keyboard.type('Accepted durable suggestion');

    await expect(page.getByTestId('history-suggestion-status')).toContainText('Pending suggestion');
    await page.getByTestId('suggest-accept-button').click();

    await expect(page.getByTestId('history-suggestion-status')).toContainText(
      'Accepted suggestion',
    );
    await expect(page.getByTestId('suggestion-resolution-row')).toContainText('accepted');

    await page.reload();
    await waitForEditor(page);
    await expect(page.getByTestId('suggestion-resolution-row')).toContainText('accepted');
  });

  test('rejected suggestion resolution survives reload', async ({ page }) => {
    const docId = `bead-35-suggestion-reject-${Date.now()}`;
    await page.goto(`/doc/${docId}`);
    await seedEmptyDoc(page);

    const editor = page.getByTestId('lash-editor-content');
    await editor.click();
    await page.keyboard.type('Keep');
    await expect(page.getByTestId('history-version')).toHaveCount(1);

    await page.getByTestId('suggest-mode-toggle').click();
    await editor.click();
    await page.keyboard.type(' remove');
    await expect(page.getByTestId('history-suggestion-status')).toContainText('Pending suggestion');

    await page.getByTestId('suggest-reject-button').click();
    await expect(editor).toContainText('Keep');
    await expect(editor).not.toContainText('remove');
    await expect(page.getByTestId('suggestion-resolution-row')).toContainText('rejected');

    await page.reload();
    await waitForEditor(page);
    await expect(page.getByTestId('suggestion-resolution-row')).toContainText('rejected');
  });
});
