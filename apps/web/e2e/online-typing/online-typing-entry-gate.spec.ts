import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

type LashTestWindow = Window & {
  __lashEditor?: {
    commands: {
      focus: (position?: 'start' | 'end') => boolean;
      setContent: (content: string) => boolean;
    };
    getText: (options?: { blockSeparator?: string }) => string;
  };
  __lashRealtime?: {
    disconnectForTest: () => void;
    reconnectForTest: () => void;
    getSnapshot: () => {
      syncState: string;
      peers: Array<{
        actorId: string;
        selection: { from: number; to: number } | null;
      }>;
    };
  };
};

const EMPTY_DOC = '<p></p>';
const REALTIME_PORT = 8787;
const REALTIME_HEALTH_URL = `http://127.0.0.1:${REALTIME_PORT}/api/realtime/health`;
const SNAPSHOT_UPDATE_THRESHOLD = 20;

let realtimeWorker: ChildProcess | null = null;

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

const openDocument = async (page: Page, documentId: string) => {
  await page.goto(`/doc/${documentId}`);
  await seedEmptyDoc(page);
};

const enableLocalRealtime = (context: BrowserContext, actorId?: string) =>
  context.addInitScript((nextActorId) => {
    window.localStorage.setItem('lash:realtime-enabled', 'true');
    if (nextActorId) {
      window.localStorage.setItem('lash:actor-id', nextActorId);
    }
  }, actorId);

const openTwoClientsOnSameDoc = async (
  browser: Browser,
  options: {
    actorA?: string;
    actorB?: string;
    documentId?: string;
  } = {},
) => {
  const { actorA = 'actor-alpha', actorB = 'actor-beta', documentId = 'demo-document' } = options;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await Promise.all([enableLocalRealtime(contextA, actorA), enableLocalRealtime(contextB, actorB)]);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  if (documentId === 'demo-document') {
    await Promise.all([openDemoDoc(pageA), openDemoDoc(pageB)]);
  } else {
    await Promise.all([openDocument(pageA, documentId), openDocument(pageB, documentId)]);
  }

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

const realtimeSnapshot = (page: Page) =>
  page.evaluate(() => (window as LashTestWindow).__lashRealtime?.getSnapshot() ?? null);

const typeIntoEditor = async (page: Page, text: string) => {
  await page.evaluate(() => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.focus('end');
  });
  await page.keyboard.type(text);
  await expect.poll(() => editorText(page)).toContain(text);
};

const sessionFor = async (roomId: string, actorId: string) => {
  const response = await fetch(
    `http://127.0.0.1:${REALTIME_PORT}/api/realtime/rooms/${roomId}/session?actorId=${actorId}`,
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { ok: true; accessToken: string };
  expect(body.ok).toBe(true);
  return body.accessToken;
};

const waitForSocketRefusal = async (url: string) =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(url);
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      socket.close();
      settle(() => reject(new Error('Unauthorized realtime socket was not refused')));
    }, 5_000);
    socket.addEventListener('open', () => {
      socket.close();
      settle(() => reject(new Error('Unauthorized realtime socket unexpectedly opened')));
    });
    socket.addEventListener('error', () => {
      settle(resolve);
    });
    socket.addEventListener('close', () => {
      settle(resolve);
    });
  });

const roomHealth = async (roomId: string, accessToken: string) => {
  const response = await fetch(
    `http://127.0.0.1:${REALTIME_PORT}/api/realtime/rooms/${roomId}/health?accessToken=${encodeURIComponent(accessToken)}`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    ok: true;
    persistence: {
      updates: number;
      snapshotSequence: number | null;
      hydrationUpdates: number;
    };
  };
};

test.describe.configure({ mode: 'serial' });

