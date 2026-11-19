import { expect, test, type Page } from '@playwright/test';

const documentPath = (suffix: string) => `/doc/prod-j10-one-step-comment-${suffix}`;
const documentText = 'A clear launch note needs one thoughtful comment';
const selectedQuote = 'thoughtful comment';
const threadStorageKey = (suffix: string) =>
  `lash:chat-threads:prod-j10-one-step-comment-${suffix}`;

const openFreshDocument = async (page: Page, suffix: string) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(documentPath(suffix));

  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.type(documentText);
  await expect(editor).toHaveText(documentText);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

  await page.keyboard.down('Shift');
  for (let index = 0; index < selectedQuote.length; index += 1) {
    await page.keyboard.press('ArrowLeft');
  }
  await page.keyboard.up('Shift');
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
        return { selected: selection.toString(), prefix: prefix.toString() };
      }),
    )
    .toEqual({
      selected: selectedQuote,
      prefix: documentText.slice(0, -selectedQuote.length),
    });
  await page.getByRole('button', { name: 'Discussion', exact: true }).click();
  await expect(page.getByTestId('rail-tab-chat')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('doc-chat-panel')).toBeVisible();
  await expect(page.getByTestId('chat-create-thread')).toBeEnabled();

  return editor;
};

const openFreshUnselectedDocument = async (page: Page, suffix: string) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(documentPath(suffix));

  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.type(documentText);
  await expect(editor).toContainText(documentText);

  const discussion = page.getByRole('button', { name: 'Discussion', exact: true });
  await discussion.click();
  await expect(page.getByTestId('rail-tab-chat')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('doc-chat-panel')).toBeVisible();

  return { discussion, editor };
};

const persistedThreads = (page: Page, key: string) =>
  page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);

