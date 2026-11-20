import { expect, test, type Locator } from '@playwright/test';

const original = 'We will publish the beta on Tuesday.';
const revised = 'We will share the beta on Tuesday.';
const latest = `${revised} Draft review starts this afternoon.`;

async function expectKickoffBody(body: Locator, sentence: string) {
  await expect(body.getByRole('heading', { name: 'Launch plan', level: 1 })).toBeVisible();
  await expect(body.locator(':scope > p').first()).toHaveText(sentence);
  await expect(body.locator(':scope > ul > li > p')).toHaveText([
    'Draft announcement',
    'Confirm support coverage',
  ]);
  await expect(body.locator(':scope > ul > li > ul > li')).toHaveText('Review launch metrics');
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
  await expect(page).toHaveURL(/\/doc\/doc-/);
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

  const paragraph = editor.locator(':scope > p').first();
  await paragraph.click({ position: { x: 4, y: 8 } });
  await page.keyboard.press('Home');
  for (const _ of 'We will ') await page.keyboard.press('ArrowRight');
  for (const _ of 'publish the beta') await page.keyboard.press('Shift+ArrowRight');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('publish the beta');
  await page.keyboard.insertText('share the beta');
  await expect(paragraph).toHaveText(revised);
  await expect(saved).toHaveText(/^All changes saved/);
  await openHistory.click();
  await expect(versions).toHaveCount(firstCount + 1);
  await button('Close activity panel').click();

  await paragraph.click({ position: { x: 4, y: 8 } });
  await page.keyboard.press('Home');
  for (const _ of revised) await page.keyboard.press('ArrowRight');
  await page.keyboard.insertText(' Draft review starts this afternoon.');
  await expect(paragraph).toHaveText(latest);
  await expect(saved).toHaveText(/^All changes saved/);
  await openHistory.click();
  await expect(versions).toHaveCount(firstCount + 2);

  const earlierVersion = `Version ${firstCount + 1}`;
  const earlierRow = history.getByRole('button', { name: new RegExp(`^${earlierVersion}\\b`) });
  const reader = page.getByRole('dialog', { name: earlierVersion, exact: true });
  const contents = reader.getByRole('article', { name: 'Version contents' });
  const backToLatest = reader.getByRole('button', { name: 'Back to latest', exact: true });
  await earlierRow.click();
  await readVersion.press('Enter');
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
  await page.keyboard.press('Escape');
  await expect(reader).toBeHidden();
  await expect(readVersion).toBeFocused();
  await expect(versions).toHaveCount(firstCount + 2);
  await expectKickoffBody(editor, latest);

  await page.setViewportSize({ width: 390, height: 844 });
  await openHistory.tap();
  await earlierRow.tap();
  await readVersion.tap();
  await expect(reader).toBeInViewport();
  await expectKickoffBody(contents, revised);
  await testInfo.attach('earlier-draft-phone', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });
  await backToLatest.tap();
  await expect(reader).toBeHidden();
  await expect(readVersion).toBeFocused();
  await expect(versions).toHaveCount(firstCount + 2);
  await button('Close activity panel').tap();
  await expect(editor).toBeEditable();
  await expectKickoffBody(editor, latest);

  await page.reload();
  await expect(title).toHaveValue('Project kickoff — Comparison');
  await expectKickoffBody(editor, latest);
});
