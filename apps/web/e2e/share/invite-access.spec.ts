import {
  createAuditLog,
  createMemoryRevocationStore,
  createShareSigner,
  createStaticPolicyStore,
  type RedactionPolicy,
} from '@lash/share';
import { createDocumentId } from '@lash/types';
import { expect, test, type Page } from '@playwright/test';

type InviteWindow = Window & {
  __lashEditor?: unknown;
  __lashInviteExposure?: string[];
  __lashLastInviteLink?: string;
  __lashOutlineItems?: unknown;
  __lashRecoveryProbe?: unknown;
  __lashSerializeMarkdown?: unknown;
};

const LEGACY_LOCAL_INVITE_SECRET = 'lash-local-invite-secret';
const LEGACY_REDACTION_POLICY: RedactionPolicy = {
  sha: 'local-redaction-v1',
  version: 1,
  rules: [{ path: 'spans.text', action: 'redact' }],
};

const typeIntoEditor = async (page: Page, text: string) => {
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(text);
  await expect(editor).toContainText(text);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved', {
    timeout: 10_000,
  });
};

const createLegacyLocalInviteLink = async (origin: string, docId: string) => {
  const signer = createShareSigner({
    secret: LEGACY_LOCAL_INVITE_SECRET,
    revocations: createMemoryRevocationStore(),
    policies: createStaticPolicyStore(LEGACY_REDACTION_POLICY),
    audit: createAuditLog({ adapter: 'memory' }),
  });
  const invite = await signer.sign({
    docId: createDocumentId(docId),
    scope: 'edit',
    expiresAt: '2099-01-01T00:00:00.000Z',
    issuedBy: 'legacy-local-owner',
    redactionPolicy: LEGACY_REDACTION_POLICY.sha,
    redactionPolicyVersion: LEGACY_REDACTION_POLICY.version,
  });
  return `${origin}/doc/${encodeURIComponent(docId)}#invite=${encodeURIComponent(invite.token)}`;
};

