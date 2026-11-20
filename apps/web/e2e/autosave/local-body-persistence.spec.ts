import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { selectDiscussionTab } from '../discussion-tabs';

type LashTestWindow = Window & {
  __lashEditor?: {
    readonly isEditable: boolean;
    commands: {
      focus: (position?: 'start' | 'end') => boolean;
      setContent: (content: Record<string, unknown>) => boolean;
    };
    getText: (options?: { blockSeparator?: string }) => string;
  };
  __lashRecoveryProbe?: {
    getJSON: () => Record<string, unknown>;
    attemptSetContent: (content: Record<string, unknown>) => boolean;
  };
  __lashLastSave?: unknown;
  __lashRestoreBodySetItem?: () => void;
};

interface SaveTransitionMetric {
  durableMs: number;
  savedVisibleMs: number;
  savedNeverPrecededDurable: boolean;
}

const route = (documentId: string) => `/doc/${documentId}`;

const bodyEnvelope = (
  documentId: string,
  text: string,
  revision = 1,
  writeId = `fixture-${revision}`,
) => ({
  version: 1,
  schemaVersion: 'lash-schema-v1',
  documentId,
  revision,
  writeId,
  savedAt: '2026-07-18T00:00:00.000Z',
  doc: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  },
});

const clearBodyState = async (page: Page, documentIds: string[]) => {
  await page.goto('/');
  await page.evaluate((ids) => {
    for (const id of ids) {
      window.localStorage.removeItem(`lash:body:${id}`);
      window.localStorage.removeItem(`lash:body-backup:${id}`);
      window.localStorage.removeItem(`lash:title:${id}`);
    }
    window.localStorage.removeItem('lash:documents');
    window.localStorage.removeItem('lash:realtime-enabled');
    window.localStorage.removeItem('lash:realtime-url');
  }, documentIds);
};

const waitForEditor = async (page: Page) => {
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible();
  await page.waitForFunction(() => (window as LashTestWindow).__lashEditor?.isEditable === true);
};

const editorText = (page: Page) =>
  page.evaluate(
    () => (window as LashTestWindow).__lashEditor?.getText({ blockSeparator: '\n' }) ?? '',
  );

const readLocalHistoryPrimary = (page: Page, documentId: string) =>
  page.evaluate(async (id) => {
    const request = indexedDB.open('lash-history');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const row = database.transaction('primary').objectStore('primary').get(id);
        row.onsuccess = () => resolve(row.result?.raw ?? null);
        row.onerror = () => reject(row.error);
      });
    } finally {
      database.close();
    }
  }, documentId);

const typeIntoEditor = async (page: Page, text: string) => {
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(text);
  await expect.poll(() => editorText(page)).toContain(text);
};

const waitForSaved = async (page: Page) => {
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved', {
    timeout: 2_500,
  });
};

