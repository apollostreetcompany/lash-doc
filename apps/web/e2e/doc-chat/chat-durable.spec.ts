import { expect, type Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';

import { enableDevelopmentLoopback, test } from '../development-loopback-worker';
import { selectDiscussionTab } from '../discussion-tabs';

type LashTestWindow = Window & {
  __lashEditor?: Editor;
};

const EMPTY_DOC = '<p></p>';
const waitForEditor = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
  await expect(page.locator('.ProseMirror')).toBeVisible();
};

const editorText = (page: Page) =>
  page.evaluate(
    () => (window as LashTestWindow).__lashEditor?.getText({ blockSeparator: '\n' }) ?? '',
  );

const seedEmptyDoc = async (page: Page) => {
  await waitForEditor(page);
  await page.evaluate((content) => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.setContent(content);
  }, EMPTY_DOC);
};

const typeIntoEditor = async (page: Page, text: string) => {
  await page.evaluate((content) => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.chain().focus('end').insertContent(content).run();
  }, text);
  await expect.poll(() => editorText(page)).toContain(text);
};

const selectText = async (page: Page, needle: string) => {
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

const createThreadWithReply = async (page: Page, reply: string) => {
  await expect(page.getByTestId('chat-create-thread')).toBeEnabled();
  await page.getByTestId('chat-create-thread').click();
  await page.getByTestId('chat-new-thread-textarea').fill('Please review this target.');
  await page.getByTestId('chat-post-thread').click();
  await expect(page.getByTestId('chat-thread')).toHaveCount(1);
  await expect(page.getByTestId('chat-anchor-row')).toBeVisible();
  await expect(page.getByTestId('chat-current-target')).toContainText('target');
  await expect(page.getByTestId('chat-document-anchor-marker')).toBeVisible();
  await page.getByTestId('chat-reply-input').fill(reply);
  await page.getByTestId('chat-add-reply').click();
  await expect(page.getByTestId('chat-message').filter({ hasText: reply })).toBeVisible();
};

const selectedEditorText = (page: Page) =>
  page.evaluate(() => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, '\n');
  });

const expectAnchorJumpSelects = async (page: Page, needle: string) => {
  await expect(page.getByTestId('chat-jump-anchor')).toBeEnabled();
  await page.evaluate(() => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.focus('end');
  });
  await page.getByTestId('chat-jump-anchor').click();
  await expect(page.getByTestId('chat-anchor-jump-status')).toContainText(
    `Selected ${needle} in the document.`,
  );
  await expect.poll(() => selectedEditorText(page)).toBe(needle);
};

test.describe('durable comments', () => {
  test('threads, replies, resolve, and reopen survive reload', async ({ page }) => {
    const docId = `bead-35-chat-local-${Date.now()}`;
    await page.goto(`/doc/${docId}`);
    await seedEmptyDoc(page);
    await typeIntoEditor(page, 'Durable target thread');
    await selectDiscussionTab(page, 'history');
    await expect(page.getByTestId('history-version').first()).toBeVisible();

    await selectDiscussionTab(page, 'chat');
    await selectText(page, 'target');
    await createThreadWithReply(page, 'Please check this wording');
    await expectAnchorJumpSelects(page, 'target');
    await page.getByTestId('chat-resolve-thread').click();
    await expect(page.getByTestId('chat-thread-status')).toContainText('Resolved');

    await page.reload();
    await waitForEditor(page);
    await selectDiscussionTab(page, 'chat');
    await expect(page.getByTestId('chat-thread')).toHaveCount(1);
    await expect(page.getByTestId('chat-anchor-row')).toBeVisible();
    await expect(page.getByTestId('chat-current-target')).toContainText('target');
    await expect(page.getByTestId('chat-orphaned')).toHaveCount(0);
    await expect(page.getByTestId('chat-document-anchor-marker')).toBeVisible();
    await expectAnchorJumpSelects(page, 'target');
    await expect(
      page.getByTestId('chat-message').filter({ hasText: 'Please check this wording' }),
    ).toBeVisible();
    await expect(page.getByTestId('chat-thread-status')).toContainText('Resolved');

    await page.getByTestId('chat-reopen-thread').click();
    await expect(page.getByTestId('chat-thread-status')).toContainText('Open');
  });

  test('development loopback can edit the body but cannot post private shared comments', async ({
    page,
    developmentLoopbackWorker: worker,
  }) => {
    await enableDevelopmentLoopback(page, worker, 'comment-fixture-owner');
    await page.goto(`/doc/bead-35-chat-loopback-${Date.now()}`);
    await seedEmptyDoc(page);
    await typeIntoEditor(page, 'Shared target section');
    await expect(page.getByTestId('realtime-sync-state')).toHaveText('Saved');

    await selectDiscussionTab(page, 'chat');
    await selectText(page, 'target');
    await expect(page.getByTestId('chat-connection-unavailable')).toHaveText(
      'Shared discussion is unavailable on this connection.',
    );
    await expect(page.getByTestId('chat-create-thread')).toBeDisabled();
    await expect(page.getByTestId('chat-thread')).toHaveCount(0);
  });
});
