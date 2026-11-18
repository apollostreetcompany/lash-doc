import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  openCredentialLink,
  parseCredentialLink,
  signIn,
  waitForPath,
} from './named-account-journey';
import {
  exerciseBrowserNetworkRecovery,
  exerciseOverlappingEdits,
  exerciseRealWorkerRestart,
  expectConvergedRichBody,
  observeRoomWire,
} from './named-edit-convergence';
import { exerciseSharedSuggestions } from './named-edit-suggestions';
import { verifySharedHistory } from './verify-shared-history';
import { selectDiscussionTab } from '../discussion-tabs';

const title = (page: Page) => page.getByRole('textbox', { name: 'Document title' });
const editor = (page: Page) =>
  page.getByRole('region', { name: 'Writing canvas' }).locator('.tiptap');
const share = (page: Page) => page.getByRole('button', { name: 'Share document', exact: true });

async function appendParagraph(page: Page, text: string) {
  const body = editor(page);
  await expect(body).toBeEditable();
  await body.press('End');
  await body.press('Enter');
  await page.keyboard.insertText(text);
  await expect(body).toContainText(text);
}

async function expectUnavailable(page: Page, originalText: string) {
  await expect(title(page)).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByText(originalText, { exact: true })).toHaveCount(0);
}

const COMMENT_ANCHOR = 'Draft agenda';
const OWNER_COMMENT = 'Can we review this agenda with the team?';
const MEMBER_REPLY = 'Yes. I can walk the team through it.';

const commentThread = (page: Page) =>
  page.getByRole('article', { name: `Thread on ${COMMENT_ANCHOR}`, exact: true });

async function exerciseSharedChat(owner: Page, member: Page, testInfo: TestInfo) {
  await selectDiscussionTab(owner, 'chat');
  await selectDiscussionTab(member, 'chat');
  await owner.bringToFront();
  const paragraph = editor(owner).locator('p').filter({ hasText: COMMENT_ANCHOR });
  await paragraph.scrollIntoViewIfNeeded();
  const target = await paragraph.evaluate((element, phrase) => {
    const text = element.firstChild;
    if (!(text instanceof Text) || !text.data.startsWith(phrase)) {
      throw new Error('The comment anchor is not in the first text node.');
    }
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, phrase.length);
    const rect = range.getBoundingClientRect();
    return { start: rect.left, end: rect.right, centerY: rect.top + rect.height / 2 };
  }, COMMENT_ANCHOR);
  await owner.mouse.move(target.start + 1, target.centerY);
  await owner.mouse.down();
  await owner.mouse.move(target.end - 1, target.centerY, { steps: 8 });
  await owner.mouse.up();
  await expect
    .poll(() => owner.evaluate(() => window.getSelection()?.toString()))
    .toBe(COMMENT_ANCHOR);
  await owner.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(owner.getByTestId('chat-new-thread-quote')).toHaveText(COMMENT_ANCHOR);
  await owner.getByRole('textbox', { name: 'Comment', exact: true }).fill(OWNER_COMMENT);
  await owner.getByRole('button', { name: 'Post comment', exact: true }).click();

  const memberThread = commentThread(member);
  await expect(memberThread.getByTestId('chat-current-target')).toHaveText(COMMENT_ANCHOR);
  await expect(memberThread.getByText(OWNER_COMMENT, { exact: true })).toBeVisible();
  await memberThread
    .getByRole('textbox', { name: `Reply to thread on ${COMMENT_ANCHOR}` })
    .fill(MEMBER_REPLY);
  await memberThread.getByRole('button', { name: 'Reply', exact: true }).click();

  const ownerThread = commentThread(owner);
  await expect(ownerThread.getByText(MEMBER_REPLY, { exact: true })).toBeVisible();
  await ownerThread.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(memberThread.getByTestId('chat-thread-status')).toHaveText('Resolved');
  await member.screenshot({ path: testInfo.outputPath('shared-chat-resolved.png') });
}

