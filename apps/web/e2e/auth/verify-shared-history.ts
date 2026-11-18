import { expect, type Page, type TestInfo } from '@playwright/test';

import { selectDiscussionTab } from '../discussion-tabs';

const history = (page: Page) => page.getByRole('region', { name: 'Shared version history' });
const editor = (page: Page) => page.getByRole('textbox', { name: 'Document editor' });

export async function verifySharedHistory({
  owner,
  member,
  originalText,
  ownerEdit,
  memberEdit,
  testInfo,
}: {
  owner: Page;
  member: Page;
  originalText: string;
  ownerEdit: string;
  memberEdit: string;
  testInfo: TestInfo;
}) {
  const version = (page: Page) =>
    history(page).getByRole('combobox', { name: 'Version', exact: true });
  const compare = (page: Page) =>
    history(page).getByRole('combobox', { name: 'Compare with', exact: true });
  const olderVersion = version(owner);
  const baselineOption = (page: Page) =>
    version(page).getByRole('option', { name: /^History started/u });

  for (const page of [owner, member]) {
    await selectDiscussionTab(page, 'history');
    await expect(baselineOption(page)).toHaveCount(1);
    const latest = await version(page).inputValue();
    const baseline = await baselineOption(page).getAttribute('value');
    expect(baseline).not.toBeNull();
    await compare(page).selectOption(baseline!);
    await expect(history(page).locator('ins').filter({ hasText: ownerEdit })).toBeVisible();
    await expect(history(page).locator('ins').filter({ hasText: memberEdit })).toBeVisible();
    expect(latest).not.toBe(baseline);
  }
  const recent = await olderVersion.inputValue();
  const baseline = await baselineOption(owner).getAttribute('value');
  expect(baseline).not.toBeNull();
  await version(member).selectOption(baseline!);
  await expect(history(member).getByRole('button', { name: 'Restore this version' })).toHaveCount(
    0,
  );

  await olderVersion.selectOption(baseline!);
  await history(owner).getByRole('button', { name: 'Restore this version' }).click();
  await history(owner).getByRole('button', { name: 'Restore version', exact: true }).click();
  for (const page of [owner, member]) {
    await expect(editor(page)).toContainText(originalText);
    await expect(editor(page)).not.toContainText(memberEdit);
    await expect(page.getByTestId('realtime-sync-state')).toHaveAttribute('data-state', 'saved');
  }

  await Promise.all([owner.reload(), member.reload()]);
  for (const page of [owner, member]) {
    await selectDiscussionTab(page, 'history');
    await expect(history(page).getByRole('option', { name: /^Restored version/u })).toHaveCount(1);
    await expect(history(page).locator(`option[value="${recent}"]`)).toHaveCount(2);
  }
  await owner.screenshot({ path: testInfo.outputPath('shared-history-restored.png') });

  await olderVersion.selectOption(recent);
  await history(owner).getByRole('button', { name: 'Restore this version' }).click();
  await history(owner).getByRole('button', { name: 'Restore version', exact: true }).click();
  for (const page of [owner, member]) {
    await expect(editor(page)).toContainText(memberEdit);
    await expect(editor(page)).toContainText(ownerEdit);
    await expect(page.getByTestId('realtime-sync-state')).toHaveAttribute('data-state', 'saved');
  }
}
