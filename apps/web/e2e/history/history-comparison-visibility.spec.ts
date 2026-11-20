import { expect, test, type Page } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

const canvasPosition = (page: Page) =>
  page.evaluate(() => ({
    page: window.scrollY,
    editor: document.querySelector('#lash-main')?.scrollTop,
  }));

test('keeps an older version comparison in view with a long device history', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page).toHaveURL(/\/doc\/doc-/u);
  await selectDiscussionTab(page, 'history');

  const editor = page.getByRole('textbox', { name: 'Document editor' });
  const versions = page.getByTestId('history-version');
  const changedText = page.getByTestId('history-diff-insert');
  const restore = page.getByRole('button', { name: 'Restore', exact: true });
  const versionCount = 8;
  const comparisonVersion = 5;
  const firstRecentVersion = 7;
  const today = Date.now();
  await page.clock.setFixedTime(today - 8 * 24 * 60 * 60 * 1000);
  await editor.click();
  await page.keyboard.insertText('The team reviewed the draft.');
  await expect(versions).toHaveCount(1);
  await expect(changedText).toHaveText('The team reviewed the draft.');
  await expect(changedText).toBeInViewport({ ratio: 1 });
  await expect(restore).toBeInViewport({ ratio: 1 });

  for (let version = 2; version <= versionCount; version += 1) {
    if (version === firstRecentVersion) await page.clock.setFixedTime(today);
    await page.keyboard.insertText(` Note ${version}.`);
    await expect(versions).toHaveCount(version);
  }
  await expect(versions.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(versions.last()).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 1440, height: 520 });
  const target = versions.nth(comparisonVersion - 1);
  await versions.first().focus();
  for (let version = 1; version < comparisonVersion; version += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
  const desktopPosition = await canvasPosition(page);
  await page.keyboard.press('Enter');
  await expect(target).toBeFocused();
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(changedText).toHaveText(`Note ${comparisonVersion}.`);
  await expect(changedText).toBeInViewport({ ratio: 1 });
  await expect(restore).toBeInViewport({ ratio: 1 });
  expect(await canvasPosition(page)).toEqual(desktopPosition);

  const listPosition = () =>
    page.getByTestId('history-version-list').evaluate((list) => list.scrollTop);
  const inspectedPosition = await listPosition();
  await editor.click();
  await page.keyboard.insertText('One more edit.');
  await expect(versions).toHaveCount(versionCount + 1);
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(changedText).toHaveText(`Note ${comparisonVersion}.`);
  expect(await listPosition()).toBe(inspectedPosition);

  const recentFilter = page.getByRole('button', { name: 'Last 7 days', exact: true });
  await recentFilter.click();
  await expect(versions).toHaveCount(versionCount + 2 - firstRecentVersion);
  const recentTarget = versions.filter({
    has: page.getByText(`Version ${firstRecentVersion}`, { exact: true }),
  });
  await recentTarget.click();
  await expect(recentTarget).toHaveAttribute('aria-pressed', 'true');
  await recentFilter.click();
  await expect(versions).toHaveCount(versionCount + 1);
  await expect(recentTarget).toHaveAttribute('aria-pressed', 'true');
  await expect(recentTarget).toBeInViewport({ ratio: 1 });
  await expect(recentFilter).toBeFocused();

  const phone = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 700 },
    storageState: await page.context().storageState({ indexedDB: true }),
  });
  try {
    const mobile = await phone.newPage();
    await mobile.goto(new URL(page.url()).pathname);
    await selectDiscussionTab(mobile, 'history');
    const mobileVersions = mobile.getByTestId('history-version');
    await expect(mobileVersions).toHaveCount(versionCount + 1);
    await expect(mobileVersions.last()).toHaveAttribute('aria-pressed', 'true');
    await expect(mobileVersions.last()).toBeInViewport({ ratio: 1 });
    const mobileTarget = mobileVersions.nth(comparisonVersion - 1);
    await mobileTarget.scrollIntoViewIfNeeded();
    const mobilePosition = await canvasPosition(mobile);
    await mobileTarget.tap();
    await expect(mobileTarget).toHaveAttribute('aria-pressed', 'true');
    const mobileChange = mobile.getByTestId('history-diff-insert');
    await expect(mobileChange).toHaveText(`Note ${comparisonVersion}.`);
    await expect(mobileChange).toBeInViewport({ ratio: 1 });
    await expect(mobile.getByRole('button', { name: 'Restore', exact: true })).toBeInViewport({
      ratio: 1,
    });
    expect(await canvasPosition(mobile)).toEqual(mobilePosition);
  } finally {
    await phone.close();
  }
});
