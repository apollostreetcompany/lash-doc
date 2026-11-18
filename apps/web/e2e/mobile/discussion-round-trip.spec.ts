import { devices, expect, test, type Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';

type LashTestWindow = Window & {
  __lashEditor?: Editor;
};

test.use({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
});

const waitForEditorReady = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
  await expect(page.locator('[data-body-mutation-locked="false"]')).toBeVisible();
};

const persistedHistoryEntryCount = (page: Page, documentId: string) =>
  page.evaluate(
    ({ activeDocumentId }) =>
      new Promise<number>((resolve, reject) => {
        const openRequest = window.indexedDB.open('lash-history');
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const transaction = database.transaction('primary', 'readonly');
          const readRequest = transaction.objectStore('primary').get(activeDocumentId);
          readRequest.onerror = () => reject(readRequest.error);
          readRequest.onsuccess = () => {
            try {
              const raw = (readRequest.result as { raw?: unknown } | undefined)?.raw;
              if (typeof raw !== 'string') {
                resolve(0);
                return;
              }
              const envelope = JSON.parse(raw) as {
                payload?: { entries?: unknown[] };
              };
              resolve(envelope.payload?.entries?.length ?? 0);
            } catch (error) {
              reject(error);
            } finally {
              database.close();
            }
          };
        };
      }),
    { activeDocumentId: documentId },
  );

const setDocumentText = async (page: Page, documentId: string, text: string) => {
  await page.evaluate((content) => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.setContent(`<p>${content}</p>`);
  }, text);
  await expect(page.getByTestId('lash-editor-content')).toContainText(text);
  await expect.poll(() => persistedHistoryEntryCount(page, documentId)).toBeGreaterThan(0);
};

const selectEditorText = async (page: Page, needle: string) => {
  await page.evaluate((target) => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    const text = editor.getText({ blockSeparator: '\n' });
    const index = text.indexOf(target);
    if (index < 0) throw new Error(`Cannot find ${target}`);
    editor
      .chain()
      .focus()
      .setTextSelection({ from: index + 1, to: index + target.length + 1 })
      .run();
  }, needle);
};

const selectedEditorText = (page: Page) =>
  page.evaluate(() => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, '\n');
  });

