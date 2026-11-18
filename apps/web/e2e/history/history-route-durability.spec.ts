import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';


import { selectDiscussionTab } from '../discussion-tabs';

const HISTORY_DATABASE = 'lash-history';
const FIRST_DOCUMENT_TEXT = 'Alpha launch note needs one thoughtful comment';
const SELECTED_QUOTE = 'thoughtful comment';
const SECOND_DOCUMENT_TEXT = 'Beta remains an independent document';

const resetLocalDocuments = async (page: Page) => {
  // Use a same-origin route that does not mount the editor or open the History
  // database before the reset. Opening `/` first can race deletion with the
  // editor's live IndexedDB connection in broader suites.
  await page.goto('/auth/sign-in');
  await page.evaluate(
    ({ historyDatabase }) =>
      new Promise<void>((resolve, reject) => {
        window.localStorage.clear();
        const request = window.indexedDB.deleteDatabase(historyDatabase);
        request.addEventListener('success', () => resolve(), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
        request.addEventListener(
          'blocked',
          () => reject(new Error(`IndexedDB ${historyDatabase} deletion was blocked.`)),
          { once: true },
        );
      }),
    { historyDatabase: HISTORY_DATABASE },
  );
  await page.goto('/');
};

const createDocument = async (page: Page) => {
  const previousPath = new URL(page.url()).pathname;
  await page.getByTestId('new-document-button').click();
  await page.waitForURL((url) => {
    const nextPath = url.pathname;
    return /\/doc\/doc-[a-z0-9-]+$/.test(nextPath) && nextPath !== previousPath;
  });
  return new URL(page.url()).pathname;
};

const editorFor = async (page: Page) => {
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  return editor;
};

const postSelectedTextComment = async (page: Page) => {
  await page.keyboard.down('Shift');
  for (let index = 0; index < SELECTED_QUOTE.length; index += 1) {
    await page.keyboard.press('ArrowLeft');
  }
  await page.keyboard.up('Shift');

  await selectDiscussionTab(page, 'chat');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByTestId('chat-new-thread-quote')).toHaveText(SELECTED_QUOTE);
  await page.getByRole('textbox', { name: 'Comment' }).fill('Name the owner before launch.');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.getByTestId('chat-count')).toHaveText('1 thread');
  await expect(page.getByTestId('chat-message')).toHaveText('Name the owner before launch.');
};

test('local History survives A → B → A, reload, and append-only Restore', async ({ page }) => {
  test.setTimeout(45_000);
  await resetLocalDocuments(page);

  const documentA = await createDocument(page);
  const editorA = await editorFor(page);
  await editorA.click();
  await page.keyboard.type(FIRST_DOCUMENT_TEXT);
  await postSelectedTextComment(page);

  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-count')).toHaveText('1 version', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await expect(page.getByTestId('history-selected-version')).toHaveText('Version 1');
  await expect(page.getByTestId('history-diff-insert')).toContainText(FIRST_DOCUMENT_TEXT);

  const documentB = await createDocument(page);
  expect(documentB).not.toBe(documentA);
  const editorB = await editorFor(page);
  await editorB.click();
  await page.keyboard.type(SECOND_DOCUMENT_TEXT);
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-count')).toHaveText('1 version', {
    timeout: 10_000,
  });

  await page.getByTestId('document-open-select').selectOption(documentA);
  await expect(page).toHaveURL(new RegExp(`${documentA}$`));
  await page.reload();

  const reloadedEditorA = await editorFor(page);
  await expect(reloadedEditorA).toContainText(FIRST_DOCUMENT_TEXT);
  await expect(reloadedEditorA).not.toContainText(SECOND_DOCUMENT_TEXT);
  await selectDiscussionTab(page, 'chat');
  await expect(page.getByTestId('chat-count')).toHaveText('1 thread');
  await expect(page.getByTestId('chat-message')).toHaveText('Name the owner before launch.');
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-count')).toHaveText('1 version');
  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await expect(page.getByTestId('history-selected-version')).toHaveText('Version 1');
  await expect(page.getByTestId('history-diff-insert')).toContainText(FIRST_DOCUMENT_TEXT);

  await reloadedEditorA.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Revised');
  await expect(page.getByTestId('history-count')).toHaveText('2 versions', {
    timeout: 10_000,
  });

  await page.getByTestId('history-version').first().click();
  await page.getByTestId('history-restore-button').click();
  await expect(reloadedEditorA).toContainText(FIRST_DOCUMENT_TEXT);
  await expect(reloadedEditorA).not.toContainText('Revised');
  await expect(page.getByTestId('history-count')).toHaveText('3 versions');
  await expect(page.getByTestId('history-selected-version')).toHaveText('Version 3');
});

test('local History catches up after leaving a saved edit and restores formatted Markdown', async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  await resetLocalDocuments(page);
  await createDocument(page);
  const editor = await editorFor(page);
  await editor.click();
  await page.keyboard.type('## Team agenda');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('Keep this important');
  await page.keyboard.press('ControlOrMeta+b');
  await expect(editor.getByRole('heading', { level: 2, name: 'Team agenda' })).toBeVisible();
  await expect(editor.locator('strong')).toHaveText('Keep this important');
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-count')).toHaveText('1 version');

  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Added before leaving');
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  // Leave in the interval where the body has saved and the History recorder has not run.
  await expect(page.getByTestId('history-count')).toHaveText('1 version');
  await page.reload();

  const reloaded = await editorFor(page);
  await expect(reloaded).toContainText('Added before leaving');
  await selectDiscussionTab(page, 'history');
  await expect(page.getByTestId('history-count')).toHaveText('2 versions');
  await expect(page.getByTestId('history-diff-insert')).toContainText('Added before leaving');
  await page.getByTestId('history-version').first().click();
  await page.getByTestId('history-restore-button').click();
  await expect(page.getByTestId('history-count')).toHaveText('3 versions');
  await expect(reloaded).not.toContainText('Added before leaving');
  await expect(reloaded.getByRole('heading', { level: 2, name: 'Team agenda' })).toBeVisible();
  await expect(reloaded.locator('strong')).toHaveText('Keep this important');
  await page.screenshot({ path: testInfo.outputPath('formatted-version-restored.png') });

  await page.reload();
  const restored = await editorFor(page);
  await expect(restored.getByRole('heading', { level: 2, name: 'Team agenda' })).toBeVisible();
  await expect(restored.locator('strong')).toHaveText('Keep this important');
  await page.getByRole('button', { name: 'Download Markdown', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Download Markdown' });
  const pendingDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download Markdown', exact: true }).click();
  const download = await pendingDownload;
  const path = await download.path();
  if (!path) throw new Error('The downloaded Markdown file was unavailable.');
  const markdown = await readFile(path, 'utf8');
  expect(markdown).toContain('## Team agenda');
  expect(markdown).toContain('**Keep this important**');
  expect(markdown).not.toContain('Added before leaving');
});
