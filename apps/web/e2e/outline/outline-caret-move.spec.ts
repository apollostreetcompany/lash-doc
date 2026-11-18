import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

import { seedOutlineDocument } from './seed-outline-document';

test.describe('outline-caret-move', () => {
  test('moves selection to next visible heading when collapsing', async ({ page }) => {
    await page.goto('/');
    const { editor, outline } = await seedOutlineDocument(page);

    const paragraph = editor.getByText('Alpha body one.', { exact: true });
    await paragraph.click();
    const caretBlock = () =>
      page.evaluate(
        () =>
          (window as Window & { __lashEditor?: Editor }).__lashEditor?.state.selection.$from.parent
            .textContent,
      );
    await expect.poll(caretBlock).toBe('Alpha body one.');

    await outline.getByRole('button', { name: 'Collapse Section Alpha' }).click();

    await expect.poll(caretBlock).toBe('Section Beta');
    await expect(outline.getByRole('button', { name: 'Expand Section Alpha' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(paragraph).toBeHidden();
  });
});