async function expectSharedChatRestored(page: Page) {
  await selectDiscussionTab(page, 'chat');
  const thread = commentThread(page);
  await expect(thread.getByTestId('chat-current-target')).toHaveText(COMMENT_ANCHOR);
  await expect(thread.getByTestId('chat-thread-status')).toHaveText('Resolved');
  await expect(thread.getByTestId('chat-message')).toHaveText([OWNER_COMMENT, MEMBER_REPLY]);
  const authors = await thread
    .getByTestId('chat-message')
    .evaluateAll((messages) => messages.map((message) => message.getAttribute('data-author-id')));
  expect(authors.every(Boolean)).toBe(true);
  expect(new Set(authors).size).toBe(2);
}

test('owner and named account edit the same document, then revocation closes access', async ({
  browser,
  page: owner,
  baseURL,
}, testInfo) => {
  const restartProof = process.env.LASH_COLLAB_WORKER_RESTART_PROOF === '1';
  if (restartProof) test.setTimeout(300_000);
  if (!baseURL) throw new Error('This journey requires the configured local Lash stack.');
  const origin = new URL(baseURL).origin;
  const marker = crypto.randomUUID().slice(0, 8);
  const ownerEmail = `owner-${marker}@example.test`;
  const recipientEmail = `recipient-${marker}@example.test`;
  const unrelatedEmail = `unrelated-${marker}@example.test`;
  const originalTitle = `Launch notes ${marker}`;
  const revisedTitle = `${originalTitle} updated`;
  const originalText = `Draft agenda ${marker}`;
  const ownerEdit = 'Owner added a date.';
  const memberEdit = 'Editor added a checklist.';
  const memberContext = await browser.newContext({ baseURL });
  const unrelatedContext = await browser.newContext({ baseURL });

  try {
    const ownerWire = observeRoomWire(owner);
    await owner.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await owner.goto('/');
    await owner.getByRole('button', { name: 'New document', exact: true }).click();
    await expect(owner).toHaveURL(/\/doc\/[^/?#]+$/u);
    const localPath = new URL(owner.url()).pathname;
    await title(owner).fill(originalTitle);
    await editor(owner).click();
    await owner.keyboard.insertText(originalText);
    await expect(editor(owner)).toHaveText(originalText);
    await expect(owner.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

    const dialog = owner.getByRole('dialog', { name: /^Share /u });
    await share(owner).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('link', { name: 'Sign in to continue' }).click();
    await signIn(owner, ownerEmail, origin);
    await waitForPath(owner, localPath);
    await expect(title(owner)).toHaveValue(originalTitle);
    await expect(editor(owner)).toHaveText(originalText);

    await share(owner).click();
    const submitted = owner.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/documents/${localPath.split('/').at(-1)}/promote` &&
        response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Save to my account' }).click();
    expect((await submitted).status(), 'Save to account API status').toBe(200);
    await expect(dialog.getByRole('heading', { name: 'Saved to your account' })).toBeVisible({
      timeout: 20_000,
    });
    const access = dialog.getByRole('region', { name: 'People with access' });
    await expect(access.getByLabel('Email address')).toBeVisible();
    await access.getByLabel('Email address').fill(recipientEmail);
    await expect(access.getByText('Can edit', { exact: true }).first()).toBeVisible();
    await access.getByRole('button', { name: 'Create invite link' }).click();
    await dialog.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(dialog.getByRole('button', { name: 'Invite link copied' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Done' })).toBeInViewport({ ratio: 1 });
    await owner.screenshot({ path: testInfo.outputPath('owner-share.png') });
    const invite = parseCredentialLink(
      await owner.evaluate(() => navigator.clipboard.readText()),
      origin,
    );
    expect(invite.pathname).toMatch(/^\/join\/doc-v[0-9]+-[0-9a-f]{64}$/u);
    expect(invite.search).toBe('');
    expect(/^#invite=[A-Za-z0-9_-]{43}$/u.test(invite.hash)).toBe(true);
    const documentPath = invite.pathname.replace(/^\/join\//u, '/doc/');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(share(owner)).toBeFocused();

    const wrong = await unrelatedContext.newPage();
    await openCredentialLink(wrong, invite);
    await wrong.getByRole('link', { name: 'Sign in to accept' }).click();
    await signIn(wrong, unrelatedEmail, origin);
    await waitForPath(wrong, invite.pathname);
    await expect(
      wrong.getByText('This invitation isn’t available.', { exact: false }),
    ).toBeVisible();
    await expectUnavailable(wrong, originalText);

    const recipient = await memberContext.newPage();
    await openCredentialLink(recipient, invite);
    await waitForPath(recipient, invite.pathname);
    await expect(recipient.getByRole('heading', { name: 'Document invitation' })).toBeVisible();
    await expectUnavailable(recipient, originalText);
    await recipient.getByRole('link', { name: 'Sign in to accept' }).click();
    const member = await memberContext.newPage();
    const memberWire = observeRoomWire(member);
    await signIn(recipient, recipientEmail, origin, member);
    await waitForPath(member, documentPath);
    await expect(title(member)).toHaveValue(originalTitle);
    await expect(editor(member)).toHaveText(originalText);
    await expect(editor(member)).toBeEditable();
    const memberStatus = member.getByRole('group', { name: 'Document status' });
    await expect(memberStatus).toContainText(/Shared/u);
    await expect(memberStatus).toContainText(/Edit access|Can edit/u);

    await appendParagraph(owner, ownerEdit);
    await expect(editor(member)).toContainText(ownerEdit);
    await appendParagraph(member, memberEdit);
    await expect(editor(owner)).toContainText(memberEdit);
    await title(member).fill(revisedTitle);
    await title(member).blur();
    await expect(title(owner)).toHaveValue(revisedTitle);
    await expect(member.getByTestId('realtime-sync-state')).toHaveAttribute('data-state', 'saved');
    await member.screenshot({ path: testInfo.outputPath('named-editor.png') });
    const converged = restartProof
      ? null
      : await test.step('Overlap independent edits with existing rich text', () =>
          exerciseOverlappingEdits({
            owner,
            member,
            ownerWire,
            memberWire,
            ownerLine: ownerEdit,
            memberLine: memberEdit,
            testInfo,
          }));

    await test.step('Anchor, reply to, and resolve a shared comment', () =>
      exerciseSharedChat(owner, member, testInfo));
    await owner.reload();
    await member.reload();
    await waitForPath(member, documentPath);
    for (const page of [owner, member]) {
      await expect(title(page)).toHaveValue(revisedTitle);
      await expect(editor(page)).toContainText(originalText);
      await expect(editor(page)).toContainText(ownerEdit);
      await expect(editor(page)).toContainText(memberEdit);
      if (converged !== null) await expectConvergedRichBody(page, converged);
      await expectSharedChatRestored(page);
    }

    await member.screenshot({ path: testInfo.outputPath('shared-chat-after-reload.png') });
    const browserNetworkCheck = () =>
      test.step('Interrupt one browser connection and verify recovery', () =>
        exerciseBrowserNetworkRecovery({ owner, member, memberWire, testInfo }));

    if (restartProof) {
      await test.step('Recover both clients through an actual local Worker restart', () =>
        exerciseRealWorkerRestart({ owner, member, ownerWire, memberWire, testInfo }));
    }

    await test.step('Accept and reject shared suggestions', () =>
      exerciseSharedSuggestions(owner, member, testInfo));
    await test.step('Restore and compare shared versions', () =>
      verifySharedHistory({ owner, member, originalText, ownerEdit, memberEdit, testInfo }));

    if (!restartProof) await browserNetworkCheck();
    for (const page of [owner, member]) {
      await expectSharedChatRestored(page);
      await expect(
        page.getByTestId('suggestion-status').filter({ hasText: 'Suggestion accepted' }),
      ).toHaveCount(1);
      await expect(title(page)).toHaveValue(revisedTitle);
    }

    await share(owner).click();
    const memberRow = access.getByRole('listitem').filter({ hasText: recipientEmail });
    await expect(memberRow).toContainText('Can edit');
    await memberRow.getByRole('button', { name: 'Revoke access' }).click();
    await expect(memberRow).toContainText(/revoked/iu);
    await expect(
      member.getByRole('heading', { name: 'Shared document unavailable' }),
    ).toBeVisible();
    await expectUnavailable(member, originalText);
    await member.reload();
    await expect(
      member.getByRole('heading', { name: 'Shared document unavailable' }),
    ).toBeVisible();
    await expectUnavailable(member, originalText);
    await member.screenshot({ path: testInfo.outputPath('access-revoked.png') });
    await expect(editor(owner)).toContainText(memberEdit);
  } finally {
    await Promise.all([memberContext.close(), unrelatedContext.close()]);
  }
});
