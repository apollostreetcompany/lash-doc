import { createLashEditorExtensions } from '@lash/editor-core';
import { getSchema } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';

import {
  createDocumentAccessController,
  requestBrowserOwnerSession,
  type DocumentAccessDependencies,
} from '../../../../apps/web/lib/documentAccess';
import type { DocumentMutationAuthority } from '../../../../apps/web/lib/documentMutationAuthority';
import {
  createBrowserDocumentPromotionAttempt,
  type BrowserDocumentPromotionAttempt,
} from '../../../../apps/web/lib/documentPromotion/browserClient';
import { createBrowserPendingPromotionStore } from '../../../../apps/web/lib/documentPromotion/pendingPromotion';
import { readDocumentTitle, saveDocumentTitle } from '../../../../apps/web/lib/documentRegistry';
import {
  assertStrictLocalBodySchemaJson,
  loadLocalDocumentBody,
  localBodyExpectedRevision,
  saveLocalDocumentBody,
} from '../../../../apps/web/lib/localDocumentBodyPersistence';
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
    clear: () => values.clear(),
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

const pendingPromotionKey = `lash:pending-promotion:v1:${ROUTE_DOCUMENT_ID}`;
const revisedBody = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{ type: 'text', text: 'Bring the revised schedule.', marks: [{ type: 'bold' }] }],
  }],
};
const revisedTitle = 'Local revision of the launch plan';