test.describe('invite access UX', () => {
  test('normal product omits synthetic Activity identities', async ({ page }) => {
    await page.goto(`/doc/bead-43-normal-mentions-${Date.now()}`);

    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await expect(page.getByTestId('rail-tab-activity')).toHaveCount(0);
    await expect(page.getByTestId('mention-panel')).toHaveCount(0);

    await editor.click();
    await page.keyboard.type('@ada');
    await expect(
      page.getByTestId('mention-suggestion').filter({ hasText: 'Ada Lovelace' }),
    ).toHaveCount(0);
    await expect(page.getByText('Ada Lovelace', { exact: true })).toHaveCount(0);
  });

  test('unavailable Share copy reflects whether transport is configured', async ({ page }) => {
    const configured = Boolean(process.env.NEXT_PUBLIC_LASH_REALTIME_URL?.trim());
    await page.goto(`/doc/bead-41-copy-${Date.now()}`);
    await expect(page.getByTestId('lash-doc-title-input')).toBeVisible();
    const shareTrigger = page.getByTestId('topbar-share-button');
    await expect(shareTrigger).toHaveAccessibleName('Share document');
    await shareTrigger.click();

    if (configured) {
      await expect(page.getByTestId('share-runtime-label')).toHaveText('Transport configured');
      await expect(page.getByTestId('share-unavailable-detail')).toContainText(
        'collaboration transport is configured',
      );
      await expect(page.getByTestId('share-unavailable-detail')).toContainText(
        'authoritative invite service',
      );
    } else {
      await expect(page.getByTestId('share-runtime-label')).toHaveText('Local only');
      await expect(page.getByTestId('share-unavailable-detail')).toContainText(
        'stored in this browser profile',
      );
    }

    const presence = page.getByTestId('realtime-presence-bar');
    await expect(presence).toHaveText('On this device');
    await expect(presence.getByTestId('collaboration-empty-state')).toHaveCount(0);
    await expect(
      presence.getByRole('button', { name: 'Invite collaborator', exact: true }),
    ).toHaveCount(0);
    await expect(presence.getByTestId('remote-collaborator')).toHaveCount(0);
    await expect(page.getByTestId('invite-controls')).toHaveCount(0);
  });

  test('local-only sharing and legacy invite consumption fail closed in two clean contexts', async ({
    browser,
    baseURL,
  }) => {
    const docId = `bead-41-local-share-${Date.now()}`;
    const title = 'Shared launch brief';
    const body = 'Maya owns the launch checklist and the Friday review.';
    const ownerContext = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
      viewport: { width: 1440, height: 900 },
    });
    const ownerPage = await ownerContext.newPage();

    try {
      await ownerPage.goto(`/doc/${docId}`);
      await ownerPage.getByTestId('lash-doc-title-input').fill(title);
      await ownerPage.getByTestId('lash-doc-title-input').blur();
      await typeIntoEditor(ownerPage, body);
      await ownerPage.evaluate(() => navigator.clipboard.writeText('clipboard unchanged'));

      await ownerPage.getByTestId('topbar-share-button').click();
      await expect(ownerPage.getByTestId('share-unavailable-heading')).toContainText(
        'Sharing is not available on this build',
      );
      await expect(ownerPage.getByTestId('share-unavailable-detail')).toContainText(
        'stored in this browser profile',
      );

      await expect(ownerPage.getByTestId('invite-controls')).toHaveCount(0);
      await expect(ownerPage.getByTestId('invite-create')).toHaveCount(0);
      await expect(ownerPage.getByTestId('share-create-comment')).toHaveCount(0);
      await expect(ownerPage.getByTestId('share-create-suggest')).toHaveCount(0);
      await expect(ownerPage.getByTestId('share-create-edit')).toHaveCount(0);
      await expect(ownerPage.getByTestId('share-create-expired')).toHaveCount(0);
      await expect(ownerPage.getByTestId('invite-collaborator-row')).toHaveCount(0);
      await expect(ownerPage.getByText(/Access granted/u)).toHaveCount(0);
      await expect(ownerPage.getByText(/Copied invite link/u)).toHaveCount(0);
      await expect
        .poll(() =>
          ownerPage.evaluate(
            () => (window as InviteWindow).__lashLastInviteLink ?? 'hook unavailable',
          ),
        )
        .toBe('hook unavailable');
      await expect
        .poll(() => ownerPage.evaluate(() => navigator.clipboard.readText()))
        .toBe('clipboard unchanged');

      await expect(ownerPage.getByTestId('lash-doc-title-input')).toHaveValue(title);
      await expect(ownerPage.locator('.ProseMirror')).toContainText(body);
      await expect(ownerPage.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
      await ownerPage.screenshot({
        path: 'artifacts/stranger-test/final/FLOW-02-share-gate.png',
        animations: 'disabled',
      });

      const recipientContext = await browser.newContext();
      const recipientPage = await recipientContext.newPage();
      try {
        await recipientPage.addInitScript(() => {
          const win = window as InviteWindow;
          win.__lashInviteExposure = [];
          const forbidden = [
            '[data-testid="invite-access-status"]',
            '[data-testid="lash-doc-title-input"]',
            '[data-testid="lash-editor-content"]',
            '[data-testid="lash-toolbar"]',
            '[data-testid="markdown-import-button"]',
            '[data-testid="markdown-export-button"]',
            '[data-testid="lash-rail"]',
            '[data-testid="lash-document-outline"]',
          ];
          const recordExposure = () => {
            for (const selector of forbidden) {
              if (
                document.querySelector(selector) &&
                !win.__lashInviteExposure?.includes(selector)
              ) {
                win.__lashInviteExposure?.push(selector);
              }
            }
            if (
              document.body?.textContent?.includes('Owner access') &&
              !win.__lashInviteExposure?.includes('Owner access')
            ) {
              win.__lashInviteExposure?.push('Owner access');
            }
          };
          new MutationObserver(recordExposure).observe(document, {
            attributes: true,
            childList: true,
            subtree: true,
          });
          window.addEventListener('DOMContentLoaded', recordExposure, { once: true });
        });
        const origin = new URL(baseURL ?? ownerPage.url()).origin;
        const legacyInviteLink = await createLegacyLocalInviteLink(origin, docId);
        await recipientPage.goto(legacyInviteLink);

        await expect(recipientPage.getByTestId('invite-access-gate')).toHaveAttribute(
          'data-state',
          'denied',
        );
        const denialHeading = recipientPage.getByTestId('invite-unavailable-heading');
        await expect(denialHeading).toContainText(
          'This invite cannot load a shared document on this build',
        );
        await expect(denialHeading).toBeFocused();
        await expect(recipientPage.getByText(/Access granted/u)).toHaveCount(0);
        await expect(recipientPage.getByTestId('lash-doc-title-input')).toHaveCount(0);
        await expect(recipientPage.locator('.ProseMirror')).toHaveCount(0);
        await expect(recipientPage.getByTestId('lash-toolbar')).toHaveCount(0);
        await expect(recipientPage.getByTestId('lash-rail')).toHaveCount(0);
        await expect(recipientPage.getByTestId('markdown-import-button')).toHaveCount(0);
        await expect(recipientPage.getByTestId('lash-document-outline')).toHaveCount(0);
        await expect
          .poll(() =>
            recipientPage.evaluate(() => {
              const win = window as InviteWindow;
              return {
                editor: typeof win.__lashEditor,
                outline: typeof win.__lashOutlineItems,
                recovery: typeof win.__lashRecoveryProbe,
                serialize: typeof win.__lashSerializeMarkdown,
              };
            }),
          )
          .toEqual({
            editor: 'undefined',
            outline: 'undefined',
            recovery: 'undefined',
            serialize: 'undefined',
          });
        await expect
          .poll(() =>
            recipientPage.evaluate(
              () => (window as InviteWindow).__lashInviteExposure ?? ['observer unavailable'],
            ),
          )
          .toEqual([]);
        await expect.poll(() => recipientPage.evaluate(() => window.location.hash)).toBe('');
        await expect
          .poll(() =>
            recipientPage.evaluate(
              (key) => window.sessionStorage.getItem(key),
              `lash:invite-token:${docId}`,
            ),
          )
          .toBeNull();

        await recipientPage.keyboard.press('Tab');
        await expect(recipientPage.getByTestId('invite-safe-route')).toBeFocused();
        await recipientPage.keyboard.press('Enter');
        await expect(recipientPage).toHaveURL(
          new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/?$`, 'u'),
        );
        await expect(recipientPage.locator('.ProseMirror')).toBeVisible();
        await expect(recipientPage.locator('.ProseMirror')).toHaveAttribute(
          'contenteditable',
          'true',
        );
      } finally {
        await recipientContext.close();
      }

      await expect(ownerPage.getByTestId('lash-doc-title-input')).toHaveValue(title);
      await expect(ownerPage.locator('.ProseMirror')).toContainText(body);
    } finally {
      await ownerContext.close();
    }
  });

  test('mobile topbar Share jumps directly to the explanation and Escape restores focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/doc/bead-41-mobile-share-${Date.now()}`);
    await expect(page.getByTestId('lash-doc-title-input')).toBeVisible();

    const shareTrigger = page.getByTestId('topbar-share-button');
    await shareTrigger.click();
    const heading = page.getByTestId('share-unavailable-heading');
    await expect(heading).toBeVisible();
    await expect(page.getByTestId('rail-tab-share')).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(async () => {
        const box = await heading.boundingBox();
        return Boolean(box && box.y >= 0 && box.y + box.height <= 812);
      })
      .toBe(true);

    await page.screenshot({
      path: 'artifacts/stranger-test/final/FLOW-02-mobile-share-gate.png',
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(shareTrigger).toBeFocused();
  });
});