test.describe('PROD-J10 one-step selected-text comment', () => {
  test('guides an unselected desktop comment target and focuses the editor in place', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { editor } = await openFreshUnselectedDocument(page, 'guided-desktop');

    const guide = page.getByTestId('chat-selection-guide');
    const recovery = page.getByRole('button', {
      name: 'Select text in document',
      exact: true,
    });
    await expect(guide).toContainText('Select text in the document to start a comment.');
    await expect(recovery).toBeEnabled();
    await expect(page.getByTestId('chat-create-thread')).toHaveCount(0);
    await expect(page.getByTestId('chat-filter-author')).toHaveCount(0);
    await expect(page.getByTestId('chat-filter-ai')).toHaveCount(0);
    await expect(page.getByTestId('chat-filter-clear')).toHaveCount(0);
    await expect(page.getByTestId('chat-empty')).toHaveCount(0);

    await recovery.click();

    await expect(editor).toBeFocused();
    await expect(page.getByTestId('doc-chat-panel')).toBeVisible();
    await expect(page.getByTestId('rail-tab-chat')).toHaveAttribute('aria-selected', 'true');
  });

  test('guides an unselected phone target through modal close before editor focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { discussion, editor } = await openFreshUnselectedDocument(page, 'guided-mobile');
    const recovery = page.getByRole('button', {
      name: 'Select text in document',
      exact: true,
    });
    await expect(recovery).toBeEnabled();
    await expect(page.getByTestId('chat-filter-author')).toHaveCount(0);
    await expect(page.getByTestId('chat-filter-ai')).toHaveCount(0);
    await expect(page.getByTestId('chat-filter-clear')).toHaveCount(0);

    const recoveryMetrics = await recovery.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
        width: rect.width,
      };
    });
    expect(recoveryMetrics.width).toBeGreaterThanOrEqual(44);
    expect(recoveryMetrics.height).toBeGreaterThanOrEqual(44);
    expect(recoveryMetrics.left).toBeGreaterThanOrEqual(0);
    expect(recoveryMetrics.right).toBeLessThanOrEqual(recoveryMetrics.viewportWidth);
    expect(recoveryMetrics.documentWidth).toBeLessThanOrEqual(recoveryMetrics.viewportWidth);

    await page.evaluate(() => {
      const focusTraceWindow = window as Window & { __guidedCommentFocusTrace?: string[] };
      focusTraceWindow.__guidedCommentFocusTrace = [];
      document.addEventListener(
        'focusin',
        (event) => {
          const target = event.target as HTMLElement | null;
          focusTraceWindow.__guidedCommentFocusTrace?.push(
            target?.getAttribute('data-testid') ?? target?.className ?? target?.tagName ?? '',
          );
        },
        { once: false },
      );
    });
    await recovery.click();

    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'false');
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector('.lash-canvas')?.hasAttribute('inert') ?? true),
      )
      .toBe(false);
    await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('');
    await expect(editor).toBeFocused();
    await expect(discussion).toHaveAttribute('aria-expanded', 'false');
    await expect(discussion).not.toBeFocused();
    const focusTrace = await page.evaluate(
      () =>
        (window as Window & { __guidedCommentFocusTrace?: string[] }).__guidedCommentFocusTrace ??
        [],
    );
    expect(focusTrace).not.toContain('topbar-discussion-button');

    await page.keyboard.down('Shift');
    for (let index = 0; index < selectedQuote.length; index += 1) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.up('Shift');
    await discussion.click();

    await expect(page.getByTestId('doc-chat-panel')).toBeVisible();
    await expect(page.getByTestId('chat-selection-guide')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeEnabled();
  });

  test('drafts before persistence, cancels cleanly, and posts the exact first comment', async ({
    page,
  }) => {
    const suffix = 'desktop';
    const storageKey = threadStorageKey(suffix);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFreshDocument(page, suffix);

    const addComment = page.getByRole('button', { name: 'Add comment', exact: true });
    await expect(addComment).toBeVisible();
    await addComment.click();

    const composer = page.getByTestId('chat-new-thread-composer');
    const comment = page.getByRole('textbox', { name: 'Comment' });
    await expect(composer).toBeVisible();
    await expect(composer.getByTestId('chat-new-thread-quote')).toHaveText(selectedQuote);
    await expect(comment).toBeFocused();
    await expect(page.getByTestId('chat-count')).toHaveText('0 threads');
    await expect(page.getByTestId('chat-thread')).toHaveCount(0);
    await expect(page.getByTestId('chat-thread-list')).toHaveCount(0);
    await expect(page.getByTestId('chat-document-anchor-marker')).toHaveCount(0);
    await expect.poll(() => persistedThreads(page, storageKey)).toBeNull();

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(composer).toHaveCount(0);
    await expect(addComment).toBeFocused();
    await expect(page.getByTestId('chat-count')).toHaveText('0 threads');
    await expect(page.getByTestId('chat-thread')).toHaveCount(0);
    await expect(page.getByTestId('chat-document-anchor-marker')).toHaveCount(0);
    await expect.poll(() => persistedThreads(page, storageKey)).toBeNull();

    await addComment.click();
    await comment.fill('   ');
    await expect(page.getByRole('button', { name: 'Post comment' })).toBeDisabled();

    await comment.fill('   Please clarify the owner before launch.   ');
    await page.getByRole('button', { name: 'Post comment' }).click();

    await expect(composer).toHaveCount(0);
    await expect(page.getByTestId('chat-count')).toHaveText('1 thread');
    await expect(page.getByTestId('chat-thread')).toHaveCount(1);
    await expect(page.getByTestId('chat-document-anchor-marker')).toHaveCount(1);
    await expect(page.getByTestId('chat-message')).toHaveCount(1);
    await expect(page.getByTestId('chat-message')).toHaveAttribute('data-author-id', 'local-user');
    await expect(page.getByTestId('chat-message')).toHaveText(
      'Please clarify the owner before launch.',
    );
    const postedThread = page.getByTestId('chat-thread');
    await expect(postedThread).toBeFocused();
    await expect(postedThread).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('chat-post-status')).toHaveText('Comment posted.');

    await expect
      .poll(async () => {
        const value = await persistedThreads(page, storageKey);
        return value ? (JSON.parse(value) as Array<unknown>) : [];
      })
      .toHaveLength(1);
    const storedThreads = JSON.parse((await persistedThreads(page, storageKey)) ?? '[]') as Array<{
      messages: Array<{ body: string }>;
    }>;
    expect(storedThreads[0]?.messages).toHaveLength(1);
    expect(storedThreads[0]?.messages[0]?.body).toBe('Please clarify the owner before launch.');
  });

  test('keeps the draft composer contained and touch actions at least 44px wide and tall', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFreshDocument(page, 'mobile');
    const addComment = page.getByRole('button', { name: 'Add comment', exact: true });
    const addCommentBox = await addComment.boundingBox();
    expect(addCommentBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(addCommentBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await addComment.click();

    const composer = page.getByTestId('chat-new-thread-composer');
    await expect(composer).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('after-mobile-composer.png'),
    });
    const metrics = await composer.evaluate((node) => {
      const textarea = node.querySelector<HTMLTextAreaElement>('textarea');
      const actions = [...node.querySelectorAll<HTMLButtonElement>('button')];
      const composerRect = node.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        composerLeft: composerRect.left,
        composerRight: composerRect.right,
        textareaWidth: textarea?.getBoundingClientRect().width ?? 0,
        actions: actions.map((action) => {
          const rect = action.getBoundingClientRect();
          return { label: action.textContent?.trim(), width: rect.width, height: rect.height };
        }),
      };
    });

    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.composerLeft).toBeGreaterThanOrEqual(0);
    expect(metrics.composerRight).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.textareaWidth).toBeGreaterThan(0);
    expect(metrics.actions.map((action) => action.label)).toEqual([
      'Cancel',
      'Open email draft',
      'Post comment',
    ]);
    for (const action of metrics.actions) {
      expect(action.width).toBeGreaterThanOrEqual(44);
      expect(action.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('keeps Chat current while the mobile comment composer is primary', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFreshDocument(page, 'mobile-orientation');

    const chatTab = page.getByTestId('rail-tab-chat');
    const historyTab = page.getByTestId('rail-tab-history');
    await expect(chatTab).toHaveAttribute('aria-selected', 'true');
    await expect(historyTab).toHaveAttribute('aria-selected', 'false');

    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(page.getByTestId('chat-new-thread-composer')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Comment' })).toBeFocused();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

    await expect(chatTab).toHaveAttribute('aria-selected', 'true');
    await expect(chatTab).toHaveAttribute('data-active', 'true');
    await expect(historyTab).toHaveAttribute('aria-selected', 'false');
    await expect(historyTab).toHaveAttribute('data-active', 'false');
  });
});
