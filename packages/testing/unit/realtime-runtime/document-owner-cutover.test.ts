import { createLashEditorExtensions } from '@lash/editor-core';
import { getSchema } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';

import {
  createDocumentAccessController,
  requestBrowserOwnerSession,
  type DocumentAccessDependencies,
} from '../../../../apps/web/lib/documentAccess';
import type { DocumentMutationAuthority } from '../../../../apps/web/lib/documentMutationAuthority';
import type { BrowserDocumentPromotionAttempt } from '../../../../apps/web/lib/documentPromotion/browserClient';
import {
  createOwnerCandidateResources,
  createRealtimeDocument,
  readRealtimeDocumentTitle,
  writeRealtimeDocumentTitle,
  type LashRealtimeYjsProvider,
  type OwnerRealtimeCandidateResources,
  type OwnerRealtimeSessionV3,
  type RealtimeSocket,
  type RealtimeRuntimeSelection,
} from '../../../../apps/web/lib/realtimeCollaboration';
import { createRealtimeRecoveryJournal } from '../../../../apps/web/lib/realtimeRecoveryJournal';

const ROUTE_DOCUMENT_ID = 'local-weekly-plan';
const REMOTE_DOCUMENT_ID = `doc-v7-${'a'.repeat(64)}`;
const OTHER_REMOTE_DOCUMENT_ID = `doc-v7-${'b'.repeat(64)}`;
const SNAPSHOT_SHA256 = 's'.repeat(43);
const ACTOR_ID = 'actor-owner';
const TITLE = 'Weekly launch plan';
const BODY = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Review the launch plan with the team on Friday.' }],
    },
  ],
};

const configuredRuntime: RealtimeRuntimeSelection = {
  invitationMode: 'unavailable',
  mode: 'configured',
  socketBaseUrl: 'wss://realtime.lash.example',
};

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

const ownerSession = (overrides: Partial<OwnerRealtimeSessionV3> = {}): OwnerRealtimeSessionV3 => ({
  protocolVersion: 3,
  source: 'owner',
  routeDocumentId: ROUTE_DOCUMENT_ID,
  remoteDocumentId: REMOTE_DOCUMENT_ID,
  promotionSnapshotSha256: SNAPSHOT_SHA256,
  actorId: ACTOR_ID,
  capabilities: ['doc.read', 'doc.edit'],
  socketUrl: `wss://realtime.lash.example/api/realtime/rooms/${REMOTE_DOCUMENT_ID}/socket?protocolVersion=3&actorId=${ACTOR_ID}`,
  socketProtocol: 'lash-realtime-v3',
  ticketProtocol: `lash-ticket.${'t'.repeat(43)}`,
  expiresAt: '2099-01-01T00:00:00.000Z',
  ...overrides,
});

const promotionAttempt = (
  overrides: Partial<{
    roomId: string;
    snapshotSha256: string;
    title: string;
    body: unknown;
  }> = {},
): BrowserDocumentPromotionAttempt => ({
  submit: vi.fn(async () => ({
    ok: true as const,
    receipt: {
      version: 1 as const,
      title: overrides.title ?? TITLE,
      body: overrides.body ?? BODY,
      snapshotSha256: overrides.snapshotSha256 ?? SNAPSHOT_SHA256,
      room: {
        roomId: overrides.roomId ?? REMOTE_DOCUMENT_ID,
        aclVersion: 1 as const,
        publicPolicy: 'restricted' as const,
        publicPolicyVersion: 1 as const,
        created: true,
      },
    },
  })),
});

const hydratedUpdate = (title: string = TITLE, body: unknown = BODY) => {
  const doc = prosemirrorJSONToYDoc(getSchema(createLashEditorExtensions()), body, 'content');
  writeRealtimeDocumentTitle(doc, title);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
};

type SocketEvent = 'close' | 'error' | 'message' | 'open';

