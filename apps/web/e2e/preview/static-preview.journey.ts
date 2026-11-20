import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { documentEditor, pasteText } from '../chips/document-chip-journey';

const edit = async (page: Page, title: string, body: string) => {
  const editor = documentEditor(page);
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await page.getByRole('textbox', { name: 'Document title' }).fill(title);
  await editor.fill(body);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
};

const watchUnavailableRequests = (page: Page, unavailableRequests: string[]) => {
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^\/(?:api|auth|doc|join|public)(?:\/|$)/.test(url.pathname)) {
      unavailableRequests.push(url.href);
    }
  });
  page.on('websocket', (socket) => unavailableRequests.push(socket.url()));
};

test('creates, finds, reopens and shares a draft using only static files', async ({
  browser,
  baseURL,
  page,
}) => {
  const unavailableRequests: string[] = [];
  watchUnavailableRequests(page, unavailableRequests);

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
  const senderEditor = documentEditor(page);
  const formattedText = 'Café notes for the next writer.';
  await expect(senderEditor).toContainText('First browser-local notes.');
  const senderUrl = page.url();
  await senderEditor.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+B');
  await page.keyboard.insertText(formattedText);
  await expect(senderEditor.locator('strong')).toHaveText(formattedText);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

  const shareButton = page.getByRole('button', { name: 'Share document', exact: true });
  await shareButton.focus();
  await page.keyboard.press('Enter');
  const share = page.getByRole('dialog', { name: 'Share a copy', exact: true });
  await expect(share).toBeVisible();
  await expect(share).toContainText('original-draft.md');
  await expect(share).toContainText('open it with Import Markdown in Lash');
  await expect(share).toContainText(
    /comments, suggestions, version history.*stay with your draft/i,
  );
  await expect(share.getByRole('link', { name: /Sign in/ })).toHaveCount(0);
  const pendingDownload = page.waitForEvent('download');
  await share.getByRole('button', { name: 'Download Markdown', exact: true }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe('original-draft.md');
  const markdown = await readFile(await download.path());
  expect(markdown).toEqual(
    Buffer.from(
      `<!-- lash-markdown:v1 -->\n\n# Original draft\n\nFirst browser-local notes.\n\n**${formattedText}**\n`,
      'utf8',
    ),
  );
  await expect(share).toBeHidden();
  await expect(shareButton).toBeFocused();

  const recipient = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const recipientPage = await recipient.newPage();
    watchUnavailableRequests(recipientPage, unavailableRequests);
    await recipientPage.goto('/?realtime=on');
    const recipientEditor = documentEditor(recipientPage);
    await expect(recipientEditor).toHaveAttribute('contenteditable', 'true');
    await expect(recipientEditor).not.toContainText(formattedText);
    const fileChooser = recipientPage.waitForEvent('filechooser');
    await recipientPage.getByRole('button', { name: 'Import Markdown', exact: true }).tap();
    await (
      await fileChooser
    ).setFiles({
      name: download.suggestedFilename(),
      mimeType: 'text/markdown',
      buffer: markdown,
    });
    const importDialog = recipientPage.getByRole('dialog', {
      name: 'Import Markdown as new document',
    });
    const createImportedDocument = importDialog.getByRole('button', {
      name: 'Create new document',
      exact: true,
    });
    await expect(createImportedDocument).toBeEnabled();
    await createImportedDocument.tap();
    await expect(recipientPage).toHaveURL(/\/\?doc=doc-[a-z0-9-]+$/);
    expect(recipientPage.url()).not.toBe(senderUrl);
    const recipientTitle = recipientPage.getByRole('textbox', { name: 'Document title' });
    await expect(recipientTitle).toHaveValue('Original draft');
    await expect(recipientEditor).toContainText('First browser-local notes.');
    await expect(recipientEditor.locator('strong')).toHaveText(formattedText);

    const recipientEdit = 'Extra notes from the recipient.';
    await recipientTitle.fill('Recipient draft');
    await recipientEditor.press('End');
    await recipientPage.keyboard.press('Enter');
    await recipientPage.keyboard.insertText(recipientEdit);
    await expect(recipientPage.getByTestId('autosave-indicator')).toHaveAttribute(
      'data-status',
      'saved',
    );
    await recipientPage.reload();
    await expect(recipientTitle).toHaveValue('Recipient draft');
    await expect(recipientEditor).toContainText(recipientEdit);
    await expect(recipientEditor.getByText(formattedText, { exact: true })).toBeVisible();
    const blankSourceSlots = await recipientPage.evaluate(() => [
      localStorage.getItem('lash:body:demo-document'),
      localStorage.getItem('lash:body-backup:demo-document'),
    ]);
    expect(blankSourceSlots).toEqual([null, null]);

    await page.reload();
    await expect(page).toHaveURL(senderUrl);
    await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue(
      'Original draft',
    );
    await expect(senderEditor).toContainText('First browser-local notes.');
    await expect(senderEditor.locator('strong')).toHaveText(formattedText);
    await expect(senderEditor).not.toContainText(recipientEdit);
  } finally {
    await recipient.close();
  }

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
