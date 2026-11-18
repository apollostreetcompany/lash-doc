import { expect, type Page } from '@playwright/test';

/**
 * Opens the explicitly gated browser-local collaboration fixture.
 *
 * This is deterministic policy/UI mechanics coverage only. It is never
 * production invitation evidence.
 */
export const openDevelopmentLoopbackShareFixture = async (page: Page) => {
  await page.goto('/?realtime=on');
  await page.getByTestId('topbar-share-button').click();
  await expect(page.getByTestId('share-create-comment')).toBeVisible();
};
