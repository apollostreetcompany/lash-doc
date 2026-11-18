import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { enableDevelopmentLoopback, test as base } from '../development-loopback-worker';

interface ShareFixtures {
  openDevelopmentLoopbackShareFixture: () => Promise<void>;
}

/**
 * Uses the gated development Share controls for policy and redaction mechanics.
 */
export const test = base.extend<ShareFixtures>({
  openDevelopmentLoopbackShareFixture: async (
    { page, developmentLoopbackWorker },
    provideFixture,
  ) => {
    await provideFixture(async () => {
      await enableDevelopmentLoopback(page, developmentLoopbackWorker, 'share-fixture-owner');
      await page.goto(`/doc/share-fixture-${randomUUID()}`);
      await page.getByTestId('topbar-share-button').click();
      await expect(page.getByTestId('share-create-comment')).toBeVisible();
    });
  },
});

export { expect };
