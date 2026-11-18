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
  for (let offset = 0; offset < wording.length; offset += 1) {
    await page.keyboard.press('Shift+ArrowLeft');
  }
  await page.getByRole('button', { name: 'Suggest wording' }).click();
  await page.getByRole('textbox', { name: 'Proposed wording' }).fill(proposal);
  await page
    .getByRole('textbox', { name: 'Comment (optional)' })
    .fill('Could this sound less final?');
  await page.getByRole('button', { name: 'Post suggestion' }).click();
  await expect(page.getByTestId('suggestion-status')).toHaveText('Suggestion pending');
  await expect(editor).toHaveText(body);
  return editor;
}