class FakeOwnerSocket implements RealtimeSocket {
  readonly sent: string[] = [];
  readyState = 0;
  private readonly listeners = new Map<SocketEvent, Set<(event: unknown) => void>>();

  addEventListener(type: SocketEvent, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.readyState = 3;
  }

  emit(type: SocketEvent, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  removeEventListener(type: SocketEvent, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }
}

const createCandidateFactory = ({
  body = BODY,
  title = TITLE,
  waitForHydration = Promise.resolve(),
}: {
  body?: unknown;
  title?: string;
  waitForHydration?: Promise<void>;
} = {}) =>
  vi.fn(
    (
      session: OwnerRealtimeSessionV3,
      options: {
        authority: DocumentMutationAuthority;
        refreshOwnerSession(
          routeDocumentId: string,
          signal: AbortSignal,
        ): Promise<OwnerRealtimeSessionV3>;
      },
    ): OwnerRealtimeCandidateResources => {
      const doc = createRealtimeDocument();
      expect(readRealtimeDocumentTitle(doc)).toBeNull();
      expect(doc.getXmlFragment('content').length).toBe(0);
      const update = hydratedUpdate(title, body);
      const provider = {
        commitAuthorityOwnership: vi.fn(() => true),
        destroy: vi.fn(() => true),
        getSnapshot: vi.fn(() => ({
          actorId: ACTOR_ID,
          canWrite: true,
          connectionState: 'connected' as const,
          enabled: true,
          hydrated: true,
          peers: [],
          pendingUpdateCount: 0,
          queuedUpdateCount: 0,
          syncState: 'saved' as const,
        })),
        start: vi.fn(async () => {
          await waitForHydration;
          const applied = options.authority.runRemoteBodyApply(session.remoteDocumentId, () => {
            Y.applyUpdate(doc, update);
          });
          if (!applied) throw new Error('candidate hydration authority denied');
        }),
        subscribe: vi.fn(() => () => undefined),
      } as unknown as LashRealtimeYjsProvider;
      return { doc, provider };
    },
  );

const createHarness = (
  overrides: Partial<DocumentAccessDependencies> & {
    createOwnerResources?: ReturnType<typeof createCandidateFactory>;
    requestOwnerSession?: (input: {
      actorId: string;
      routeDocumentId: string;
      signal: AbortSignal;
    }) => Promise<unknown>;
  } = {},
  runtime: RealtimeRuntimeSelection = {
    invitationMode: 'unavailable',
    mode: 'disabled',
    socketBaseUrl: null,
  },
) => {
  const createOwnerResources = overrides.createOwnerResources ?? createCandidateFactory();
  const requestOwnerSession =
    overrides.requestOwnerSession ??
    vi.fn(async () => ({ ok: false as const, reason: 'unauthenticated', retryable: false }));
  const dependencies = {
    clearLegacyCredential: vi.fn(),
    clearRoomCredentials: vi.fn(),
    createOwnerResources,
    createResources: vi.fn(),
    delay: vi.fn(async () => undefined),
    exchangeSession: vi.fn(),
    fetcher: vi.fn(),
    getActorId: vi.fn(() => ACTOR_ID),
    installRecoveryNavigationWarning: vi.fn(() => vi.fn()),
    navigateHome: vi.fn(),
    readFragmentCredential: () => ({ state: 'absent' as const }),
    readRuntime: () => runtime,
    recoveryJournal: createRealtimeRecoveryJournal(createStorage()),
    readStoredCredential: () => null,
    requestOwnerSession,
    scrubInviteFragment: vi.fn(() => true),
    validateDevelopmentInvite: vi.fn(),
    writeValidatedCredential: vi.fn(),
    ...overrides,
  } as unknown as DocumentAccessDependencies;
  return { createOwnerResources, dependencies, requestOwnerSession };
};

describe('account-owner access cutover', () => {
  it('passes the frozen 43-character promotion snapshot through the real owner provider boundary', () => {
    const controller = createDocumentAccessController(
      { documentId: ROUTE_DOCUMENT_ID },
      createHarness().dependencies,
    );
    const authority = controller.getMutationAuthority();
    authority.enterLocalReady();
    expect(authority.freezeForOwnerCutover()).toBe(true);
    authority.enterRemoteHydrating(REMOTE_DOCUMENT_ID);

    const resources = createOwnerCandidateResources(ownerSession(), {
      authority,
      createSocket: vi.fn(),
      refreshOwnerSession: vi.fn(async () => ownerSession()),
    });

    expect(resources.doc.getXmlFragment('content').length).toBe(0);
    expect(resources.provider.destroy()).toBe(true);
    resources.doc.destroy();
  });

  it('requests owner access from the same route using only the route ID and actor in bounded JSON', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        ok: true,
        version: 1,
        localDocumentId: ROUTE_DOCUMENT_ID,
        remoteDocumentId: REMOTE_DOCUMENT_ID,
        promotionSnapshotSha256: SNAPSHOT_SHA256,
        access: {
          source: 'owner',
          capabilities: ['doc.read', 'doc.edit'],
          protocolVersion: 3,
        },
        socket: {
          url: `wss://realtime.lash.example/api/realtime/rooms/${REMOTE_DOCUMENT_ID}/socket?protocolVersion=3&actorId=${ACTOR_ID}`,
          protocol: 'lash-realtime-v3',
          ticketProtocol: `lash-ticket.${'t'.repeat(43)}`,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      }),
    );
    const signal = new AbortController().signal;

    await expect(
      requestBrowserOwnerSession({
        actorId: ACTOR_ID,
        routeDocumentId: ROUTE_DOCUMENT_ID,
        signal,
        fetcher,
      }),
    ).resolves.toEqual({ ok: true, session: ownerSession() });

    expect(fetcher).toHaveBeenCalledWith(`/api/documents/${ROUTE_DOCUMENT_ID}/owner-session`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, actorId: ACTOR_ID }),
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
      version: 1,
      actorId: ACTOR_ID,
    });
  });

  it.each([
    [
      'ticket in the URL',
      `wss://realtime.lash.example/api/realtime/rooms/${REMOTE_DOCUMENT_ID}/socket?protocolVersion=3&actorId=${ACTOR_ID}&ticket=secret`,
    ],
    [
      'wrong room',
      `wss://realtime.lash.example/api/realtime/rooms/${OTHER_REMOTE_DOCUMENT_ID}/socket?protocolVersion=3&actorId=${ACTOR_ID}`,
    ],
    [
      'wrong actor',
      `wss://realtime.lash.example/api/realtime/rooms/${REMOTE_DOCUMENT_ID}/socket?protocolVersion=3&actorId=other-actor`,
    ],
  ])('rejects an owner-session response with %s before returning a bearer', async (_label, url) => {
    const fetcher = vi.fn(async () =>
      Response.json({
        ok: true,
        version: 1,
        localDocumentId: ROUTE_DOCUMENT_ID,
        remoteDocumentId: REMOTE_DOCUMENT_ID,
        promotionSnapshotSha256: SNAPSHOT_SHA256,
        access: {
          source: 'owner',
          capabilities: ['doc.read', 'doc.edit'],
          protocolVersion: 3,
        },
        socket: {
          url,
          protocol: 'lash-realtime-v3',
          ticketProtocol: `lash-ticket.${'t'.repeat(43)}`,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      }),
    );

    await expect(
      requestBrowserOwnerSession({
        actorId: ACTOR_ID,
        routeDocumentId: ROUTE_DOCUMENT_ID,
        signal: new AbortController().signal,
        fetcher,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid-response', retryable: false });
  });

  it.each([
    ['noncanonical route', 'local/weekly-plan', ACTOR_ID],
    ['noncanonical actor', ROUTE_DOCUMENT_ID, 'Actor Owner'],
  ])(
    'does not send an owner-session request for a %s',
    async (_label, routeDocumentId, actorId) => {
      const fetcher = vi.fn();
      await expect(
        requestBrowserOwnerSession({
          actorId,
          routeDocumentId,
          signal: new AbortController().signal,
          fetcher,
        }),
      ).resolves.toEqual({ ok: false, reason: 'invalid-request', retryable: false });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('settles a stalled owner-session fetch at one bounded retryable deadline', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const pending = requestBrowserOwnerSession({
      actorId: ACTOR_ID,
      routeDocumentId: ROUTE_DOCUMENT_ID,
      signal: new AbortController().signal,
      fetcher,
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(26);
    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'network-error',
      retryable: true,
    });
    vi.useRealTimers();
  });

  it('keeps the committed local projection visible and mutation-frozen until exact owner hydration parity commits', async () => {
    let finishHydration!: () => void;
    const waitForHydration = new Promise<void>((resolve) => {
      finishHydration = resolve;
    });
    const createOwnerResources = createCandidateFactory({ waitForHydration });
    const requestOwnerSession = vi.fn(async () => ({ ok: true as const, session: ownerSession() }));
    const harness = createHarness({ createOwnerResources, requestOwnerSession });
    const controller = createDocumentAccessController(
      { documentId: ROUTE_DOCUMENT_ID },
      harness.dependencies,
    );
    await controller.start();
    const localResolution = controller.getResolution();
    const attempt = promotionAttempt();
    const authorityCommitResolutions: Array<string | null> = [];
    const inconsistentControllerFrames: Array<{
      accessPhase: string;
      authorityPhase: string;
    }> = [];
    const unsubscribeAuthority = controller.getMutationAuthority().subscribe((snapshot) => {
      if (snapshot.phase === 'ready-edit' && snapshot.remoteDocumentId !== null) {
        authorityCommitResolutions.push(controller.getResolution()?.kind ?? null);
      }
    });
    const unsubscribeController = controller.subscribe((snapshot) => {
      if (controller.getResolution()?.kind !== 'remote') return;
      const authorityPhase = controller.getMutationAuthority().getSnapshot().phase;
      if (snapshot.phase !== 'remote-ready' || authorityPhase !== 'ready-edit') {
        inconsistentControllerFrames.push({
          accessPhase: snapshot.phase,
          authorityPhase,
        });
      }
    });

    const cuttingOver = controller.promoteOwnerDocument(attempt);
    await vi.waitFor(() => expect(createOwnerResources).toHaveBeenCalledOnce());

    expect(controller.getSnapshot()).toMatchObject({ phase: 'local-ready' });
    expect(controller.getResolution()).toBe(localResolution);
    expect(controller.getResolution()).toMatchObject({
      kind: 'local',
      routeDocumentId: ROUTE_DOCUMENT_ID,
    });
    expect(controller.getMutationAuthority().getSnapshot()).toMatchObject({
      bodyWrite: false,
      metadataWrite: 'none',
      phase: 'remote-hydrating',
      remoteDocumentId: REMOTE_DOCUMENT_ID,
      routeDocumentId: ROUTE_DOCUMENT_ID,
    });

    finishHydration();
    await expect(cuttingOver).resolves.toMatchObject({
      ok: true,
      remoteDocumentId: REMOTE_DOCUMENT_ID,
      routeDocumentId: ROUTE_DOCUMENT_ID,
    });

    expect(attempt.submit).toHaveBeenCalledOnce();
    expect(requestOwnerSession).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      routeDocumentId: ROUTE_DOCUMENT_ID,
      signal: expect.any(AbortSignal),
    });
    expect(controller.getResolution()).toMatchObject({
      kind: 'remote',
      routeDocumentId: ROUTE_DOCUMENT_ID,
      remoteDocumentId: REMOTE_DOCUMENT_ID,
    });
    expect(controller.getMutationAuthority().getSnapshot()).toMatchObject({
      bodyWrite: true,
      phase: 'ready-edit',
      remoteDocumentId: REMOTE_DOCUMENT_ID,
      routeDocumentId: ROUTE_DOCUMENT_ID,
    });
    expect(controller.getSnapshot()).toMatchObject({
      authoritativeOwner: true,
      canWrite: true,
      hydrated: true,
      phase: 'remote-ready',
    });
    expect(authorityCommitResolutions).toEqual(['remote']);
    expect(inconsistentControllerFrames).toEqual([]);
    unsubscribeAuthority();
    unsubscribeController();
  });

  it.each([
    ['wrong room', ownerSession({ remoteDocumentId: OTHER_REMOTE_DOCUMENT_ID })],
    [
      'wrong capabilities',
      ownerSession({
        capabilities: ['doc.edit', 'doc.read'] as unknown as readonly ['doc.read', 'doc.edit'],
      }),
    ],
    ['wrong snapshot', ownerSession({ promotionSnapshotSha256: 'x'.repeat(43) })],
  ])(
    'denies a %s owner session before candidate creation and restores local authority',
    async (_label, session) => {
      const createOwnerResources = createCandidateFactory();
      const harness = createHarness({
        createOwnerResources,
        requestOwnerSession: vi.fn(async () => ({ ok: true as const, session })),
      });
      const controller = createDocumentAccessController(
        { documentId: ROUTE_DOCUMENT_ID },
        harness.dependencies,
      );
      await controller.start();
      const localResolution = controller.getResolution();

      await expect(controller.promoteOwnerDocument(promotionAttempt())).resolves.toMatchObject({
        ok: false,
        reason: 'owner-session-invalid',
      });

      expect(createOwnerResources).not.toHaveBeenCalled();
      expect(controller.getResolution()).toBe(localResolution);
      expect(controller.getSnapshot()).toMatchObject({ phase: 'local-ready' });
      expect(controller.getMutationAuthority().getSnapshot()).toMatchObject({
        bodyWrite: true,
        phase: 'ready-edit',
        remoteDocumentId: null,
      });
    },
  );

  it('destroys a mismatched candidate, stores no resolution hint, and restores the exact local outcome', async () => {
    const createOwnerResources = createCandidateFactory({
      title: 'Wrong remote title',
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Wrong remote body.' }] }],
      },
    });
    const harness = createHarness({
      createOwnerResources,
      requestOwnerSession: vi.fn(async () => ({ ok: true as const, session: ownerSession() })),
    });
    const controller = createDocumentAccessController(
      { documentId: ROUTE_DOCUMENT_ID },
      harness.dependencies,
    );
    await controller.start();
    const localResolution = controller.getResolution();

    await expect(controller.promoteOwnerDocument(promotionAttempt())).resolves.toEqual({
      ok: false,
      reason: 'integrity-mismatch',
      retryable: true,
    });

    const candidate = createOwnerResources.mock.results[0]?.value;
    expect(candidate.provider.destroy).toHaveBeenCalledOnce();
    expect(controller.getResolution()).toBe(localResolution);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'local-ready' });
    expect(controller.getMutationAuthority().getSnapshot()).toMatchObject({
      bodyWrite: true,
      phase: 'ready-edit',
      remoteDocumentId: null,
    });
  });

  it('restores fresh local body and metadata mutation tickets after real-provider parity failure', async () => {
    let socket: FakeOwnerSocket | null = null;
    const createOwnerResources = vi.fn(
      (
        session: OwnerRealtimeSessionV3,
        options: {
          authority: DocumentMutationAuthority;
          refreshOwnerSession(
            routeDocumentId: string,
            signal: AbortSignal,
          ): Promise<OwnerRealtimeSessionV3>;
        },
      ) => {
        socket = new FakeOwnerSocket();
        return createOwnerCandidateResources(session, {
          ...options,
          createSocket: () => socket as FakeOwnerSocket,
        });
      },
    );
    const harness = createHarness({
      createOwnerResources,
      requestOwnerSession: vi.fn(async () => ({ ok: true as const, session: ownerSession() })),
    });
    const controller = createDocumentAccessController(
      { documentId: ROUTE_DOCUMENT_ID },
      harness.dependencies,
    );
    await controller.start();
    const localResolution = controller.getResolution();

    const promoting = controller.promoteOwnerDocument(promotionAttempt());
    await vi.waitFor(() => expect(createOwnerResources).toHaveBeenCalledOnce());
    const activeSocket = socket as FakeOwnerSocket | null;
    expect(activeSocket).not.toBeNull();
    if (!activeSocket) throw new Error('owner provider socket was not created');
    activeSocket.readyState = 1;
    activeSocket.emit('message', {
      data: JSON.stringify({
        type: 'room-ready',
        roomId: REMOTE_DOCUMENT_ID,
        protocolVersion: 3,
      }),
    });
    activeSocket.emit('message', {
      data: JSON.stringify({
        type: 'yjs-update',
        roomId: REMOTE_DOCUMENT_ID,
        source: 'broadcast',
        update: Buffer.from(
          hydratedUpdate('Wrong remote title', {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Wrong remote body.' }],
              },
            ],
          }),
        ).toString('base64'),
      }),
    });
    activeSocket.emit('message', {
      data: JSON.stringify({
        type: 'room-hydration-complete',
        roomId: REMOTE_DOCUMENT_ID,
        protocolVersion: 3,
        persistedUpdates: 1,
      }),
    });

    await expect(promoting).resolves.toEqual({
      ok: false,
      reason: 'integrity-mismatch',
      retryable: true,
    });
    expect(controller.getResolution()).toBe(localResolution);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'local-ready' });

    const authority = controller.getMutationAuthority();
    expect(authority.getSnapshot()).toMatchObject({
      bodyWrite: true,
      metadataWrite: 'document',
      phase: 'ready-edit',
      remoteDocumentId: null,
    });
    const freshTicket = authority.capture();
    let bodyWrites = 0;
    let metadataWrites = 0;
    expect(
      authority.runBodyMutation(freshTicket, () => {
        bodyWrites += 1;
      }),
    ).toBe(true);
    expect(
      authority.runMetadataMutation(freshTicket, () => {
        metadataWrites += 1;
      }),
    ).toBe(true);
    expect({ bodyWrites, metadataWrites }).toEqual({ bodyWrites: 1, metadataWrites: 1 });
  });

  it('reuses one opaque promotion attempt after response loss without changing its frozen snapshot', async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        reason: 'network-error' as const,
        retryable: true,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        receipt: {
          version: 1 as const,
          title: TITLE,
          body: BODY,
          snapshotSha256: SNAPSHOT_SHA256,
          room: {
            roomId: REMOTE_DOCUMENT_ID,
            aclVersion: 1 as const,
            publicPolicy: 'restricted' as const,
            publicPolicyVersion: 1 as const,
            created: false,
          },
        },
      });
    const attempt = { submit } as BrowserDocumentPromotionAttempt;
    const harness = createHarness({
      requestOwnerSession: vi.fn(async () => ({ ok: true as const, session: ownerSession() })),
    });
    const controller = createDocumentAccessController(
      { documentId: ROUTE_DOCUMENT_ID },
      harness.dependencies,
    );
    await controller.start();

    await expect(controller.promoteOwnerDocument(attempt)).resolves.toMatchObject({
      ok: false,
      reason: 'promotion-failed',
      retryable: true,
    });
    expect(controller.getResolution()).toMatchObject({
      kind: 'local',
      routeDocumentId: ROUTE_DOCUMENT_ID,
    });
    expect(controller.getMutationAuthority().getSnapshot()).toMatchObject({
      bodyWrite: true,
      remoteDocumentId: null,
    });

    await expect(controller.promoteOwnerDocument(attempt)).resolves.toMatchObject({
      ok: true,
      remoteDocumentId: REMOTE_DOCUMENT_ID,
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({ fetcher: harness.dependencies.fetcher });
    expect(submit.mock.calls[1]?.[0]).toMatchObject({ fetcher: harness.dependencies.fetcher });
  });

  it('joins the active owner cutover when the user retries while it is still settling', async () => {
    let finishPromotion!: (
      result: Awaited<ReturnType<BrowserDocumentPromotionAttempt['submit']>>,
    ) => void;
    const submit = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<BrowserDocumentPromotionAttempt['submit']>>>((resolve) => {
          finishPromotion = resolve;
        }),
    );
    const attempt = { submit } as BrowserDocumentPromotionAttempt;
    const harness = createHarness({
      requestOwnerSession: vi.fn(async () => ({ ok: true as const, session: ownerSession() })),
    });
    const controller = createDocumentAccessController(
      { documentId: ROUTE_DOCUMENT_ID },
      harness.dependencies,
    );
    await controller.start();

    const firstSave = controller.promoteOwnerDocument(attempt);
    const retry = controller.promoteOwnerDocument(attempt);

    expect(retry).toBe(firstSave);
    expect(submit).toHaveBeenCalledOnce();

    finishPromotion({
      ok: true,
      receipt: {
        version: 1,
        title: TITLE,
        body: BODY,
        snapshotSha256: SNAPSHOT_SHA256,
        room: {
          roomId: REMOTE_DOCUMENT_ID,
          aclVersion: 1,
          publicPolicy: 'restricted',
          publicPolicyVersion: 1,
          created: true,
        },
      },
    });

    await expect(firstSave).resolves.toMatchObject({
      ok: true,
      remoteDocumentId: REMOTE_DOCUMENT_ID,
    });
    await expect(retry).resolves.toMatchObject({
      ok: true,
      remoteDocumentId: REMOTE_DOCUMENT_ID,
    });
  });

  it('waits for account discovery and then saves when the user promotes during that probe', async () => {
    let finishOwnerProbe!: (result: {
      ok: false;
      reason: 'document-unavailable';
      retryable: false;
    }) => void;
    const requestOwnerSession = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{
            ok: false;
            reason: 'document-unavailable';
            retryable: false;
          }>((resolve) => {
            finishOwnerProbe = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true as const, session: ownerSession() });
    const harness = createHarness({ requestOwnerSession }, configuredRuntime);
    const controller = createDocumentAccessController(
      { documentId: ROUTE_DOCUMENT_ID },
      harness.dependencies,
    );
    const starting = controller.start();
    await vi.waitFor(() => expect(requestOwnerSession).toHaveBeenCalledOnce());
    const attempt = promotionAttempt();

    const saving = controller.promoteOwnerDocument(attempt);
    finishOwnerProbe({
      ok: false,
      reason: 'document-unavailable',
      retryable: false,
    });

    await starting;
    await expect(saving).resolves.toMatchObject({
      ok: true,
      remoteDocumentId: REMOTE_DOCUMENT_ID,
    });
    expect(attempt.submit).toHaveBeenCalledOnce();
    expect(requestOwnerSession).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['unauthenticated', false],
    ['document-unavailable', false],
    ['temporarily-unavailable', true],
  ] as const)(
    'keeps a configured owner reopen local when owner session is %s',
    async (reason, retryable) => {
      const requestOwnerSession = vi.fn(async () => ({ ok: false as const, reason, retryable }));
      const harness = createHarness({ requestOwnerSession }, configuredRuntime);
      const controller = createDocumentAccessController(
        { documentId: ROUTE_DOCUMENT_ID },
        harness.dependencies,
      );

      await controller.start();

      expect(requestOwnerSession).toHaveBeenCalledWith({
        actorId: ACTOR_ID,
        routeDocumentId: ROUTE_DOCUMENT_ID,
        signal: expect.any(AbortSignal),
      });
      expect(harness.createOwnerResources).not.toHaveBeenCalled();
      expect(controller.getResolution()).toMatchObject({
        kind: 'local',
        routeDocumentId: ROUTE_DOCUMENT_ID,
      });
      expect(controller.getSnapshot()).toMatchObject({
        phase: 'local-ready',
        retryable,
      });
      expect(controller.getMutationAuthority().getSnapshot()).toMatchObject({
        bodyWrite: true,
        phase: 'ready-edit',
      });
    },
  );

  it('mounts local content only after a non-owner account probe restores local authority', async () => {
    let finishOwnerProbe:
      | ((result: {
          ok: false;
          reason: 'document-unavailable';
          retryable: false;
        }) => void)
      | null = null;
    const requestOwnerSession = vi.fn(
      () =>
        new Promise<{
          ok: false;
          reason: 'document-unavailable';
          retryable: false;
        }>((resolve) => {
          finishOwnerProbe = resolve;
        }),
    );
    const harness = createHarness({ requestOwnerSession }, configuredRuntime);
    const controller = createDocumentAccessController(
      { documentId: ROUTE_DOCUMENT_ID },
      harness.dependencies,
    );
    const frames: Array<{ bodyWrite: boolean; phase: string }> = [];
    controller.subscribe((snapshot) => {
      frames.push({
        bodyWrite: controller.getMutationAuthority().getSnapshot().bodyWrite,
        phase: snapshot.phase,
      });
    });

    const starting = controller.start();
    await vi.waitFor(() => expect(requestOwnerSession).toHaveBeenCalledOnce());
    const framesBeforeProbeSettled = frames.length;
    expect(
      frames.slice(0, framesBeforeProbeSettled).some((frame) => frame.phase === 'local-ready'),
    ).toBe(false);
    finishOwnerProbe?.({
      ok: false,
      reason: 'document-unavailable',
      retryable: false,
    });
    await starting;

    expect(frames.length).toBeGreaterThan(framesBeforeProbeSettled);
    expect(frames.at(-1)).toEqual({ bodyWrite: true, phase: 'local-ready' });
  });

  it('retries a transient background owner reopen without unmounting the local resolution', async () => {
    const requestOwnerSession = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        reason: 'temporarily-unavailable' as const,
        retryable: true,
      })
      .mockResolvedValueOnce({ ok: true as const, session: ownerSession() });
    const harness = createHarness({ requestOwnerSession }, configuredRuntime);
    const controller = createDocumentAccessController(
      { documentId: ROUTE_DOCUMENT_ID },
      harness.dependencies,
    );

    await controller.start();
    const localResolution = controller.getResolution();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'local-ready',
      retryable: true,
    });

    const retrying = controller.retry();
    expect(controller.getResolution()).toBe(localResolution);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'local-ready' });
    await retrying;

    expect(requestOwnerSession).toHaveBeenCalledTimes(2);
    expect(controller.getResolution()).toMatchObject({
      kind: 'remote',
      remoteDocumentId: REMOTE_DOCUMENT_ID,
      routeDocumentId: ROUTE_DOCUMENT_ID,
    });
  });

  it('hydrates current remote state on later owner reopen without comparing the historical promotion body', async () => {
    const currentTitle = 'Weekly launch plan — edited remotely';
    const currentBody = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'This is the current Durable Object state.' }],
        },
      ],
    };
    const createOwnerResources = createCandidateFactory({
      title: currentTitle,
      body: currentBody,
    });
    const harness = createHarness(
      {
        createOwnerResources,
        requestOwnerSession: vi.fn(async () => ({ ok: true as const, session: ownerSession() })),
      },
      configuredRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: ROUTE_DOCUMENT_ID },
      harness.dependencies,
    );

    await controller.start();

    expect(controller.getResolution()).toMatchObject({
      kind: 'remote',
      routeDocumentId: ROUTE_DOCUMENT_ID,
      remoteDocumentId: REMOTE_DOCUMENT_ID,
    });
    const candidate = createOwnerResources.mock.results[0]?.value;
    expect(readRealtimeDocumentTitle(candidate.doc)).toBe(currentTitle);
  });
});
