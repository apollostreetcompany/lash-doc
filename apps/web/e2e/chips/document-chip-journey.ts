import { expect, type Page } from '@playwright/test';

export const documentEditor = (page: Page) =>
  page.getByRole('textbox', { name: 'Document editor' });

export const createDocument = async (page: Page, title: string): Promise<string> => {
  await page.goto('/documents');
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page).toHaveURL(/\/doc\/doc-[a-z0-9-]+\/?$/);
  await expect(documentEditor(page)).toHaveAttribute('contenteditable', 'true');
  const path = new URL(page.url()).pathname.replace(/\/$/, '');
  await page.getByRole('textbox', { name: 'Document title' }).fill(title);
  await documentEditor(page).fill('Writing in the related document.');
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  return path;
};

export const openSource = async (page: Page) => {
  await page.goto('/');
  await expect(documentEditor(page)).toHaveAttribute('contenteditable', 'true');
  await documentEditor(page).click();
};

export const pasteText = async (page: Page, text: string) => {
  await documentEditor(page).evaluate((editor, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    editor.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
    );
  }, text);
};
