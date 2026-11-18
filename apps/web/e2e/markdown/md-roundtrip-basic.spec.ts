import { expect, test, type FileChooser, type Page } from '@playwright/test';
import path from 'path';

const fixturePath = path.join(__dirname, 'fixtures', 'basic.md');

const clearMarkdownState = async (page: Page) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
};

const waitForEditor = async (page: Page) => {
  await expect(page.locator('.ProseMirror')).toBeVisible();
};

const waitForSaved = async (page: Page) => {
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved', {
    timeout: 10_000,
  });
};

const sourceBodyRaw = (page: Page, documentId: string) =>
  page.evaluate((id) => window.localStorage.getItem(`lash:body:${id}`), documentId);

const registryRaw = (page: Page) =>
  page.evaluate(() => window.localStorage.getItem('lash:documents'));

const chooseMarkdownFile = async (page: Page, file: Parameters<FileChooser['setFiles']>[0]) => {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import Markdown', exact: true }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(file);
};

test.describe('safe Markdown document transfer', () => {
  test('discloses export limits and imports into a fresh durable route without changing either source', async ({
    page,
  }) => {
    const sourceId = 'markdown-source-safe';
    const sourcePath = `/doc/${sourceId}`;
    await clearMarkdownState(page);
    await page.goto(sourcePath);
    await waitForEditor(page);

    await page.getByTestId('lash-doc-title-input').fill('Source safeguard');
    await page.getByTestId('lash-doc-title-input').press('Tab');
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('This source stays unchanged.');
    await waitForSaved(page);
    const sourceBefore = await sourceBodyRaw(page, sourceId);
    expect(sourceBefore).toBeTruthy();

    const importButton = page.getByRole('button', { name: 'Import Markdown', exact: true });
    const downloadButton = page.getByRole('button', {
      name: 'Download Markdown',
      exact: true,
    });
    await expect(importButton).toBeVisible();
    await expect(downloadButton).toBeVisible();

    const registryBeforeCancel = await registryRaw(page);
    await chooseMarkdownFile(page, fixturePath);
    const importDialog = page.getByRole('dialog', { name: 'Import Markdown as new document' });
    await expect(importDialog).toBeVisible();
    await expect(importDialog).toContainText(
      'A new local document will be created. Your current document, comments, suggestions, and version history will not change.',
    );
    await expect(importDialog.getByText('Other Markdown', { exact: true })).toBeVisible();
    await expect(importDialog.getByText('basic', { exact: true })).toBeVisible();
    await importDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(importDialog).toHaveCount(0);
    expect(await registryRaw(page)).toBe(registryBeforeCancel);
    expect(await sourceBodyRaw(page, sourceId)).toBe(sourceBefore);
    await expect(page).toHaveURL(new RegExp(`${sourcePath}$`));

    await chooseMarkdownFile(page, fixturePath);
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Create new document' }).click();
    await expect(page).toHaveURL(/\/doc\/(?!markdown-source-safe$)[a-z0-9-]+$/);
    const legacyDestinationPath = new URL(page.url()).pathname;
    const legacyDestinationId = legacyDestinationPath.split('/').pop() ?? '';
    expect(legacyDestinationId).not.toBe(sourceId);
    await expect(page.getByTestId('lash-doc-title-input')).toHaveValue('basic');
    await expect(page.getByRole('heading', { level: 1, name: 'Project Plan' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();
    await expect(page.locator('.lash-editor-content ul[data-type="taskList"] li')).toHaveCount(2);
    await page.reload();
    await waitForEditor(page);
    await expect(page.getByTestId('lash-doc-title-input')).toHaveValue('basic');
    await expect(page.getByRole('heading', { level: 1, name: 'Project Plan' })).toBeVisible();

    await downloadButton.click();
    const downloadDialog = page.getByRole('dialog', { name: 'Download Markdown' });
    await expect(downloadDialog).toContainText(
      'Markdown includes the document title and supported body formatting. Comments, suggestions, version history, authorship, chat, collaborators, and access details are not included. Your Lash document will not change.',
    );
    await downloadDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(downloadDialog).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as Window & { __lashLastExport?: string }).__lashLastExport,
      ),
    ).toBeUndefined();

    await downloadButton.click();
    const downloadPromise = page.waitForEvent('download');
    await downloadDialog.getByRole('button', { name: 'Download Markdown', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('basic.md');
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error('Downloaded Markdown path was unavailable.');
    const exported = await page.evaluate(
      () => (window as Window & { __lashLastExport?: string }).__lashLastExport ?? '',
    );
    expect(exported.startsWith('<!-- lash-markdown:v1 -->\n\n# basic\n\n')).toBe(true);
    expect(exported).toContain('# Project Plan');
    expect(exported).toContain('- [x] Ship schema');
    expect(exported.endsWith('\n')).toBe(true);

    const importedSourceBefore = await sourceBodyRaw(page, legacyDestinationId);
    await chooseMarkdownFile(page, {
      name: download.suggestedFilename(),
      mimeType: 'text/markdown',
      buffer: Buffer.from(exported, 'utf8'),
    });
    await expect(importDialog).toContainText('Lash Markdown v1');
    await expect(importDialog.getByText('basic', { exact: true })).toBeVisible();
    await importDialog.getByRole('button', { name: 'Create new document' }).click();
    await page.waitForURL(
      (url) =>
        /^\/doc\/[a-z0-9-]+$/u.test(url.pathname) &&
        url.pathname !== legacyDestinationPath &&
        url.pathname !== sourcePath,
    );
    const v1DestinationPath = new URL(page.url()).pathname;
    expect(v1DestinationPath).not.toBe(legacyDestinationPath);
    expect(v1DestinationPath).not.toBe(sourcePath);
    await page.reload();
    await waitForEditor(page);
    await expect(page.getByTestId('lash-doc-title-input')).toHaveValue('basic');
    await expect(page.getByRole('heading', { level: 1, name: 'Project Plan' })).toBeVisible();
    await expect(page.locator('.lash-editor-content ul[data-type="taskList"] li')).toHaveCount(2);

    await page.goto(legacyDestinationPath);
    await waitForEditor(page);
    expect(await sourceBodyRaw(page, legacyDestinationId)).toBe(importedSourceBefore);
    await expect(page.getByTestId('lash-doc-title-input')).toHaveValue('basic');
    await page.goto(sourcePath);
    await waitForEditor(page);
    expect(await sourceBodyRaw(page, sourceId)).toBe(sourceBefore);
    await expect(page.getByTestId('lash-doc-title-input')).toHaveValue('Source safeguard');
    await expect(page.locator('.ProseMirror')).toContainText('This source stays unchanged.');
    await download.delete();
  });

  test('keeps the named dialog flow keyboard-accessible and unclipped at 390x844', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await clearMarkdownState(page);
    await page.goto('/doc/markdown-mobile-source');
    await waitForEditor(page);

    const importButton = page.getByRole('button', { name: 'Import Markdown', exact: true });
    const downloadButton = page.getByRole('button', {
      name: 'Download Markdown',
      exact: true,
    });
    await expect(importButton).toBeVisible();
    await expect(downloadButton).toBeVisible();
    await downloadButton.click();
    const downloadDialog = page.getByRole('dialog', { name: 'Download Markdown' });
    await expect(downloadDialog.getByRole('button', { name: 'Download Markdown' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(downloadDialog).toHaveCount(0);
    await expect(downloadButton).toBeFocused();

    const before = await registryRaw(page);
    await chooseMarkdownFile(page, fixturePath);
    const importDialog = page.getByRole('dialog', { name: 'Import Markdown as new document' });
    await expect(importDialog).toContainText(
      'Finish saving or recover your current document before opening the imported document.',
    );
    await expect(importDialog.getByRole('button', { name: 'Create new document' })).toBeDisabled();
    await expect(importDialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(importDialog).toHaveCount(0);
    await expect(importButton).toBeFocused();
    expect(await registryRaw(page)).toBe(before);

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noOverflow).toBe(true);
  });
});
