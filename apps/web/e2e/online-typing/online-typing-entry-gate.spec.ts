import { expect, test, type Browser, type Page } from '@playwright/test';

type LashTestWindow = Window & {
  __lashEditor?: {
    commands: {
      focus: (position?: 'start' | 'end') => boolean;
      setContent: (content: string) => boolean;
    };
    getText: (options?: { blockSeparator?: string }) => string;
  };
};

const EMPTY_DOC = '<p></p>';

const waitForEditor = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
  await expect(page.locator('.ProseMirror')).toBeVisible();
};

const seedEmptyDoc = async (page: Page) => {
  await waitForEditor(page);
  await page.evaluate((content) => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.setContent(content);
  }, EMPTY_DOC);
};

const openDemoDoc = async (page: Page) => {
  await page.goto('/');
  await seedEmptyDoc(page);
};

const openTwoClientsOnSameDoc = async (browser: Browser) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await Promise.all([openDemoDoc(pageA), openDemoDoc(pageB)]);

  return {
    pageA,
    pageB,
    close: async () => {
      await Promise.all([contextA.close(), contextB.close()]);
    },
  };
};

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

test.describe('online typing entry gate', () => {
  test('same-doc remote visibility shows keystrokes in another browser context', async ({
    browser,
  }) => {
    const room = await openTwoClientsOnSameDoc(browser);
    try {
      const remoteVisibleText = 'Remote visible alpha';
      await typeIntoEditor(room.pageA, remoteVisibleText);

      await expect
        .poll(() => editorText(room.pageB), {
          message: 'client B should receive client A keystrokes for the same document',
          timeout: 3_000,
        })
        .toContain(remoteVisibleText);
    } finally {
      await room.close();
    }
  });

  test('same-doc concurrent typing converges across two browser contexts', async ({ browser }) => {
    const room = await openTwoClientsOnSameDoc(browser);
    try {
      const fromA = 'Alpha from client A';
      const fromB = 'Beta from client B';

      await typeIntoEditor(room.pageA, fromA);
      await typeIntoEditor(room.pageB, fromB);

      await expect
        .poll(
          async () => {
            const [textA, textB] = await Promise.all([
              editorText(room.pageA),
              editorText(room.pageB),
            ]);
            return [textA, textB].every((text) => text.includes(fromA) && text.includes(fromB));
          },
          {
            message: 'both clients should converge to a document containing both users typing',
            timeout: 3_000,
          },
        )
        .toBe(true);
    } finally {
      await room.close();
    }
  });

  test('typed document content survives reload of the same document', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await openDemoDoc(page);
      const durableText = 'Durable reload text';
      await typeIntoEditor(page, durableText);

      await page.reload();
      await waitForEditor(page);

      await expect
        .poll(() => editorText(page), {
          message: 'document content should be durable after reload',
          timeout: 3_000,
        })
        .toContain(durableText);
    } finally {
      await context.close();
    }
  });
});
