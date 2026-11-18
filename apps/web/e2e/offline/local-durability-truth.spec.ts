import { expect, test, type Page } from '@playwright/test';

type LashTestWindow = Window & {
  __lashEditor?: {
    getText: (options?: { blockSeparator?: string }) => string;
  };
  __lashOffline?: unknown;
};

const route = (documentId: string) => `/doc/${documentId}`;

const waitForEditor = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
  await expect(page.locator('.ProseMirror')).toBeVisible();
};

const editorText = (page: Page) =>
  page.evaluate(
    () => (window as LashTestWindow).__lashEditor?.getText({ blockSeparator: '\n' }) ?? '',
  );

const expectNoSimulatedCollaboration = async (page: Page) => {
  await expect(page.getByTestId('offline-panel')).toHaveCount(0);
  await expect(page.getByTestId('offline-status')).toHaveCount(0);
  await expect(page.getByTestId('offline-queue-depth')).toHaveCount(0);
  await expect(page.getByTestId('offline-merge-status')).toHaveCount(0);
  await expect(page.getByTestId('presence-status')).toHaveCount(0);
  expect(await page.evaluate(() => '__lashOffline' in window)).toBe(false);
};

test.describe('local durability truth', () => {
  test('local-durability-truth restores verified writing without simulated network claims', async ({
    page,
  }) => {
    const documentId = `bead-43-local-truth-${Date.now()}`;
    const durableText = 'Local durability comes from verified browser storage.';

    await page.goto(route(documentId));
    await waitForEditor(page);
    await expect(page.getByTestId('realtime-presence-bar')).toHaveAttribute(
      'data-enabled',
      'false',
    );
    await expect(page.getByTestId('realtime-presence-bar')).toHaveText('On this device');
    await expect(page.getByTestId('remote-collaborator')).toHaveCount(0);

    await page.locator('.ProseMirror').click();
    await page.keyboard.type(durableText);
    await expect.poll(() => editorText(page)).toBe(durableText);
    await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved', {
      timeout: 2_500,
    });

    await expect(page.getByTestId('rail-tab-activity')).toHaveCount(0);
    const desktopShare = page.getByTestId('topbar-share-button');
    await expect(desktopShare).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Control+/');
    await expect(desktopShare).toHaveAttribute('aria-expanded', 'false');
    await desktopShare.click();
    await expect(desktopShare).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('rail-tab-share')).toHaveAttribute('aria-selected', 'true');
    await expectNoSimulatedCollaboration(page);

    await page.reload();
    await waitForEditor(page);
    await expect.poll(() => editorText(page)).toBe(durableText);
    await expectNoSimulatedCollaboration(page);
  });

  test('malformed local state enters recovery without a false saved or network state', async ({
    page,
  }) => {
    const documentId = `bead-43-recovery-truth-${Date.now()}`;
    const backup = {
      version: 1,
      schemaVersion: 'lash-schema-v1',
      documentId,
      revision: 2,
      writeId: 'bead-43-recovery',
      savedAt: '2026-07-18T00:00:00.000Z',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Verified recovery copy' }],
          },
        ],
      },
    };

    await page.goto('/');
    await page.evaluate(
      ({ id, backupRaw }) => {
        window.localStorage.setItem(`lash:body:${id}`, '{"malformed":');
        window.localStorage.setItem(`lash:body-backup:${id}`, backupRaw);
      },
      { id: documentId, backupRaw: JSON.stringify(backup) },
    );
    await page.goto(route(documentId));

    await expect(page.getByTestId('local-body-notice')).toHaveAttribute('data-kind', 'recovered');
    await expect(page.getByTestId('autosave-indicator')).toHaveCount(0);
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
    await expect(page.locator('.ProseMirror')).toContainText('Verified recovery copy');
    await expectNoSimulatedCollaboration(page);
  });

  test('mobile Share navigation keeps a reachable close path and restores focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(route(`bead-43-mobile-truth-${Date.now()}`));
    await waitForEditor(page);

    const shareTrigger = page.getByTestId('topbar-share-button');
    await expect(shareTrigger).toHaveAttribute('aria-expanded', 'false');
    await shareTrigger.click();
    await expect(shareTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'true');
    await expect(page.getByTestId('rail-tab-activity')).toHaveCount(0);
    await expect(page.getByTestId('rail-tab-share')).toHaveAttribute('aria-selected', 'true');
    await expectNoSimulatedCollaboration(page);

    await page.getByRole('button', { name: 'Close activity panel' }).click();
    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'false');
    await expect(shareTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(shareTrigger).toBeFocused();

    await shareTrigger.click();
    await expect(shareTrigger).toHaveAttribute('aria-expanded', 'true');
    const close = page.getByRole('button', { name: 'Close activity panel' });
    await expect(close).toBeVisible();
    const closeBox = await close.boundingBox();
    expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(closeBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect(closeBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((closeBox?.x ?? 0) + (closeBox?.width ?? 0)).toBeLessThanOrEqual(375);
    expect((closeBox?.y ?? 0) + (closeBox?.height ?? 0)).toBeLessThanOrEqual(812);
    expect(
      await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      })),
    ).toEqual({ documentWidth: 375, viewportWidth: 375 });

    await close.click();
    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'false');
    await expect(shareTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(shareTrigger).toBeFocused();
  });
});
