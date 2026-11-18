import { expect, type Page, type TestInfo } from '@playwright/test';

const editor = (page: Page) =>
  page.getByRole('region', { name: 'Writing canvas' }).locator('.tiptap');
const suggest = (page: Page) => page.getByRole('button', { name: 'Suggest wording', exact: true });
const thread = (page: Page, note: string) =>
  page.getByTestId('chat-thread').filter({ hasText: note });

async function postSuggestion(
  member: Page,
  paragraph: string,
  selected: string,
  replacement: string,
  note: string,
) {
  await member.bringToFront();
  const last = editor(member).locator('p').last();
  await last.click();
  await member.keyboard.press('End');
  await member.keyboard.press('Enter');
  await member.keyboard.insertText(paragraph);
  await expect(editor(member).locator('p').last()).toHaveText(paragraph);
  await last.scrollIntoViewIfNeeded();
  const positions = await last.evaluate((element, quote) => {
    const text = element.firstChild;
    if (!(text instanceof Text) || !text.data.endsWith(quote)) {
      throw new Error('The suggestion target is not at the end of the paragraph.');
    }
    const range = document.createRange();
    const start = text.data.length - quote.length;
    range.setStart(text, start);
    range.setEnd(text, start + 1);
    const first = range.getBoundingClientRect();
    range.setEnd(text, text.data.length);
    range.setStart(text, text.data.length - 1);
    const last = range.getBoundingClientRect();
    return {
      start: { x: first.left + 1, y: first.top + first.height / 2 },
      end: { x: last.right - 1, y: last.top + last.height / 2 },
    };
  }, selected);
  await member.mouse.move(positions.start.x, positions.start.y);
  await member.mouse.down();
  await member.mouse.move(positions.end.x, positions.end.y, { steps: 8 });
  await member.mouse.up();
  await expect.poll(() => member.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await suggest(member).click();
  const input = member.getByRole('textbox', { name: 'Proposed wording' });
  await expect(input).toHaveValue(selected);
  await input.fill(replacement);
  await member.getByRole('textbox', { name: 'Comment (optional)' }).fill(note);
  await member.getByRole('button', { name: 'Post suggestion' }).click();
  await expect(thread(member, note).getByTestId('suggestion-status')).toHaveText(
    'Suggestion pending',
  );
}

export async function exerciseSharedSuggestions(owner: Page, member: Page, testInfo: TestInfo) {
  const word = 'publish the beta';
  const replacement = 'share the beta';
  const original = `${word} early, then ${word}`;
  const accepted = `${word} early, then ${replacement}`;
  const note = 'Could this sound less final?';
  await postSuggestion(member, original, word, replacement, note);

  await suggest(owner).click();
  const ownerThread = thread(owner, note);
  const memberThread = thread(member, note);
  await expect(ownerThread.getByTestId('suggestion-status')).toHaveText('Suggestion pending');
  await expect(ownerThread.getByTestId('chat-current-target')).toHaveText(word);
  await expect(editor(owner).locator('p').last()).toHaveText(original);
  await owner.screenshot({ path: testInfo.outputPath('suggestion-pending.png') });
  await ownerThread.getByRole('textbox', { name: `Reply to thread on ${word}` }).fill('Good call');
  await ownerThread.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(memberThread.getByText('Good call', { exact: true })).toBeVisible();
  await ownerThread.getByRole('button', { name: 'Accept suggestion' }).click();
  for (const page of [owner, member]) {
    await expect(editor(page).locator('p').last()).toHaveText(accepted);
    await expect(thread(page, note).getByTestId('suggestion-status')).toHaveText(
      'Suggestion accepted',
    );
  }
  await ownerThread.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(memberThread.getByTestId('chat-thread-status')).toHaveText('Resolved');
  await owner.screenshot({ path: testInfo.outputPath('suggestion-accepted-and-resolved.png') });

  const rejectTarget = 'keep this wording';
  const rejectNote = 'This is a second suggestion for review.';
  await postSuggestion(
    member,
    `Please ${rejectTarget}`,
    rejectTarget,
    'replace this wording',
    rejectNote,
  );
  await thread(owner, rejectNote).getByRole('button', { name: 'Reject suggestion' }).click();
  for (const page of [owner, member]) {
    await expect(editor(page).locator('p').last()).toHaveText(`Please ${rejectTarget}`);
    await expect(thread(page, rejectNote).getByTestId('suggestion-status')).toHaveText(
      'Suggestion rejected',
    );
  }
}
