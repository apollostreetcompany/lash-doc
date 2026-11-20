import { describe, expect, it, vi } from 'vitest';

import {
  createBrowserDocumentAccessController,
  createDocumentAccessController,
  type DocumentAccessDependencies,
} from '../../../../apps/web/lib/documentAccess';
import {
  readInviteFragmentCredential,
  scrubInviteFragment,
} from '../../../../apps/web/lib/inviteAccess';
import {
  createRealtimeDocument,
  exchangeRealtimeSession,
  RealtimeProviderStartError,
  type AuthorizedRealtimeSession,
  type LashRealtimeYjsProvider,
  type RealtimeRuntimeSelection,
  type RealtimeSessionExchangeResult,
  type RealtimeSnapshot,
} from '../../../../apps/web/lib/realtimeCollaboration';
import { createRealtimeRecoveryJournal } from '../../../../apps/web/lib/realtimeRecoveryJournal';
import { RECENT_SHARED_BOOKMARKS_KEY } from '../../../../apps/web/lib/recentSharedDocuments';

const disabledRuntime: RealtimeRuntimeSelection = {
  invitationMode: 'unavailable',
  mode: 'disabled',
  socketBaseUrl: null,
};

const configuredRuntime: RealtimeRuntimeSelection = {
  invitationMode: 'unavailable',
  mode: 'configured',
  socketBaseUrl: 'wss://realtime.lash.example',
};

const loopbackRuntime: RealtimeRuntimeSelection = {
  invitationMode: 'development-loopback',
  mode: 'development-loopback',
  socketBaseUrl: 'ws://127.0.0.1:8788/',
};

const session: AuthorizedRealtimeSession = {
  accessToken: 'short-lived-session',
  actorId: 'actor-owner',
  capabilities: ['doc.read', 'doc.edit'],
  documentId: 'fixture-document',
  inviteRequired: false,
  protocolVersion: 2,
  scope: 'edit',
  socketBaseUrl: 'ws://127.0.0.1:8788/',
};

const success: RealtimeSessionExchangeResult = { ok: true, session };

const sessionWith = (overrides: Partial<AuthorizedRealtimeSession>): AuthorizedRealtimeSession => ({
  ...session,
  ...overrides,
});

