import { expect, test, type Locator, type Page } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';
import {
  openCredentialLink,
  parseCredentialLink,
  signIn,
  waitForPath,
} from './named-account-journey';

const repeatedPhrase = 'publish the beta';
const original = `${repeatedPhrase} first, then ${repeatedPhrase}`;
const originalTargetStart = original.lastIndexOf(repeatedPhrase);
const pastedCopy = `${repeatedPhrase} / `;
const duplicatePrefix = original.slice(0, originalTargetStart) + pastedCopy;
const afterPaste = duplicatePrefix + repeatedPhrase;
const replacement = 'share the beta';
const accepted = duplicatePrefix + replacement;
const reviewComment = 'Does the second launch need a separate announcement?';
const suggestionNote = 'Use gentler wording for the second launch.';
const ownerReply = 'Yes, let’s distinguish the two announcements.';

const title = (page: Page) => page.getByRole('textbox', { name: 'Document title' });
const editor = (page: Page) => page.getByRole('textbox', { name: 'Document editor' });
const paragraph = (page: Page) => editor(page).locator('p').first();
const share = (page: Page) => page.getByRole('button', { name: 'Share document', exact: true });
const shareDialog = (page: Page) => page.getByRole('dialog', { name: /^Share /u });
const grantList = (page: Page) =>
  shareDialog(page).getByRole('region', { name: 'People with access' });
const thread = (page: Page, note: string) =>
  page
    .getByRole('region', { name: 'Document chat' })
    .getByRole('article')
    .filter({ has: page.getByText(note, { exact: true }) });

async function expectDetachedFeedback(page: Page, note: string) {
  const feedback = thread(page, note);
  await expect(feedback).toHaveAccessibleName('Discussion thread');
  await expect(feedback.getByText('Selected text changed', { exact: true })).toBeVisible();
  await expect(feedback.getByText(repeatedPhrase, { exact: true })).toHaveCount(0);
  await expect(feedback.getByRole('button', { name: /Show document target/u })).toHaveCount(0);
}

async function expectSelectionAt(target: Locator, start: number, text: string) {
  await expect
    .poll(() =>
      target.evaluate(async (element) => {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const selection = window.getSelection();
        if (!selection?.rangeCount) return null;
        const selected = selection.getRangeAt(0);
        if (
          !element.contains(selected.startContainer) ||
          !element.contains(selected.endContainer)
        ) {
          return null;
        }
        const prefix = document.createRange();
        prefix.selectNodeContents(element);
        prefix.setEnd(selected.startContainer, selected.startOffset);
        return { start: prefix.toString().length, text: selected.toString() };
      }),
    )
    .toEqual({ start, text });
}

async function selectSecondPhrase(page: Page) {
  const target = paragraph(page);
  await expect(target).toHaveText(original);
  await page.bringToFront();
  await target.scrollIntoViewIfNeeded();
  const points = await target.evaluate((element, quote) => {
    const text = element.firstChild;
    if (!(text instanceof Text) || !text.data.endsWith(quote)) {
      throw new Error('Expected the second occurrence at the end of the paragraph.');
    }
    const range = document.createRange();
    const start = text.data.length - quote.length;
    range.setStart(text, start);
    range.setEnd(text, start + 1);
    const left = range.getBoundingClientRect();
    range.setEnd(text, text.length);
    range.setStart(text, text.length - 1);
    const right = range.getBoundingClientRect();
    return {
      start: { x: left.left + 1, y: left.top + left.height / 2 },
      end: { x: right.right - 1, y: right.top + right.height / 2 },
    };
  }, repeatedPhrase);
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 8 });
  await page.mouse.up();
  await expectSelectionAt(target, originalTargetStart, repeatedPhrase);
}

async function showFeedbackTarget(page: Page, note: string) {
  const feedback = thread(page, note);
  await expect(feedback.getByTestId('chat-current-target')).toHaveText(repeatedPhrase);
  await feedback
    .getByRole('button', { name: `Show document target for thread on ${repeatedPhrase}` })
    .click();
  await expect(page.getByTestId('chat-anchor-jump-status')).toHaveText(
    `Selected ${repeatedPhrase} in the document.`,
  );
}

async function expectOriginalTargetAfterPaste(page: Page) {
  await expect(paragraph(page)).toHaveText(afterPaste);
  await expect(thread(page, suggestionNote).getByTestId('suggestion-status')).toHaveText(
    'Suggestion pending',
  );
  for (const note of [reviewComment, suggestionNote]) {
    await showFeedbackTarget(page, note);
    await expect(editor(page)).toBeFocused();
    await expectSelectionAt(paragraph(page), duplicatePrefix.length, repeatedPhrase);
  }
}

