import { expect, type Page } from '@playwright/test';

export const wording = 'publish the beta';
export const proposal = 'share the beta';
export const body = `${wording} once, then ${wording}`;

export const editorFor = (page: Page) =>
  page.getByTestId('lash-editor-content').locator('[contenteditable="true"]');

export async function proposeWording(page: Page) {
  const editor = editorFor(page);
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(body);
  await expect(editor).toHaveText(body);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

  for (let offset = 0; offset < wording.length; offset += 1) {
    await page.keyboard.press('Shift+ArrowLeft');
  }
  await expect
    .poll(() =>
      editor.evaluate((element) => {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return null;
        const range = selection.getRangeAt(0);
        if (!element.contains(range.commonAncestorContainer)) return null;
        const prefix = document.createRange();
        prefix.selectNodeContents(element);
        prefix.setEnd(range.startContainer, range.startOffset);
        return { before: prefix.toString(), selected: selection.toString() };
      }),
    )
    .toEqual({ before: `${wording} once, then `, selected: wording });

  await page.getByRole('button', { name: 'Suggest wording' }).click();
  const replacement = page.getByRole('textbox', { name: 'Proposed wording' });
  await expect(replacement).toHaveValue(wording);
  await replacement.fill(proposal);
  await page
    .getByRole('textbox', { name: 'Comment (optional)' })
    .fill('Could this sound less final?');
  await page.getByRole('button', { name: 'Post suggestion' }).click();
  await expect(page.getByTestId('suggestion-status')).toHaveText('Suggestion pending');
  await expect(editor).toHaveText(body);
  return editor;
}