const createRecoveryStorage = () => {
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

const createHarness = (
  overrides: Partial<DocumentAccessDependencies> = {},
  runtime: RealtimeRuntimeSelection = disabledRuntime,
) => {
  const provider = {
    destroy: vi.fn(),
    disconnectForTest: vi.fn(),
    getSnapshot: vi.fn(() => ({
      actorId: 'actor-owner',
      connectionState: 'connected' as const,
      enabled: true,
      hydrated: true,
      peers: [],
      pendingUpdateCount: 0,
      queuedUpdateCount: 0,
      syncState: 'saved' as const,
    })),
    reconnectForTest: vi.fn(),
    reconnectNow: vi.fn(),
    setLocalSelection: vi.fn(),
    start: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
  } as unknown as LashRealtimeYjsProvider;
  const doc = createRealtimeDocument();
  const calls = {
    clear: vi.fn(),
    delay: vi.fn(async () => undefined),
    exchange: vi.fn(async () => success),
    legacy: vi.fn(),
    navigate: vi.fn(),
    resources: vi.fn(() => ({ doc, provider })),
    scrub: vi.fn(() => true),
    actor: vi.fn(() => 'actor-owner'),
    validate: vi.fn(async () => ({ ok: true as const, scope: 'edit' as const, token: 'invite' })),
  };
  const dependencies: DocumentAccessDependencies = {
    clearLegacyCredential: calls.legacy,
    clearRoomCredentials: calls.clear,
    createOwnerResources: vi.fn(),
    createResources: calls.resources,
    delay: calls.delay,
    exchangeSession: calls.exchange,
    fetcher: vi.fn(),
    getActorId: calls.actor,
    installRecoveryNavigationWarning: vi.fn(() => vi.fn()),
    navigateHome: calls.navigate,
    readFragmentCredential: () => ({ state: 'absent' }),
    readRuntime: () => runtime,
    recoveryJournal: createRealtimeRecoveryJournal(createRecoveryStorage()),
    readStoredCredential: () => null,
    requestOwnerSession: vi.fn(async () => ({
      ok: false as const,
      reason: 'unauthenticated' as const,
      retryable: false,
    })),
    scrubInviteFragment: calls.scrub,
    validateDevelopmentInvite: calls.validate,
    writeValidatedCredential: vi.fn(),
    ...overrides,
  };
  calls.exchange = dependencies.exchangeSession as typeof calls.exchange;
  calls.resources = dependencies.createResources as typeof calls.resources;
  return { calls, dependencies, doc, provider };
};

describe('browser document access controller', () => {
  it('removes the named Comment projection on disconnect and hydrates fresh read authority on retry', async () => {
    const roomId = `doc-v1-${'a'.repeat(64)}`;
    const actorId = `named-${'b'.repeat(32)}`;
    const commentSession = {
      actorId,
      capabilities: ['doc.read', 'doc.comment', 'doc.suggest'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      protocolVersion: 6,
      roomId,
      role: 'comment',
      socketProtocol: 'lash-realtime-v6',
      socketUrl: `wss://realtime.example.test/api/realtime/rooms/${roomId}/socket?protocolVersion=6&actorId=${actorId}`,
      source: 'named',
      ticketProtocol: `lash-named-comment-ticket.${'c'.repeat(43)}`,
    } as const;
    const initialBookmark = 'a'.repeat(100);
    const renewedBookmark = 'b'.repeat(100);
    const requestNamedSession = vi
      .fn(async () => ({ ok: true as const, session: commentSession, recentBookmark: renewedBookmark }))
      .mockResolvedValueOnce({ ok: true, session: commentSession, recentBookmark: initialBookmark });
    const harness = createHarness({ requestNamedSession }, configuredRuntime);
    const storage = createRecoveryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    let endHydration!: () => void;
    vi.mocked(harness.provider.start).mockImplementationOnce(() => new Promise<void>((resolve) => {
      endHydration = resolve;
    }));
    const providerSnapshot: RealtimeSnapshot = {
      ...harness.provider.getSnapshot(), actorId, canWrite: false,
    };
    const renewed = createHarness({}, configuredRuntime);
    vi.mocked(renewed.provider.getSnapshot).mockReturnValue(providerSnapshot);
    vi.mocked(harness.provider.getSnapshot).mockReturnValue(providerSnapshot);
    const observers = vi.mocked(harness.provider.subscribe);
    harness.calls.resources.mockReturnValueOnce({ doc: harness.doc, provider: harness.provider })
      .mockReturnValueOnce({ doc: renewed.doc, provider: renewed.provider });
    const controller = createDocumentAccessController({ documentId: roomId }, harness.dependencies);
    try {
      const opening = controller.start();
      await vi.waitFor(() => expect(harness.provider.start).toHaveBeenCalledOnce());
      expect(storage.getItem(RECENT_SHARED_BOOKMARKS_KEY)).toBeNull();
      endHydration();
      await opening;
      expect(controller.getSnapshot()).toMatchObject({
        phase: 'remote-ready', scope: 'comment', authorized: true, hydrated: true,
        canWrite: false, canIssueInvites: false, authoritativeOwner: false,
      });
      expect(controller.getMutationAuthority().getSnapshot()).toMatchObject({
        phase: 'ready-read', bodyWrite: false, metadataWrite: 'none',
      });
      expect(controller.getResolution()).toMatchObject({ kind: 'remote', doc: harness.doc });
      const recorded = storage.getItem(RECENT_SHARED_BOOKMARKS_KEY);
      expect(JSON.parse(recorded!)).toEqual({
        version: 1,
        bookmarks: [{ actorId, bookmark: initialBookmark }],
      });
      const [, resourceOptions] = vi.mocked(harness.dependencies.createResources).mock.calls[0];
      await resourceOptions?.refreshOwnerSession?.(roomId, new AbortController().signal);
      expect(requestNamedSession).toHaveBeenCalledTimes(2);
      expect(storage.getItem(RECENT_SHARED_BOOKMARKS_KEY)).toBe(recorded);

      observers.mock.calls[0]?.[0]({
        ...providerSnapshot, connectionState: 'reconnecting', syncState: 'reconnecting',
      });
      expect(controller.getSnapshot()).toMatchObject({
        phase: 'unavailable', reason: 'comment-connection-lost', hydrated: false, retryable: true,
      });
      expect(controller.getResolution()).toBeNull();
      expect(controller.getMutationAuthority().getSnapshot().phase).toBe('revoked');
      expect(harness.provider.destroy).toHaveBeenCalledOnce();

      await controller.retry();
      expect(requestNamedSession).toHaveBeenCalledTimes(3);
      expect(controller.getResolution()).toMatchObject({ kind: 'remote', doc: renewed.doc });
      expect(controller.getMutationAuthority().getSnapshot()).toMatchObject({
        phase: 'ready-read', bodyWrite: false, metadataWrite: 'none',
      });
      expect(controller.captureInviteIssuance()).toBeNull();
    } finally {
      controller.destroy();
      vi.unstubAllGlobals();
    }
  });

  it('permits local writing without a recovery journal when realtime is disabled and no invitation exists', async () => {
    const runtime = vi.fn().mockReturnValueOnce(disabledRuntime).mockReturnValue(configuredRuntime);
    const harness = createHarness({ recoveryJournal: null, readRuntime: runtime });
    const controller = createDocumentAccessController({ documentId: 'local-document' }, harness.dependencies);

    await controller.start();

    expect(controller.getResolution()).toMatchObject({ kind: 'local', runtime: disabledRuntime });
    expect(controller.getMutationAuthority().getSnapshot().bodyWrite).toBe(true);
    expect(runtime).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.requestOwnerSession).not.toHaveBeenCalled();
    expect(harness.calls.exchange).not.toHaveBeenCalled();
    expect(harness.calls.resources).not.toHaveBeenCalled();
  });

  it.each([
    { scenario: 'configured owner route', runtime: configuredRuntime, access: {} },
    { scenario: 'development loopback route', runtime: loopbackRuntime, access: {} },
    {
      scenario: 'incoming invite',
      runtime: disabledRuntime,
      access: { readFragmentCredential: () => ({ state: 'valid', token: 'pending-invite' }) as const },
    },
    {
      scenario: 'stored invite',
      runtime: disabledRuntime,
      access: { readStoredCredential: () => ({
        version: 1,
        documentId: 'local-document',
        token: 'stored-invite',
        authority: 'configured',
        validatedAt: '2026-11-18T00:00:00.000Z',
      }) as const },
    },
  ])('keeps a $scenario closed when recovery storage cannot be acquired', async ({ runtime, access }) => {
    const harness = createHarness({ ...access, recoveryJournal: null }, runtime);
    const controller = createDocumentAccessController({ documentId: 'local-document' }, harness.dependencies);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({ phase: 'unavailable', reason: 'recovery-storage-unavailable' });
    expect(controller.getResolution()).toBeNull();
    expect(controller.getMutationAuthority().getSnapshot().bodyWrite).toBe(false);
    expect(harness.dependencies.requestOwnerSession).not.toHaveBeenCalled();
    expect(harness.calls.exchange).not.toHaveBeenCalled();
    expect(harness.calls.resources).not.toHaveBeenCalled();
  });

  it.each([
    [
      'length',
      () => ({
        get length() {
          throw new DOMException('Storage length denied.', 'SecurityError');
        },
        getItem: () => null,
        key: () => null,
        removeItem: () => undefined,
        setItem: () => undefined,
      }),
    ],
    [
      'key',
      () => ({
        get length() {
          return 1;
        },
        getItem: () => null,
        key: () => {
          throw new DOMException('Storage key denied.', 'SecurityError');
        },
        removeItem: () => undefined,
        setItem: () => undefined,
      }),
    ],
    [
      'getItem',
      () => ({
        get length() {
          return 1;
        },
        getItem: () => {
          throw new DOMException('Storage read denied.', 'SecurityError');
        },
        key: () => 'lash:realtime-recovery:v2:fixture-document:actor:1:digest:receipt',
        removeItem: () => undefined,
        setItem: () => undefined,
      }),
    ],
  ])(
    'fails closed before authorization when recovery %s enumeration is unavailable',
    async (_label, createStorage) => {
      const order: string[] = [];
      const harness = createHarness(
        {
          readFragmentCredential: () => ({ state: 'valid', token: 'fresh-secret' }),
          recoveryJournal: createRealtimeRecoveryJournal(createStorage()),
          scrubInviteFragment: () => {
            order.push('scrub');
            return true;
          },
        },
        loopbackRuntime,
      );
      const controller = createDocumentAccessController(
        { documentId: 'fixture-document' },
        harness.dependencies,
      );

      await expect(controller.start()).resolves.toBeUndefined();

      expect(order).toEqual(['scrub']);
      expect(controller.getSnapshot()).toMatchObject({
        phase: 'unavailable',
        reason: 'recovery-storage-unavailable',
      });
      expect(harness.calls.exchange).not.toHaveBeenCalled();
      expect(harness.calls.resources).not.toHaveBeenCalled();
      expect(harness.dependencies.writeValidatedCredential).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'replaceState throws',
      () => {
        throw new DOMException('History denied.', 'SecurityError');
      },
    ],
    ['invite remains after replaceState', () => false],
  ])('fails closed before token use when fragment scrub %s', async (_label, scrub) => {
    const harness = createHarness(
      {
        readFragmentCredential: () => ({ state: 'valid', token: 'fresh-secret' }),
        scrubInviteFragment: scrub,
      },
      loopbackRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );

    await expect(controller.start()).resolves.toBeUndefined();

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'unavailable',
      reason: 'fragment-scrub-failed',
    });
    expect(harness.calls.exchange).not.toHaveBeenCalled();
    expect(harness.calls.resources).not.toHaveBeenCalled();
    expect(harness.dependencies.writeValidatedCredential).not.toHaveBeenCalled();
  });

  it.each([
    ['valid', () => ({ state: 'valid' as const, token: 'fresh-secret' })],
    ['invalid', () => ({ state: 'invalid' as const })],
    [
      'unreadable',
      () => {
        throw new DOMException('Fragment unavailable.', 'SecurityError');
      },
    ],
  ])('scrubs a %s invite fragment before publishing an existing recovery', async (_label, read) => {
    const order: string[] = [];
    const storage = createRecoveryStorage();
    const recoveryJournal = createRealtimeRecoveryJournal(
      storage,
      () => '2026-07-18T06:00:00.000Z',
    );
    expect(
      recoveryJournal.persistAndVerify({
        baselineStateVector: new Uint8Array([9]),
        documentId: 'fixture-document',
        epoch: 3,
        principalId: 'actor-owner',
        reason: 'scope-mismatch',
        scope: 'edit',
        unsyncedMetadata: null,
        unsyncedTitle: null,
        updates: [{ bytes: new Uint8Array([7, 8, 9]), updateId: 'existing-recovery' }],
      }).ok,
    ).toBe(true);
    const listForDocument = vi
      .spyOn(recoveryJournal, 'listForDocument')
      .mockImplementation((id) => {
        order.push('recovery');
        return createRealtimeRecoveryJournal(storage).listForDocument(id);
      });
    const harness = createHarness(
      {
        readFragmentCredential: read,
        recoveryJournal,
        scrubInviteFragment: vi.fn(() => {
          order.push('scrub');
          return true;
        }),
      },
      loopbackRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );

    await controller.start();

    expect(listForDocument).toHaveBeenCalled();
    expect(order[0]).toBe('scrub');
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'recovery-available',
      recoveryUpdateCount: 1,
    });
    expect(harness.calls.exchange).not.toHaveBeenCalled();
    expect(harness.dependencies.writeValidatedCredential).not.toHaveBeenCalled();
  });

  it('seals and retains dirty ordinary teardown when lifecycle recovery cannot be verified', async () => {
    const doc = createRealtimeDocument();
    const destroyDocument = vi.spyOn(doc, 'destroy');
    const seal = {
      id: 'ordinary-lifecycle-seal',
      snapshot: {
        authorityEpoch: 0,
        baselineStateVector: new Uint8Array([3, 2, 1]),
        documentId: 'fixture-document',
        principalId: 'actor-owner',
        reason: 'lifecycle' as const,
        sealedAt: '2026-07-18T07:00:00.000Z',
        scope: 'edit' as const,
        updates: [
          { bytes: new Uint8Array([1, 2, 3]), updateId: 'sent-unacked' },
          { bytes: new Uint8Array([4, 5, 6]), updateId: 'queued' },
        ],
      },
    };
    const provider = {
      commitDestroy: vi.fn(() => false),
      destroy: vi.fn(),
      getSnapshot: vi.fn(() => ({
        actorId: 'actor-owner',
        canWrite: true,
        connectionState: 'connected' as const,
        enabled: true,
        hydrated: true,
        peers: [],
        pendingUpdateCount: 1,
        queuedUpdateCount: 1,
        syncState: 'syncing' as const,
      })),
      reconnectForTest: vi.fn(),
      sealForRecovery: vi.fn(() => seal),
      setLocalSelection: vi.fn(),
      start: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined),
    } as unknown as LashRealtimeYjsProvider;
    const installWarning = vi.fn(() => vi.fn());
    const recoveryJournal = {
      discard: vi.fn(() => false),
      listForDocument: vi.fn(() => ({ ok: true as const, records: [] })),
      persistAndVerify: vi.fn(() => ({ ok: false as const, reason: 'write-failed' as const })),
      read: vi.fn(() => null),
    };
    const harness = createHarness(
      {
        createResources: vi.fn(() => ({ doc, provider })),
        installRecoveryNavigationWarning: installWarning,
        recoveryJournal,
      },
      loopbackRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );
    await controller.start();

    const destroyResult = controller.destroy();

    expect(destroyResult).toEqual({
      ok: false,
      disposition: 'recovery-blocked',
      updateCount: 2,
    });
    expect(provider.sealForRecovery).toHaveBeenCalledWith('lifecycle');
    expect(provider.commitDestroy).not.toHaveBeenCalled();
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(destroyDocument).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'recovery-blocked',
      recoveryUpdateCount: 2,
    });
    expect(installWarning).toHaveBeenCalledOnce();

    expect(controller.clearCredentialAndNavigate()).toEqual({
      ok: false,
      disposition: 'recovery-blocked',
      updateCount: 2,
    });
    expect(harness.calls.clear).not.toHaveBeenCalled();
    expect(harness.calls.navigate).not.toHaveBeenCalled();
  });

  it('retains two blocked same-document controllers without replacing the older seal', async () => {
    const documentId = 'same-document-retention-collision';
    const createBlockedController = async (sealId: string) => {
      const doc = createRealtimeDocument();
      const seal = {
        id: sealId,
        snapshot: {
          authorityEpoch: 0,
          baselineStateVector: new Uint8Array([1]),
          documentId,
          principalId: 'actor-owner',
          reason: 'lifecycle' as const,
          sealedAt: '2026-07-18T07:30:00.000Z',
          scope: 'edit' as const,
          updates: [{ bytes: new Uint8Array([1, 2, 3]), updateId: `${sealId}-update` }],
        },
      };
      const provider = {
        commitDestroy: vi.fn(() => false),
        destroy: vi.fn(),
        discardSealedRecovery: vi.fn(() => true),
        getSnapshot: vi.fn(() => ({
          actorId: 'actor-owner',
          canWrite: true,
          connectionState: 'connected' as const,
          enabled: true,
          hydrated: true,
          peers: [],
          pendingUpdateCount: 1,
          queuedUpdateCount: 0,
          syncState: 'syncing' as const,
        })),
        reconnectForTest: vi.fn(),
        sealForRecovery: vi.fn(() => seal),
        setLocalSelection: vi.fn(),
        start: vi.fn(async () => undefined),
        subscribe: vi.fn(() => () => undefined),
      } as unknown as LashRealtimeYjsProvider;
      const harness = createHarness(
        {
          createResources: vi.fn(() => ({ doc, provider })),
          exchangeSession: vi.fn(async () => ({
            ok: true as const,
            session: { ...session, documentId },
          })),
          recoveryJournal: {
            discard: vi.fn(() => false),
            listForDocument: vi.fn(() => ({ ok: true as const, records: [] })),
            persistAndVerify: vi.fn(() => ({
              ok: false as const,
              reason: 'write-failed' as const,
            })),
            read: vi.fn(() => null),
          },
        },
        loopbackRuntime,
      );
      const controller = createDocumentAccessController({ documentId }, harness.dependencies);
      await controller.start();
      expect(controller.destroy()).toMatchObject({
        ok: false,
        disposition: 'recovery-blocked',
      });
      return controller;
    };

    const first = await createBlockedController('first-seal');
    const second = await createBlockedController('second-seal');

    expect(
      createBrowserDocumentAccessController({
        documentId,
        navigateHome: () => undefined,
      }),
    ).toBe(first);
    expect(first.discardBlockedRealtimeRecovery('discard-first')).toBe(true);
    expect(
      createBrowserDocumentAccessController({
        documentId,
        navigateHome: () => undefined,
      }),
    ).toBe(second);
    expect(second.discardBlockedRealtimeRecovery('discard-second')).toBe(true);
  });

  it('revokes a captured invite-issuance epoch before lifecycle teardown completes', async () => {
    const harness = createHarness({}, loopbackRuntime);
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    ) as ReturnType<typeof createDocumentAccessController> & {
      allowsInviteIssuance(ticket: unknown): boolean;
      captureInviteIssuance(): unknown | null;
    };
    await controller.start();

    const ticket = controller.captureInviteIssuance();

    expect(ticket).toMatchObject({
      authoritativeOwner: true,
      documentId: 'fixture-document',
      remoteDocumentId: 'fixture-document',
      routeDocumentId: 'fixture-document',
      scope: 'edit',
    });
    expect(controller.allowsInviteIssuance(ticket)).toBe(true);

    controller.destroy();

    expect(controller.allowsInviteIssuance(ticket)).toBe(false);
  });

  it.each([
    ['canonical null scope', null],
    ['existing edit scope', 'edit' as const],
  ])(
    'derives one current edit issuance ticket for a token-free loopback owner with %s',
    async (_label, scope) => {
      const fetcher = vi.fn(async () =>
        Response.json({
          ok: true,
          accessToken: 'short-lived-session',
          inviteRequired: false,
          protocolVersion: 2,
          grant: {
            actorId: 'actor-owner',
            capabilities: ['doc.read', 'doc.edit'],
            documentId: 'fixture-document',
            protocolVersion: 2,
            scope,
          },
        }),
      );
      const harness = createHarness(
        {
          exchangeSession: (input) => exchangeRealtimeSession({ ...input, fetcher }),
        },
        loopbackRuntime,
      );
      const controller = createDocumentAccessController(
        { documentId: 'fixture-document' },
        harness.dependencies,
      );

      await controller.start();

      expect(controller.getSnapshot()).toMatchObject({
        authoritativeOwner: true,
        canIssueInvites: true,
        phase: 'remote-ready',
        scope,
      });
      const ticket = controller.captureInviteIssuance();
      expect(ticket).toMatchObject({
        authoritativeOwner: true,
        documentId: 'fixture-document',
        remoteDocumentId: 'fixture-document',
        routeDocumentId: 'fixture-document',
        scope: 'edit',
      });
      expect(controller.allowsInviteIssuance(ticket)).toBe(true);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(harness.calls.resources).toHaveBeenCalledWith(expect.objectContaining({ scope }), {
        authority: controller.getMutationAuthority(),
      });
    },
  );

  it.each([
    [
      'an incoming invite credential',
      loopbackRuntime,
      sessionWith({ scope: 'edit' }),
      { state: 'valid' as const, token: 'invited-token' },
    ],
    [
      'an invite-required session',
      loopbackRuntime,
      sessionWith({ inviteRequired: true, scope: 'edit' }),
      { state: 'absent' as const },
    ],
    [
      'configured transport',
      configuredRuntime,
      sessionWith({ socketBaseUrl: 'wss://realtime.lash.example', scope: 'edit' }),
      { state: 'valid' as const, token: 'configured-token' },
    ],
    ['view scope', loopbackRuntime, sessionWith({ scope: 'view' }), { state: 'absent' as const }],
    [
      'comment scope',
      loopbackRuntime,
      sessionWith({ scope: 'comment' }),
      { state: 'absent' as const },
    ],
    [
      'suggest scope',
      loopbackRuntime,
      sessionWith({ scope: 'suggest' }),
      { state: 'absent' as const },
    ],
    [
      'missing edit capability',
      loopbackRuntime,
      sessionWith({ capabilities: ['doc.read'], scope: 'edit' }),
      { state: 'absent' as const },
    ],
    [
      'missing read capability',
      loopbackRuntime,
      sessionWith({ capabilities: ['doc.edit'], scope: 'edit' }),
      { state: 'absent' as const },
    ],
  ])('keeps invite issuance disabled for %s', async (_label, runtime, nextSession, fragment) => {
    const harness = createHarness(
      {
        exchangeSession: vi.fn(async () => ({ ok: true as const, session: nextSession })),
        readFragmentCredential: () => fragment,
      },
      runtime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({ canIssueInvites: false });
    expect(controller.captureInviteIssuance()).toBeNull();
  });

  it('keeps invite issuance disabled when session exchange reports revocation', async () => {
    const harness = createHarness(
      {
        exchangeSession: vi.fn(async () => ({
          ok: false as const,
          error: 'revoked' as const,
          retryable: false,
          status: 403,
        })),
      },
      loopbackRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({
      canIssueInvites: false,
      phase: 'denied',
      reason: 'revoked',
    });
    expect(controller.captureInviteIssuance()).toBeNull();
  });

  it('revokes invite ticket state and visible eligibility from the same authority transition', async () => {
    const harness = createHarness({}, loopbackRuntime);
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );
    await controller.start();
    const ticket = controller.captureInviteIssuance();
    expect(controller.getSnapshot().canIssueInvites).toBe(true);

    controller.getMutationAuthority().revoke();

    expect(controller.getSnapshot()).toMatchObject({
      authoritativeOwner: false,
      canIssueInvites: false,
    });
    expect(controller.captureInviteIssuance()).toBeNull();
    expect(controller.allowsInviteIssuance(ticket)).toBe(false);
  });

  it.each([
    ['empty', '#invite=&view=outline'],
    ['oversized', `#view=outline&invite=${'x'.repeat(16_385)}`],
    ['duplicate', '#invite=first&view=outline&invite=second'],
  ])(
    'denies and scrubs a present-but-%s invite fragment without opening local content',
    async (_label, hash) => {
      const location = {
        hash,
        pathname: '/doc/fixture-document',
        search: '?mode=test',
      };
      const replaceState = vi.fn();
      const harness = createHarness(
        {
          readFragmentCredential: () => readInviteFragmentCredential(location),
          scrubInviteFragment: () => {
            scrubInviteFragment(location, { replaceState });
            location.hash = '#view=outline';
            return true;
          },
        },
        disabledRuntime,
      );
      const controller = createDocumentAccessController(
        { documentId: 'fixture-document' },
        harness.dependencies,
      );

      await controller.start();

      expect(controller.getSnapshot()).toMatchObject({
        hasIncomingInvite: true,
        phase: 'denied',
        reason: 'invalid',
      });
      expect(controller.getResolution()).toBeNull();
      expect(harness.calls.actor).not.toHaveBeenCalled();
      expect(harness.calls.exchange).not.toHaveBeenCalled();
      expect(harness.calls.resources).not.toHaveBeenCalled();
      expect(harness.calls.clear).toHaveBeenCalledWith('fixture-document');
      expect(replaceState).toHaveBeenCalledWith(
        null,
        '',
        '/doc/fixture-document?mode=test#view=outline',
      );
    },
  );

  it.each([
    ['disabled', disabledRuntime],
    ['configured transport without an invite', configuredRuntime],
  ])(
    'opens a %s owner document locally before any authorized remote resource exists',
    async (_label, runtime) => {
      const harness = createHarness({}, runtime);
      const controller = createDocumentAccessController(
        { documentId: 'fixture-document' },
        harness.dependencies,
      );

      await controller.start();

      expect(controller.getSnapshot()).toMatchObject({
        phase: 'local-ready',
        transportConfigured: runtime.mode === 'configured',
      });
      expect(controller.getResolution()).toMatchObject({
        documentId: 'fixture-document',
        kind: 'local',
        routeDocumentId: 'fixture-document',
      });
      expect(harness.calls.actor).toHaveBeenCalledTimes(runtime.mode === 'configured' ? 1 : 0);
      expect(harness.calls.exchange).not.toHaveBeenCalled();
      expect(harness.calls.resources).not.toHaveBeenCalled();
      expect(harness.dependencies.createOwnerResources).not.toHaveBeenCalled();
      expect(harness.dependencies.requestOwnerSession).toHaveBeenCalledTimes(
        runtime.mode === 'configured' ? 1 : 0,
      );
    },
  );

  it.each([
    ['invalid', 'invalid'],
    ['expired', 'expired'],
    ['revoked', 'revoked'],
    ['wrong document', 'document-mismatch'],
  ] as const)(
    'rejects a locally %s loopback invite before actor, Worker, or resource creation',
    async (_label, reason) => {
      const harness = createHarness(
        {
          readFragmentCredential: () => ({ state: 'valid', token: 'opaque-invite' }),
          validateDevelopmentInvite: vi.fn(async () => ({ ok: false as const, reason })),
        },
        loopbackRuntime,
      );
      const controller = createDocumentAccessController(
        { documentId: 'fixture-document' },
        harness.dependencies,
      );

      await controller.start();

      expect(controller.getSnapshot()).toMatchObject({ phase: 'denied', reason });
      expect(harness.calls.actor).not.toHaveBeenCalled();
      expect(harness.calls.exchange).not.toHaveBeenCalled();
      expect(harness.calls.resources).not.toHaveBeenCalled();
      expect(harness.calls.clear).toHaveBeenCalledWith('fixture-document');
      expect(harness.calls.scrub).toHaveBeenCalledOnce();
    },
  );

  it('deduplicates Strict-Mode-style concurrent starts and publishes only after hydration', async () => {
    let finishHydration!: () => void;
    const hydration = new Promise<void>((resolve) => {
      finishHydration = resolve;
    });
    const harness = createHarness(
      {
        createResources: vi.fn(() => ({
          doc: createRealtimeDocument(),
          provider: {
            destroy: vi.fn(),
            getSnapshot: () => ({
              actorId: 'actor-owner',
              connectionState: 'connecting',
              enabled: true,
              hydrated: false,
              peers: [],
              pendingUpdateCount: 0,
              queuedUpdateCount: 0,
              syncState: 'connecting',
            }),
            start: () => hydration,
            subscribe: () => () => undefined,
          } as unknown as LashRealtimeYjsProvider,
        })),
      },
      loopbackRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );

    const first = controller.start();
    const second = controller.start();
    await vi.waitFor(() => expect(harness.calls.exchange).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(controller.getSnapshot()).toMatchObject({ phase: 'remote-hydrating' }),
    );

    expect(second).toBe(first);
    expect(controller.getResolution()).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      hydrated: false,
      phase: 'remote-hydrating',
    });

    finishHydration();
    await first;

    expect(controller.getSnapshot()).toMatchObject({
      authorized: true,
      hydrated: true,
      phase: 'remote-ready',
    });
    expect(controller.getResolution()).toMatchObject({
      kind: 'remote',
      remoteDocumentId: 'fixture-document',
      routeDocumentId: 'fixture-document',
    });
  });

  it('never retries an exact typed terminal failure even when the HTTP status is transient-looking', async () => {
    const harness = createHarness(
      {
        exchangeSession: vi.fn(async () => ({
          error: 'invite-authority-unavailable',
          ok: false as const,
          retryable: false as const,
          status: 503,
        })),
        readFragmentCredential: () => ({ state: 'valid', token: 'opaque-invite' }),
      },
      configuredRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );

    await controller.start();

    expect(harness.calls.exchange).toHaveBeenCalledOnce();
    expect(harness.calls.delay).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'unavailable',
      reason: 'invite-authority-unavailable',
      retryable: false,
    });
  });

  it('classifies a non-JSON 4xx session response as terminal protocol failure', async () => {
    const result = await exchangeRealtimeSession({
      actorId: 'actor-owner',
      fetcher: vi.fn(async () => new Response('<html>denied</html>', { status: 403 })),
      inviteToken: 'opaque-invite',
      roomId: 'fixture-document',
      runtime: loopbackRuntime,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      ok: false,
      error: 'protocol-error',
      retryable: false,
      status: 403,
    });
  });

  it('aborts each stalled session exchange at a bounded deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let requestSignal: AbortSignal | null = null;
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal as AbortSignal;
          requestSignal.addEventListener(
            'abort',
            () => reject(new DOMException('Session exchange deadline elapsed.', 'AbortError')),
            { once: true },
          );
        }),
    ) as unknown as typeof fetch;

    const exchange = exchangeRealtimeSession({
      actorId: 'actor-owner',
      fetcher,
      inviteToken: 'opaque-invite',
      roomId: 'fixture-document',
      runtime: loopbackRuntime,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(5_001);
    const deadlineAborted = requestSignal?.aborted ?? false;
    controller.abort();
    await exchange.catch(() => undefined);
    vi.useRealTimers();

    expect(deadlineAborted).toBe(true);
  });

  it('keeps a known 403 terminal when its response body stalls until the deadline', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: () =>
          new Promise<unknown>((_resolve, reject) => {
            const requestSignal = init?.signal;
            requestSignal?.addEventListener(
              'abort',
              () => reject(new DOMException('Body read aborted.', 'AbortError')),
              { once: true },
            );
          }),
      } as Response),
    ) as unknown as typeof fetch;
    const exchange = exchangeRealtimeSession({
      actorId: 'actor-owner',
      fetcher,
      inviteToken: 'opaque-invite',
      roomId: 'fixture-document',
      runtime: loopbackRuntime,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(5_001);
    const result = await exchange;
    vi.useRealTimers();

    expect(result).toEqual({
      ok: false,
      error: 'protocol-error',
      retryable: false,
      status: 403,
    });
  });

  it('settles at the deadline even when a fetch implementation ignores abort', async () => {
    vi.useFakeTimers();
    let settledResult: RealtimeSessionExchangeResult | null = null;
    void exchangeRealtimeSession({
      actorId: 'actor-owner',
      fetcher: vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch,
      inviteToken: 'opaque-invite',
      roomId: 'fixture-document',
      runtime: loopbackRuntime,
      signal: new AbortController().signal,
    }).then((result) => {
      settledResult = result;
    });

    await vi.advanceTimersByTimeAsync(5_001);
    const resultAfterDeadline = settledResult;
    vi.useRealTimers();

    expect(resultAfterDeadline).toEqual({
      ok: false,
      error: 'transient',
      retryable: true,
      status: null,
    });
  });

  it('bounds transient authorization to three attempts at 0/250/1000 ms and allows manual retry', async () => {
    const exchange = vi.fn(async () => ({
      error: 'transient',
      ok: false as const,
      retryable: true as const,
      status: 503,
    }));
    const harness = createHarness({ exchangeSession: exchange }, loopbackRuntime);
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );

    await controller.start();

    expect(exchange).toHaveBeenCalledTimes(3);
    expect(harness.calls.delay.mock.calls.map(([delay]) => delay)).toEqual([250, 1000]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'unavailable',
      reason: 'transient-exhausted',
      retryable: true,
    });

    exchange.mockResolvedValueOnce(success);
    await controller.retry();
    expect(exchange).toHaveBeenCalledTimes(4);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'remote-ready' });
  });

  it('lets destroy win over a late successful exchange without creating resources or a socket', async () => {
    let finishExchange!: (result: RealtimeSessionExchangeResult) => void;
    const exchange = new Promise<RealtimeSessionExchangeResult>((resolve) => {
      finishExchange = resolve;
    });
    const harness = createHarness({ exchangeSession: vi.fn(() => exchange) }, loopbackRuntime);
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );

    const starting = controller.start();
    await vi.waitFor(() => expect(harness.calls.exchange).toHaveBeenCalledOnce());
    controller.destroy();
    finishExchange(success);
    await starting;

    expect(harness.calls.resources).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'destroyed' });
  });

  it('destroys hidden realtime resources when provider hydration fails terminally', async () => {
    const doc = createRealtimeDocument();
    const destroyDocument = vi.spyOn(doc, 'destroy');
    const destroyProvider = vi.fn();
    const harness = createHarness(
      {
        createResources: vi.fn(() => ({
          doc,
          provider: {
            destroy: destroyProvider,
            getSnapshot: () => ({
              actorId: 'actor-owner',
              connectionState: 'offline',
              enabled: true,
              hydrated: false,
              peers: [],
              pendingUpdateCount: 0,
              queuedUpdateCount: 0,
              syncState: 'offline',
            }),
            start: vi.fn(async () => {
              throw new RealtimeProviderStartError(
                'protocol',
                'Invalid hydration-complete protocol frame.',
              );
            }),
            subscribe: () => () => undefined,
          } as unknown as LashRealtimeYjsProvider,
        })),
      },
      loopbackRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );

    await controller.start();

    expect(destroyProvider).toHaveBeenCalledOnce();
    expect(destroyDocument).toHaveBeenCalledOnce();
    expect(controller.getResolution()).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'unavailable',
      reason: 'protocol-error',
      retryable: false,
    });
  });

  it('removes the document surface when the provider reports a terminal scope mismatch', async () => {
    let publishProvider!: (snapshot: RealtimeSnapshot) => void;
    let terminalReason: string | null = null;
    const doc = createRealtimeDocument();
    const destroyDocument = vi.spyOn(doc, 'destroy');
    const destroyProvider = vi.fn();
    const readySnapshot = {
      actorId: 'actor-owner',
      canWrite: true,
      connectionState: 'connected' as const,
      enabled: true,
      hydrated: true,
      peers: [],
      pendingUpdateCount: 0,
      queuedUpdateCount: 0,
      syncState: 'saved' as const,
    };
    const provider = {
      destroy: destroyProvider,
      getSnapshot: () => readySnapshot,
      getTerminalReason: () => terminalReason,
      start: vi.fn(async () => undefined),
      subscribe: vi.fn((listener: (snapshot: RealtimeSnapshot) => void) => {
        publishProvider = listener;
        listener(readySnapshot);
        return () => undefined;
      }),
    } as unknown as LashRealtimeYjsProvider;
    const harness = createHarness(
      {
        createResources: vi.fn(() => ({ doc, provider })),
      },
      loopbackRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );
    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'remote-ready', canWrite: true });

    terminalReason = 'scope-mismatch';
    publishProvider({
      ...readySnapshot,
      canWrite: false,
      connectionState: 'offline',
      hydrated: false,
      syncState: 'offline',
    });

    expect(destroyProvider).toHaveBeenCalledOnce();
    expect(destroyDocument).toHaveBeenCalledOnce();
    expect(controller.getResolution()).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'denied',
      authorized: false,
      canWrite: false,
      hydrated: false,
      reason: 'scope-mismatch',
      syncState: 'denied',
    });
  });

  it('revokes first, readback-verifies every unsynced byte, then tears down to recovery available', async () => {
    let publishProvider!: (snapshot: RealtimeSnapshot) => void;
    let terminalReason: string | null = null;
    const lifecycle: string[] = [];
    const recoveryJournal = createRealtimeRecoveryJournal(createRecoveryStorage());
    const persistAndVerify = vi
      .spyOn(recoveryJournal, 'persistAndVerify')
      .mockImplementation((input) => {
        lifecycle.push('persist');
        return createRealtimeRecoveryJournal(createRecoveryStorage()).persistAndVerify(input);
      });
    const doc = createRealtimeDocument();
    const destroyDocument = vi.spyOn(doc, 'destroy').mockImplementation(() => {
      lifecycle.push('destroy-doc');
    });
    const destroyProvider = vi.fn(() => {
      lifecycle.push('destroy-provider');
    });
    const readySnapshot: RealtimeSnapshot = {
      actorId: 'actor-owner',
      canWrite: true,
      connectionState: 'connected',
      enabled: true,
      hydrated: true,
      peers: [],
      pendingUpdateCount: 1,
      queuedUpdateCount: 1,
      syncState: 'syncing',
    };
    const seal = {
      id: 'terminal-scope-seal',
      snapshot: {
        authorityEpoch: 0,
        baselineStateVector: new Uint8Array([9, 9]),
        documentId: 'fixture-document',
        principalId: 'actor-owner',
        reason: 'scope-mismatch' as const,
        sealedAt: '2026-07-18T06:30:00.000Z',
        scope: 'edit' as const,
        updates: [
          { bytes: new Uint8Array([1, 2, 3]), updateId: 'pending-1' },
          { bytes: new Uint8Array([4, 5]), updateId: 'queued-2' },
        ],
      },
    };
    const provider = {
      commitDestroy: vi.fn(() => {
        destroyProvider();
        return true;
      }),
      destroy: destroyProvider,
      getSnapshot: () => readySnapshot,
      getTerminalReason: () => terminalReason,
      sealForRecovery: vi.fn(() => {
        controller.getMutationAuthority().revoke();
        return seal;
      }),
      start: vi.fn(async () => undefined),
      subscribe: vi.fn((listener: (snapshot: RealtimeSnapshot) => void) => {
        publishProvider = listener;
        listener(readySnapshot);
        return () => undefined;
      }),
    } as unknown as LashRealtimeYjsProvider;
    const harness = createHarness(
      {
        createResources: vi.fn(() => ({ doc, provider })),
        recoveryJournal,
      },
      loopbackRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );
    await controller.start();
    const authority = controller.getMutationAuthority();
    expect(authority.getSnapshot()).toMatchObject({ bodyWrite: true, phase: 'ready-edit' });

    terminalReason = 'scope-mismatch';
    publishProvider({
      ...readySnapshot,
      canWrite: false,
      connectionState: 'offline',
      hydrated: false,
      syncState: 'offline',
    });

    expect(authority.getSnapshot()).toMatchObject({
      bodyWrite: false,
      epoch: 1,
      phase: 'recovery-available',
    });
    expect(persistAndVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'fixture-document',
        epoch: 0,
        principalId: 'actor-owner',
        updates: [
          { bytes: new Uint8Array([1, 2, 3]), updateId: 'pending-1' },
          { bytes: new Uint8Array([4, 5]), updateId: 'queued-2' },
        ],
      }),
    );
    expect(lifecycle).toEqual(['persist', 'destroy-provider', 'destroy-doc']);
    expect(destroyDocument).toHaveBeenCalledOnce();
    expect(controller.getResolution()).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      authorized: false,
      phase: 'recovery-available',
      recoveryExportAvailable: true,
      recoveryUpdateCount: 2,
      syncState: 'unavailable',
    });
    const exported = controller.exportRealtimeRecovery();
    expect(exported).toContain('pending-1');
    expect(exported).toContain('queued-2');
    expect(exported).not.toMatch(/accessToken|short-lived-session/u);
  });

  it('retains exact bytes and refuses destructive teardown when recovery cannot be verified', async () => {
    let publishProvider!: (snapshot: RealtimeSnapshot) => void;
    let terminalReason: string | null = null;
    const doc = createRealtimeDocument();
    const destroyDocument = vi.spyOn(doc, 'destroy');
    const destroyProvider = vi.fn();
    const removeWarning = vi.fn();
    const installWarning = vi.fn(() => removeWarning);
    const readySnapshot: RealtimeSnapshot = {
      actorId: 'actor-owner',
      canWrite: true,
      connectionState: 'connected',
      enabled: true,
      hydrated: true,
      peers: [],
      pendingUpdateCount: 1,
      queuedUpdateCount: 0,
      syncState: 'syncing',
    };
    const recoveryJournal = {
      discard: vi.fn(() => false),
      listForDocument: vi.fn(() => ({ ok: true as const, records: [] })),
      persistAndVerify: vi.fn(() => ({ ok: false as const, reason: 'write-failed' as const })),
      read: vi.fn(() => null),
    };
    const seal = {
      id: 'blocked-terminal-seal',
      snapshot: {
        authorityEpoch: 0,
        baselineStateVector: new Uint8Array([9]),
        documentId: 'fixture-document',
        principalId: 'actor-owner',
        reason: 'scope-mismatch' as const,
        sealedAt: '2026-07-18T06:45:00.000Z',
        scope: 'edit' as const,
        updates: [{ bytes: new Uint8Array([7, 8, 9]), updateId: 'exact-local-update' }],
      },
    };
    const provider = {
      commitDestroy: vi.fn(() => false),
      destroy: destroyProvider,
      getSnapshot: () => readySnapshot,
      getTerminalReason: () => terminalReason,
      sealForRecovery: vi.fn(() => {
        controller.getMutationAuthority().revoke();
        return seal;
      }),
      start: vi.fn(async () => undefined),
      subscribe: vi.fn((listener: (snapshot: RealtimeSnapshot) => void) => {
        publishProvider = listener;
        listener(readySnapshot);
        return () => undefined;
      }),
    } as unknown as LashRealtimeYjsProvider;
    const harness = createHarness(
      {
        createResources: vi.fn(() => ({ doc, provider })),
        installRecoveryNavigationWarning: installWarning,
        recoveryJournal,
      },
      loopbackRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );
    await controller.start();

    terminalReason = 'scope-mismatch';
    publishProvider({
      ...readySnapshot,
      canWrite: false,
      connectionState: 'offline',
      hydrated: false,
      syncState: 'offline',
    });
    controller.destroy();

    expect(controller.getMutationAuthority().getSnapshot()).toMatchObject({
      bodyWrite: false,
      phase: 'recovery-blocked',
    });
    expect(controller.getResolution()).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'recovery-blocked',
      recoveryExportAvailable: true,
      recoveryUpdateCount: 1,
    });
    expect(destroyProvider).not.toHaveBeenCalled();
    expect(destroyDocument).not.toHaveBeenCalled();
    expect(installWarning).toHaveBeenCalledOnce();
    expect(removeWarning).not.toHaveBeenCalled();
    expect(controller.exportRealtimeRecovery()).toContain('exact-local-update');

    expect(controller.discardRealtimeRecovery()).toBe(false);
    expect(removeWarning).not.toHaveBeenCalled();
    expect(destroyProvider).not.toHaveBeenCalled();
    expect(destroyDocument).not.toHaveBeenCalled();
  });

  it('discovers a verified recovery receipt on remount without authorizing or applying it', async () => {
    const storage = createRecoveryStorage();
    const recoveryJournal = createRealtimeRecoveryJournal(
      storage,
      () => '2026-07-18T06:00:00.000Z',
    );
    expect(
      recoveryJournal.persistAndVerify({
        baselineStateVector: new Uint8Array([9]),
        documentId: 'fixture-document',
        epoch: 3,
        principalId: 'actor-owner',
        reason: 'scope-mismatch',
        scope: 'edit',
        unsyncedMetadata: null,
        unsyncedTitle: null,
        updates: [{ bytes: new Uint8Array([7, 8, 9]), updateId: 'remounted-update' }],
      }).ok,
    ).toBe(true);
    const exchangeSession = vi.fn(async () => success);
    const createResources = vi.fn();
    const harness = createHarness(
      {
        createResources,
        exchangeSession,
        recoveryJournal,
      },
      loopbackRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );

    await controller.start();

    expect(exchangeSession).not.toHaveBeenCalled();
    expect(createResources).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      authorized: false,
      phase: 'recovery-available',
      recoveryExportAvailable: true,
      recoveryUpdateCount: 1,
    });
    expect(controller.getMutationAuthority().getSnapshot()).toMatchObject({
      bodyWrite: false,
      phase: 'recovery-available',
    });
    expect(controller.exportRealtimeRecovery()).toContain('remounted-update');
    expect(controller.getResolution()).toBeNull();

    controller.clearCredentialAndNavigate();
    expect(harness.calls.navigate).not.toHaveBeenCalled();
    expect(controller.discardRealtimeRecovery()).toBe(true);
    const remaining = recoveryJournal.listForDocument('fixture-document');
    expect(remaining.ok && remaining.records).toHaveLength(0);
    controller.clearCredentialAndNavigate();
    expect(harness.calls.navigate).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing snapshot', null],
    [
      'wrong document',
      {
        authorityEpoch: 0,
        baselineStateVector: new Uint8Array([9]),
        documentId: 'different-document',
        principalId: 'actor-owner',
        reason: 'scope-mismatch' as const,
        scope: 'edit' as const,
        updates: [{ bytes: new Uint8Array([1]), updateId: 'pending-1' }],
      },
    ],
    [
      'wrong reason',
      {
        authorityEpoch: 0,
        baselineStateVector: new Uint8Array([9]),
        documentId: 'fixture-document',
        principalId: 'actor-owner',
        reason: 'protocol-error' as const,
        scope: 'edit' as const,
        updates: [{ bytes: new Uint8Array([1]), updateId: 'pending-1' }],
      },
    ],
    [
      'duplicate update ids',
      {
        authorityEpoch: 0,
        baselineStateVector: new Uint8Array([9]),
        documentId: 'fixture-document',
        principalId: 'actor-owner',
        reason: 'scope-mismatch' as const,
        scope: 'edit' as const,
        updates: [
          { bytes: new Uint8Array([1]), updateId: 'duplicate' },
          { bytes: new Uint8Array([2]), updateId: 'duplicate' },
        ],
      },
    ],
  ])(
    'blocks teardown when queued/pending work has a %s recovery snapshot',
    async (_label, recovery) => {
      let publishProvider!: (snapshot: RealtimeSnapshot) => void;
      let terminalReason: string | null = null;
      const doc = createRealtimeDocument();
      const destroyDocument = vi.spyOn(doc, 'destroy');
      const destroyProvider = vi.fn();
      const installWarning = vi.fn(() => vi.fn());
      const readySnapshot: RealtimeSnapshot = {
        actorId: 'actor-owner',
        canWrite: true,
        connectionState: 'connected',
        enabled: true,
        hydrated: true,
        peers: [],
        pendingUpdateCount: 1,
        queuedUpdateCount: recovery?.updates.length === 2 ? 1 : 0,
        syncState: 'syncing',
      };
      const provider = {
        destroy: destroyProvider,
        getSnapshot: () => readySnapshot,
        getTerminalReason: () => terminalReason,
        getUnsyncedRecoverySnapshot: () => recovery,
        start: vi.fn(async () => undefined),
        subscribe: vi.fn((listener: (snapshot: RealtimeSnapshot) => void) => {
          publishProvider = listener;
          listener(readySnapshot);
          return () => undefined;
        }),
      } as unknown as LashRealtimeYjsProvider;
      const harness = createHarness(
        {
          createResources: vi.fn(() => ({ doc, provider })),
          installRecoveryNavigationWarning: installWarning,
        },
        loopbackRuntime,
      );
      const controller = createDocumentAccessController(
        { documentId: 'fixture-document' },
        harness.dependencies,
      );
      await controller.start();

      terminalReason = 'scope-mismatch';
      publishProvider({
        ...readySnapshot,
        canWrite: false,
        connectionState: 'offline',
        hydrated: false,
        syncState: 'offline',
      });
      controller.destroy();

      expect(controller.getSnapshot()).toMatchObject({
        phase: 'recovery-blocked',
        recoveryExportAvailable: false,
      });
      expect(installWarning).toHaveBeenCalledOnce();
      expect(destroyProvider).not.toHaveBeenCalled();
      expect(destroyDocument).not.toHaveBeenCalled();
      expect(controller.discardRealtimeRecovery()).toBe(false);
    },
  );

  it('tears down transport exhaustion and retries with one fresh authorization generation', async () => {
    const exhaustedDoc = createRealtimeDocument();
    const readyDoc = createRealtimeDocument();
    const destroyExhaustedDocument = vi.spyOn(exhaustedDoc, 'destroy');
    const destroyExhaustedProvider = vi.fn();
    const readyProvider = {
      destroy: vi.fn(),
      getSnapshot: () => ({
        actorId: 'actor-owner',
        connectionState: 'connected',
        enabled: true,
        hydrated: true,
        peers: [],
        pendingUpdateCount: 0,
        queuedUpdateCount: 0,
        syncState: 'saved',
      }),
      start: vi.fn(async () => undefined),
      subscribe: () => () => undefined,
    } as unknown as LashRealtimeYjsProvider;
    const createResources = vi
      .fn()
      .mockReturnValueOnce({
        doc: exhaustedDoc,
        provider: {
          destroy: destroyExhaustedProvider,
          getSnapshot: () => ({
            actorId: 'actor-owner',
            connectionState: 'offline',
            enabled: true,
            hydrated: false,
            peers: [],
            pendingUpdateCount: 0,
            queuedUpdateCount: 0,
            syncState: 'offline',
          }),
          start: vi.fn(async () => {
            throw new RealtimeProviderStartError(
              'transient-exhausted',
              'Realtime transport attempts were exhausted.',
            );
          }),
          subscribe: () => () => undefined,
        } as unknown as LashRealtimeYjsProvider,
      })
      .mockReturnValueOnce({ doc: readyDoc, provider: readyProvider });
    const harness = createHarness({ createResources }, loopbackRuntime);
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );

    await controller.start();

    expect(destroyExhaustedProvider).toHaveBeenCalledOnce();
    expect(destroyExhaustedDocument).toHaveBeenCalledOnce();
    expect(controller.getResolution()).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'unavailable',
      reason: 'transient-exhausted',
      retryable: true,
    });

    await controller.retry();

    expect(createResources).toHaveBeenCalledTimes(2);
    expect(harness.calls.exchange).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'remote-ready',
      retryable: false,
    });
  });

  it('clears only the active room before safe navigation', async () => {
    const harness = createHarness(
      {
        readFragmentCredential: () => ({ state: 'valid', token: 'opaque-invite' }),
      },
      disabledRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );
    await controller.start();

    controller.clearCredentialAndNavigate();

    expect(harness.calls.clear).toHaveBeenCalledWith('fixture-document');
    expect(harness.calls.scrub).toHaveBeenCalled();
    expect(harness.calls.navigate).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'destroyed' });
  });

  it('scrubs an authorized invite fragment even when session storage rejects persistence', async () => {
    const harness = createHarness(
      {
        readFragmentCredential: () => ({ state: 'valid', token: 'opaque-invite' }),
        writeValidatedCredential: vi.fn(() => {
          throw new DOMException('Storage disabled.', 'QuotaExceededError');
        }),
      },
      loopbackRuntime,
    );
    const controller = createDocumentAccessController(
      { documentId: 'fixture-document' },
      harness.dependencies,
    );

    await controller.start();

    expect(harness.calls.scrub).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'remote-ready',
      authorized: true,
      hydrated: true,
    });
  });
});
