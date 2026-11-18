import { expect, test, type Page } from '@playwright/test';

const route = (documentId: string) => `/doc/${documentId}`;

const documentEditor = (page: Page) => page.getByRole('textbox', { name: 'Document editor' });

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
    const editor = documentEditor(page);
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(page.getByTestId('realtime-presence-bar')).toHaveAttribute(
      'data-enabled',
      'false',
    );
    await expect(page.getByTestId('realtime-presence-bar')).toHaveText('On this device');
    await expect(page.getByTestId('remote-collaborator')).toHaveCount(0);

    await editor.click();
    await page.keyboard.type(durableText);
    await expect(editor).toHaveText(durableText);
    await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved', {
      timeout: 2_500,
    });

    await expect(page.getByTestId('rail-tab-activity')).toHaveCount(0);
    const desktopShare = page.getByTestId('topbar-share-button');
    await expect(desktopShare).toHaveAttribute('aria-expanded', 'false');
    await desktopShare.click();
    await expect(desktopShare).toHaveAttribute('aria-expanded', 'true');
    const share = page.getByRole('dialog', { name: /^Share/ });
    await expect(share).toBeVisible();
    await expectNoSimulatedCollaboration(page);
    await page.keyboard.press('Escape');
    await expect(share).toBeHidden();
    await expect(desktopShare).toBeFocused();

    await page.reload();
    await expect(editor).toHaveText(durableText);
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
    await expect(documentEditor(page)).toHaveAttribute('contenteditable', 'false');
    await expect(documentEditor(page)).toContainText('Verified recovery copy');
    await expectNoSimulatedCollaboration(page);
  });
});

test.describe('local durability truth on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test('mobile Share navigation keeps a reachable close path and restores focus', async ({
    page,
  }) => {
    await page.goto(route(`bead-43-mobile-truth-${Date.now()}`));
    await expect(documentEditor(page)).toBeVisible();

    const shareTrigger = page.getByTestId('topbar-share-button');
    const share = page.getByRole('dialog', { name: /^Share/ });
    const close = share.getByRole('button', { name: 'Close sharing' });
    await expect(shareTrigger).toHaveAttribute('aria-expanded', 'false');
    await shareTrigger.tap();
    await expect(shareTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(share).toBeVisible();
    await expect(share).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('.lash-app')).toHaveAttribute('data-rail-mobile', 'false');
    await expect(page.getByTestId('rail-tab-activity')).toHaveCount(0);
    await expectNoSimulatedCollaboration(page);

    await close.tap();
    await expect(share).toBeHidden();
    await expect(shareTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(shareTrigger).toBeFocused();

    await shareTrigger.tap();
    await expect(shareTrigger).toHaveAttribute('aria-expanded', 'true');
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

    await close.tap({ position: { x: 38, y: 6 } });
    await expect(share).toBeHidden();
    await expect(shareTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(shareTrigger).toBeFocused();
  });
});