test.describe('mobile Discussion to document round trip', () => {
  test('opens directly, keeps labels readable, and returns Show focus to the target', async ({
    page,
  }) => {
    await page.goto('/doc/str-j07-mobile-discussion');
    await waitForEditorReady(page);
    await setDocumentText(page, 'str-j07-mobile-discussion', 'Mobile discussion target text');
    await selectEditorText(page, 'target');

    const discussion = page.getByTestId('topbar-discussion-button');
    const share = page.getByTestId('topbar-share-button');
    const tools = page.getByTestId('topbar-mobile-tools');
    await expect(discussion).toBeVisible();
    await expect(discussion).toHaveAccessibleName('Discussion');
    await expect(tools).toBeVisible();
    await expect(tools).toHaveAccessibleName('More document tools');

    await tools.tap();
    const suggestTool = page.getByTestId('mobile-suggest-mode-toggle');
    await expect(suggestTool).toBeVisible();
    await expect(suggestTool).toHaveText('Suggest wording');
    await expect(suggestTool).not.toHaveAttribute('aria-pressed');
    const toolsMetrics = await page.evaluate(() => {
      const trigger = document.querySelector<HTMLElement>('[data-testid="topbar-mobile-tools"]');
      const action = document.querySelector<HTMLElement>(
        '[data-testid="mobile-suggest-mode-toggle"]',
      );
      if (!trigger || !action) throw new Error('Mobile document tools were not rendered');
      const triggerRect = trigger.getBoundingClientRect();
      const actionRect = action.getBoundingClientRect();
      return {
        triggerHeight: triggerRect.height,
        triggerLeft: triggerRect.left,
        triggerRight: triggerRect.right,
        actionHeight: actionRect.height,
        actionLeft: actionRect.left,
        actionRight: actionRect.right,
        viewportWidth: window.innerWidth,
      };
    });
    expect(toolsMetrics.triggerHeight).toBeGreaterThanOrEqual(44);
    expect(toolsMetrics.actionHeight).toBeGreaterThanOrEqual(44);
    expect(toolsMetrics.triggerLeft).toBeGreaterThanOrEqual(0);
    expect(toolsMetrics.actionLeft).toBeGreaterThanOrEqual(0);
    expect(toolsMetrics.triggerRight).toBeLessThanOrEqual(toolsMetrics.viewportWidth);
    expect(toolsMetrics.actionRight).toBeLessThanOrEqual(toolsMetrics.viewportWidth);
    await suggestTool.tap();
    await expect(page.getByTestId('mobile-document-tools-panel')).toHaveCount(0);
    const proposal = page.getByRole('textbox', { name: 'Proposed wording' });
    await expect(proposal).toHaveValue('target');
    await expect(proposal).toBeFocused();
    await page.getByRole('button', { name: 'Cancel suggestion' }).tap();
    await page.getByRole('button', { name: 'Close activity panel' }).tap();

    await tools.tap();
    const focusTool = page.getByTestId('mobile-focus-mode-toggle');
    await expect(focusTool).toHaveText('Focus');
    await focusTool.tap();
    await expect(page.locator('.lash-app')).toHaveAttribute('data-focus-mode', 'true');
    await expect(discussion).toBeVisible();
    await expect(discussion).toHaveAttribute('aria-expanded', 'false');
    await expect(discussion).not.toHaveAttribute('aria-controls');

    const closedMetrics = await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>(
        '[data-testid="topbar-discussion-button"]',
      );
      if (!target) throw new Error('Discussion control was not rendered');
      const rect = target.getBoundingClientRect();
      return {
        height: rect.height,
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    expect(closedMetrics.height).toBeGreaterThanOrEqual(44);
    expect(closedMetrics.left).toBeGreaterThanOrEqual(0);
    expect(closedMetrics.right).toBeLessThanOrEqual(closedMetrics.viewportWidth);
    expect(closedMetrics.documentWidth).toBeLessThanOrEqual(closedMetrics.viewportWidth);

    // Touch enters Discussion directly; Share is not used as a discovery step.
    await discussion.tap();
    await expect(page.locator('.lash-app')).toHaveAttribute('data-focus-mode', 'false');
    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'true');
    await expect(discussion).toHaveAttribute('aria-expanded', 'true');
    await expect(share).toHaveAttribute('aria-expanded', 'false');
    const chatLabel = page.getByTestId('rail-tab-chat').locator('.lash-rail-tab-text');
    await expect(chatLabel).toBeVisible();
    await expect(chatLabel).toHaveText('Chat');
    await expect(page.getByTestId('rail-tab-chat')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('doc-chat-panel')).toBeVisible();
    await expect(page.locator('#rail-section-history')).toBeHidden();
    await expect(page.locator('#rail-section-ai')).toBeHidden();
    expect(
      await page.evaluate(() => document.querySelector('.lash-canvas')?.hasAttribute('inert')),
    ).toBe(true);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const rail = document.querySelector<HTMLElement>('.lash-rail');
          if (!rail) return false;
          const rect = rail.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= window.innerWidth;
        }),
      )
      .toBe(true);
    const railMetrics = await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>('.lash-rail');
      if (!rail) throw new Error('Discussion drawer was not rendered');
      const rect = rail.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
    });
    expect(railMetrics.left).toBeGreaterThanOrEqual(0);
    expect(railMetrics.right).toBeLessThanOrEqual(railMetrics.viewportWidth);

    const railControls = page.locator('.lash-rail-tabs button');
    const railControlCount = await railControls.count();
    expect(railControlCount).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < railControlCount; index += 1) {
      const control = railControls.nth(index);
      await control.evaluate((element) =>
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
      );
      await expect(control).toBeVisible();
      const geometry = await control.evaluate((element) => {
        const nav = element.closest<HTMLElement>('.lash-rail-tabs');
        if (!nav) throw new Error('Rail navigation container was not rendered');
        const controlRect = element.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        return {
          controlLeft: controlRect.left,
          controlRight: controlRect.right,
          controlHeight: controlRect.height,
          navLeft: navRect.left,
          navRight: navRect.right,
        };
      });
      expect(geometry.controlHeight).toBeGreaterThanOrEqual(44);
      expect(geometry.controlLeft).toBeGreaterThanOrEqual(geometry.navLeft - 1);
      expect(geometry.controlRight).toBeLessThanOrEqual(geometry.navRight + 1);
      const visibleLabel = control.locator('.lash-rail-tab-text');
      if ((await visibleLabel.count()) > 0) {
        await expect(visibleLabel).toBeVisible();
        await expect(visibleLabel).not.toHaveText('');
      } else {
        await expect(control).toHaveAccessibleName('Close activity panel');
      }
    }

    await page.getByTestId('chat-create-thread').tap();
    await page.getByTestId('chat-new-thread-textarea').fill('Review this target.');
    await page.getByTestId('rail-tab-history').tap();
    await expect(page.getByTestId('rail-tab-history')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#rail-section-chat')).toBeHidden();
    await expect(page.locator('#rail-section-history')).toBeVisible();
    await expect(page.locator('#rail-section-ai')).toBeHidden();
    await expect(discussion).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('rail-tab-chat').tap();
    await expect(page.getByTestId('chat-new-thread-textarea')).toHaveValue('Review this target.');
    await expect(page.getByTestId('chat-new-thread-quote')).toHaveText('target');
    await page.getByTestId('chat-post-thread').tap();
    await expect(page.getByTestId('chat-thread')).toHaveCount(1);

    // A normal keyboard close restores the actual originating control.
    await page.keyboard.press('Escape');
    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'false');
    await expect(discussion).toBeFocused();
    await expect(share).toBeEnabled();

    // Backdrop close follows the same actual-origin restoration contract.
    await discussion.tap();
    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'true');
    await page.locator('.lash-app-backdrop').tap({ position: { x: 10, y: 100 } });
    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'false');
    await expect(discussion).toBeFocused();
    await expect(share).toBeEnabled();

    await page.evaluate(() => {
      const editor = (window as LashTestWindow).__lashEditor;
      if (!editor) throw new Error('Lash editor test hook is unavailable');
      editor.commands.setTextSelection(editor.state.doc.content.size);
    });

    // Keyboard re-entry and Show exercise the no-trigger-restore navigation path.
    await discussion.focus();
    await page.keyboard.press('Enter');
    const show = page.getByTestId('chat-jump-anchor');
    await expect(show).toBeEnabled();
    await show.focus();
    await page.evaluate(() => {
      const traceWindow = window as Window & {
        __lashMobileFocusTrace?: string[];
        __lashMobileFocusTraceInstalled?: boolean;
      };
      traceWindow.__lashMobileFocusTrace = [];
      if (!traceWindow.__lashMobileFocusTraceInstalled) {
        document.addEventListener('focusin', (event) => {
          const element = event.target as HTMLElement | null;
          traceWindow.__lashMobileFocusTrace?.push(
            element?.getAttribute('data-testid') ?? element?.className ?? element?.tagName ?? '',
          );
        });
        traceWindow.__lashMobileFocusTraceInstalled = true;
      }
    });
    await page.keyboard.press('Enter');

    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'false');
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector('.lash-canvas')?.hasAttribute('inert') ?? true),
      )
      .toBe(false);
    await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('');
    await expect.poll(() => selectedEditorText(page)).toBe('target');
    await expect(page.locator('.ProseMirror')).toBeFocused();
    await expect(discussion).not.toBeFocused();
    await expect(share).not.toBeFocused();
    await expect(share).toBeEnabled();
    const focusTrace = await page.evaluate(
      () => (window as Window & { __lashMobileFocusTrace?: string[] }).__lashMobileFocusTrace ?? [],
    );
    expect(focusTrace).not.toContain('topbar-discussion-button');
    expect(focusTrace).not.toContain('topbar-share-button');
  });
});
