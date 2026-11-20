import { expect, test, type Page } from '@playwright/test';

import { signIn, waitForPath } from './named-account-journey';

const title = (page: Page) => page.getByRole('textbox', { name: 'Document title' });
const editor = (page: Page) => page.getByRole('textbox', { name: 'Document editor' });
const share = (page: Page) => page.getByRole('button', { name: 'Share document', exact: true });
const shareDialog = (page: Page) => page.getByRole('dialog', { name: /^Share /u });
const documentHeading = 'Launch checklist';
const originalPassage = 'Confirm the venue.';
const laterPassage = 'Keep the new budget on this device.';

async function expectDocument(page: Page, expectedTitle: string, hasLaterEdits: boolean) {
  const body = editor(page);
  await expect(title(page)).toHaveValue(expectedTitle);
  await expect(body).toBeEditable();
  await expect(body.getByRole('heading', { level: 2 })).toHaveText(documentHeading);
  const paragraphs = body.locator('p');
  await expect(paragraphs).toHaveText(
    hasLaterEdits ? [originalPassage, laterPassage] : [originalPassage],
  );
  await expect(paragraphs.first().locator('strong')).toHaveText(originalPassage);
  if (hasLaterEdits) {
    await expect(paragraphs.last().locator('em')).toHaveText(laterPassage);
  }
}

test('a lost save-to-account response preserves later device edits across reload and account reopen', async ({
  baseURL,
  page,
}, testInfo) => {
  if (!baseURL) throw new Error('This journey requires the configured local Lash stack.');
  const origin = new URL(baseURL).origin;
  const marker = crypto.randomUUID().slice(0, 8);
  const email = `promotion-owner-${marker}@example.test`;
  const originalTitle = `Launch notes ${marker}`;
  const laterTitle = `Device budget ${marker}`;

  await page.goto('/');
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page).toHaveURL(/\/doc\/[^/?#]+$/u);
  const localPath = new URL(page.url()).pathname;
  const promotionPath = `/api/documents/${localPath.split('/').at(-1)}/promote`;

  const body = editor(page);
  await title(page).fill(originalTitle);
  await expect(body).toBeEditable();
  await body.click();
  await page.keyboard.press('ControlOrMeta+Alt+2');
  await expect(body.getByRole('heading', { level: 2 })).toBeVisible();
  await expect(body).toBeFocused();
  await page.keyboard.insertText(documentHeading);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+B');
  await page.keyboard.insertText(originalPassage);
  await expectDocument(page, originalTitle, false);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

  const dialog = shareDialog(page);
  await share(page).click();
  await dialog.getByRole('link', { name: 'Sign in to continue' }).click();
  await signIn(page, email, origin);
  await waitForPath(page, localPath);
  await expectDocument(page, originalTitle, false);

  const connectedRooms: string[] = [];
  page.on('websocket', (socket) => {
    const pathname = new URL(socket.url()).pathname;
    const roomId = /^\/api\/realtime\/rooms\/([^/]+)\/socket$/u.exec(pathname)?.[1];
    if (roomId) connectedRooms.push(roomId);
  });

  let promotionPosts = 0;
  let promotionStatus: number | undefined;
  let committedRoom: string | undefined;
  await page.route(
    (url) => url.origin === origin && url.pathname === promotionPath,
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      promotionPosts += 1;
      try {
        if (promotionPosts === 1) {
          // The authenticated request reaches the actual server. Drop only the response.
          const upstream = await route.fetch({ maxRetries: 0 });
          promotionStatus = upstream.status();
          const submitted = route.request().postDataJSON() as {
            snapshot?: { snapshotSha256?: string };
          };
          const digest = submitted.snapshot?.snapshotSha256;
          const receipt = (await upstream.json().catch(() => null)) as {
            ok?: boolean;
            created?: boolean;
            roomId?: string;
            snapshotSha256?: string;
          } | null;
          if (
            digest &&
            receipt?.ok === true &&
            receipt.created === true &&
            receipt.snapshotSha256 === digest
          ) {
            committedRoom = receipt.roomId;
          }
        }
      } finally {
        await route.abort('connectionreset');
      }
    },
  );

  await share(page).click();
  await dialog.getByRole('button', { name: 'Save to my account', exact: true }).click();
  await expect.poll(() => promotionStatus, { message: 'Actual promotion HTTP status' }).toBe(200);
  await expect
    .poll(() => committedRoom, { message: 'Matching creation receipt before connection reset' })
    .toMatch(/^doc-v[0-9]+-[0-9a-f]{64}$/u);
  await dialog.getByRole('button', { name: 'Close sharing', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('invite-access-status')).toHaveText('On this device');

  await title(page).fill(laterTitle);
  await body.locator('p').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+I');
  await page.keyboard.insertText(laterPassage);
  await expectDocument(page, laterTitle, true);
  await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-status', 'saved');

  await page.reload();
  await waitForPath(page, localPath);
  await expectDocument(page, laterTitle, true);
  await expect(page.getByTestId('invite-access-status')).toHaveText('On this device');
  const recovery = page.getByTestId('promotion-recovery-notice');
  await expect(recovery).toContainText('Your edits are still in this device draft.');
  await page.screenshot({ path: testInfo.outputPath('recovered-device-draft.png') });

  await recovery.getByRole('button', { name: 'Account save options', exact: true }).click();
  const check = dialog.getByRole('button', { name: 'Check account copy', exact: true });
  const openCopy = dialog.getByRole('button', { name: 'Open account copy', exact: true });
  await expect(openCopy).toHaveCount(0);
  await check.click();
  await expect(openCopy).toBeEnabled();
  await expect(
    dialog.getByRole('heading', { name: `Share “${laterTitle}”`, exact: true }),
  ).toBeVisible();
  expect(connectedRooms).toHaveLength(0);
  await openCopy.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('realtime-sync-state')).toHaveText('Saved');
  await expectDocument(page, originalTitle, false);
  expect(connectedRooms).toContain(committedRoom);
  await page.screenshot({ path: testInfo.outputPath('verified-earlier-account-copy.png') });

  await page
    .getByTestId('account-copy-notice')
    .getByRole('button', { name: 'Return to device draft', exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === localPath);
  await expectDocument(page, laterTitle, true);
  await page.reload();
  await page.waitForURL((url) => url.pathname === localPath);
  await expectDocument(page, laterTitle, true);
  await expect(page.getByTestId('invite-access-status')).toHaveText('On this device');
  expect(promotionPosts).toBe(1);
});
