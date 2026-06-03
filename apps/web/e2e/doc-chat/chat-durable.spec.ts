import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

type LashTestWindow = Window & {
  __lashEditor?: {
    commands: {
      focus: (position?: 'start' | 'end') => boolean;
      setContent: (content: string) => boolean;
    };
    chain: () => {
      focus: () => {
        setTextSelection: (range: { from: number; to: number }) => { run: () => boolean };
      };
    };
    getText: (options?: { blockSeparator?: string }) => string;
  };
};

const EMPTY_DOC = '<p></p>';
const REALTIME_PORT = 8787;
const REALTIME_HEALTH_URL = `http://127.0.0.1:${REALTIME_PORT}/api/realtime/health`;

let realtimeWorker: ChildProcess | null = null;

const waitForEditor = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
  await expect(page.locator('.ProseMirror')).toBeVisible();
};

const editorText = (page: Page) =>
  page.evaluate(
    () => (window as LashTestWindow).__lashEditor?.getText({ blockSeparator: '\n' }) ?? '',
  );

const seedEmptyDoc = async (page: Page) => {
  await waitForEditor(page);
  await page.evaluate((content) => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.setContent(content);
  }, EMPTY_DOC);
};

const typeIntoEditor = async (page: Page, text: string) => {
  await page.evaluate(() => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.focus('end');
  });
  await page.keyboard.type(text);
  await expect.poll(() => editorText(page)).toContain(text);
};

const selectText = async (page: Page, needle: string) => {
  await page.evaluate((target) => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    const text = editor.getText({ blockSeparator: '\n' });
    const index = text.indexOf(target);
    if (index < 0) throw new Error(`Cannot find ${target}`);
    editor
      .chain()
      .focus()
      .setTextSelection({ from: index + 1, to: index + target.length + 1 })
      .run();
  }, needle);
};

const createThreadWithReply = async (page: Page, reply: string) => {
  await expect(page.getByTestId('chat-create-thread')).toBeEnabled();
  await page.getByTestId('chat-create-thread').click();
  await expect(page.getByTestId('chat-thread')).toHaveCount(1);
  await page.getByTestId('chat-reply-input').fill(reply);
  await page.getByTestId('chat-add-reply').click();
  await expect(page.getByTestId('chat-message').filter({ hasText: reply })).toBeVisible();
};

const assertRealtimePortFree = () => {
  const result = spawnSync('lsof', ['-n', '-P', `-iTCP:${REALTIME_PORT}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  if (result.status === 0) {
    throw new Error(`Realtime test port ${REALTIME_PORT} is already in use:\n${result.stdout}`);
  }
};

const waitForRealtimeWorker = async () => {
  const deadline = Date.now() + 30_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(REALTIME_HEALTH_URL);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Realtime worker did not become ready: ${lastError}`);
};

const startRealtimeWorker = async () => {
  assertRealtimePortFree();
  realtimeWorker = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--config',
      'packages/realtime-worker/wrangler.jsonc',
      '--local',
      '--port',
      String(REALTIME_PORT),
      '--log-level',
      'error',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  realtimeWorker.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  await waitForRealtimeWorker();
};

const stopRealtimeWorker = async () => {
  const worker = realtimeWorker;
  realtimeWorker = null;
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  worker.kill('SIGTERM');
  const timeout = setTimeout(() => worker.kill('SIGKILL'), 5_000);
  await once(worker, 'exit').catch(() => undefined);
  clearTimeout(timeout);
};

const enableLocalRealtime = (context: BrowserContext, actorId: string) =>
  context.addInitScript((nextActorId) => {
    window.localStorage.setItem('lash:realtime-enabled', 'true');
    window.localStorage.setItem('lash:actor-id', nextActorId);
  }, actorId);

const openTwoRealtimeClients = async (browser: Browser, documentId: string) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await Promise.all([
    enableLocalRealtime(contextA, 'comment-author'),
    enableLocalRealtime(contextB, 'comment-reviewer'),
  ]);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await Promise.all([pageA.goto(`/doc/${documentId}`), pageB.goto(`/doc/${documentId}`)]);
  await Promise.all([seedEmptyDoc(pageA), seedEmptyDoc(pageB)]);
  return {
    pageA,
    pageB,
    close: async () => {
      await Promise.all([contextA.close(), contextB.close()]);
    },
  };
};

test.describe('durable comments', () => {
  test('threads, replies, resolve, and reopen survive reload', async ({ page }) => {
    const docId = `bead-35-chat-local-${Date.now()}`;
    await page.goto(`/doc/${docId}`);
    await seedEmptyDoc(page);
    await typeIntoEditor(page, 'Durable target thread');
    await expect(page.getByTestId('history-version').first()).toBeVisible();

    await selectText(page, 'target');
    await createThreadWithReply(page, 'Please check this wording');
    await page.getByTestId('chat-resolve-thread').click();
    await expect(page.getByTestId('chat-thread-status')).toContainText('Resolved');

    await page.reload();
    await waitForEditor(page);
    await expect(page.getByTestId('chat-thread')).toHaveCount(1);
    await expect(
      page.getByTestId('chat-message').filter({ hasText: 'Please check this wording' }),
    ).toBeVisible();
    await expect(page.getByTestId('chat-thread-status')).toContainText('Resolved');

    await page.getByTestId('chat-reopen-thread').click();
    await expect(page.getByTestId('chat-thread-status')).toContainText('Open');
  });

  test('realtime comments sync and remain anchored across remote edits', async ({ browser }) => {
    await startRealtimeWorker();
    const clients = await openTwoRealtimeClients(browser, `bead-35-chat-sync-${Date.now()}`);
    try {
      await typeIntoEditor(clients.pageA, 'Shared target section');
      await expect.poll(() => editorText(clients.pageB)).toContain('Shared target section');

      await selectText(clients.pageA, 'target');
      await createThreadWithReply(clients.pageA, 'Remote reviewer can see this');

      await expect(clients.pageB.getByTestId('chat-thread')).toHaveCount(1);
      await expect(
        clients.pageB
          .getByTestId('chat-message')
          .filter({ hasText: 'Remote reviewer can see this' }),
      ).toBeVisible();

      await typeIntoEditor(clients.pageB, ' after remote edit');
      await expect(clients.pageA.getByTestId('chat-anchor-status')).toContainText('Anchored');
      await expect(clients.pageA.getByTestId('chat-current-context')).toContainText('target');
    } finally {
      await clients.close();
      await stopRealtimeWorker();
    }
  });
});
