import { expect, test, type Locator, type Page } from '@playwright/test';

const original = 'We will publish the beta on Tuesday.';
const revised = 'We will share the beta on Tuesday.';
const latest = `${revised} Draft review starts this afternoon.`;
const selectedText = 'publish the beta';

async function expectKickoffBody(body: Locator, sentence: string) {
  await expect(body.getByRole('heading', { name: 'Launch plan', level: 1 })).toBeVisible();
  await expect(body.locator(':scope > p').first()).toHaveText(sentence);
  await expect(body.locator(':scope > ul > li > p')).toHaveText([
    'Draft announcement',
    'Confirm support coverage',
  ]);
  await expect(body.locator(':scope > ul > li > ul > li')).toHaveText('Review launch metrics');
}

async function textPointAtOffset(paragraph: Locator, offset: number) {
  await paragraph.scrollIntoViewIfNeeded();
  return paragraph.evaluate((element, textOffset) => {
    const text = element.firstChild;
    if (!(text instanceof Text)) throw new Error('Expected the plain kickoff paragraph.');
    const caret = document.createRange();
    caret.setStart(text, textOffset);
    caret.collapse(true);
    const bounds = caret.getBoundingClientRect();
    return { x: bounds.left + 0.5, y: bounds.top + bounds.height / 2 };
  }, offset);
}

async function clickAtTextOffset(page: Page, paragraph: Locator, offset: number) {
  const point = await textPointAtOffset(paragraph, offset);
  await page.mouse.click(point.x, point.y);
  const actualOffset = await paragraph.evaluate((element) => {
    const selection = window.getSelection();
    return selection?.isCollapsed && selection.focusNode === element.firstChild
      ? selection.focusOffset
      : null;
  });
  expect(actualOffset).toBe(offset);
}

test.use({ hasTouch: true, viewport: { width: 1440, height: 900 } });

test('reads the full earlier kickoff draft by keyboard and touch without restoring it', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const title = page.getByRole('textbox', { name: 'Document title' });
  const status = page.getByRole('group', { name: 'Document status' });
  const openHistory = status.getByRole('button', { name: 'History', exact: true });
  const saved = page.getByTestId('autosave-indicator');
  const history = page.getByRole('tabpanel', { name: 'History', exact: true });
  const versions = history.getByTestId('history-version');
  const readVersion = history.getByRole('button', { name: 'Read version', exact: true });

  await expect(editor).toBeEditable();
  await button('New document').click();
  await expect(page).toHaveURL(/\/(?:doc\/|\?doc=)doc-/);
  await title.fill('Project kickoff — Comparison');
  await editor.click();
  await button('Heading 1').click();
  await page.keyboard.insertText('Launch plan');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(original);
  await page.keyboard.press('Enter');
  await button('Bullet List').click();
  await page.keyboard.insertText('Draft announcement');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Confirm support coverage');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Review launch metrics');
  await page.keyboard.press('Tab');
  await expectKickoffBody(editor, original);
  await expect(saved).toHaveText(/^All changes saved/);
  await openHistory.click();
  await expect(versions.first()).toBeVisible();
  const firstCount = await versions.count();
  await button('Close activity panel').click();
  await expect(openHistory).toBeFocused();

  const paragraph = editor.locator(':scope > p').first();
  const selectionStart = 'We will '.length;
  await clickAtTextOffset(page, paragraph, selectionStart);
  const selectionEnd = await textPointAtOffset(paragraph, selectionStart + selectedText.length);
  await page.keyboard.down('Shift');
  try {
    await page.mouse.click(selectionEnd.x, selectionEnd.y);
  } finally {
    await page.keyboard.up('Shift');
  }
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selectedText);
  await page.keyboard.insertText('share the beta');
  await expect(paragraph).toHaveText(revised);
  await expect(saved).toHaveText(/^All changes saved/);
  await openHistory.click();
  await expect(versions).toHaveCount(firstCount + 1);
  await button('Close activity panel').click();
  await expect(openHistory).toBeFocused();

  await clickAtTextOffset(page, paragraph, revised.length);
  await page.keyboard.insertText(' Draft review starts this afternoon.');
  await expect(paragraph).toHaveText(latest);
  await expect(saved).toHaveText(/^All changes saved/);
  await openHistory.click();
  await expect(versions).toHaveCount(firstCount + 2);

  const earlierVersion = `Version ${firstCount + 1}`;
  const latestVersion = `Version ${firstCount + 2}`;
  const readPrevious = history.getByRole('button', {
    name: `Read previous draft, ${earlierVersion}`,
    exact: true,
  });
  const earlierRow = history.getByRole('button', { name: new RegExp(`^${earlierVersion}\\b`) });
  const reader = page.getByRole('dialog', { name: earlierVersion, exact: true });
  const contents = reader.getByRole('article', { name: 'Version contents' });
  const backToLatest = reader.getByRole('button', { name: 'Back to latest', exact: true });
  await expect(history.getByTestId('history-selected-version')).toHaveText(latestVersion);
  await readPrevious.press('Enter');
  await expect(reader).toBeVisible();
  await expectKickoffBody(contents, revised);
  await expect(contents).not.toContainText('Draft review starts this afternoon.');
  await expect(reader.getByRole('heading', { name: earlierVersion, exact: true })).toBeFocused();
  await testInfo.attach('earlier-draft-desktop', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });
  await page.keyboard.press('Tab');
  await expect(backToLatest).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(reader).toBeHidden();
  await expect(readPrevious).toBeFocused();
  await expect(versions).toHaveCount(firstCount + 2);
  await expect(history.getByTestId('history-selected-version')).toHaveText(latestVersion);
  await expectKickoffBody(editor, latest);

  await page.setViewportSize({ width: 390, height: 844 });
  await openHistory.tap();
  await readPrevious.tap();
  await expect(reader).toBeInViewport();
  await expectKickoffBody(contents, revised);
  await testInfo.attach('earlier-draft-phone', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(reader).toBeHidden();
  await expect(readPrevious).toBeFocused();
  await expect(history).toBeVisible();

  await readPrevious.tap();
  await expect(reader).toBeVisible();
  await backToLatest.tap();
  await expect(reader).toBeHidden();
  await expect(history).toBeHidden();
  await expect(openHistory).toBeFocused();
  await expect(editor).toBeInViewport();
  await expect(editor).toBeEditable();
  await expectKickoffBody(editor, latest);
  await testInfo.attach('latest-draft-phone', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });

  await openHistory.tap();
  await expect(versions).toHaveCount(firstCount + 2);
  await earlierRow.tap();
  await expect(earlierRow).toHaveAttribute('aria-pressed', 'true');
  await expect(readPrevious).toHaveCount(0);
  await readVersion.tap();
  await expectKickoffBody(contents, revised);
  await backToLatest.tap();
  await expect(history).toBeHidden();

  await page.reload();
  await expect(title).toHaveValue('Project kickoff — Comparison');
  await expectKickoffBody(editor, latest);
});