const downloadMarkdownText = async (page: Page) => {
  await page.getByRole('button', { name: 'Download Markdown', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Download Markdown', exact: true });
  await expect(dialog).toBeVisible();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download Markdown', exact: true }).click();
  const path = await (await pending).path();
  if (!path) throw new Error('Downloaded Markdown is unavailable');
  await expect(dialog).toHaveCount(0);
  return readFile(path, 'utf8');
};

const reopenInRestoredContext = async (browser: Browser, page: Page, documentId: string) => {
  const storageState = await page.context().storageState();
  const restoredContext = await browser.newContext({ storageState });
  const restoredPage = await restoredContext.newPage();
  await restoredPage.goto(route(documentId));
  await waitForEditor(restoredPage);
  return { restoredContext, restoredPage };
};

test.describe('local document body persistence', () => {
  test('shows opening until the saved draft can accept its first paragraph', async ({ page }) => {
    await page.goto(route('local-body-opening'));
    const editor = page.getByRole('textbox', { name: 'Document editor' });
    const first = 'A saved paragraph.';
    const next = 'A new paragraph.';
    await expect(editor).toBeEditable();
    await editor.fill(first);
    await waitForSaved(page);

    const historyGate = Promise.withResolvers<void>();
    let historyReadHeld = false;
    await page.exposeFunction('waitForLocalBodyHistoryTest', () => {
      historyReadHeld = true;
      return historyGate.promise;
    });
    await page.addInitScript(() => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name, version) {
        const request = open.call(this, name, version);
        if (name === 'lash-history') {
          const add = request.addEventListener.bind(request);
          Object.defineProperty(request, 'addEventListener', {
            value: (
              type: string,
              listener: EventListenerOrEventListenerObject,
              options?: boolean | AddEventListenerOptions,
            ) => {
              if (type !== 'success' || typeof listener !== 'function') {
                return add(type, listener, options);
              }
              // Delay the native success notification, keeping the real stored History.
              return add(
                type,
                (event) => {
                  const waitForHistory = (
                    window as Window & { waitForLocalBodyHistoryTest?: () => Promise<void> }
                  ).waitForLocalBodyHistoryTest;
                  if (!waitForHistory) throw new Error('The local History fixture did not install.');
                  void waitForHistory().then(() => listener.call(request, event));
                },
                options,
              );
            },
          });
        }
        return request;
      };
    });

    try {
      await page.reload();
      await expect.poll(() => historyReadHeld).toBe(true);
      const canvas = page.getByRole('region', { name: 'Writing canvas' });
      await expect(canvas.getByRole('status')).toHaveText('Opening draft…');
      await expect(editor).toHaveCount(0);
    } finally {
      historyGate.resolve();
    }
    await expect(editor).toHaveText(first);
    expect(await editor.getAttribute('contenteditable')).toBe('true');
    await editor.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(next);
    await expect(editor.locator(':scope > p')).toHaveText([first, next]);
    await waitForSaved(page);
  });

  test('verified saved content survives reload and a restored browser context', async ({
    browser,
    page,
  }) => {
    const documentId = 'local-body-reload';
    await clearBodyState(page, [documentId]);
    await page.goto(route(documentId));
    await waitForEditor(page);
    const registryUpdatedAtBefore = await page.evaluate((id) => {
      const records = JSON.parse(window.localStorage.getItem('lash:documents') ?? '[]') as Array<{
        id?: string;
        updatedAt?: string;
      }>;
      return records.find((record) => record.id === id)?.updatedAt ?? null;
    }, documentId);

    const durableText = 'FLOW-01 durable local writing';
    await typeIntoEditor(page, durableText);

    await waitForSaved(page);
    const registryUpdatedAtAfter = await page.evaluate((id) => {
      const records = JSON.parse(window.localStorage.getItem('lash:documents') ?? '[]') as Array<{
        id?: string;
        updatedAt?: string;
      }>;
      return records.find((record) => record.id === id)?.updatedAt ?? null;
    }, documentId);
    expect(registryUpdatedAtBefore).not.toBeNull();
    expect(registryUpdatedAtAfter).not.toBeNull();
    expect(Date.parse(registryUpdatedAtAfter ?? '')).toBeGreaterThan(
      Date.parse(registryUpdatedAtBefore ?? ''),
    );
    await expect(
      page.getByTestId('document-open-select').locator(`option[value="${route(documentId)}"]`),
    ).toHaveCount(1);

    await page.reload();
    await waitForEditor(page);

    await expect.poll(() => editorText(page)).toContain(durableText);
    await expect(page.locator('.ProseMirror')).toContainText(durableText);
    await page.screenshot({
      path: test.info().outputPath('FLOW-01-reload.png'),
      fullPage: true,
    });

    const { restoredContext, restoredPage } = await reopenInRestoredContext(
      browser,
      page,
      documentId,
    );
    try {
      await expect.poll(() => editorText(restoredPage)).toContain(durableText);
    } finally {
      await restoredContext.close();
    }
  });

  test('flushes the final pending edit during immediate reload', async ({ page }) => {
    const documentId = 'local-body-immediate-reload';
    await clearBodyState(page, [documentId]);
    await page.goto(route(documentId));
    await waitForEditor(page);

    const finalText = 'pending edit survives immediate reload';
    await typeIntoEditor(page, finalText);
    await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'pending');

    await page.reload();
    await waitForEditor(page);
    await expect.poll(() => editorText(page)).toContain(finalText);
  });

  test('flushes on an immediate document switch and keeps bodies isolated', async ({ page }) => {
    const alpha = 'local-body-alpha';
    const beta = 'local-body-beta';
    await clearBodyState(page, [alpha, beta]);

    await page.goto(route(beta));
    await waitForEditor(page);
    await page.goto(route(alpha));
    await waitForEditor(page);

    await typeIntoEditor(page, 'Alpha pending body');
    await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'pending');
    await page.getByTestId('document-open-select').selectOption(route(beta));
    await expect(page).toHaveURL(new RegExp(`${route(beta)}$`));
    await waitForEditor(page);
    await typeIntoEditor(page, 'Beta durable body');
    await waitForSaved(page);

    await page.getByTestId('document-open-select').selectOption(route(alpha));
    await expect(page).toHaveURL(new RegExp(`${route(alpha)}$`));
    await waitForEditor(page);
    await expect.poll(() => editorText(page)).toContain('Alpha pending body');
    await expect.poll(() => editorText(page)).not.toContain('Beta durable body');

    await page.getByTestId('document-open-select').selectOption(route(beta));
    await waitForEditor(page);
    await expect.poll(() => editorText(page)).toContain('Beta durable body');
    await expect.poll(() => editorText(page)).not.toContain('Alpha pending body');
  });

  test('gates a recovered backup until the keyboard-accessible keep action', async ({ page }, testInfo) => {
    const documentId = 'local-body-recovery';
    const backup = JSON.stringify(bodyEnvelope(documentId, 'Last good recovered body', 4));
    await clearBodyState(page, [documentId]);
    await page.evaluate(
      ({ id, backupRaw }) => {
        window.localStorage.setItem(`lash:body:${id}`, '{"malformed":');
        window.localStorage.setItem(`lash:body-backup:${id}`, backupRaw);
      },
      { id: documentId, backupRaw: backup },
    );

    await page.goto(route(documentId));
    await expect(page.locator('.ProseMirror')).toContainText('Last good recovered body');
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
    await expect(page.getByTestId('local-body-notice')).toContainText(
      'Recovered an earlier saved copy',
    );
    await expect(page.getByTestId('autosave-indicator')).toHaveCount(0);
    await expect(page.getByTestId('toolbar-btn-insert-table')).toBeDisabled();
    await expect(page.getByTestId('markdown-import-button')).toBeDisabled();
    await expect(page.getByTestId('markdown-import-input')).toBeDisabled();
    await expect(page.getByTestId('markdown-export-button')).toBeEnabled();
    await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashRecoveryProbe));
    const recoveredJson = await page.evaluate(() =>
      (window as LashTestWindow).__lashRecoveryProbe?.getJSON(),
    );

    await page.evaluate(() => {
      const probe = (window as LashTestWindow).__lashRecoveryProbe;
      if (!probe) throw new Error('Recovery mutation probe is unavailable');
      probe.attemptSetContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Forbidden programmatic mutation' }],
          },
        ],
      });
    });
    expect(
      await page.evaluate(() => (window as LashTestWindow).__lashRecoveryProbe?.getJSON()),
    ).toEqual(recoveredJson);

    await page.getByTestId('toolbar-btn-insert-table').evaluate((button) => {
      button.removeAttribute('disabled');
    });
    await page.getByTestId('toolbar-btn-insert-table').click();
    await expect(page.locator('.ProseMirror table')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as LashTestWindow).__lashRecoveryProbe?.getJSON()),
    ).toEqual(recoveredJson);

    const markdownInput = page.getByTestId('markdown-import-input');
    await markdownInput.evaluate((input) => input.removeAttribute('disabled'));
    await markdownInput.setInputFiles({
      name: 'forbidden.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Forbidden markdown mutation'),
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as LashTestWindow).__lashRecoveryProbe?.getJSON()),
    ).toEqual(recoveredJson);
    expect(
      await page.evaluate(
        (id) => ({
          primary: window.localStorage.getItem(`lash:body:${id}`),
          backup: window.localStorage.getItem(`lash:body-backup:${id}`),
        }),
        documentId,
      ),
    ).toEqual({ primary: '{"malformed":', backup });
    await page.setViewportSize({ width: 375, height: 812 });
    const keepActionBox = await page.getByTestId('keep-recovered-copy').boundingBox();
    expect(keepActionBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: testInfo.outputPath('recovery-mobile-375.png'),
      fullPage: true,
    });

    await page.getByTestId('keep-recovered-copy').focus();
    await page.keyboard.press('Enter');
    await waitForEditor(page);
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
    await expect(page.locator('.ProseMirror')).toBeFocused();
    await expect(page.getByTestId('markdown-import-button')).toBeEnabled();
    await expect(page.getByTestId('local-body-notice')).toHaveCount(0);
    const promoted = await page.evaluate((id) => {
      const primary = JSON.parse(window.localStorage.getItem(`lash:body:${id}`) ?? '{}') as {
        revision?: number;
      };
      return {
        revision: primary.revision,
        backup: window.localStorage.getItem(`lash:body-backup:${id}`),
      };
    }, documentId);
    expect(promoted).toEqual({ revision: 5, backup });

    await page.evaluate(() => {
      const editor = (window as LashTestWindow).__lashEditor;
      if (!editor) throw new Error('Lash editor test hook is unavailable');
      editor.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Last good recovered body after confirmed recovery',
              },
            ],
          },
        ],
      });
    });
    await expect
      .poll(() => editorText(page))
      .toContain('Last good recovered body after confirmed recovery');
    await waitForSaved(page);
    await page.reload();
    await waitForEditor(page);
    await expect
      .poll(() => editorText(page))
      .toContain('Last good recovered body after confirmed recovery');
  });

  test('keeps recovery locked and retryable when promotion storage fails', async ({ page }) => {
    const documentId = 'local-body-recovery-promotion-failure';
    const primaryRaw = '{"malformed":';
    const backupRaw = JSON.stringify(bodyEnvelope(documentId, 'Exportable recovered body', 4));
    await clearBodyState(page, [documentId]);
    await page.evaluate(
      ({ id, primary, backup }) => {
        window.localStorage.setItem(`lash:body:${id}`, primary);
        window.localStorage.setItem(`lash:body-backup:${id}`, backup);
      },
      { id: documentId, primary: primaryRaw, backup: backupRaw },
    );

    await page.goto(route(documentId));
    await expect(page.locator('.ProseMirror')).toContainText('Exportable recovered body');
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
    await page.evaluate((id) => {
      const storagePrototype = Object.getPrototypeOf(window.localStorage) as Storage;
      const originalSetItem = storagePrototype.setItem;
      storagePrototype.setItem = function setItem(key: string, value: string) {
        if (key === `lash:body:${id}`) {
          throw new DOMException('forced recovery quota failure', 'QuotaExceededError');
        }
        return originalSetItem.call(this, key, value);
      };
      (window as LashTestWindow).__lashRestoreBodySetItem = () => {
        storagePrototype.setItem = originalSetItem;
      };
    }, documentId);

    await page.getByTestId('keep-recovered-copy').click();

    await expect(page.getByTestId('local-body-notice')).toHaveAttribute(
      'data-kind',
      'recovery-error',
    );
    await expect(page.getByTestId('local-body-notice')).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('local-body-notice')).toContainText(
      'Could not keep the recovered copy',
    );
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
    await expect(page.getByTestId('keep-recovered-copy')).toContainText(/Retry/i);
    await expect(page.getByTestId('markdown-export-button')).toBeEnabled();
    expect(
      await page.evaluate(
        (id) => ({
          primary: window.localStorage.getItem(`lash:body:${id}`),
          backup: window.localStorage.getItem(`lash:body-backup:${id}`),
        }),
        documentId,
      ),
    ).toEqual({ primary: primaryRaw, backup: backupRaw });

    expect(await downloadMarkdownText(page)).toContain('Exportable recovered body');

    await page.evaluate(() => (window as LashTestWindow).__lashRestoreBodySetItem?.());
    await page.getByTestId('keep-recovered-copy').click();
    await waitForEditor(page);
    await expect(page.getByTestId('local-body-notice')).toHaveCount(0);
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
  });

  test('rejects a non-string executable persisted link and displays only the safe backup', async ({
    page,
  }) => {
    const documentId = 'local-body-unsafe-link';
    const unsafe = {
      ...bodyEnvelope(documentId, 'unsafe primary', 2),
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'unsafe primary',
                marks: [{ type: 'link', attrs: { href: ['javascript:alert(1)'] } }],
              },
            ],
          },
        ],
      },
    };
    const backup = JSON.stringify(bodyEnvelope(documentId, 'Safe recovered text', 1));
    const unsafeRaw = JSON.stringify(unsafe);
    await clearBodyState(page, [documentId]);
    await page.evaluate(
      ({ id, primaryRaw, backupRaw }) => {
        window.localStorage.setItem(`lash:body:${id}`, primaryRaw);
        window.localStorage.setItem(`lash:body-backup:${id}`, backupRaw);
      },
      { id: documentId, primaryRaw: unsafeRaw, backupRaw: backup },
    );

    await page.goto(route(documentId));
    await expect(page.locator('.ProseMirror')).toContainText('Safe recovered text');
    await expect(page.locator('.ProseMirror a[href^="javascript:"]')).toHaveCount(0);
    await expect(page.getByTestId('local-body-notice')).toContainText(
      'Recovered an earlier saved copy',
    );
    expect(
      await page.evaluate(
        (id) => ({
          primary: window.localStorage.getItem(`lash:body:${id}`),
          backup: window.localStorage.getItem(`lash:body-backup:${id}`),
        }),
        documentId,
      ),
    ).toEqual({ primary: unsafeRaw, backup });
  });

  test('rejects unknown active-schema node and mark fields before hydration', async ({ page }) => {
    const cases = [
      {
        id: 'local-body-unknown-node-key',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', futureNodeKey: 'must not disappear' }],
        },
      },
      {
        id: 'local-body-unknown-node-attr',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', attrs: { futureNodeAttr: 'must not disappear' } }],
        },
      },
      {
        id: 'local-body-unknown-mark-key',
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'linked',
                  marks: [
                    {
                      type: 'link',
                      attrs: { href: 'https://example.com' },
                      futureMarkKey: 'must not disappear',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      {
        id: 'local-body-unknown-mark-attr',
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'linked',
                  marks: [
                    {
                      type: 'link',
                      attrs: {
                        href: 'https://example.com',
                        futureMarkAttr: 'must not disappear',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ];

    for (const fixture of cases) {
      const primaryRaw = JSON.stringify({
        ...bodyEnvelope(fixture.id, 'unsafe primary', 2),
        doc: fixture.doc,
      });
      const backupRaw = JSON.stringify(
        bodyEnvelope(fixture.id, `Safe backup for ${fixture.id}`, 1),
      );
      await clearBodyState(page, [fixture.id]);
      await page.evaluate(
        ({ id, primary, backup }) => {
          window.localStorage.setItem(`lash:body:${id}`, primary);
          window.localStorage.setItem(`lash:body-backup:${id}`, backup);
        },
        { id: fixture.id, primary: primaryRaw, backup: backupRaw },
      );

      await page.goto(route(fixture.id));
      await expect(page.locator('.ProseMirror')).toContainText(`Safe backup for ${fixture.id}`);
      await expect(page.getByTestId('local-body-notice')).toHaveAttribute('data-kind', 'recovered');
      expect(
        await page.evaluate(
          (id) => ({
            primary: window.localStorage.getItem(`lash:body:${id}`),
            backup: window.localStorage.getItem(`lash:body-backup:${id}`),
          }),
          fixture.id,
        ),
      ).toEqual({ primary: primaryRaw, backup: backupRaw });
    }
  });

  test('fails closed when both copies are corrupt and preserves both strings', async ({ page }) => {
    const documentId = 'local-body-dual-corrupt';
    await clearBodyState(page, [documentId]);
    await page.evaluate((id) => {
      window.localStorage.setItem(`lash:body:${id}`, '{"primary":');
      window.localStorage.setItem(`lash:body-backup:${id}`, '{"backup":');
    }, documentId);

    await page.goto(route(documentId));
    await expect(page.getByTestId('local-body-notice')).toContainText(
      'Saved document data could not be opened',
    );
    await expect(page.getByTestId('autosave-indicator')).toHaveCount(0);
    await typeIntoEditor(page, 'Unsaved rescue text');
    await expect(page.getByTestId('autosave-indicator')).toHaveCount(0);
    expect(
      await page.evaluate(
        (id) => ({
          primary: window.localStorage.getItem(`lash:body:${id}`),
          backup: window.localStorage.getItem(`lash:body-backup:${id}`),
        }),
        documentId,
      ),
    ).toEqual({ primary: '{"primary":', backup: '{"backup":' });
  });

  test('shows Save failed and preserves the last verified primary on quota failure', async ({
    page,
  }, testInfo) => {
    const documentId = 'local-body-quota';
    await clearBodyState(page, [documentId]);
    await page.goto(route(documentId));
    const editor = page.getByRole('textbox', { name: 'Document editor' });
    const appendText = async (text: string) => {
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.insertText(text);
      await expect(editor).toContainText(text.trim());
    };
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await appendText('Verified before quota');
    await waitForSaved(page);
    await appendText(' and rotated backup');
    await waitForSaved(page);
    await expect.poll(() => readLocalHistoryPrimary(page, documentId)).toContain('rotated backup');
    const verifiedHistory = await readLocalHistoryPrimary(page, documentId);
    const verifiedSlots = await page.evaluate(
      (id) => ({
        primary: window.localStorage.getItem(`lash:body:${id}`),
        backup: window.localStorage.getItem(`lash:body-backup:${id}`),
      }),
      documentId,
    );
    expect(verifiedSlots.primary).not.toBeNull();
    expect(verifiedSlots.backup).not.toBeNull();

    await page.evaluate(() => {
      const win = window as LashTestWindow & { __lashBodyWriteAttempts?: number };
      win.__lashBodyWriteAttempts = 0;
      const storagePrototype = Object.getPrototypeOf(window.localStorage) as Storage;
      const originalSetItem = storagePrototype.setItem;
      storagePrototype.setItem = function setItem(key: string, value: string) {
        if (key.startsWith('lash:body')) {
          win.__lashBodyWriteAttempts = (win.__lashBodyWriteAttempts ?? 0) + 1;
          throw new DOMException('forced quota failure', 'QuotaExceededError');
        }
        return originalSetItem.call(this, key, value);
      };
    });
    await appendText(' plus unsaved quota text');

    await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'error', {
      timeout: 2_500,
    });
    await expect(page.getByTestId('autosave-indicator')).toContainText('Save failed');
    await expect(page.getByTestId('local-body-notice')).toContainText('Save failed');
    const failedWriteAttempts = await page.evaluate(
      () =>
        (window as LashTestWindow & { __lashBodyWriteAttempts?: number }).__lashBodyWriteAttempts ??
        0,
    );
    expect(failedWriteAttempts).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        (id) => ({
          primary: window.localStorage.getItem(`lash:body:${id}`),
          backup: window.localStorage.getItem(`lash:body-backup:${id}`),
        }),
        documentId,
      ),
    ).toEqual(verifiedSlots);
    await editor.focus();
    await page.keyboard.press('Home');
    expect(await page.getByTestId('autosave-indicator').getAttribute('data-status')).toBe('error');
    await page.waitForTimeout(700);
    expect(
      await page.evaluate(
        () =>
          (window as LashTestWindow & { __lashBodyWriteAttempts?: number })
            .__lashBodyWriteAttempts ?? 0,
      ),
    ).toBe(failedWriteAttempts);
    expect(await downloadMarkdownText(page)).toContain('unsaved quota text');
    await page.evaluate(() => {
      const selection = window.getSelection();
      const editor = document.querySelector('.ProseMirror');
      if (!selection || !editor) throw new Error('Editor selection is unavailable');
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      (window as LashTestWindow & { __lashCopiedText?: string }).__lashCopiedText = '';
      document.addEventListener(
        'copy',
        () => {
          (window as LashTestWindow & { __lashCopiedText?: string }).__lashCopiedText =
            selection.toString();
        },
        { once: true },
      );
    });
    await page.keyboard.press('ControlOrMeta+C');
    expect(await page.getByTestId('autosave-indicator').getAttribute('data-status')).toBe('error');
    expect(
      await page.evaluate(
        () => (window as LashTestWindow & { __lashCopiedText?: string }).__lashCopiedText ?? '',
      ),
    ).toContain('unsaved quota text');
    await page.waitForTimeout(700);
    await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'error');
    await expect(page.getByTestId('autosave-indicator')).toContainText('Save failed');
    expect(
      await page.evaluate(
        () =>
          (window as LashTestWindow & { __lashBodyWriteAttempts?: number })
            .__lashBodyWriteAttempts ?? 0,
      ),
    ).toBe(failedWriteAttempts);
    await page.screenshot({
      path: testInfo.outputPath('save-failed.png'),
      fullPage: true,
    });
    // History used to wait independently of the storage acknowledgement.
    await page.waitForTimeout(1_900);
    expect(await readLocalHistoryPrimary(page, documentId)).toBe(verifiedHistory);

    await page.reload();
    await expect(editor).toHaveText('Verified before quota and rotated backup');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await appendText(' and saved after reload');
    await waitForSaved(page);
    await expect
      .poll(() => readLocalHistoryPrimary(page, documentId))
      .toContain('saved after reload');
    expect(await readLocalHistoryPrimary(page, documentId)).not.toContain('unsaved quota text');
  });

  test('records History after a failed first save only when a later save verifies', async ({
    page,
  }) => {
    const documentId = 'local-history-first-save-retry';
    await clearBodyState(page, [documentId]);
    await page.goto(route(documentId));
    const editor = page.getByRole('textbox', { name: 'Document editor' });
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await page.evaluate((id) => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === `lash:body:${id}`)
          throw new DOMException('Forced quota failure', 'QuotaExceededError');
        write.call(this, key, value);
      };
      (window as LashTestWindow).__lashRestoreBodySetItem = () => {
        Storage.prototype.setItem = write;
      };
    }, documentId);

    await editor.click();
    await page.keyboard.insertText('First attempt');
    await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'error');
    await page.waitForTimeout(1_900);
    expect(await readLocalHistoryPrimary(page, documentId)).toBeNull();
    await page.evaluate(() => (window as LashTestWindow).__lashRestoreBodySetItem?.());
    await page.keyboard.press('End');
    await page.keyboard.insertText(' saved on retry');
    await waitForSaved(page);
    await expect
      .poll(() => readLocalHistoryPrimary(page, documentId))
      .toContain('First attempt saved on retry');
    await page.reload();
    await expect(editor).toHaveText('First attempt saved on retry');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
  });

  test('keeps a verified older body writable and preserves divergent legacy History', async ({
    page,
  }) => {
    const documentId = 'local-history-legacy-divergence';
    await clearBodyState(page, [documentId]);
    await page.goto(route(documentId));
    const editor = page.getByRole('textbox', { name: 'Document editor' });
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await editor.click();
    await page.keyboard.insertText('Last verified draft');
    await waitForSaved(page);
    await expect
      .poll(() => readLocalHistoryPrimary(page, documentId))
      .toContain('Last verified draft');
    const olderHistory = await readLocalHistoryPrimary(page, documentId);
    const verifiedPrimary = await page.evaluate(
      (id) => localStorage.getItem(`lash:body:${id}`),
      documentId,
    );
    if (!verifiedPrimary || !olderHistory) throw new Error('Missing verified fixture');

    await page.keyboard.press('End');
    await page.keyboard.insertText(' with divergent history');
    await waitForSaved(page);
    await expect
      .poll(() => readLocalHistoryPrimary(page, documentId))
      .toContain('with divergent history');
    const divergentHistory = await readLocalHistoryPrimary(page, documentId);
    if (!divergentHistory) throw new Error('Missing divergent History fixture');
    const { head } = JSON.parse(divergentHistory).payload as { head: string };
    await page.goto('/');
    // Recreate a pre-fix split state without fabricating format or integrity bytes.
    await page.evaluate(({ id, raw }) => localStorage.setItem(`lash:body:${id}`, raw), {
      id: documentId,
      raw: verifiedPrimary,
    });
    await page.goto(route(documentId));

    await expect(editor).toHaveText('Last verified draft');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await selectDiscussionTab(page, 'history');
    const history = page.getByRole('tabpanel', { name: 'History' });
    await expect(history).toContainText(
      'Version history is paused because it does not match the saved draft.',
    );
    await expect(history.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0);
    const preview = history.getByRole('button', { name: 'Preview saved version' });
    const snapshot = history.getByRole('textbox', { name: 'Saved version text' });
    await preview.focus();
    await page.keyboard.press('Enter');
    await expect(snapshot).toHaveValue('Last verified draft with divergent history');
    await expect(snapshot).toHaveAttribute('readonly', '');
    expect(await page.evaluate((id) => localStorage.getItem(`lash:body:${id}`), documentId)).toBe(
      verifiedPrimary,
    );
    expect(await readLocalHistoryPrimary(page, documentId)).toBe(divergentHistory);

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' and safely continued');
    await waitForSaved(page);
    await page.waitForTimeout(1_900);
    expect(await readLocalHistoryPrimary(page, documentId)).toBe(divergentHistory);
    await page.reload();
    await expect(editor).toHaveText('Last verified draft and safely continued');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' through one more save');
    await waitForSaved(page);
    await page.reload();
    await expect(editor).toHaveText(
      'Last verified draft and safely continued through one more save',
    );
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    expect(
      await page.evaluate(
        (id) => JSON.parse(localStorage.getItem(`lash:body:${id}`) ?? '{}').divergentHistoryHead,
        documentId,
      ),
    ).toBe(head);
    expect(await readLocalHistoryPrimary(page, documentId)).toBe(divergentHistory);

    await selectDiscussionTab(page, 'history');
    await expect(history).toContainText(
      'Version history is paused because it does not match the saved draft.',
    );
    await preview.click();
    await expect(snapshot).toHaveValue('Last verified draft with divergent history');
    await history.getByRole('button', { name: 'Hide saved version' }).click();
    await page.evaluate(
      async ({ id, raw }) => {
        const request = indexedDB.open('lash-history');
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const transaction = database.transaction('primary', 'readwrite');
          transaction.objectStore('primary').put({ documentId: id, raw });
          await new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
          });
        } finally {
          database.close();
        }
      },
      { id: documentId, raw: olderHistory },
    );
    await preview.click();
    await expect(history).toContainText('This saved version is no longer available to preview.');
    await expect(snapshot).toHaveCount(0);
    await expect(editor).toHaveAttribute('contenteditable', 'true');

    await page.addInitScript(() => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name, version) {
        // Keep History's open pending. Browser-local body writes still use real storage.
        return name === 'lash-history'
          ? (new EventTarget() as unknown as IDBOpenDBRequest)
          : open.call(this, name, version);
      };
    });
    await page.reload();
    await expect(editor).toHaveText(
      'Last verified draft and safely continued through one more save',
    );
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await selectDiscussionTab(page, 'history');
    await expect(history).toContainText(
      'Version history is paused because it does not match the saved draft.',
    );
    await expect(preview).toHaveCount(0);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' while History is loading');
    await waitForSaved(page);
    await page.reload();
    await expect(editor).toHaveText(
      'Last verified draft and safely continued through one more save while History is loading',
    );
    await expect(editor).toHaveAttribute('contenteditable', 'true');
  });

  test('shows a truthful save failure when a failed image retains a blob preview', async ({
    page,
  }) => {
    const documentId = 'local-body-blob-preview';
    await clearBodyState(page, [documentId]);
    await page.goto(route(documentId));
    await waitForEditor(page);
    await typeIntoEditor(page, 'Verified body before failed image');
    await waitForSaved(page);
    await typeIntoEditor(page, ' with a rotated backup');
    await waitForSaved(page);
    const verifiedSlots = await page.evaluate(
      (id) => ({
        primary: window.localStorage.getItem(`lash:body:${id}`),
        backup: window.localStorage.getItem(`lash:body-backup:${id}`),
      }),
      documentId,
    );

    await page.evaluate(() => {
      const editor = (window as LashTestWindow).__lashEditor;
      if (!editor) throw new Error('Lash editor test hook is unavailable');
      editor.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              src: '',
              alt: 'Failed upload',
              width: 360,
              status: 'error',
              uploadId: 'failed-upload',
              previewSrc: 'blob:https://lash.local/failed-upload',
              progress: 0,
              error: 'Mock upload failed',
            },
          },
        ],
      });
    });

    await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'error', {
      timeout: 2_500,
    });
    await expect(page.getByTestId('local-body-notice')).toContainText('Save failed');
    expect(
      await page.evaluate(
        (id) => ({
          primary: window.localStorage.getItem(`lash:body:${id}`),
          backup: window.localStorage.getItem(`lash:body-backup:${id}`),
        }),
        documentId,
      ),
    ).toEqual(verifiedSlots);
  });

  test('keeps editing/export available when localStorage acquisition is blocked', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const pageErrors: string[] = [];
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('blocked storage', 'SecurityError');
        },
      });
    });
    const blockedPage = await context.newPage();
    blockedPage.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await blockedPage.goto(`${route('local-body-storage-blocked')}?realtime=off`);
      await expect(blockedPage.locator('.ProseMirror')).toBeVisible();
      await expect(blockedPage.getByTestId('local-body-notice')).toContainText(
        'Local saving is unavailable',
      );
      await expect(blockedPage.getByTestId('autosave-indicator')).toHaveCount(0);
      await blockedPage.locator('.ProseMirror').click();
      await blockedPage.keyboard.type('Copyable rescue text');
      await expect(blockedPage.locator('.ProseMirror')).toContainText('Copyable rescue text');
      await selectDiscussionTab(blockedPage, 'history');
      await expect(blockedPage.getByRole('tabpanel', { name: 'History' })).toContainText(
        'Version history is paused while local saving is unavailable.',
      );
      await expect(
        blockedPage.getByRole('button', { name: 'Download Markdown', exact: true }),
      ).toBeEnabled();
      await blockedPage.waitForTimeout(700);
      expect(
        await blockedPage.evaluate(() => (window as LashTestWindow).__lashLastSave ?? null),
      ).toBeNull();
      expect(await downloadMarkdownText(blockedPage)).toContain('Copyable rescue text');
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('saves and cold-opens a 100 KB local body within the browser budget', async ({ page }) => {
    const documentId = 'local-body-100kb';
    const payload = `FLOW-01 100 KB payload ${'x'.repeat(100 * 1024)}`;
    await clearBodyState(page, [documentId]);
    await page.goto(route(documentId));
    await waitForEditor(page);

    const saveStartedAt = Date.now();
    const applied = await page.evaluate((text) => {
      const editor = (window as LashTestWindow).__lashEditor;
      if (!editor) throw new Error('Lash editor test hook is unavailable');
      return editor.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text }],
          },
        ],
      });
    }, payload);
    expect(applied).toBe(true);
    await waitForSaved(page);
    const saveVisibleMs = Date.now() - saveStartedAt;

    const reloadStartedAt = Date.now();
    await page.reload();
    await waitForEditor(page);
    await expect.poll(() => editorText(page)).toHaveLength(payload.length);
    const coldOpenMs = Date.now() - reloadStartedAt;

    const metrics = {
      bytes: new TextEncoder().encode(payload).byteLength,
      saveVisibleMs,
      coldOpenMs,
    };
    console.info('local-body-100kb metrics', JSON.stringify(metrics));
    expect(metrics.bytes).toBeGreaterThanOrEqual(100 * 1024);
    expect(metrics.saveVisibleMs, JSON.stringify(metrics)).toBeLessThanOrEqual(1_000);
    expect(metrics.coldOpenMs, JSON.stringify(metrics)).toBeLessThanOrEqual(2_500);
  });

  test('keeps repeated durable-to-visible save transitions below the trust p95', async ({
    page,
  }) => {
    const documentId = 'local-body-save-transition-p95';
    const sampleCount = 12;
    const payloadTail = 'x'.repeat(100 * 1024);
    await clearBodyState(page, [documentId]);
    await page.goto(route(documentId));
    await waitForEditor(page);

    const samples: SaveTransitionMetric[] = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      samples.push(
        await page.evaluate(
          async ({ id, index, tail }) => {
            const editor = (window as LashTestWindow).__lashEditor;
            if (!editor) throw new Error('Lash editor test hook is unavailable');
            const key = `lash:body:${id}`;
            const previous = JSON.parse(window.localStorage.getItem(key) ?? '{}') as {
              writeId?: string;
            };
            const marker = `FLOW-01 save transition ${index}`;
            const startedAt = performance.now();
            let durableMs: number | null = null;
            let sawUnsavedState = false;
            let savedNeverPrecededDurable = true;

            editor.commands.setContent({
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: `${marker} ${tail}` }],
                },
              ],
            });

            return await new Promise<SaveTransitionMetric>((resolve, reject) => {
              const timeoutAt = startedAt + 2_500;
              const observe = () => {
                const now = performance.now();
                const indicator = document.querySelector<HTMLElement>(
                  '[data-testid="autosave-indicator"]',
                );
                const status = indicator?.dataset.status ?? null;
                if (status !== null && status !== 'saved') {
                  sawUnsavedState = true;
                }

                const current = JSON.parse(window.localStorage.getItem(key) ?? '{}') as {
                  writeId?: string;
                  doc?: unknown;
                };
                if (
                  durableMs === null &&
                  current.writeId &&
                  current.writeId !== previous.writeId &&
                  JSON.stringify(current.doc).includes(marker)
                ) {
                  durableMs = now - startedAt;
                }

                if (sawUnsavedState && status === 'saved') {
                  if (durableMs === null) savedNeverPrecededDurable = false;
                  resolve({
                    durableMs: durableMs ?? Number.POSITIVE_INFINITY,
                    savedVisibleMs: now - startedAt,
                    savedNeverPrecededDurable,
                  });
                  return;
                }
                if (now >= timeoutAt) {
                  reject(new Error(`save transition ${index} timed out at status ${status}`));
                  return;
                }
                requestAnimationFrame(observe);
              };
              requestAnimationFrame(observe);
            });
          },
          { id: documentId, index: sample, tail: payloadTail },
        ),
      );
    }

    const percentile = (values: number[], ratio: number) => {
      const ordered = [...values].sort((left, right) => left - right);
      return ordered[Math.ceil(ordered.length * ratio) - 1] ?? Number.POSITIVE_INFINITY;
    };
    const metrics = {
      sampleCount,
      durableMedianMs: percentile(
        samples.map((sample) => sample.durableMs),
        0.5,
      ),
      durableP95Ms: percentile(
        samples.map((sample) => sample.durableMs),
        0.95,
      ),
      savedVisibleMedianMs: percentile(
        samples.map((sample) => sample.savedVisibleMs),
        0.5,
      ),
      savedVisibleP95Ms: percentile(
        samples.map((sample) => sample.savedVisibleMs),
        0.95,
      ),
      savedVisibleMaxMs: Math.max(...samples.map((sample) => sample.savedVisibleMs)),
    };
    console.info('local-body-save-transition metrics', JSON.stringify({ metrics, samples }));

    expect(samples.every((sample) => sample.savedNeverPrecededDurable)).toBe(true);
    expect(metrics.savedVisibleP95Ms, JSON.stringify({ metrics, samples })).toBeLessThan(500);
  });

  test('detects a newer local-tab revision and prevents the stale tab from overwriting', async ({
    page,
  }) => {
    const documentId = 'local-body-conflict';
    await clearBodyState(page, [documentId]);
    await page.goto(route(documentId));
    await waitForEditor(page);
    await typeIntoEditor(page, 'Shared baseline');
    await waitForSaved(page);

    const secondPage = await page.context().newPage();
    try {
      await secondPage.goto(route(documentId));
      await waitForEditor(secondPage);
      await typeIntoEditor(secondPage, ' newer tab edit');
      await waitForSaved(secondPage);
      const newerPrimary = await secondPage.evaluate(
        (id) => window.localStorage.getItem(`lash:body:${id}`),
        documentId,
      );

      await expect(page.getByTestId('local-body-notice')).toContainText('changed in another tab');
      await expect(page.getByTestId('autosave-indicator')).toHaveCount(0);
      await typeIntoEditor(page, ' stale local edit');
      await page.waitForTimeout(700);
      expect(
        await page.evaluate((id) => window.localStorage.getItem(`lash:body:${id}`), documentId),
      ).toBe(newerPrimary);
    } finally {
      await secondPage.close();
    }
  });
});
