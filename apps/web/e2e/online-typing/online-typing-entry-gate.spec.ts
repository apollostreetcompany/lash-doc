import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import {
  enableDevelopmentLoopback,
  test,
  type DevelopmentLoopbackWorker,
} from '../development-loopback-worker';

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
      connectionState: string;
      syncState: string;
      queuedUpdateCount: number;
      pendingUpdateCount: number;
      peers: Array<{
        actorId: string;
        selection: { from: number; to: number } | null;
      }>;
    };
  };
};

const EMPTY_DOC = '<p></p>';
const SNAPSHOT_UPDATE_THRESHOLD = 20;

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

const openTwoClientsOnSameDoc = async (
  browser: Browser,
  worker: DevelopmentLoopbackWorker,
  options: {
    actorA?: string;
    actorB?: string;
    documentId?: string;
  } = {},
) => {
  const { actorA = 'actor-alpha', actorB = 'actor-beta', documentId = 'demo-document' } = options;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await Promise.all([
    enableDevelopmentLoopback(contextA, worker, actorA),
    enableDevelopmentLoopback(contextB, worker, actorB),
  ]);
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

const focusEditor = (page: Page) =>
  page.evaluate(() => {
    const editor = (window as LashTestWindow).__lashEditor;
    if (!editor) throw new Error('Lash editor test hook is unavailable');
    editor.commands.focus('end');
  });

const typeIntoEditor = async (page: Page, text: string) => {
  await focusEditor(page);
  await page.keyboard.type(text);
  await expect.poll(() => editorText(page)).toContain(text);
};

const sessionFor = async (worker: DevelopmentLoopbackWorker, roomId: string, actorId: string) => {
  const response = await fetch(
    `${worker.httpBaseUrl}/api/realtime/rooms/${roomId}/session?actorId=${actorId}`,
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

const roomHealth = async (
  worker: DevelopmentLoopbackWorker,
  roomId: string,
  accessToken: string,
) => {
  const response = await fetch(
    `${worker.httpBaseUrl}/api/realtime/rooms/${roomId}/health?accessToken=${encodeURIComponent(accessToken)}`,
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

test.describe('development loopback transport', () => {
  test('unauthorized sessions cannot read or join a document room', async ({
    developmentLoopbackWorker: worker,
  }) => {
    const roomId = 'access-boundary-alpha';
    const noTokenHealth = await fetch(`${worker.httpBaseUrl}/api/realtime/rooms/${roomId}/health`);
    expect(noTokenHealth.status).toBe(403);

    await waitForSocketRefusal(`${worker.socketBaseUrl}/api/realtime/rooms/${roomId}/socket`);

    const accessToken = await sessionFor(worker, roomId, 'actor-authorized');
    const tamperedToken = `${accessToken.slice(0, -2)}xx`;
    const tamperedHealth = await fetch(
      `${worker.httpBaseUrl}/api/realtime/rooms/${roomId}/health?accessToken=${tamperedToken}`,
    );
    expect(tamperedHealth.status).toBe(403);

    await waitForSocketRefusal(
      `${worker.socketBaseUrl}/api/realtime/rooms/${roomId}/socket?accessToken=${encodeURIComponent(tamperedToken)}`,
    );

    const authorizedHealth = await fetch(
      `${worker.httpBaseUrl}/api/realtime/rooms/${roomId}/health?accessToken=${encodeURIComponent(accessToken)}`,
    );
    expect(authorizedHealth.status).toBe(200);
  });

  test('same-doc remote visibility shows keystrokes in another browser context', async ({
    browser,
    developmentLoopbackWorker: worker,
  }) => {
    const room = await openTwoClientsOnSameDoc(browser, worker);
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

  test('same-doc concurrent typing converges across two browser contexts', async ({
    browser,
    developmentLoopbackWorker: worker,
  }) => {
    const room = await openTwoClientsOnSameDoc(browser, worker);
    try {
      const fromA = 'Alpha from client A';
      const fromB = 'Beta from client B';

      await Promise.all([focusEditor(room.pageA), focusEditor(room.pageB)]);
      await Promise.all([
        room.pageA.keyboard.insertText(fromA),
        room.pageB.keyboard.insertText(fromB),
      ]);

      await expect
        .poll(
          async () => {
            const [textA, textB] = await Promise.all([
              editorText(room.pageA),
              editorText(room.pageB),
            ]);
            return textA === textB && textA.includes(fromA) && textA.includes(fromB);
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

  test('typed document content survives reload of the same document', async ({
    browser,
    developmentLoopbackWorker: worker,
  }) => {
    const context = await browser.newContext();
    await enableDevelopmentLoopback(context, worker);
    const primarySentinel = 'realtime-primary-sentinel';
    const backupSentinel = 'realtime-backup-sentinel';
    await context.addInitScript(
      ({ primary, backup }) => {
        window.localStorage.setItem('lash:body:demo-document', primary);
        window.localStorage.setItem('lash:body-backup:demo-document', backup);
      },
      { primary: primarySentinel, backup: backupSentinel },
    );
    const page = await context.newPage();

    try {
      await openDemoDoc(page);
      await expect(page.getByTestId('autosave-indicator')).toHaveCount(0);
      const durableText = 'Durable reload text';
      await typeIntoEditor(page, durableText);
      await page.waitForTimeout(700);
      expect(
        await page.evaluate(() => ({
          primary: window.localStorage.getItem('lash:body:demo-document'),
          backup: window.localStorage.getItem('lash:body-backup:demo-document'),
        })),
      ).toEqual({ primary: primarySentinel, backup: backupSentinel });

      await page.reload();
      await waitForEditor(page);

      await expect
        .poll(() => editorText(page), {
          message: 'document content should be durable after reload',
          timeout: 3_000,
        })
        .toContain(durableText);
      await expect(page.getByTestId('autosave-indicator')).toHaveCount(0);
      expect(
        await page.evaluate(() => ({
          primary: window.localStorage.getItem('lash:body:demo-document'),
          backup: window.localStorage.getItem('lash:body-backup:demo-document'),
        })),
      ).toEqual({ primary: primarySentinel, backup: backupSentinel });
    } finally {
      await context.close();
    }
  });

  test('durable room compacts snapshots without deleting update history', async ({
    browser,
    developmentLoopbackWorker: worker,
  }) => {
    const roomId = `bead-31-snapshot-${Date.now()}`;
    const context = await browser.newContext();
    await enableDevelopmentLoopback(context, worker);
    const page = await context.newPage();

    try {
      await openDocument(page, roomId);
      await typeIntoEditor(page, 'Snapshot compaction writes enough real editor updates.');
      const accessToken = await sessionFor(worker, roomId, 'actor-snapshot-reader');

      await expect
        .poll(
          async () => {
            const health = await roomHealth(worker, roomId, accessToken);
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

      const health = await roomHealth(worker, roomId, accessToken);
      expect(health.persistence.updates).toBeGreaterThanOrEqual(SNAPSHOT_UPDATE_THRESHOLD);
      expect(health.persistence.snapshotSequence).not.toBeNull();
    } finally {
      await context.close();
    }
  });

  test('presence and remote cursor awareness are visible across clients', async ({
    browser,
    developmentLoopbackWorker: worker,
  }) => {
    const room = await openTwoClientsOnSameDoc(browser, worker, {
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

  test('offline-queue uses the actual provider queue while the peer remains unchanged', async ({
    browser,
    developmentLoopbackWorker: worker,
  }) => {
    const queuedText = 'Queued through the real Yjs provider';
    const room = await openTwoClientsOnSameDoc(browser, worker, {
      actorA: 'queue-author',
      actorB: 'queue-observer',
      documentId: `bead-43-offline-queue-${Date.now()}`,
    });

    try {
      await expect
        .poll(() => realtimeSnapshot(room.pageA), {
          message: 'both clients should establish actual awareness before disconnect',
        })
        .toMatchObject({
          connectionState: 'connected',
          peers: expect.arrayContaining([
            expect.objectContaining({
              actorId: 'queue-observer',
            }),
          ]),
        });

      await room.pageA.evaluate(() => {
        const api = (window as LashTestWindow).__lashRealtime;
        if (!api) throw new Error('Realtime test API unavailable');
        api.disconnectForTest();
      });
      await expect
        .poll(() => realtimeSnapshot(room.pageA))
        .toMatchObject({ connectionState: 'reconnecting' });
      await expect
        .poll(async () => {
          const snapshot = await realtimeSnapshot(room.pageB);
          return snapshot?.peers.some((peer) => peer.actorId === 'queue-author') ?? false;
        })
        .toBe(false);

      await typeIntoEditor(room.pageA, queuedText);
      await expect
        .poll(() => realtimeSnapshot(room.pageA), {
          message: 'the disconnected provider should own a real queued Yjs update',
        })
        .toMatchObject({
          connectionState: 'reconnecting',
          syncState: 'reconnecting',
          queuedUpdateCount: expect.any(Number),
          pendingUpdateCount: 0,
        });
      expect((await realtimeSnapshot(room.pageA))?.queuedUpdateCount ?? 0).toBeGreaterThan(0);

      await room.pageB.waitForTimeout(500);
      expect(await editorText(room.pageB)).not.toContain(queuedText);
    } finally {
      await room.close();
    }
  });

  test('offline-merge reconnects, converges, and reloads the actual queued update', async ({
    browser,
    developmentLoopbackWorker: worker,
  }) => {
    const queuedText = 'Durable queued update from the real provider';
    const documentId = `bead-43-offline-merge-${Date.now()}`;
    const room = await openTwoClientsOnSameDoc(browser, worker, {
      actorA: 'merge-author',
      actorB: 'merge-observer',
      documentId,
    });
    let verificationContext: BrowserContext | null = null;

    try {
      await expect
        .poll(() => realtimeSnapshot(room.pageA))
        .toMatchObject({
          connectionState: 'connected',
          peers: expect.arrayContaining([
            expect.objectContaining({
              actorId: 'merge-observer',
            }),
          ]),
        });

      await room.pageA.evaluate(() => {
        const api = (window as LashTestWindow).__lashRealtime;
        if (!api) throw new Error('Realtime test API unavailable');
        api.disconnectForTest();
      });
      await typeIntoEditor(room.pageA, queuedText);
      await expect
        .poll(async () => (await realtimeSnapshot(room.pageA))?.queuedUpdateCount ?? 0)
        .toBeGreaterThan(0);
      expect(await editorText(room.pageB)).not.toContain(queuedText);

      await room.pageA.evaluate(() => {
        const api = (window as LashTestWindow).__lashRealtime;
        if (!api) throw new Error('Realtime test API unavailable');
        api.reconnectForTest();
      });
      await expect
        .poll(
          async () => {
            const [textA, textB] = await Promise.all([
              editorText(room.pageA),
              editorText(room.pageB),
            ]);
            return { textA, textB };
          },
          {
            message: 'both clients should converge after the provider reconnects',
            timeout: 5_000,
          },
        )
        .toEqual({ textA: queuedText, textB: queuedText });
      await expect
        .poll(() => realtimeSnapshot(room.pageA))
        .toMatchObject({
          connectionState: 'connected',
          syncState: 'saved',
          queuedUpdateCount: 0,
          pendingUpdateCount: 0,
        });

      await Promise.all([room.pageA.reload(), room.pageB.reload()]);
      await Promise.all([waitForEditor(room.pageA), waitForEditor(room.pageB)]);
      await expect
        .poll(
          async () => {
            const [textA, textB] = await Promise.all([
              editorText(room.pageA),
              editorText(room.pageB),
            ]);
            return { textA, textB };
          },
          {
            message: 'the converged provider state should hydrate both reloaded clients',
            timeout: 5_000,
          },
        )
        .toEqual({ textA: queuedText, textB: queuedText });

      verificationContext = await browser.newContext();
      await enableDevelopmentLoopback(verificationContext, worker, 'merge-clean-verifier');
      const verificationPage = await verificationContext.newPage();
      await verificationPage.goto(`/doc/${documentId}`);
      await waitForEditor(verificationPage);
      await expect
        .poll(() => editorText(verificationPage), {
          message: 'a third clean context should hydrate the exact Durable Object text',
          timeout: 5_000,
        })
        .toBe(queuedText);
    } finally {
      await verificationContext?.close();
      await room.close();
    }
  });

  test('presence-resume removes and restores actual provider awareness', async ({
    browser,
    developmentLoopbackWorker: worker,
  }) => {
    const room = await openTwoClientsOnSameDoc(browser, worker, {
      actorA: 'presence-author',
      actorB: 'presence-observer',
      documentId: `bead-43-presence-resume-${Date.now()}`,
    });

    try {
      await expect
        .poll(() => realtimeSnapshot(room.pageA))
        .toMatchObject({
          peers: expect.arrayContaining([
            expect.objectContaining({
              actorId: 'presence-observer',
            }),
          ]),
        });

      await room.pageB.evaluate(() => {
        const api = (window as LashTestWindow).__lashRealtime;
        if (!api) throw new Error('Realtime test API unavailable');
        api.disconnectForTest();
      });
      await expect
        .poll(async () => {
          const snapshot = await realtimeSnapshot(room.pageA);
          return snapshot?.peers.some((peer) => peer.actorId === 'presence-observer') ?? false;
        })
        .toBe(false);

      await room.pageB.evaluate(() => {
        const api = (window as LashTestWindow).__lashRealtime;
        if (!api) throw new Error('Realtime test API unavailable');
        api.reconnectForTest();
      });
      await expect
        .poll(() => realtimeSnapshot(room.pageA), {
          message: 'actual room awareness should restore the reconnected peer',
          timeout: 5_000,
        })
        .toMatchObject({
          peers: expect.arrayContaining([
            expect.objectContaining({
              actorId: 'presence-observer',
            }),
          ]),
        });
    } finally {
      await room.close();
    }
  });

  test('sync state surfaces saved, reconnecting, and recovered states', async ({
    browser,
    developmentLoopbackWorker: worker,
  }) => {
    const room = await openTwoClientsOnSameDoc(browser, worker, {
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
