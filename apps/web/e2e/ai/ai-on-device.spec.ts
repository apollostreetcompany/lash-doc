import { expect, test } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

test('reports unavailable AI without fabricated actions', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'LanguageModel', {
      configurable: true,
      value: { availability: async () => 'unavailable' },
    });
  });
  await page.goto('/');
  await selectDiscussionTab(page, 'ai');
  await expect(page.getByTestId('ai-status')).toContainText('On-device AI is unavailable');
  await expect(page.getByRole('button', { name: 'Improve writing' })).toHaveCount(0);
  await expect(page.getByTestId('ai-review')).toHaveCount(0);
});

test('reviews and applies a browser model revision without flattening the document', async ({
  page,
}) => {
  // This substitute exercises the browser integration and application contract.
  // Actual on-device model inference requires a compatible browser and device.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'LanguageModel', {
      configurable: true,
      value: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async (input: string) => {
            const request = JSON.parse(input) as { selectedText: string; beforeContext: string };
            if (
              request.selectedText !== 'the rough plan' ||
              !request.beforeContext.includes('Outline')
            ) {
              throw new Error('Unexpected request context');
            }
            return JSON.stringify({
              revision: 'the tentative plan',
              rationale: 'Uses more precise wording.',
            });
          },
          destroy() {},
        }),
      },
    });
  });
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );
  await expect(page.getByTestId('lash-editor-content')).toHaveAttribute('contenteditable', 'true');
  await page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.commands.setContent(
      '<h2 data-heading-id="outline">Outline</h2><p><strong>Review</strong> the rough plan.</p><ul><li><p><em>Next steps</em></p></li></ul>',
    );
  });
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 5000 });
  await selectDiscussionTab(page, 'ai');
  await page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.state.doc.descendants((node, position) => {
      const needle = 'the rough plan';
      const start = node.text?.indexOf(needle) ?? -1;
      if (start >= 0)
        editor.commands.setTextSelection({
          from: position + start,
          to: position + start + needle.length,
        });
    });
  });

  const draft = page.getByTestId('lash-editor-content');
  await page.getByRole('button', { name: 'Improve writing' }).click();
  await expect(page.getByTestId('ai-original')).toHaveText('the rough plan');
  await expect(page.getByTestId('ai-revision')).toHaveText('the tentative plan');
  await expect(page.getByTestId('ai-patch-json')).toHaveCount(0);
  await expect(draft).toContainText('Review the rough plan.');

  await page.getByRole('button', { name: 'Apply revision' }).click();
  await expect(page.getByTestId('ai-status')).toHaveText('Revision applied.');
  const expectRichRevision = async () => {
    await expect(draft.locator('h2[data-heading-id="outline"]')).toHaveText('Outline');
    await expect(draft.locator('p > strong')).toHaveText('Review');
    await expect(draft.locator('ul em')).toHaveText('Next steps');
    await expect(draft).toContainText('Review the tentative plan.');
  };
  await expectRichRevision();
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute(
    'data-author-id',
    'ai-editor',
  );
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute('data-intent', 'ai');
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expectRichRevision();
});
