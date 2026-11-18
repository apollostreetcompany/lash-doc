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
  const draft = page.getByRole('textbox', { name: 'Document editor' });
  const planParagraph = draft.locator(':scope > p');
  const expectRichDraft = async (plan: string) => {
    await expect(draft.locator('h2[data-heading-id="outline"]')).toHaveText('Outline');
    await expect(planParagraph.locator('strong')).toHaveText('Review');
    await expect(draft.locator('ul em')).toHaveText('Next steps');
    await expect(planParagraph).toHaveText(`Review ${plan}.`);
  };

  await expect(draft).toHaveAttribute('contenteditable', 'true');
  await selectDiscussionTab(page, 'history');
  await draft.click();
  await draft.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      'text/html',
      '<h2 data-heading-id="outline">Outline</h2><p><strong>Review</strong> the rough plan.</p><ul><li><p><em>Next steps</em></p></li></ul>',
    );
    element.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }),
    );
  });
  await expectRichDraft('the rough plan');
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  await expect(page.getByTestId('history-version')).toHaveCount(1);
  // Keep focus from paste through selection so the editor can finish reconciling native focus.
  await expect(draft).toBeFocused();
  await planParagraph.click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  for (const _ of 'the rough plan') await page.keyboard.press('Shift+ArrowLeft');
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('the rough plan');

  await selectDiscussionTab(page, 'ai');
  await page.getByRole('button', { name: 'Improve writing' }).click();
  await expect(page.getByTestId('ai-original')).toHaveText('the rough plan');
  await expect(page.getByTestId('ai-revision')).toHaveText('the tentative plan');
  await expect(page.getByTestId('ai-patch-json')).toHaveCount(0);
  await expectRichDraft('the rough plan');

  await page.getByRole('button', { name: 'Apply revision' }).click();
  await expect(page.getByTestId('ai-status')).toHaveText('Revision applied.');
  await expectRichDraft('the tentative plan');
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute(
    'data-author-id',
    'ai-editor',
  );
  await expect(page.getByTestId('history-diff-insert')).toHaveAttribute('data-intent', 'ai');
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expectRichDraft('the tentative plan');
});