async function expectNoDocument(page: Page, documentTitle: string) {
  await expect(page.getByRole('heading', { name: 'Shared document unavailable' })).toBeVisible();
  await expect(title(page)).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByText(documentTitle, { exact: true })).toHaveCount(0);
  await expect(page.getByText(reviewComment, { exact: true })).toHaveCount(0);
}

async function expectReviewerAccess(page: Page, documentTitle: string, privatePrior: string) {
  await expect(title(page)).toHaveValue(documentTitle);
  await expect(title(page)).not.toBeEditable();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).not.toBeEditable();
  await expect(page.getByRole('group', { name: 'Document status' })).toContainText('Can comment');
  await selectDiscussionTab(page, 'chat');
  await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'AI', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Shared version history' })).toHaveCount(0);
  await expect(share(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Document settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(privatePrior);
}

test('a named Comment reviewer proposes an exact edit without edit or History access', async ({
  browser,
  page: owner,
  baseURL,
}, testInfo) => {
  if (!baseURL) throw new Error('This journey requires the configured local Lash stack.');
  const origin = new URL(baseURL).origin;
  const marker = crypto.randomUUID().slice(0, 8);
  const ownerEmail = `comment-owner-${marker}@example.test`;
  const reviewerEmail = `comment-reviewer-${marker}@example.test`;
  const documentTitle = `Release wording ${marker}`;
  const privatePrior = `Confidential draft ${marker}.`;
  const reviewerContext = await browser.newContext({ baseURL });

  try {
    await test.step('Promote a Restricted document', async () => {
      await owner.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      await owner.goto('/');
      await owner.getByRole('button', { name: 'New document', exact: true }).click();
      await expect(owner).toHaveURL(/\/doc\/[^/?#]+$/u);
      const localPath = new URL(owner.url()).pathname;
      await title(owner).fill(documentTitle);
      await editor(owner).click();
      await owner.keyboard.insertText(privatePrior);
      await expect(editor(owner)).toHaveText(privatePrior);
      await expect(owner.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

      await share(owner).click();
      await shareDialog(owner).getByRole('link', { name: 'Sign in to continue' }).click();
      await signIn(owner, ownerEmail, origin);
      await waitForPath(owner, localPath);

      await share(owner).click();
      await shareDialog(owner).getByRole('button', { name: 'Save to my account' }).click();
      await expect(
        shareDialog(owner).getByRole('heading', { name: 'Saved to your account' }),
      ).toBeVisible();
      const audience = shareDialog(owner).getByRole('region', { name: 'Public access' });
      await expect(audience.getByText('Restricted', { exact: true })).toBeVisible();
      await shareDialog(owner).getByRole('button', { name: 'Done' }).click();
    });

    await test.step('Keep the superseded wording in the owner’s shared History only', async () => {
      await expect(editor(owner)).toBeEditable();
      await expect(editor(owner)).toHaveText(privatePrior);
      await editor(owner).click();
      await owner.keyboard.press('ControlOrMeta+a');
      await owner.keyboard.insertText(original);
      await expect(editor(owner)).toHaveText(original);
      await expect(owner.getByTestId('realtime-sync-state')).toHaveAttribute('data-state', 'saved');

      await selectDiscussionTab(owner, 'history');
      const history = owner.getByRole('region', { name: 'Shared version history' });
      const compare = history.getByRole('combobox', { name: 'Compare with' });
      const baseline = compare.getByRole('option', { name: /^History started/u });
      await expect(baseline).toHaveCount(1);
      const version = await baseline.getAttribute('value');
      if (!version) throw new Error('The owner’s baseline History version is unavailable.');
      await compare.selectOption(version);
      await expect(history.locator('del').filter({ hasText: privatePrior })).toBeVisible();
    });

    const invite = await test.step('Create a named Comment invite', async () => {
      await share(owner).click();
      const audience = shareDialog(owner).getByRole('region', { name: 'Public access' });
      await expect(audience.getByText('Restricted', { exact: true })).toBeVisible();
      const grant = grantList(owner);
      await grant.getByLabel('Email address').fill(reviewerEmail);
      await grant
        .getByRole('combobox', { name: 'Access level' })
        .selectOption({ label: 'Can comment' });
      await grant.getByRole('button', { name: 'Create invite link' }).click();
      const grantRow = grant.getByRole('listitem').filter({ hasText: reviewerEmail });
      await expect(grantRow).toContainText('Can comment');
      await grant.getByRole('button', { name: 'Copy invite link' }).click();
      await expect(grant.getByRole('button', { name: 'Invite link copied' })).toBeVisible();
      const link = parseCredentialLink(
        await owner.evaluate(() => navigator.clipboard.readText()),
        origin,
      );
      expect(link.pathname).toMatch(/^\/join\/doc-v[0-9]+-[0-9a-f]{64}$/u);
      expect(link.search).toBe('');
      expect(/^#invite=[A-Za-z0-9_-]{43}$/u.test(link.hash)).toBe(true);
      await owner.screenshot({ path: testInfo.outputPath('restricted-comment-invite.png') });
      await shareDialog(owner).getByRole('button', { name: 'Done' }).click();
      return link;
    });

    const reviewer = await reviewerContext.newPage();
    await test.step('Join as the named reviewer and confirm read-only writing access', async () => {
      await openCredentialLink(reviewer, invite);
      await waitForPath(reviewer, invite.pathname);
      await expect(reviewer.getByRole('heading', { name: 'Document invitation' })).toBeVisible();
      await expect(title(reviewer)).toHaveCount(0);
      await expect(editor(reviewer)).toHaveCount(0);
      await reviewer.getByRole('link', { name: 'Sign in to accept' }).click();
      await signIn(reviewer, reviewerEmail, origin);
      await waitForPath(reviewer, invite.pathname.replace(/^\/join\//u, '/doc/'));
      await expectReviewerAccess(reviewer, documentTitle, privatePrior);
      await expect(editor(reviewer)).toHaveText(original);
      await expect(reviewer.getByRole('button', { name: 'Select text in document' })).toBeVisible();
      await reviewer.getByRole('button', { name: 'Close activity panel', exact: true }).click();
      await expect(
        reviewer.getByRole('button', { name: 'Discussion', exact: true }),
      ).toHaveAttribute('aria-expanded', 'false');
    });

    await test.step('Post an anchored comment and propose wording for the second occurrence', async () => {
      await selectSecondPhrase(reviewer);
      await reviewer.getByRole('button', { name: 'Comment', exact: true }).click();
      await expect(reviewer.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(reviewer.getByTestId('chat-new-thread-quote')).toHaveText(repeatedPhrase);
      const commentDraft = reviewer.getByRole('textbox', { name: 'Comment', exact: true });
      await expect(commentDraft).toBeFocused();
      await commentDraft.fill(reviewComment);
      await reviewer.getByRole('button', { name: 'Post comment', exact: true }).click();
      await expect(thread(reviewer, reviewComment)).toHaveAccessibleName(
        `Thread on ${repeatedPhrase}`,
      );

      await selectSecondPhrase(reviewer);
      await reviewer.getByRole('button', { name: 'Suggest wording', exact: true }).click();
      const wording = reviewer.getByRole('textbox', { name: 'Proposed wording' });
      await expect(wording).toHaveValue(repeatedPhrase);
      await wording.fill(replacement);
      await reviewer.getByRole('textbox', { name: 'Comment (optional)' }).fill(suggestionNote);
      await reviewer.getByRole('button', { name: 'Post suggestion', exact: true }).click();
      await expect(thread(reviewer, suggestionNote).getByTestId('suggestion-status')).toHaveText(
        'Suggestion pending',
      );

      await expect(
        reviewer.getByRole('button', {
          name: /^(Accept suggestion|Reject suggestion|Resolve|Reopen)$/u,
        }),
      ).toHaveCount(0);
      await expect(editor(reviewer)).toHaveText(original);
      await reviewer.screenshot({ path: testInfo.outputPath('reviewer-posted-feedback.png') });
    });

    await test.step('A clipboard copy before the quote leaves both reviews attached to the original', async () => {
      await owner.bringToFront();
      await selectDiscussionTab(owner, 'chat');
      await owner.evaluate((text) => navigator.clipboard.writeText(text), pastedCopy);
      await showFeedbackTarget(owner, reviewComment);
      await expectSelectionAt(paragraph(owner), originalTargetStart, repeatedPhrase);
      const target = paragraph(owner);
      await target.scrollIntoViewIfNeeded();
      const position = await target.evaluate((element, start) => {
        const text = element.firstChild;
        if (!(text instanceof Text) || text.length <= start) {
          throw new Error('Expected a visible glyph at the start of the original quote.');
        }
        const glyph = document.createRange();
        glyph.setStart(text, start);
        glyph.setEnd(text, start + 1);
        const rect = glyph.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        return {
          x: rect.left - bounds.left + Math.min(1, rect.width / 4),
          y: rect.top - bounds.top + rect.height / 2,
        };
      }, originalTargetStart);
      await target.click({ position });
      await expect(editor(owner)).toBeFocused();
      await expectSelectionAt(target, originalTargetStart, '');
      await owner.keyboard.press('ControlOrMeta+v');
      await expect(paragraph(owner)).toHaveText(afterPaste);
      await expect(paragraph(reviewer)).toHaveText(afterPaste);
      await expect(owner.getByTestId('realtime-sync-state')).toHaveAttribute('data-state', 'saved');
      await paragraph(owner).evaluate((target) => target.scrollIntoView({ block: 'center' }));
      await owner.screenshot({ path: testInfo.outputPath('owner-pasted-identical-copy.png') });

      for (const page of [owner, reviewer]) {
        await page.bringToFront();
        await expectOriginalTargetAfterPaste(page);
      }
      await Promise.all([owner.reload(), reviewer.reload()]);
      await expectReviewerAccess(reviewer, documentTitle, privatePrior);
      for (const page of [owner, reviewer]) {
        await page.bringToFront();
        await selectDiscussionTab(page, 'chat');
        await expectOriginalTargetAfterPaste(page);
      }
      await expect(editor(reviewer)).not.toBeEditable();
      await paragraph(reviewer).evaluate((target) => target.scrollIntoView({ block: 'center' }));
      await reviewer.screenshot({
        path: testInfo.outputPath('reviewer-shows-original-after-reload.png'),
      });
    });

    await test.step('The owner accepts only the original occurrence', async () => {
      await owner.bringToFront();
      const comment = thread(owner, reviewComment);
      await expect(comment.getByTestId('chat-current-target')).toHaveText(repeatedPhrase);
      await comment
        .getByRole('textbox', { name: `Reply to thread on ${repeatedPhrase}` })
        .fill(ownerReply);
      await comment.getByRole('button', { name: 'Reply', exact: true }).click();
      await expect(
        thread(reviewer, reviewComment).getByText(ownerReply, { exact: true }),
      ).toBeVisible();

      const proposal = thread(owner, suggestionNote);
      await expect(proposal.getByTestId('suggestion-status')).toHaveText('Suggestion pending');
      await expect(proposal.getByTestId('chat-current-target')).toHaveText(repeatedPhrase);
      await expect(editor(owner)).toHaveText(afterPaste);
      await owner.screenshot({ path: testInfo.outputPath('owner-pending-suggestion.png') });
      await proposal.getByRole('button', { name: 'Accept suggestion', exact: true }).click();
      for (const page of [owner, reviewer]) {
        await expect(editor(page)).toHaveText(accepted);
        await expect(thread(page, suggestionNote).getByTestId('suggestion-status')).toHaveText(
          'Suggestion accepted',
        );
      }
      await expectDetachedFeedback(reviewer, reviewComment);
      await expectDetachedFeedback(reviewer, suggestionNote);
    });

    await test.step('Reopen to the accepted wording, then revoke the reviewer’s access', async () => {
      await Promise.all([owner.reload(), reviewer.reload()]);
      await expectReviewerAccess(reviewer, documentTitle, privatePrior);
      await selectDiscussionTab(owner, 'chat');
      for (const page of [owner, reviewer]) {
        await expect(editor(page)).toHaveText(accepted);
        await expect(
          thread(page, reviewComment).getByText(ownerReply, { exact: true }),
        ).toBeVisible();
        await expect(thread(page, suggestionNote).getByTestId('suggestion-status')).toHaveText(
          'Suggestion accepted',
        );
      }

      await expectDetachedFeedback(reviewer, reviewComment);
      await expectDetachedFeedback(reviewer, suggestionNote);

      await paragraph(reviewer).evaluate((target) => target.scrollIntoView({ block: 'center' }));
      await reviewer.screenshot({
        path: testInfo.outputPath('reviewer-accepted-body-after-reload.png'),
      });
      await share(owner).click();
      const reviewerRow = grantList(owner).getByRole('listitem').filter({ hasText: reviewerEmail });
      await expect(reviewerRow).toContainText('Can comment');
      await expect(reviewerRow).toContainText('Access granted');
      await reviewerRow.getByRole('button', { name: 'Revoke access' }).click();
      await expect(reviewerRow).toContainText(/revoked/iu);
      await expectNoDocument(reviewer, documentTitle);
      await reviewer.reload();
      await expectNoDocument(reviewer, documentTitle);
      await reviewer.screenshot({ path: testInfo.outputPath('reviewer-access-revoked.png') });
      await expect(editor(owner)).toHaveText(accepted);
    });
  } finally {
    await reviewerContext.close();
  }
});
