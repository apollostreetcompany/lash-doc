import { expect, test, type Locator, type Page } from '@playwright/test';

const quote = 'launch';
const before = 'Private context: launch once, then ';
const original = before + quote;
const note = 'Does this date still work for A & B?';

const editorFor = (page: Page) => page.getByRole('textbox', { name: 'Document editor' });
const discussion = (page: Page) => page.getByRole('button', { name: 'Discussion', exact: true });
const contextualComment = (page: Page) =>
  page.getByRole('button', { name: 'Comment', exact: true });
const draft = (page: Page) => page.getByTestId('chat-new-thread-composer');
const comment = (page: Page) => draft(page).getByRole('textbox', { name: 'Comment', exact: true });

async function expectNativeSelection(editor: Locator, prefix: string, text: string) {
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
        return { prefix: prefix.toString(), text: range.toString() };
      }),
    )
    .toEqual({ prefix, text });
}

async function highlightSecondOccurrence(page: Page) {
  const editor = editorFor(page);
  await page.goto(`/doc/contextual-comment-${crypto.randomUUID()}`);
  await expect(editor).toBeEditable();
  await editor.click();
  await page.keyboard.insertText(original);
  await expect(editor).toHaveText(original);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');
  await expect(discussion(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(contextualComment(page)).toHaveCount(0);
  await expectNativeSelection(editor, original, '');

  const wordModifier = process.platform === 'darwin' ? 'Alt' : 'Control';
  await page.keyboard.press(`${wordModifier}+Shift+ArrowLeft`);
  await expectNativeSelection(editor, before, quote);
  await expect(discussion(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(contextualComment(page)).toBeVisible();
  await expect(editor).toBeFocused();
  return editor;
}

async function expectComposer(page: Page) {
  await expect(page.getByTestId('topbar-discussion-button')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(draft(page).getByTestId('chat-new-thread-quote')).toHaveText(quote);
  await expect(comment(page)).toBeFocused();
}

async function captureEmailDrafts(page: Page) {
  const addresses: string[] = [];
  await page.exposeFunction('recordCommentEmailDraft', (address: string) => {
    addresses.push(address);
  });
  await page.evaluate(() => {
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.protocol !== 'mailto:') {
        nativeClick.call(this);
        return;
      }
      // Observe the actual handoff while keeping the mail client closed.
      const recorder = window as Window & {
        recordCommentEmailDraft?(href: string): Promise<void>;
      };
      void recorder.recordCommentEmailDraft?.(this.href);
    };
  });
  return addresses;
}

test('keyboard highlight opens an exact comment, prepares email, and saves the thread', async ({
  page,
}, testInfo) => {
  const editor = await highlightSecondOccurrence(page);
  await page.keyboard.press('Tab');
  await expect(contextualComment(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expectComposer(page);
  const email = draft(page).getByRole('button', { name: 'Open email draft', exact: true });
  await expect(email).toBeDisabled();
  await comment(page).fill(note);

  const addresses = await captureEmailDrafts(page);
  await email.click();
  await expect.poll(() => addresses).toHaveLength(1);
  const handoff = new URL(addresses[0]);
  expect(handoff.protocol).toBe('mailto:');
  expect(handoff.pathname).toBe('');
  expect(handoff.searchParams.get('subject')).toBe('Comment on a passage');
  expect(handoff.searchParams.get('body')).toBe(`> ${quote}\r\n\r\n${note}`);
  expect([...handoff.searchParams.keys()].sort()).toEqual(['body', 'subject']);

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  await page.evaluate(() => navigator.clipboard.writeText('Replace this clipboard text'));
  await draft(page).getByRole('button', { name: 'Copy quote and comment', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n')),
    )
    .toBe(`> ${quote}\n\n${note}`);
  const copied = draft(page).getByText('Quote and comment copied.', { exact: true });
  await expect(copied).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('contextual-comment-email.png') });
  await comment(page).fill(`${note} Let’s confirm.`);
  await expect(copied).toHaveCount(0);
  await comment(page).fill(note);
  await expect(comment(page)).toHaveValue(note);
  await expect(page.getByRole('article', { name: `Thread on ${quote}` })).toHaveCount(0);

  await draft(page).getByRole('button', { name: 'Post comment', exact: true }).click();
  const thread = page.getByRole('article', { name: `Thread on ${quote}`, exact: true });
  await expect(thread.getByText(note, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close activity panel' }).click();
  await expect(discussion(page)).toHaveAttribute('aria-expanded', 'false');

  await page.route('**/api/account/session', (route) =>
    route.fulfill({ status: 204, headers: { 'x-lash-account-status': 'authenticated' } }),
  );
  let promotionRequests = 0;
  await page.route('**/api/documents/*/promote', (route) => {
    promotionRequests += 1;
    return route.abort();
  });
  await page.reload();
  await expect(discussion(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(thread).toHaveCount(0);
  await page.getByRole('button', { name: 'Share document', exact: true }).click();
  const share = page.getByRole('dialog', { name: /^Share “/u });
  await share.getByRole('button', { name: 'Save to my account', exact: true }).click();
  await expect(share.getByRole('alert')).toContainText('1 comment and 0 suggestions');
  await expect(share.getByRole('button', { name: 'Save to my account' })).toHaveCount(0);
  expect(promotionRequests).toBe(0);
  await share.getByRole('button', { name: 'Close sharing', exact: true }).click();

  await discussion(page).click();
  await expect(thread.getByText(note, { exact: true })).toBeVisible();
  await thread.getByRole('button', { name: `Show document target for thread on ${quote}` }).click();
  await expectNativeSelection(editor, before, quote);
});

test.describe('contextual Comment on a narrow touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('taps the highlighted text action and focuses the quoted draft', async ({
    page,
  }, testInfo) => {
    await highlightSecondOccurrence(page);
    const action = contextualComment(page);
    await expect(action).toBeInViewport({ ratio: 1 });
    const size = await action.evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a native button.');
      return { width: button.offsetWidth, height: button.offsetHeight };
    });
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);

    await action.tap();
    await expectComposer(page);
    await page.screenshot({ path: testInfo.outputPath('contextual-comment-touch.png') });
    await comment(page).fill(note);
    await draft(page).getByRole('button', { name: 'Post comment', exact: true }).tap();
    await expect(
      page.getByRole('article', { name: `Thread on ${quote}` }).getByText(note, { exact: true }),
    ).toBeVisible();
  });
});