const createPendingPromotionFixture = () => {
  const storage = createStorage();
  const schema = getSchema(createLashEditorExtensions());
  const persistence = {
    storage,
    documentId: ROUTE_DOCUMENT_ID,
    validateSchema: (doc: Record<string, unknown>) => assertStrictLocalBodySchemaJson(doc, schema),
  };
  const initial = saveLocalDocumentBody({
    ...persistence,
    doc: BODY,
    expected: null,
    createWriteId: () => 'initial-draft',
  });
  saveDocumentTitle(storage, ROUTE_DOCUMENT_ID, TITLE);

  let accountSnapshot: { title: string; body: unknown; snapshotSha256: string } | undefined;
  let account: 'original' | 'different' = 'original';
  let beforeNextOwnerSession: (() => Promise<void>) | undefined;
  const fetcher = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(async (url, request) => {
    if (url === `/api/documents/${ROUTE_DOCUMENT_ID}/promote`) {
      const { snapshot } = JSON.parse(request?.body as string);
      expect(snapshot).toMatchObject({ title: TITLE, body: BODY });
      expect(JSON.parse(storage.getItem(pendingPromotionKey) ?? 'null')).toEqual({
        version: 1,
        documentId: ROUTE_DOCUMENT_ID,
        snapshotSha256: snapshot.snapshotSha256,
        bodySha256: snapshot.bodySha256,
        revision: 1,
        writeId: 'initial-draft',
        title: TITLE,
      });
      accountSnapshot = snapshot;
      throw new TypeError('Connection lost after the fixture committed the promotion');
    }

    expect(url).toBe(`/api/documents/${ROUTE_DOCUMENT_ID}/owner-session`);
    const beforeResponse = beforeNextOwnerSession;
    beforeNextOwnerSession = undefined;
    await beforeResponse?.();
    if (!accountSnapshot) {
      return Response.json(
        { version: 1, ok: false, error: 'document-unavailable', retryable: false },
        { status: 404 },
      );
    }
    const session = ownerSession({ promotionSnapshotSha256: account === 'original'
      ? accountSnapshot.snapshotSha256
      : SNAPSHOT_SHA256 });
    return Response.json({
      version: 1,
      ok: true,
      localDocumentId: session.routeDocumentId,
      remoteDocumentId: session.remoteDocumentId,
      promotionSnapshotSha256: session.promotionSnapshotSha256,
      access: {
        source: session.source,
        capabilities: session.capabilities,
        protocolVersion: session.protocolVersion,
      },
      socket: {
        url: session.socketUrl,
        protocol: session.socketProtocol,
        ticketProtocol: session.ticketProtocol,
        expiresAt: session.expiresAt,
      },
    });
  });
  const pendingPromotionStore = createBrowserPendingPromotionStore(storage, {
    read: async () => ({ primaryRaw: null, backupRaw: null }),
    commit: vi.fn(),
  });
  const createPage = (createOwnerResources = createCandidateFactory(), preferDeviceDraft = false) => createDocumentAccessController(
    { documentId: ROUTE_DOCUMENT_ID },
    createHarness({
      createOwnerResources,
      fetcher,
      pendingPromotionStore,
      preferDeviceDraft,
      requestOwnerSession: (input) => requestBrowserOwnerSession({ ...input, fetcher }),
    }, configuredRuntime).dependencies,
  );
  const createAttempt = () => {
    const saved = loadLocalDocumentBody(persistence);
    if (saved.state !== 'ready') throw new Error('Could not verify the fixture draft');
    return createBrowserDocumentPromotionAttempt({
      localDocumentId: ROUTE_DOCUMENT_ID,
      title: readDocumentTitle(storage, ROUTE_DOCUMENT_ID),
      body: saved.envelope.doc,
      adjuncts: { comments: 0, suggestions: 0 },
    }, globalThis.crypto);
  };
  return {
    storage,
    createPage,
    createAttempt,
    submit: (page: ReturnType<typeof createPage>) => page.promoteOwnerDocument(createAttempt()),
    switchAccount(next: typeof account) { account = next; },
    delayNextOwnerSession(delay: () => Promise<void>) { beforeNextOwnerSession = delay; },
    saveRevisedDraft() {
      saveLocalDocumentBody({
        ...persistence,
        doc: revisedBody,
        expected: localBodyExpectedRevision(initial),
        createWriteId: () => 'revised-draft',
      });
      saveDocumentTitle(storage, ROUTE_DOCUMENT_ID, revisedTitle);
    },
    readDraft: () => loadLocalDocumentBody(persistence),
    readTitle: () => readDocumentTitle(storage, ROUTE_DOCUMENT_ID),
    submittedRequests: () => fetcher.mock.calls.filter(([url]) => String(url).endsWith('/promote')),
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
  it('keeps a newer device draft after an ambiguous save and opens the matching account copy only by choice', async () => {
    const fixture = createPendingPromotionFixture();
    const firstPage = fixture.createPage();
    await firstPage.start();
    const exactAttempt = fixture.createAttempt();
    await expect(firstPage.promoteOwnerDocument(exactAttempt)).resolves.toMatchObject({
      ok: false,
      reason: 'device-draft-preserved',
      retryable: false,
    });
    expect(firstPage.getSnapshot().promotionRecovery).toBe('device-draft');
    expect(firstPage.getMutationAuthority().getSnapshot()).toMatchObject({ bodyWrite: true });
    fixture.switchAccount('different');
    await expect(firstPage.promoteOwnerDocument(exactAttempt)).resolves.toMatchObject({
      ok: false,
      reason: 'device-draft-preserved',
    });
    expect(fixture.submittedRequests()).toHaveLength(1);
    fixture.switchAccount('original');
    fixture.saveRevisedDraft();
    firstPage.destroy();

    const savedMarker = fixture.storage.getItem(pendingPromotionKey);
    const candidate = createCandidateFactory();
    const reloaded = fixture.createPage(candidate);
    await reloaded.start();
    expect(reloaded.getResolution()).toMatchObject({ kind: 'local' });
    expect(reloaded.getSnapshot().promotionRecovery).toBe('device-draft');
    await reloaded.checkAccountCopy();
    expect(reloaded.getSnapshot().promotionRecovery).toBe('account-copy-available');
    expect(reloaded.getMutationAuthority().getSnapshot()).toMatchObject({ bodyWrite: true, remoteDocumentId: null });
    expect(candidate).not.toHaveBeenCalled();

    fixture.switchAccount('different');
    await expect(reloaded.openAccountCopy()).resolves.toMatchObject({
      ok: false,
      reason: 'device-draft-preserved',
    });
    expect(reloaded.getSnapshot().promotionRecovery).toBe('device-draft');
    expect(candidate).not.toHaveBeenCalled();

    fixture.switchAccount('original');
    await reloaded.checkAccountCopy();
    expect(reloaded.getSnapshot().promotionRecovery).toBe('account-copy-available');
    expect(candidate).not.toHaveBeenCalled();
    await expect(reloaded.openAccountCopy()).resolves.toMatchObject({
      ok: true,
      remoteDocumentId: REMOTE_DOCUMENT_ID,
    });
    const accountCopy = reloaded.getResolution();
    expect(accountCopy?.kind).toBe('remote');
    if (!accountCopy || accountCopy.kind !== 'remote') throw new Error('Account copy did not open');
    expect(readRealtimeDocumentTitle(accountCopy.doc)).toBe(TITLE);
    expect(yXmlFragmentToProsemirrorJSON(accountCopy.doc.getXmlFragment('content'))).toEqual(BODY);
    expect(reloaded.getSnapshot().promotionRecovery).toBe('account-copy-open');
    expect(fixture.storage.getItem(pendingPromotionKey)).toBe(savedMarker);
    expect(fixture.readDraft()).toMatchObject({
      state: 'ready',
      envelope: { doc: revisedBody, revision: 2, writeId: 'revised-draft' },
    });
    expect(fixture.readTitle()).toBe(revisedTitle);
    expect(fixture.submittedRequests()).toHaveLength(1);
    reloaded.destroy();

    const returned = fixture.createPage();
    await returned.start();
    expect(returned.getResolution()).toMatchObject({ kind: 'local' });
    expect(returned.getSnapshot().promotionRecovery).toBe('device-draft');
    returned.destroy();
  });

  it('keeps matching device text when new local Discussion is present after the response loss', async () => {
    const fixture = createPendingPromotionFixture();
    const firstPage = fixture.createPage();
    await firstPage.start();
    await fixture.submit(firstPage);
    firstPage.destroy();
    const discussionKey = `lash:chat-threads:${ROUTE_DOCUMENT_ID}`;
    const newDiscussion = JSON.stringify([{ id: 'new-local-thread' }]);
    fixture.storage.setItem(discussionKey, newDiscussion);

    const reloaded = fixture.createPage();
    await reloaded.start();
    expect(reloaded.getResolution()).toMatchObject({ kind: 'local' });
    expect(reloaded.getSnapshot().promotionRecovery).toBe('device-draft');
    expect(fixture.storage.getItem(discussionKey)).toBe(newDiscussion);
    expect(fixture.storage.getItem(pendingPromotionKey)).not.toBeNull();
    reloaded.destroy();
  });

  it('recognizes unchanged local work without an extra promotion and keeps newer account edits', async () => {
    const fixture = createPendingPromotionFixture();
    const firstPage = fixture.createPage();
    await firstPage.start();
    await fixture.submit(firstPage);
    firstPage.destroy();
    expect(fixture.storage.getItem(pendingPromotionKey)).not.toBeNull();

    const newerAccountTitle = 'Updated from another device';
    const reloaded = fixture.createPage(createCandidateFactory({ body: revisedBody, title: newerAccountTitle }));
    await reloaded.start();
    const accountCopy = reloaded.getResolution();
    if (!accountCopy || accountCopy.kind !== 'remote') throw new Error('Account copy did not reopen');
    expect(readRealtimeDocumentTitle(accountCopy.doc)).toBe(newerAccountTitle);
    expect(fixture.submittedRequests()).toHaveLength(1);
    expect(fixture.storage.getItem(pendingPromotionKey)).toBeNull();
    expect(reloaded.getSnapshot().promotionRecovery).toBeUndefined();
    reloaded.destroy();
  });

  it('confirms an explicitly opened account copy when the device draft is unchanged', async () => {
    const fixture = createPendingPromotionFixture();
    const page = fixture.createPage();
    await page.start();
    await fixture.submit(page);
    await page.checkAccountCopy();
    expect(page.getResolution()).toMatchObject({ kind: 'local' });
    expect(page.getSnapshot().promotionRecovery).toBe('account-copy-available');
    await expect(page.openAccountCopy()).resolves.toMatchObject({ ok: true });
    expect(page.getSnapshot().promotionRecovery).toBeUndefined();
    expect(fixture.storage.getItem(pendingPromotionKey)).toBeNull();
    expect(fixture.submittedRequests()).toHaveLength(1);
    page.destroy();
  });

  it('honors an explicit return to the pending device draft even when the persisted body matches', async () => {
    const fixture = createPendingPromotionFixture();
    const original = fixture.createPage();
    await original.start();
    await fixture.submit(original);
    original.destroy();

    const candidate = createCandidateFactory();
    const returned = fixture.createPage(candidate, true);
    await returned.start();
    expect(returned.getResolution()).toMatchObject({ kind: 'local' });
    expect(returned.getSnapshot().promotionRecovery).toBe('device-draft');
    expect(candidate).not.toHaveBeenCalled();
    expect(fixture.storage.getItem(pendingPromotionKey)).not.toBeNull();
    await returned.checkAccountCopy();
    await expect(returned.openAccountCopy()).resolves.toMatchObject({ ok: true });
    expect(fixture.storage.getItem(pendingPromotionKey)).toBeNull();
    returned.destroy();
  });

  it('keeps the source when a different account signs in during automatic hydration', async () => {
    const fixture = createPendingPromotionFixture();
    const original = fixture.createPage();
    await original.start();
    await fixture.submit(original);
    original.destroy();

    const hydration = Promise.withResolvers<void>();
    const candidate = createCandidateFactory({ waitForHydration: hydration.promise });
    const reloaded = fixture.createPage(candidate);
    const starting = reloaded.start();
    await vi.waitFor(() => expect(candidate).toHaveBeenCalledOnce());
    fixture.switchAccount('different');
    hydration.resolve();
    await starting;
    expect(reloaded.getResolution()).toMatchObject({ kind: 'local' });
    expect(reloaded.getSnapshot().promotionRecovery).toBe('device-draft');
    expect(candidate.mock.results[0]?.value.provider.commitAuthorityOwnership).not.toHaveBeenCalled();
    expect(fixture.storage.getItem(pendingPromotionKey)).not.toBeNull();
    reloaded.destroy();
  });

  it('keeps a newer device save made while the final marked account check is pending', async () => {
    const fixture = createPendingPromotionFixture();
    const original = fixture.createPage();
    await original.start();
    await fixture.submit(original);
    original.destroy();

    const hydration = Promise.withResolvers<void>();
    const candidate = createCandidateFactory({ waitForHydration: hydration.promise });
    const reloaded = fixture.createPage(candidate);
    const starting = reloaded.start();
    await vi.waitFor(() => expect(candidate).toHaveBeenCalledOnce());
    const finalCheck = Promise.withResolvers<void>();
    const finalCheckStarted = Promise.withResolvers<void>();
    fixture.delayNextOwnerSession(() => {
      finalCheckStarted.resolve();
      return finalCheck.promise;
    });
    hydration.resolve();
    await finalCheckStarted.promise;
    fixture.saveRevisedDraft();
    finalCheck.resolve();
    await starting;
    expect(reloaded.getResolution()).toMatchObject({ kind: 'local' });
    expect(reloaded.getSnapshot().promotionRecovery).toBe('device-draft');
    expect(candidate.mock.results[0]?.value.provider.commitAuthorityOwnership).not.toHaveBeenCalled();
    expect(fixture.storage.getItem(pendingPromotionKey)).not.toBeNull();
    reloaded.destroy();
  });

  it('keeps the device draft when its pending account-save marker cannot be verified', async () => {
    const fixture = createPendingPromotionFixture();
    const original = fixture.createPage();
    await original.start();
    await fixture.submit(original);
    original.destroy();
    fixture.storage.setItem(pendingPromotionKey, '{"version":2}');

    const candidate = createCandidateFactory();
    const reloaded = fixture.createPage(candidate);
    await reloaded.start();
    await reloaded.checkAccountCopy();
    expect(reloaded.getResolution()).toMatchObject({ kind: 'local' });
    expect(reloaded.getSnapshot().promotionRecovery).toBe('device-draft');
    expect(candidate).not.toHaveBeenCalled();
    expect(fixture.storage.getItem(pendingPromotionKey)).toBe('{"version":2}');
    reloaded.destroy();
  });

  it('does not dispatch promotion when the browser cannot verify the pending marker write', async () => {
    const fixture = createPendingPromotionFixture();
    const firstPage = fixture.createPage();
    await firstPage.start();
    const save = fixture.storage.setItem;
    vi.spyOn(fixture.storage, 'setItem').mockImplementation((key, value) => {
      if (key !== pendingPromotionKey) save(key, value);
    });
    await expect(fixture.submit(firstPage)).resolves.toMatchObject({
      ok: false,
      reason: 'promotion-failed',
      promotion: { reason: 'device-draft-unverified', retryable: false },
    });
    expect(firstPage.getResolution()).toMatchObject({ kind: 'local' });
    expect(firstPage.getMutationAuthority().getSnapshot()).toMatchObject({ bodyWrite: true });
    expect(fixture.submittedRequests()).toHaveLength(0);
    expect(firstPage.getSnapshot().promotionRecovery).toBeUndefined();
    firstPage.destroy();
  });

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

  it('keeps an interrupted owner-session response body or unavailable gateway retryable', async () => {
    const interrupted = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":true,'));
        controller.error(new TypeError('Connection reset'));
      },
    });
    for (const response of [
      new Response(interrupted, { status: 200, headers: { 'content-type': 'application/json' } }),
      new Response('Gateway unavailable', { status: 503 }),
    ]) {
      await expect(requestBrowserOwnerSession({
        actorId: ACTOR_ID,
        routeDocumentId: ROUTE_DOCUMENT_ID,
        signal: new AbortController().signal,
        fetcher: async () => response,
      })).resolves.toEqual({ ok: false, reason: 'network-error', retryable: true });
    }
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
