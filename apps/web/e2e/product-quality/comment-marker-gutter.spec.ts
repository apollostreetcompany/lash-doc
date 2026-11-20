import { expect, test, type Page } from '@playwright/test';

const sentence = 'We will publish the beta on Tuesday.';
const target = 'publish the beta';

async function postComment(page: Page) {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Document editor' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.fill(sentence);
  await editor.locator('p').click();
  await page.keyboard.press('End');
  for (const _ of ' on Tuesday.') await page.keyboard.press('ArrowLeft');
  for (const _ of target) await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(target);
  await page.getByRole('button', { name: 'Discussion', exact: true }).click();
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Could this sound less final?');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByRole('article', { name: `Thread on ${target}` })).toBeVisible();
  return editor;
}

test('keeps the desktop comment marker outside the writing line', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await postComment(page);
  const marker = page.getByRole('button', { name: `Comment thread on ${target}` });
  await expect(marker).toBeVisible();
  await expect
    .poll(async () => {
      const mark = await marker.boundingBox();
      const prose = await editor.boundingBox();
      const paper = await page.getByRole('article', { name: 'Untitled document' }).boundingBox();
      return Boolean(
        mark &&
          prose &&
          paper &&
          mark.x >= prose.x + prose.width + 4 &&
          mark.x + mark.width <= paper.x + paper.width,
      );
    })
    .toBe(true);
  await marker.click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(target);
  await expect(editor).toHaveText(sentence);
  await page.screenshot({
    path: test.info().outputPath('desktop-comment-gutter.png'),
    animations: 'disabled',
  });
});

test('keeps the phone document target reachable from the thread', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await postComment(page);
  await expect(page.getByRole('button', { name: `Comment thread on ${target}` })).toBeHidden();
  await page.getByRole('button', { name: `Show document target for thread on ${target}` }).click();
  await expect(editor).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(target);
  await page.screenshot({
    path: test.info().outputPath('phone-comment-target.png'),
    animations: 'disabled',
  });
});
