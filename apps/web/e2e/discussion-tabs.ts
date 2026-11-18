import { expect, type Page } from '@playwright/test';

export type DiscussionTab = 'chat' | 'history' | 'ai';

const tabLabel: Record<DiscussionTab, string> = {
  chat: 'Chat',
  history: 'History',
  ai: 'AI',
};

export const selectDiscussionTab = async (page: Page, id: DiscussionTab) => {
  const tab = page.getByTestId(`rail-tab-${id}`);
  if ((await tab.count()) === 0) {
    const trigger = page.getByTestId('topbar-discussion-button');
    await expect(trigger).toBeVisible();
    await trigger.click();
  }

  await expect(tab).toBeVisible();
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click();
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: tabLabel[id] })).toBeVisible();
};
