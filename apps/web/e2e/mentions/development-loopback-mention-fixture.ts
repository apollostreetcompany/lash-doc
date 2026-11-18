import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { enableDevelopmentLoopback, test as base } from '../development-loopback-worker';

type MentionFixtures = {
  openSyntheticMentionFixture(page: Page, documentId?: string): Promise<void>;
};

export const createSyntheticMentionDocumentId = (port: number, nonce = randomUUID()) =>
  `mention-fixture-${port}-${nonce}`;

/**
 * Explicit browser fixture for synthetic mention identities and privacy.
 */
export const test = base.extend<MentionFixtures>({
  openSyntheticMentionFixture: async ({ developmentLoopbackWorker }, provideFixture) => {
    await provideFixture(async (page, documentId) => {
      const fixtureDocumentId =
        documentId ?? createSyntheticMentionDocumentId(developmentLoopbackWorker.port);
      await enableDevelopmentLoopback(page, developmentLoopbackWorker, 'mention-fixture-owner');
      await page.addInitScript((initDocumentId) => {
        (
          window as Window & {
            __lashMentionFixture?: {
              version: 1;
              kind: 'synthetic-mention-identities';
              documentId: string;
            };
          }
        ).__lashMentionFixture = {
          version: 1,
          kind: 'synthetic-mention-identities',
          documentId: initDocumentId,
        };
      }, fixtureDocumentId);
      await page.goto(`/doc/${encodeURIComponent(fixtureDocumentId)}?realtime=on`);
      await page.waitForFunction(() =>
        Boolean((window as Window & { __lashEditor?: unknown }).__lashEditor),
      );
      await page.getByTestId('topbar-discussion-button').click();
      await page.getByRole('tab', { name: 'Activity (test fixture)', exact: true }).click();
      await expect(page.getByTestId('synthetic-mention-fixture')).toBeVisible();
    });
  },
});

export { expect };
