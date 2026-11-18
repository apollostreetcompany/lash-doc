import { expect, test, type Page } from '@playwright/test';

import { enableAiFixture } from './enable-ai-fixture';
import { selectDiscussionTab } from '../discussion-tabs';

const ready = async (page: Page) =>
  page.waitForFunction(() =>
    Boolean((window as unknown as { __lashEditor?: unknown }).__lashEditor),
  );

const selectRough = async (page: Page) =>
  page.evaluate(() => {
    const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
      .__lashEditor;
    editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
  });

const selectTextOccurrence = async (page: Page, needle: string, occurrence: number) =>
  page.evaluate(
    ({ needle: selectedText, occurrence: selectedOccurrence }) => {
      const editor = (window as unknown as { __lashEditor: import('@tiptap/core').Editor })
        .__lashEditor;
      let seen = 0;
      let match: { from: number; to: number } | null = null;

      editor.state.doc.descendants((node, position) => {
        if (!node.isText || !node.text || match) return;

        let searchFrom = 0;
        while (searchFrom <= node.text.length - selectedText.length) {
          const index = node.text.indexOf(selectedText, searchFrom);
          if (index < 0) return;
          if (seen === selectedOccurrence) {
            match = {
              from: position + index,
              to: position + index + selectedText.length,
            };
            return;
          }
          seen += 1;
          searchFrom = index + selectedText.length;
        }
      });

      if (!match) {
        throw new Error(`Could not find occurrence ${selectedOccurrence} of "${selectedText}".`);
      }
      editor.chain().focus().setTextSelection(match).run();
      return match;
    },
    { needle, occurrence },
  );

test('ai-patch-apply', async ({ page }) => {
  await enableAiFixture(page);
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('rough copy');
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 5000 });

  await selectDiscussionTab(page, 'ai');
  await selectRough(page);
  await expect(page.getByTestId('ai-improve-button')).toBeEnabled();
  await page.getByTestId('ai-improve-button').click();

  await expect(page.getByTestId('ai-patch-json')).toContainText('"op": "replace_text"');
  await expect(page.getByTestId('lash-editor-content')).toContainText('rough copy');

  await page.getByTestId('ai-accept-button').click();
  await expect(page.getByTestId('ai-status')).toContainText('AI patch applied');
  await expect(page.getByTestId('lash-editor-content')).toContainText('Polished rough copy');
});

test('ai-patch-apply preserves the selected repeated occurrence', async ({ page }) => {
  await enableAiFixture(page);
  await page.goto('/');
  await ready(page);

  await page.getByTestId('lash-editor-content').click();
  await page.keyboard.type('hello world hello');
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-version')).toHaveCount(1, { timeout: 5000 });

  await selectDiscussionTab(page, 'ai');
  const selectedPmRange = await selectTextOccurrence(page, 'hello', 1);
  await expect(page.getByTestId('ai-improve-button')).toBeEnabled();
  await page.getByTestId('ai-improve-button').click();

  await expect(page.getByTestId('ai-patch-json')).toContainText('"from": 12');
  await expect(page.getByTestId('ai-patch-json')).toContainText('"to": 17');
  await expect(page.getByTestId('ai-citation')).toHaveAttribute('data-range-from', '12');
  await expect(page.getByTestId('ai-citation')).toHaveAttribute('data-range-to', '17');
  const stagedPatch = JSON.parse(
    (await page.getByTestId('ai-patch-json').textContent()) ?? 'null',
  ) as {
    operations: Array<{ op: string; from: number; to: number; text: string }>;
    citations: Array<{ type: string; baseVersion: string; rangeFrom: number; rangeTo: number }>;
  };
  expect(stagedPatch.operations).toEqual([
    { op: 'replace_text', from: 12, to: 17, text: 'Polished hello' },
  ]);
  expect(stagedPatch.citations).toEqual([
    { type: 'doc', baseVersion: expect.any(String), rangeFrom: 12, rangeTo: 17 },
  ]);

  await page.getByTestId('ai-accept-button').click();
  await expect(page.getByTestId('ai-status')).toContainText('AI patch applied');
  await expect(page.getByTestId('lash-editor-content')).toHaveText('hello world Polished hello');

  await page.getByTestId('ai-citation').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = (
          window as unknown as {
            __lashEditor: import('@tiptap/core').Editor;
          }
        ).__lashEditor;
        return {
          from: editor.state.selection.from,
          to: editor.state.selection.to,
        };
      }),
    )
    .toEqual(selectedPmRange);
});
