import { expect, type Page } from '@playwright/test';

import { enableDevelopmentLoopback, test } from '../development-loopback-worker';

type LashTestWindow = Window & {
  __lashEditor?: {
    commands: {
      focus: (position?: 'start' | 'end') => boolean;
    };
    getText: (options?: { blockSeparator?: string }) => string;
  };
  __lashRealtime?: {
    disconnectForTest: () => void;
    reconnectForTest: () => void;
    getSnapshot: () => { syncState: string };
  };
  __lashLastInviteLink?: string;
};

const waitForEditor = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
  await expect(page.locator('.ProseMirror')).toBeVisible();
};

const realtimeSnapshot = (page: Page) =>
  page.evaluate(() => {
    const api = (window as LashTestWindow).__lashRealtime;
    if (!api) throw new Error('Realtime test API unavailable');
    return api.getSnapshot();
  });

const editorText = (page: Page) =>
  page.evaluate(
    () => (window as LashTestWindow).__lashEditor?.getText({ blockSeparator: '\n' }) ?? '',
  );

const typeIntoEditor = async (page: Page, text: string) => {
  await page.evaluate(() => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.focus('end');
  });
  await page.keyboard.type(text);
  await expect.poll(() => editorText(page)).toContain(text);
};

test.describe('collaboration delight', () => {
  test('local-only documents do not advertise realtime collaboration', async ({ page }) => {
    await page.goto(`/doc/bead-36-local-only-${Date.now()}`);
    await waitForEditor(page);

    await expect(page.getByTestId('realtime-presence-bar')).toHaveAttribute(
      'data-enabled',
      'false',
    );
    await expect(page.getByTestId('collaboration-empty-state')).toHaveCount(0);
    await expect(page.getByTestId('realtime-presence-bar')).toHaveText('On this device');
    await expect(page.getByTestId('remote-collaborator')).toHaveCount(0);
  });

  test('first-run collaboration state can open invite flow', async ({
    page,
    developmentLoopbackWorker: worker,
  }) => {
    await enableDevelopmentLoopback(page, worker, 'delight-owner');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/doc/bead-36-first-run-${Date.now()}`);
    await waitForEditor(page);

    await expect(page.getByTestId('realtime-sync-state')).toHaveText('Saved');
    await expect(page.getByTestId('invite-access-status')).toHaveText('Owner access');
    const shareDisclosure = page.getByTestId('topbar-share-button');
    const inviteShortcut = page.getByTestId('collaboration-share-shortcut');
    await expect(shareDisclosure).toHaveAttribute('aria-expanded', 'false');
    await inviteShortcut.click();
    await expect(shareDisclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('share-panel')).toBeVisible();
    await expect(page.getByTestId('invite-email-input')).toBeVisible();
    await page.getByRole('button', { name: 'Close activity panel' }).click();
    await expect(shareDisclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(inviteShortcut).toBeFocused();

    await shareDisclosure.click();
    await expect(shareDisclosure).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(shareDisclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(shareDisclosure).toBeFocused();

    await inviteShortcut.click();
    await expect(shareDisclosure).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(shareDisclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(inviteShortcut).toBeFocused();
    await expect(page.getByTestId('realtime-presence-bar')).toContainText('Development session');
  });

  test('view invite can hydrate realtime content without body edit access', async ({
    browser,
    developmentLoopbackWorker: worker,
  }) => {
    const docId = `bead-36-view-hydrate-${Date.now()}`;
    const ownerContext = await browser.newContext();
    await enableDevelopmentLoopback(ownerContext, worker, 'delight-view-owner');
    const ownerPage = await ownerContext.newPage();

    try {
      await ownerPage.goto(`/doc/${docId}`);
      await waitForEditor(ownerPage);
      await typeIntoEditor(ownerPage, 'Read-only realtime content');
      await expect.poll(() => realtimeSnapshot(ownerPage)).toMatchObject({ syncState: 'saved' });

      await ownerPage.getByTestId('collaboration-share-shortcut').click();
      await ownerPage.getByTestId('invite-email-input').fill('reader@example.com');
      await ownerPage.getByTestId('invite-role-select').selectOption('view');
      await ownerPage.getByTestId('invite-expiry-select').selectOption('7d');
      await ownerPage.getByTestId('invite-create').click();
      await expect(ownerPage.getByTestId('invite-copy-status')).toContainText('Copied');
      const link = await ownerPage.evaluate(
        () => (window as LashTestWindow).__lashLastInviteLink ?? '',
      );

      const readerContext = await browser.newContext();
      await enableDevelopmentLoopback(readerContext, worker, 'delight-view-reader');
      const readerPage = await readerContext.newPage();
      try {
        await readerPage.goto(link);
        await waitForEditor(readerPage);
        await expect(readerPage.getByTestId('invite-access-status')).toHaveText('View access');
        await expect(readerPage.getByTestId('realtime-sync-state')).toHaveText('Read only');
        await expect
          .poll(() => realtimeSnapshot(readerPage))
          .toMatchObject({
            syncState: 'saved',
          });
        await expect.poll(() => editorText(readerPage)).toContain('Read-only realtime content');

        await readerPage.evaluate(() => {
          const editor = (window as LashTestWindow).__lashEditor;
          if (!editor) throw new Error('Lash editor test hook is unavailable');
          editor.commands.focus('end');
        });
        await readerPage.keyboard.type('Reader body edit should not land');
        await expect
          .poll(() => editorText(readerPage))
          .not.toContain('Reader body edit should not land');
      } finally {
        await readerContext.close();
      }
    } finally {
      await ownerContext.close();
    }
  });

  test('reconnect feedback includes a retry action', async ({
    page,
    developmentLoopbackWorker: worker,
  }) => {
    await enableDevelopmentLoopback(page, worker, 'delight-retry');
    await page.goto(`/doc/bead-36-retry-${Date.now()}`);
    await waitForEditor(page);
    await expect.poll(() => realtimeSnapshot(page)).toMatchObject({ syncState: 'saved' });

    await page.evaluate(() => {
      const api = (window as LashTestWindow).__lashRealtime;
      if (!api) throw new Error('Realtime test API unavailable');
      api.disconnectForTest();
    });
    await expect(page.getByTestId('sync-feedback')).toContainText('Reconnecting');
    await expect(page.getByTestId('sync-retry-button')).toBeVisible();

    await page.getByTestId('sync-retry-button').click();
    await expect.poll(() => realtimeSnapshot(page)).toMatchObject({ syncState: 'saved' });
    await expect(page.getByTestId('sync-feedback')).toContainText('Saved');
  });
});
