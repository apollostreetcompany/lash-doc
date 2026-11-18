import { expect, test, type Page } from '@playwright/test';

import { documentEditor, pasteText } from '../chips/document-chip-journey';

const edit = async (page: Page, title: string, body: string) => {
  const editor = documentEditor(page);
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await page.getByRole('textbox', { name: 'Document title' }).fill(title);
  await editor.fill(body);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
};

test('creates, finds and reopens drafts using only static files', async ({ page }) => {
  const unavailableRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.origin === new URL(page.url()).origin &&
      /^\/(?:api|auth|doc|join|public)\//.test(url.pathname)
    ) {
      unavailableRequests.push(url.pathname);
    }
  });
  page.on('websocket', (socket) => unavailableRequests.push(socket.url()));

  await page.goto('/?realtime=on');
  await edit(page, 'Original draft', 'First browser-local notes.');
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page).toHaveURL(/\/\?doc=doc-[a-z0-9-]+$/);
  const secondUrl = page.url();
  await edit(page, 'Searchable second draft', 'Second browser-local notes.');

  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page).toHaveURL(/\/\?doc=doc-[a-z0-9-]+$/);
  expect(page.url()).not.toBe(secondUrl);
  await edit(page, 'Final drafting space', 'Third browser-local notes.');
  await pasteText(page, secondUrl);
  const chip = page.getByTestId('lash-chip');
  await expect(chip).toContainText('Searchable second draft');
  await expect(chip).toHaveAttribute('href', `/${new URL(secondUrl).search}`);
  await chip.click();
  await expect(page).toHaveURL(secondUrl);
  await expect(documentEditor(page)).toContainText('Second browser-local notes.');

  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search by title' }).fill('searchable second');
  await page.getByRole('link', { name: /^Searchable second draft/ }).click();
  await expect(page).toHaveURL(secondUrl);
  await page.reload();
  await expect(documentEditor(page)).toContainText('Second browser-local notes.');

  await page
    .getByRole('combobox', { name: 'Open document' })
    .selectOption({ label: 'Original draft' });
  await expect(documentEditor(page)).toContainText('First browser-local notes.');
  await page.getByRole('button', { name: 'Share document' }).click();
  const share = page.getByRole('dialog', { name: /Share/ });
  await expect(share).toContainText('Account saving and sharing aren’t available in this preview.');
  await expect(share.getByRole('link', { name: /Sign in/ })).toHaveCount(0);
  await share.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Document settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Document settings' });
  await expect(settings).toContainText('Public links aren’t available in this preview.');
  await expect(settings.getByRole('link', { name: /Sign in/ })).toHaveCount(0);
  expect(unavailableRequests).toEqual([]);
});

test('opens a locally imported Markdown document at its preview address', async ({ page }) => {
  await page.goto('/');
  await edit(page, 'Source draft', 'Keep this source writing.');
  const fileChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import Markdown', exact: true }).click();
  await (
    await fileChooser
  ).setFiles({
    name: 'preview-import.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Imported draft\n\nRead this from the browser storage.\n'),
  });
  const dialog = page.getByRole('dialog', { name: 'Import Markdown as new document' });
  await dialog.getByRole('button', { name: 'Create new document', exact: true }).click();
  await expect(page).toHaveURL(/\/\?doc=doc-[a-z0-9-]+$/);
  await expect(page.getByRole('heading', { name: 'Imported draft', level: 1 })).toBeVisible();
  await expect(page.getByText('Imported document opened.', { exact: true })).toBeAttached();
  await page.reload();
  await expect(documentEditor(page)).toContainText('Read this from the browser storage.');
});