test.describe('online typing entry gate', () => {
  test.beforeAll(startRealtimeWorker);
  test.afterAll(stopRealtimeWorker);

  test('unauthorized sessions cannot read or join a document room', async () => {
    const roomId = 'access-boundary-alpha';
    const noTokenHealth = await fetch(
      `http://127.0.0.1:${REALTIME_PORT}/api/realtime/rooms/${roomId}/health`,
    );
    expect(noTokenHealth.status).toBe(403);

    await waitForSocketRefusal(
      `ws://127.0.0.1:${REALTIME_PORT}/api/realtime/rooms/${roomId}/socket`,
    );

    const accessToken = await sessionFor(roomId, 'actor-authorized');
    const tamperedToken = `${accessToken.slice(0, -2)}xx`;
    const tamperedHealth = await fetch(
      `http://127.0.0.1:${REALTIME_PORT}/api/realtime/rooms/${roomId}/health?accessToken=${tamperedToken}`,
    );
    expect(tamperedHealth.status).toBe(403);

    await waitForSocketRefusal(
      `ws://127.0.0.1:${REALTIME_PORT}/api/realtime/rooms/${roomId}/socket?accessToken=${encodeURIComponent(tamperedToken)}`,
    );

    const authorizedHealth = await fetch(
      `http://127.0.0.1:${REALTIME_PORT}/api/realtime/rooms/${roomId}/health?accessToken=${encodeURIComponent(accessToken)}`,
    );
    expect(authorizedHealth.status).toBe(200);
  });

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
    await enableLocalRealtime(context);
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

  test('durable room compacts snapshots without deleting update history', async ({ browser }) => {
    const roomId = `bead-31-snapshot-${Date.now()}`;
    const context = await browser.newContext();
    await enableLocalRealtime(context);
    const page = await context.newPage();

    try {
      await openDocument(page, roomId);
      await typeIntoEditor(page, 'Snapshot compaction writes enough real editor updates.');
      const accessToken = await sessionFor(roomId, 'actor-snapshot-reader');

      await expect
        .poll(
          async () => {
            const health = await roomHealth(roomId, accessToken);
            return health.persistence;
          },
          {
            message: 'room should preserve update rows while compacting a hydration snapshot',
            timeout: 5_000,
          },
        )
        .toMatchObject({
          updates: expect.any(Number),
          snapshotSequence: expect.any(Number),
          hydrationUpdates: expect.any(Number),
        });

      const health = await roomHealth(roomId, accessToken);
      expect(health.persistence.updates).toBeGreaterThanOrEqual(SNAPSHOT_UPDATE_THRESHOLD);
      expect(health.persistence.snapshotSequence).not.toBeNull();
    } finally {
      await context.close();
    }
  });

  test('presence and remote cursor awareness are visible across clients', async ({ browser }) => {
    const room = await openTwoClientsOnSameDoc(browser, {
      actorA: 'ada-author',
      actorB: 'grace-editor',
      documentId: `bead-33-presence-${Date.now()}`,
    });

    try {
      await expect
        .poll(() => realtimeSnapshot(room.pageA), {
          message: 'client A should receive client B awareness state',
          timeout: 3_000,
        })
        .toMatchObject({
          peers: expect.arrayContaining([
            expect.objectContaining({
              actorId: 'grace-editor',
            }),
          ]),
        });

      await expect(
        room.pageA.locator('[data-testid="remote-collaborator"][data-actor-id="grace-editor"]'),
      ).toBeVisible();

      await room.pageB.evaluate(() => {
        const editor = (window as LashTestWindow).__lashEditor;
        if (!editor) throw new Error('Lash editor test hook is unavailable');
        editor.commands.focus('end');
      });
      await room.pageB.keyboard.type('Remote cursor probe');

      await expect(
        room.pageA.locator('[data-testid="remote-cursor-marker"][data-actor-id="grace-editor"]'),
      ).toContainText(/Grace Editor: cursor/i);
    } finally {
      await room.close();
    }
  });

  test('sync state surfaces saved, reconnecting, and recovered states', async ({ browser }) => {
    const room = await openTwoClientsOnSameDoc(browser, {
      actorA: 'sync-author',
      actorB: 'sync-observer',
      documentId: `bead-33-sync-${Date.now()}`,
    });

    try {
      await typeIntoEditor(room.pageA, 'Sync state probe');

      await expect
        .poll(() => realtimeSnapshot(room.pageA), {
          message: 'local updates should report saved after the room acknowledges them',
          timeout: 3_000,
        })
        .toMatchObject({ syncState: 'saved' });
      await expect(room.pageA.getByTestId('realtime-sync-state')).toContainText(/saved/i);

      await room.pageA.evaluate(() => {
        (window as LashTestWindow).__lashRealtime?.disconnectForTest();
      });
      await expect(room.pageA.getByTestId('realtime-sync-state')).toContainText(
        /reconnecting|offline/i,
      );

      await room.pageA.evaluate(() => {
        (window as LashTestWindow).__lashRealtime?.reconnectForTest();
      });
      await expect
        .poll(() => realtimeSnapshot(room.pageA), {
          message: 'manual reconnect should restore the saved sync state',
          timeout: 3_000,
        })
        .toMatchObject({ syncState: 'saved' });
    } finally {
      await room.close();
    }
  });
});
