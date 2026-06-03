import { expect, test, type Page } from '@playwright/test';

type InviteWindow = Window & {
  __lashEditor?: {
    commands: {
      focus: (position?: 'start' | 'end') => boolean;
    };
    getText: (options?: { blockSeparator?: string }) => string;
  };
  __lashLastInviteLink?: string;
};

const inviteLink = (page: Page) =>
  page.evaluate(() => (window as InviteWindow).__lashLastInviteLink ?? '');

const editorText = (page: Page) =>
  page.evaluate(
    () => (window as InviteWindow).__lashEditor?.getText({ blockSeparator: '\n' }) ?? '',
  );

const typeIntoEditor = async (page: Page, text: string) => {
  await page.evaluate(() => {
    const editor = (window as InviteWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.focus('end');
  });
  await page.keyboard.type(text);
  await expect.poll(() => editorText(page)).toContain(text);
};

test.describe('invite access UX', () => {
  test('invited collaborator opens an edit invite and can type in the document', async ({
    browser,
    page,
  }) => {
    const docId = `bead-34-edit-${Date.now()}`;
    await page.goto(`/doc/${docId}`);

    await page.getByTestId('invite-email-input').fill('collab@example.com');
    await page.getByTestId('invite-role-select').selectOption('edit');
    await page.getByTestId('invite-expiry-select').selectOption('7d');
    await page.getByTestId('invite-create').click();

    await expect(page.getByTestId('invite-copy-status')).toContainText('Copied');
    await expect(page.getByTestId('invite-collaborator-row').first()).toContainText(
      'collab@example.com',
    );
    await expect(page.getByTestId('invite-collaborator-row').first()).toContainText('edit');

    const link = await inviteLink(page);
    expect(link).toContain(`/doc/${docId}#invite=`);

    const collaboratorContext = await browser.newContext();
    const collaboratorPage = await collaboratorContext.newPage();
    try {
      await collaboratorPage.goto(link);
      await expect(collaboratorPage.getByTestId('invite-access-status')).toContainText(
        'Access granted: edit',
      );
      await expect(collaboratorPage.getByTestId('share-can-edit')).toContainText('yes');

      await typeIntoEditor(collaboratorPage, 'Edited through invite');
    } finally {
      await collaboratorContext.close();
    }
  });

  test('comment invite opens with comment capability but not body editing', async ({
    browser,
    page,
  }) => {
    const docId = `bead-34-comment-${Date.now()}`;
    await page.goto(`/doc/${docId}`);

    await page.getByTestId('invite-email-input').fill('commenter@example.com');
    await page.getByTestId('invite-role-select').selectOption('comment');
    await page.getByTestId('invite-expiry-select').selectOption('7d');
    await page.getByTestId('invite-create').click();
    await expect(page.getByTestId('invite-copy-status')).toContainText('Copied');
    const link = await inviteLink(page);

    const collaboratorContext = await browser.newContext();
    const collaboratorPage = await collaboratorContext.newPage();
    try {
      await collaboratorPage.goto(link);
      await expect(collaboratorPage.getByTestId('invite-access-status')).toContainText(
        'Access granted: comment',
      );
      await expect(collaboratorPage.getByTestId('share-can-comment')).toContainText('yes');
      await expect(collaboratorPage.getByTestId('share-can-edit')).toContainText('no');

      await collaboratorPage.evaluate(() => {
        const editor = (window as InviteWindow).__lashEditor;
        if (!editor) throw new Error('Lash editor test hook is unavailable');
        editor.commands.focus('end');
      });
      await collaboratorPage.keyboard.type('Body edit should not land');
      await expect
        .poll(() => editorText(collaboratorPage))
        .not.toContain('Body edit should not land');
    } finally {
      await collaboratorContext.close();
    }
  });

  test('revoked and expired invites deny document access', async ({ browser, page }) => {
    const docId = `bead-34-deny-${Date.now()}`;
    await page.goto(`/doc/${docId}`);

    await page.getByTestId('invite-email-input').fill('revoked@example.com');
    await page.getByTestId('invite-role-select').selectOption('comment');
    await page.getByTestId('invite-expiry-select').selectOption('never');
    await page.getByTestId('invite-create').click();
    await expect(page.getByTestId('invite-copy-status')).toContainText('Copied');
    const revokedLink = await inviteLink(page);
    await page.getByTestId('invite-revoke-button').first().click();
    await expect(page.getByTestId('invite-collaborator-row').first()).toContainText('revoked');

    const revokedPage = await page.context().newPage();
    try {
      await revokedPage.goto(revokedLink);
      await expect(revokedPage.getByTestId('invite-access-status')).toContainText(
        'Denied: revoked',
      );
    } finally {
      await revokedPage.close();
    }

    await page.getByTestId('invite-email-input').fill('expired@example.com');
    await page.getByTestId('invite-role-select').selectOption('view');
    await page.getByTestId('invite-expiry-select').selectOption('expired');
    await page.getByTestId('invite-create').click();
    await expect.poll(() => inviteLink(page)).not.toBe(revokedLink);
    const expiredLink = await inviteLink(page);

    const expiredContext = await browser.newContext();
    const expiredPage = await expiredContext.newPage();
    try {
      await expiredPage.goto(expiredLink);
      await expect(expiredPage.getByTestId('invite-access-status')).toContainText(
        'Denied: expired',
      );
      await expect(expiredPage.getByTestId('share-can-edit')).toContainText('no');
    } finally {
      await expiredContext.close();
    }
  });
});
