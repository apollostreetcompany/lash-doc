import { describe, expect, it, vi } from 'vitest';

import { createDocumentMutationAuthority } from '../../../../apps/web/lib/documentMutationAuthority';
import * as realtimeMetadata from '../../../../apps/web/lib/realtimeCollaboration';
import {
  createRealtimeDocument,
  createOwnerCandidateResources,
  LashRealtimeYjsProvider,
  RealtimeProviderStartError,
  type AuthorizedRealtimeSession,
  type NamedRealtimeSessionV5,
  type OwnerRealtimeSessionV3,
  type RealtimeSocket,
} from '../../../../apps/web/lib/realtimeCollaboration';

type SocketEvent = 'close' | 'error' | 'message' | 'open';

class FakeSocket implements RealtimeSocket {
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
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  removeEventListener(type: SocketEvent, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }
}

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

const roomReady = JSON.stringify({
  type: 'room-ready',
  roomId: 'fixture-document',
  protocolVersion: 2,
});

const hydrationComplete = JSON.stringify({
  type: 'room-hydration-complete',
  roomId: 'fixture-document',
  protocolVersion: 2,
  persistedUpdates: 0,
});

const exactOwnerTicketProtocol = (value: string) => {
  const token = value.replace(/^lash-ticket\./u, '');
  return `lash-ticket.${`${token}${'x'.repeat(43)}`.slice(0, 43)}`;
};

const ownerSession = (
  ticketProtocol: string,
  overrides: Partial<OwnerRealtimeSessionV3> = {},
): OwnerRealtimeSessionV3 => ({
  actorId: 'actor-owner',
  capabilities: ['doc.read', 'doc.edit'],
  expiresAt: '2026-07-30T00:01:00.000Z',
  promotionSnapshotSha256: 'INXKCuVYUANlDd5pZPAEz4eGNandNcnRuxnPfzd6OLk',
  protocolVersion: 3,
  remoteDocumentId: 'opaque-room-47',
  routeDocumentId: 'local-route-document',
  socketProtocol: 'lash-realtime-v3',
  socketUrl:
    'wss://realtime.example.test/api/realtime/rooms/opaque-room-47/socket?protocolVersion=3&actorId=actor-owner',
  source: 'owner',
  ticketProtocol: exactOwnerTicketProtocol(ticketProtocol),
  ...overrides,
});

const ownerRoomReady = JSON.stringify({
  type: 'room-ready',
  roomId: 'opaque-room-47',
  protocolVersion: 3,
});

const ownerHydrationComplete = JSON.stringify({
  type: 'room-hydration-complete',
  roomId: 'opaque-room-47',
  protocolVersion: 3,
  persistedUpdates: 0,
});

const namedRoomId = `doc-v1-${'a'.repeat(64)}`;
const namedActorId = `named-${'b'.repeat(32)}`;
const namedSession = (ticket: string): NamedRealtimeSessionV5 => ({
  actorId: namedActorId,
  capabilities: ['doc.read', 'doc.edit'],
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  protocolVersion: 5,
  remoteDocumentId: namedRoomId,
  role: 'edit',
  roomId: namedRoomId,
  routeDocumentId: namedRoomId,
  socketProtocol: 'lash-realtime-v5',
  socketUrl: `wss://realtime.example.test/api/realtime/rooms/${namedRoomId}/socket?protocolVersion=5&actorId=${namedActorId}`,
  source: 'named',
  ticketProtocol: `lash-named-ticket.${ticket.padEnd(43, 't')}`,
});

function hydrateSocket(socket: FakeSocket, roomId: string, protocolVersion: number) {
  socket.readyState = 1;
  socket.emit('message', { data: JSON.stringify({ type: 'room-ready', roomId, protocolVersion }) });
  socket.emit('message', {
    data: JSON.stringify({
      type: 'room-hydration-complete',
      roomId,
      protocolVersion,
      persistedUpdates: 0,
    }),
  });
}

const encodedRemoteUpdate = (text: string) => {
  const remote = createRealtimeDocument();
  let update: Uint8Array | null = null;
  remote.on('update', (nextUpdate: Uint8Array) => {
    update = nextUpdate;
  });
  remote.getText('body').insert(0, text);
  if (!update) throw new Error('remote fixture did not produce a Yjs update');
  return Buffer.from(update).toString('base64');
};

const commitAuthorityOwnership = (provider: LashRealtimeYjsProvider) =>
  (
    provider as LashRealtimeYjsProvider & {
      commitAuthorityOwnership(): boolean;
    }
  ).commitAuthorityOwnership();

describe('authorized realtime provider lifecycle', () => {
  it.each([
    ['42-character token', `lash-ticket.${'t'.repeat(42)}`],
    ['44-character token', `lash-ticket.${'t'.repeat(44)}`],
    ['padded token', `lash-ticket.${'t'.repeat(43)}=`],
    ['whitespace token', `lash-ticket.${'t'.repeat(42)} `],
    ['percent-encoded token', `lash-ticket.${'t'.repeat(40)}%2F`],
  ])('rejects a noncanonical %s owner socket ticket', (_label, ticketProtocol) => {
    expect(() =>
      createOwnerCandidateResources(ownerSession('valid-ticket', { ticketProtocol }), {
        createSocket: () => new FakeSocket(),
        refreshOwnerSession: vi.fn(),
      }),
    ).toThrow('Owner realtime authorization was invalid.');
  });

  it.each([
    ['64-character hexadecimal', 'a'.repeat(64)],
    ['padded base64url', 'INXKCuVYUANlDd5pZPAEz4eGNandNcnRuxnPfzd6OLk='],
    ['short base64url', 'INXKCuVYUANlDd5pZPAEz4eGNandNcnRuxnPfzd6OL'],
    ['long base64url', 'INXKCuVYUANlDd5pZPAEz4eGNandNcnRuxnPfzd6OLkA'],
    ['percent-encoded', 'INXKCuVYUANlDd5pZPAEz4eGNandNcnRuxnPfzd6%4F'],
    ['whitespace', ' INXKCuVYUANlDd5pZPAEz4eGNandNcnRuxnPfzd6OL'],
  ])('rejects a noncanonical %s promotion snapshot digest', (_label, digest) => {
    expect(() =>
      createOwnerCandidateResources(
        ownerSession('lash-ticket.invalid-snapshot', {
          promotionSnapshotSha256: digest,
        }),
        {
          createSocket: () => new FakeSocket(),
          refreshOwnerSession: vi.fn(),
        },
      ),
    ).toThrow('Owner realtime authorization was invalid.');
  });

  it('destroys an owner candidate before hydration without revoking owner-cutover authority', () => {
    const authority = createDocumentMutationAuthority('local-route-document');
    authority.enterLocalReady();
    expect(authority.freezeForOwnerCutover()).toBe(true);
    const { provider } = createOwnerCandidateResources(ownerSession('pre-hydration-destroy'), {
      authority,
      createSocket: () => new FakeSocket(),
      refreshOwnerSession: vi.fn(),
    });

    expect(provider.destroy()).toBe(true);
    expect(authority.getSnapshot()).toMatchObject({
      bodyWrite: false,
      phase: 'owner-cutover',
      remoteDocumentId: null,
    });
    expect(authority.restoreLocalAfterOwnerCutover()).toBe(true);
    expect(authority.getSnapshot()).toMatchObject({
      bodyWrite: true,
      metadataWrite: 'document',
      phase: 'ready-edit',
      remoteDocumentId: null,
    });
  });

  it('destroys a hydrated precommit owner candidate without revoking remote-hydrating authority', async () => {
    const authority = createDocumentMutationAuthority('local-route-document');
    authority.enterLocalReady();
    expect(authority.freezeForOwnerCutover()).toBe(true);
    authority.enterRemoteHydrating('opaque-room-47');
    const socket = new FakeSocket();
    const { provider } = createOwnerCandidateResources(ownerSession('precommit-destroy'), {
      authority,
      createSocket: () => socket,
      refreshOwnerSession: vi.fn(),
    });

    const starting = provider.start();
    socket.readyState = 1;
    socket.emit('message', { data: ownerRoomReady });
    socket.emit('message', { data: ownerHydrationComplete });
    await starting;
    expect(provider.destroy()).toBe(true);
    expect(authority.getSnapshot()).toMatchObject({
      bodyWrite: false,
      phase: 'remote-hydrating',
      remoteDocumentId: 'opaque-room-47',
    });
    expect(authority.restoreLocalAfterOwnerCutover()).toBe(true);
  });

  it('commits owner authority only after writable hydration and revokes it on postcommit destroy', async () => {
    const authority = createDocumentMutationAuthority('local-route-document');
    authority.enterLocalReady();
    expect(authority.freezeForOwnerCutover()).toBe(true);
    authority.enterRemoteHydrating('opaque-room-47');
    const socket = new FakeSocket();
    const { provider } = createOwnerCandidateResources(ownerSession('postcommit-destroy'), {
      authority,
      createSocket: () => socket,
      refreshOwnerSession: vi.fn(),
    });

    expect(commitAuthorityOwnership(provider)).toBe(false);
    const starting = provider.start();
    expect(commitAuthorityOwnership(provider)).toBe(false);
    socket.readyState = 1;
    socket.emit('message', { data: ownerRoomReady });
    socket.emit('message', { data: ownerHydrationComplete });
    await starting;

    expect(commitAuthorityOwnership(provider)).toBe(true);
    expect(commitAuthorityOwnership(provider)).toBe(true);
    authority.enterRemoteReady({ canWrite: true });
    expect(provider.destroy()).toBe(true);
    expect(authority.getSnapshot()).toMatchObject({
      bodyWrite: false,
      phase: 'revoked',
      remoteDocumentId: 'opaque-room-47',
    });
  });

  it('revokes committed owner authority on a terminal socket close', async () => {
    const authority = createDocumentMutationAuthority('local-route-document');
    authority.enterLocalReady();
    expect(authority.freezeForOwnerCutover()).toBe(true);
    authority.enterRemoteHydrating('opaque-room-47');
    const socket = new FakeSocket();
    const { provider } = createOwnerCandidateResources(ownerSession('postcommit-terminal'), {
      authority,
      createSocket: () => socket,
      refreshOwnerSession: vi.fn(),
    });

    const starting = provider.start();
    socket.readyState = 1;
    socket.emit('message', { data: ownerRoomReady });
    socket.emit('message', { data: ownerHydrationComplete });
    await starting;
    expect(commitAuthorityOwnership(provider)).toBe(true);
    authority.enterRemoteReady({ canWrite: true });

    socket.emit('close', { code: 4409 });

    expect(provider.getTerminalReason()).toBe('protocol-error');
    expect(authority.getSnapshot()).toMatchObject({
      bodyWrite: false,
      phase: 'revoked',
      remoteDocumentId: 'opaque-room-47',
    });
  });

  it('isolates subscriber failures so terminal owner cleanup and later subscribers still run', async () => {
    const authority = createDocumentMutationAuthority('local-route-document');
    authority.enterLocalReady();
    expect(authority.freezeForOwnerCutover()).toBe(true);
    authority.enterRemoteHydrating('opaque-room-47');
    const socket = new FakeSocket();
    const { provider } = createOwnerCandidateResources(ownerSession('throwing-subscriber'), {
      authority,
      createSocket: () => socket,
      refreshOwnerSession: vi.fn(),
    });
    const throwingSubscriber = vi.fn(() => {
      throw new Error('subscriber failure');
    });
    const observingSubscriber = vi.fn();

    expect(() => provider.subscribe(throwingSubscriber)).not.toThrow();
    provider.subscribe(observingSubscriber);
    const starting = provider.start();
    const rejected = expect(starting).rejects.toMatchObject({ kind: 'protocol' });
    socket.readyState = 1;
    socket.emit('close', { code: 4409 });
    await rejected;

    expect(provider.getTerminalReason()).toBe('protocol-error');
    expect(provider.getSnapshot()).toMatchObject({
      canWrite: false,
      connectionState: 'offline',
      hydrated: false,
    });
    expect(authority.getSnapshot()).toMatchObject({
      phase: 'remote-hydrating',
      remoteDocumentId: 'opaque-room-47',
    });
    expect(observingSubscriber).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectionState: 'offline' }),
    );
    expect(throwingSubscriber.mock.calls.length).toBeGreaterThan(1);
  });

  it('fences an unacknowledged body edit when another client restores the shared document', async () => {
    const socket = new FakeSocket();
    const { doc, provider } = createOwnerCandidateResources(ownerSession('restore-fence'), {
      createSocket: () => socket,
      refreshOwnerSession: vi.fn(),
    });
    const starting = provider.start();
    socket.readyState = 1;
    for (const frame of [ownerRoomReady, ownerHydrationComplete]) {
      socket.emit('message', { data: JSON.stringify({ ...JSON.parse(frame), historyGeneration: 3 }) });
    }
    await starting;
    expect(provider.hasSharedHistory()).toBe(true);

    const listing = provider.sharedHistory.request({ type: 'shared-history-list', before: null });
    const request = JSON.parse(socket.sent.at(-1)!);
    expect(request).toMatchObject({ type: 'shared-history-list', before: null });
    const outcome = { kind: 'list', head: 4, revisions: [], nextBefore: null, canRestore: true };
    socket.emit('message', { data: JSON.stringify({
      type: 'shared-history-result', requestId: request.requestId, roomId: 'opaque-room-47', outcome,
    }) });
    expect(await listing).toEqual(outcome);

    doc.getText('body').insert(0, 'An edit in transit');
    const update = JSON.parse(socket.sent.at(-1)!);
    expect(update).toMatchObject({ type: 'yjs-update', historyGeneration: 3 });
    expect(await provider.sharedHistory.request({
      type: 'shared-history-restore', expectedHead: 4, target: 1,
    })).toEqual({ kind: 'error', code: 'unavailable' });
    socket.emit('close', { code: 4410 });
    expect(provider.getTerminalReason()).toBe('protocol-error');
    expect(provider.getUnsyncedRecoverySnapshot()?.updates).toMatchObject([{ updateId: update.updateId }]);
    expect(provider.getSnapshot()).toMatchObject({ canWrite: false, hydrated: false });
  });

  it('preserves a pre-rollout body edit if reconnect discovers a newer restore generation', async () => {
    vi.useFakeTimers();
    try {
      const first = new FakeSocket();
      const second = new FakeSocket();
      const sockets = [first, second];
      const { doc, provider } = createOwnerCandidateResources(ownerSession('pre-history-ticket'), {
        createSocket: () => sockets.shift()!,
        refreshOwnerSession: vi.fn().mockResolvedValue(ownerSession('post-restore-ticket')),
      });
      const starting = provider.start();
      first.readyState = 1;
      first.emit('message', { data: ownerRoomReady });
      first.emit('message', { data: ownerHydrationComplete });
      await starting;
      doc.getText('body').insert(0, 'Unacknowledged pre-rollout edit');
      const { updateId } = JSON.parse(first.sent.at(-1)!);
      first.emit('close', { code: 1006 });
      await vi.advanceTimersByTimeAsync(1_000);

      second.readyState = 1;
      second.emit('message', { data: JSON.stringify({ ...JSON.parse(ownerRoomReady), historyGeneration: 1 }) });
      expect(provider.getTerminalReason()).toBe('protocol-error');
      expect(provider.getUnsyncedRecoverySnapshot()?.updates).toMatchObject([{ updateId }]);
      expect(second.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the protocol-v2 URL transport and does not add WebSocket subprotocols', async () => {
    const socket = new FakeSocket();
    const createSocket = vi.fn((_url: string, _protocols?: readonly string[]) => socket);
    const provider = new LashRealtimeYjsProvider({
      createSocket,
      doc: createRealtimeDocument(),
      session,
    });

    expect(commitAuthorityOwnership(provider)).toBe(false);
    const starting = provider.start();
    expect(createSocket).toHaveBeenCalledWith(
      'ws://127.0.0.1:8788/api/realtime/rooms/fixture-document/socket?accessToken=short-lived-session&protocolVersion=2',
      undefined,
    );
    socket.readyState = 1;
    socket.emit('message', { data: roomReady });
    socket.emit('message', { data: hydrationComplete });
    await starting;
  });

  it('opens an owner session at the exact bearer-free URL with ordered ticket subprotocols', async () => {
    const initial = ownerSession('lash-ticket.initial-ticket');
    const expectedSocketUrl = initial.socketUrl;
    const socket = new FakeSocket();
    const createSocket = vi.fn((_url: string, _protocols?: readonly string[]) => socket);
    const refreshOwnerSession = vi.fn();
    const { doc, provider } = createOwnerCandidateResources(initial, {
      createSocket,
      refreshOwnerSession,
    });
    Object.assign(initial as unknown as Record<string, unknown>, {
      remoteDocumentId: 'caller-mutated-room',
      socketUrl: 'wss://attacker.invalid/socket?accessToken=mutated',
      ticketProtocol: 'lash-ticket.caller-mutated',
    });

    expect(doc.getText('body').toString()).toBe('');
    const starting = provider.start();
    expect(createSocket).toHaveBeenCalledWith(expectedSocketUrl, [
      'lash-realtime-v3',
      exactOwnerTicketProtocol('lash-ticket.initial-ticket'),
    ]);
    const openedUrl = new URL(createSocket.mock.calls[0]?.[0] ?? '');
    expect(openedUrl.searchParams.has('accessToken')).toBe(false);
    expect(openedUrl.searchParams.has('ticket')).toBe(false);
    expect(openedUrl.toString()).not.toContain(
      exactOwnerTicketProtocol('lash-ticket.initial-ticket'),
    );
    expect(refreshOwnerSession).not.toHaveBeenCalled();

    socket.readyState = 1;
    socket.emit('message', { data: ownerRoomReady });
    socket.emit('message', { data: ownerHydrationComplete });
    await starting;
    expect(provider.getSnapshot()).toMatchObject({
      actorId: 'actor-owner',
      canWrite: true,
      connectionState: 'connected',
      hydrated: true,
    });
    expect(JSON.stringify(provider)).not.toMatch(
      /lash-ticket|ticketProtocol|accessToken|providerToken/u,
    );
    const recoverySeal = provider.sealForRecovery('lifecycle');
    expect(recoverySeal.snapshot).toMatchObject({
      documentId: 'local-route-document',
      remoteDocumentId: 'opaque-room-47',
      routeDocumentId: 'local-route-document',
    });
    expect(JSON.stringify(recoverySeal)).not.toMatch(
      /lash-ticket|ticketProtocol|accessToken|providerToken/u,
    );
  });

  it('binds owner hydration frames and remote updates to the opaque remote room, not the route id', async () => {
    const socket = new FakeSocket();
    const { provider } = createOwnerCandidateResources(ownerSession('lash-ticket.room-binding'), {
      createSocket: () => socket,
      refreshOwnerSession: vi.fn(),
    });
    const starting = provider.start();
    socket.readyState = 1;
    socket.emit('message', {
      data: JSON.stringify({
        type: 'room-ready',
        roomId: 'local-route-document',
        protocolVersion: 3,
      }),
    });
    await expect(starting).rejects.toMatchObject({ kind: 'protocol' });
    expect(provider.getTerminalReason()).toBe('protocol-error');
    expect(provider.getDocument().getText('body').toString()).toBe('');
  });

  it('rejects an owner update frame bound to the route id instead of the opaque room id', async () => {
    const socket = new FakeSocket();
    const { provider } = createOwnerCandidateResources(ownerSession('lash-ticket.update-binding'), {
      createSocket: () => socket,
      refreshOwnerSession: vi.fn(),
    });
    const starting = provider.start();
    socket.readyState = 1;
    socket.emit('message', { data: ownerRoomReady });
    socket.emit('message', { data: ownerHydrationComplete });
    await starting;

    socket.emit('message', {
      data: JSON.stringify({
        type: 'yjs-update',
        roomId: 'local-route-document',
        source: 'broadcast',
        update: encodedRemoteUpdate('must not apply'),
      }),
    });

    expect(provider.getTerminalReason()).toBe('protocol-error');
    expect(provider.getDocument().getText('body').toString()).toBe('');
  });

  it('refreshes owner authorization for automatic reconnect and fails closed on changed room', async () => {
    vi.useFakeTimers();
    try {
      const firstSocket = new FakeSocket();
      const secondSocket = new FakeSocket();
      const sockets = [firstSocket, secondSocket];
      const refreshOwnerSession = vi
        .fn()
        .mockResolvedValueOnce(ownerSession('lash-ticket.refreshed-ticket'))
        .mockResolvedValueOnce(
          ownerSession('lash-ticket.changed-room', {
            remoteDocumentId: 'different-opaque-room',
            socketUrl:
              'wss://realtime.example.test/api/realtime/rooms/different-opaque-room/socket?protocolVersion=3&actorId=actor-owner',
          }),
        );
      const createSocket = vi.fn(() => {
        const socket = sockets.shift();
        if (!socket) throw new Error('unexpected socket');
        return socket;
      });
      const { provider } = createOwnerCandidateResources(
        ownerSession('lash-ticket.initial-reconnect'),
        {
          createSocket,
          refreshOwnerSession,
        },
      );

      const starting = provider.start();
      firstSocket.emit('close', { code: 1006 });
      await vi.advanceTimersByTimeAsync(250);
      expect(refreshOwnerSession).toHaveBeenNthCalledWith(
        1,
        'local-route-document',
        expect.any(AbortSignal),
      );
      expect(createSocket).toHaveBeenNthCalledWith(2, expect.any(String), [
        'lash-realtime-v3',
        exactOwnerTicketProtocol('lash-ticket.refreshed-ticket'),
      ]);

      secondSocket.readyState = 1;
      secondSocket.emit('message', { data: ownerRoomReady });
      secondSocket.emit('message', { data: ownerHydrationComplete });
      await starting;

      secondSocket.emit('close', { code: 1006 });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(refreshOwnerSession).toHaveBeenNthCalledWith(
        2,
        'local-route-document',
        expect.any(AbortSignal),
      );
      expect(createSocket).toHaveBeenCalledTimes(2);
      expect(provider.getTerminalReason()).toBe('protocol-error');
      expect(provider.getSnapshot()).toMatchObject({
        canWrite: false,
        connectionState: 'offline',
        hydrated: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never reuses an owner ticket returned by refresh', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const initial = ownerSession('lash-ticket.single-use');
      const refreshOwnerSession = vi.fn().mockResolvedValue(initial);
      const createSocket = vi.fn(() => socket);
      const { provider } = createOwnerCandidateResources(initial, {
        createSocket,
        refreshOwnerSession,
      });

      const starting = provider.start();
      const rejected = expect(starting).rejects.toMatchObject({ kind: 'protocol' });
      socket.emit('close', { code: 1006 });
      await vi.advanceTimersByTimeAsync(250);

      expect(refreshOwnerSession).toHaveBeenCalledOnce();
      expect(createSocket).toHaveBeenCalledOnce();
      expect(provider.getTerminalReason()).toBe('protocol-error');
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [
      'snapshot binding',
      (session: OwnerRealtimeSessionV3) => ({
        ...session,
        promotionSnapshotSha256: 'J'.repeat(43),
      }),
    ],
    [
      'exact read-edit grant',
      (session: OwnerRealtimeSessionV3) =>
        ({
          ...session,
          capabilities: ['doc.read'],
        }) as unknown as OwnerRealtimeSessionV3,
    ],
    [
      'protocol version',
      (session: OwnerRealtimeSessionV3) =>
        ({
          ...session,
          protocolVersion: 2,
        }) as unknown as OwnerRealtimeSessionV3,
    ],
    [
      'bearer-free socket URL',
      (session: OwnerRealtimeSessionV3) => ({
        ...session,
        socketUrl: `${session.socketUrl}&accessToken=must-never-enter-a-url`,
      }),
    ],
  ])('fails closed when refreshed owner authorization changes its %s', async (_label, mutate) => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const initial = ownerSession(`lash-ticket.binding-${String(_label).replaceAll(' ', '-')}`);
      const refreshOwnerSession = vi
        .fn()
        .mockResolvedValue(
          mutate(ownerSession(`lash-ticket.refresh-${String(_label).replaceAll(' ', '-')}`)),
        );
      const createSocket = vi.fn(() => socket);
      const { provider } = createOwnerCandidateResources(initial, {
        createSocket,
        refreshOwnerSession,
      });

      const rejected = expect(provider.start()).rejects.toMatchObject({ kind: 'protocol' });
      socket.emit('close', { code: 1006 });
      await vi.advanceTimersByTimeAsync(250);

      expect(refreshOwnerSession).toHaveBeenCalledOnce();
      expect(createSocket).toHaveBeenCalledOnce();
      expect(provider.getTerminalReason()).toBe('protocol-error');
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps construction silent and deduplicates explicit start', async () => {
    const doc = createRealtimeDocument();
    const socket = new FakeSocket();
    const createSocket = vi.fn(() => socket);
    const provider = new LashRealtimeYjsProvider({ createSocket, doc, session });

    doc.getText('body').insert(0, 'before start');
    expect(createSocket).not.toHaveBeenCalled();
    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'connecting',
      hydrated: false,
      queuedUpdateCount: 0,
    });

    const first = provider.start();
    const second = provider.start();
    expect(second).toBe(first);
    expect(createSocket).toHaveBeenCalledOnce();

    socket.readyState = 1;
    socket.emit('open');
    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'connecting',
      hydrated: false,
    });

    socket.emit('message', { data: roomReady });
    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'hydrating',
      hydrated: false,
      syncState: 'hydrating',
    });
    expect(socket.sent).toEqual([]);

    socket.emit('message', { data: hydrationComplete });
    await first;
    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'connected',
      hydrated: true,
      syncState: 'saved',
    });
  });

  it('invokes injected hydration and reconnect timers without a receiver', async () => {
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    const sockets = [firstSocket, secondSocket];
    const handles = [101, 102, 103] as unknown as Array<ReturnType<typeof setTimeout>>;
    const scheduled: Array<{
      callback: () => void;
      delayMs: number;
      handle: ReturnType<typeof setTimeout>;
    }> = [];
    const cleared: Array<ReturnType<typeof setTimeout>> = [];
    const setTimeoutFn = function (
      this: unknown,
      callback: () => void,
      delayMs?: number,
    ): ReturnType<typeof setTimeout> {
      if (this !== undefined) throw new TypeError('Illegal invocation');
      const handle = handles[scheduled.length];
      if (handle === undefined) throw new Error('unexpected timer schedule');
      scheduled.push({ callback, delayMs: delayMs ?? 0, handle });
      return handle;
    } as typeof setTimeout;
    const clearTimeoutFn = function (this: unknown, handle: ReturnType<typeof setTimeout>) {
      if (this !== undefined) throw new TypeError('Illegal invocation');
      cleared.push(handle);
    } as typeof clearTimeout;
    const provider = new LashRealtimeYjsProvider({
      clearTimeoutFn,
      createSocket: () => {
        const socket = sockets.shift();
        if (!socket) throw new Error('unexpected socket');
        return socket;
      },
      doc: createRealtimeDocument(),
      session,
      setTimeoutFn,
    });

    const starting = provider.start();
    expect(scheduled).toEqual([{ callback: expect.any(Function), delayMs: 5_000, handle: 101 }]);

    firstSocket.emit('close', { code: 1006 });
    expect(scheduled).toEqual([
      { callback: expect.any(Function), delayMs: 5_000, handle: 101 },
      { callback: expect.any(Function), delayMs: 250, handle: 102 },
    ]);
    expect(cleared).toEqual([101]);

    provider.reconnectForTest();
    expect(scheduled).toEqual([
      { callback: expect.any(Function), delayMs: 5_000, handle: 101 },
      { callback: expect.any(Function), delayMs: 250, handle: 102 },
      { callback: expect.any(Function), delayMs: 5_000, handle: 103 },
    ]);
    expect(cleared).toEqual([101, 102]);

    secondSocket.readyState = 1;
    secondSocket.emit('open');
    secondSocket.emit('message', { data: roomReady });
    secondSocket.emit('message', { data: hydrationComplete });
    await starting;

    expect(cleared).toEqual([101, 102, 103]);
    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'connected',
      hydrated: true,
      syncState: 'saved',
    });
  });

  it('does not publish local updates or awareness until hydration completes', async () => {
    const doc = createRealtimeDocument();
    const socket = new FakeSocket();
    const provider = new LashRealtimeYjsProvider({
      createSocket: () => socket,
      doc,
      session,
    });
    const starting = provider.start();
    socket.readyState = 1;
    socket.emit('open');
    socket.emit('message', { data: roomReady });

    provider.setLocalSelection({ from: 1, to: 1 });
    doc.getText('body').insert(0, 'during hydration');
    expect(socket.sent).toEqual([]);

    socket.emit('message', { data: hydrationComplete });
    await starting;
    const postHydrationCount = socket.sent.length;
    expect(socket.sent.some((payload) => JSON.parse(payload).type === 'awareness-update')).toBe(
      true,
    );

    doc.getText('body').insert(0, 'after hydration');
    expect(socket.sent.length).toBeGreaterThan(postHydrationCount);
    expect(socket.sent.some((payload) => JSON.parse(payload).type === 'yjs-update')).toBe(true);
  });

  it('reports a Yjs title edit as Saved only after the exact update acknowledgement', async () => {
    const writeTitle = (
      realtimeMetadata as typeof realtimeMetadata & {
        writeRealtimeDocumentTitle?: (
          doc: ReturnType<typeof createRealtimeDocument>,
          title: string,
        ) => void;
      }
    ).writeRealtimeDocumentTitle;
    expect(typeof writeTitle).toBe('function');
    const doc = createRealtimeDocument();
    const socket = new FakeSocket();
    const provider = new LashRealtimeYjsProvider({
      createSocket: () => socket,
      doc,
      session,
    });
    const starting = provider.start();
    socket.readyState = 1;
    socket.emit('open');
    socket.emit('message', { data: roomReady });
    socket.emit('message', { data: hydrationComplete });
    await starting;

    writeTitle!(doc, 'Acknowledged shared title');
    const titleUpdate = socket.sent
      .map((payload) => JSON.parse(payload) as { type?: string; updateId?: string })
      .find((message) => message.type === 'yjs-update');
    expect(titleUpdate?.updateId).toBeTruthy();
    expect(provider.getSnapshot()).toMatchObject({
      pendingUpdateCount: 1,
      syncState: 'syncing',
    });

    socket.emit('message', {
      data: JSON.stringify({ type: 'sync-ack', updateId: titleUpdate?.updateId }),
    });

    expect(provider.getSnapshot()).toMatchObject({
      pendingUpdateCount: 0,
      syncState: 'saved',
    });
  });

  it('applies a live remote update after hydration without echoing or disconnecting', async () => {
    const doc = createRealtimeDocument();
    const socket = new FakeSocket();
    const provider = new LashRealtimeYjsProvider({
      createSocket: () => socket,
      doc,
      session,
    });
    const starting = provider.start();
    socket.readyState = 1;
    socket.emit('open');
    socket.emit('message', { data: roomReady });
    socket.emit('message', { data: hydrationComplete });
    await starting;
    const sentBeforeRemoteUpdate = socket.sent.length;

    socket.emit('message', {
      data: JSON.stringify({
        type: 'yjs-update',
        roomId: 'fixture-document',
        source: 'broadcast',
        update: encodedRemoteUpdate('live'),
      }),
    });

    expect(doc.getText('body').toString()).toBe('live');
    expect(socket.sent).toHaveLength(sentBeforeRemoteUpdate);
    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'connected',
      hydrated: true,
    });
  });

  it('requires exact room-ready ordering and hydration-complete protocol v2', async () => {
    const provider = new LashRealtimeYjsProvider({
      createSocket: () => new FakeSocket(),
      doc: createRealtimeDocument(),
      session,
    });
    const socket = (provider as unknown as { socket: FakeSocket | null }).socket;
    expect(socket).toBeNull();

    const starting = provider.start();
    const active = (provider as unknown as { socket: FakeSocket }).socket;
    active.readyState = 1;
    active.emit('open');
    active.emit('message', { data: hydrationComplete });

    await expect(starting).rejects.toThrow(/protocol/i);
    expect(provider.getSnapshot()).toMatchObject({
      hydrated: false,
      connectionState: 'offline',
    });
  });

  it('ignores a late socket completion after idempotent destroy', async () => {
    const socket = new FakeSocket();
    const provider = new LashRealtimeYjsProvider({
      createSocket: () => socket,
      doc: createRealtimeDocument(),
      session,
    });
    const starting = provider.start();
    provider.destroy();
    provider.destroy();

    socket.readyState = 1;
    socket.emit('open');
    socket.emit('message', { data: roomReady });
    socket.emit('message', { data: hydrationComplete });

    await expect(starting).rejects.toThrow(/destroyed/i);
    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'offline',
      hydrated: false,
    });
  });

  it('queues genuine offline edits after first hydration and flushes on explicit reconnect', async () => {
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    const sockets = [firstSocket, secondSocket];
    const provider = new LashRealtimeYjsProvider({
      createSocket: () => {
        const socket = sockets.shift();
        if (!socket) throw new Error('unexpected socket');
        return socket;
      },
      doc: createRealtimeDocument(),
      session,
    });
    const starting = provider.start();
    firstSocket.readyState = 1;
    firstSocket.emit('open');
    firstSocket.emit('message', { data: roomReady });
    firstSocket.emit('message', { data: hydrationComplete });
    await starting;

    firstSocket.readyState = 3;
    firstSocket.emit('close', { code: 1006 });
    provider.getDocument().getText('body').insert(0, 'queued');
    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'reconnecting',
      queuedUpdateCount: 1,
    });

    provider.reconnectForTest();
    secondSocket.readyState = 1;
    secondSocket.emit('open');
    secondSocket.emit('message', { data: roomReady });
    expect(secondSocket.sent).toEqual([]);
    secondSocket.emit('message', { data: hydrationComplete });

    await vi.waitFor(() =>
      expect(provider.getSnapshot()).toMatchObject({
        connectionState: 'connected',
        queuedUpdateCount: 0,
        pendingUpdateCount: 1,
      }),
    );
    expect(secondSocket.sent.some((payload) => JSON.parse(payload).type === 'yjs-update')).toBe(
      true,
    );

    const sentBeforeRemoteUpdate = secondSocket.sent.length;
    secondSocket.emit('message', {
      data: JSON.stringify({
        type: 'yjs-update',
        roomId: 'fixture-document',
        source: 'broadcast',
        update: encodedRemoteUpdate('remote after reconnect'),
      }),
    });
    expect(provider.getDocument().getText('body').toString()).toContain('remote after reconnect');
    expect(secondSocket.sent).toHaveLength(sentBeforeRemoteUpdate);
    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'connected',
      hydrated: true,
    });
  });

  it('retains and resends an unacknowledged update across disconnect and rehydration', async () => {
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    const sockets = [firstSocket, secondSocket];
    const provider = new LashRealtimeYjsProvider({
      createSocket: () => {
        const socket = sockets.shift();
        if (!socket) throw new Error('unexpected socket');
        return socket;
      },
      doc: createRealtimeDocument(),
      session,
    });
    const starting = provider.start();
    firstSocket.readyState = 1;
    firstSocket.emit('open');
    firstSocket.emit('message', { data: roomReady });
    firstSocket.emit('message', { data: hydrationComplete });
    await starting;

    provider.getDocument().getText('body').insert(0, 'must survive');
    const firstUpdate = firstSocket.sent
      .map(
        (payload) => JSON.parse(payload) as { type?: string; update?: string; updateId?: string },
      )
      .find((payload) => payload.type === 'yjs-update');
    expect(firstUpdate).toMatchObject({
      type: 'yjs-update',
      update: expect.any(String),
      updateId: expect.any(String),
    });
    expect(provider.getSnapshot()).toMatchObject({
      pendingUpdateCount: 1,
      queuedUpdateCount: 0,
      syncState: 'syncing',
    });

    provider.disconnectForTest();
    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'reconnecting',
      hydrated: false,
      pendingUpdateCount: 0,
      queuedUpdateCount: 1,
      syncState: 'reconnecting',
    });

    provider.reconnectForTest();
    secondSocket.readyState = 1;
    secondSocket.emit('open');
    secondSocket.emit('message', { data: roomReady });
    expect(secondSocket.sent).toEqual([]);
    secondSocket.emit('message', { data: hydrationComplete });

    const resent = secondSocket.sent
      .map(
        (payload) => JSON.parse(payload) as { type?: string; update?: string; updateId?: string },
      )
      .find((payload) => payload.type === 'yjs-update');
    expect(resent).toEqual(firstUpdate);
    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'connected',
      hydrated: true,
      pendingUpdateCount: 1,
      queuedUpdateCount: 0,
      syncState: 'syncing',
    });
  });

  it('rearms the hydration fence before publishing reconnect edits or awareness', async () => {
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    const sockets = [firstSocket, secondSocket];
    const provider = new LashRealtimeYjsProvider({
      createSocket: () => {
        const socket = sockets.shift();
        if (!socket) throw new Error('unexpected socket');
        return socket;
      },
      doc: createRealtimeDocument(),
      session,
    });
    const starting = provider.start();
    firstSocket.readyState = 1;
    firstSocket.emit('open');
    firstSocket.emit('message', { data: roomReady });
    firstSocket.emit('message', { data: hydrationComplete });
    await starting;

    provider.disconnectForTest();
    provider.reconnectForTest();
    secondSocket.readyState = 1;
    secondSocket.emit('open');
    secondSocket.emit('message', { data: roomReady });
    provider.setLocalSelection({ from: 2, to: 2 });
    provider.getDocument().getText('body').insert(0, 'fenced');

    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'hydrating',
      hydrated: false,
      queuedUpdateCount: 1,
      pendingUpdateCount: 0,
      syncState: 'hydrating',
    });
    expect(secondSocket.sent).toEqual([]);

    secondSocket.emit('message', { data: hydrationComplete });
    expect(secondSocket.sent.map((payload) => JSON.parse(payload).type)).toEqual([
      'yjs-update',
      'awareness-update',
    ]);
  });

  it('rejects a remote update that arrives before reconnect room-ready', async () => {
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    const sockets = [firstSocket, secondSocket];
    const provider = new LashRealtimeYjsProvider({
      createSocket: () => {
        const socket = sockets.shift();
        if (!socket) throw new Error('unexpected socket');
        return socket;
      },
      doc: createRealtimeDocument(),
      session,
    });
    const starting = provider.start();
    firstSocket.readyState = 1;
    firstSocket.emit('open');
    firstSocket.emit('message', { data: roomReady });
    firstSocket.emit('message', { data: hydrationComplete });
    await starting;

    provider.disconnectForTest();
    provider.reconnectForTest();
    secondSocket.readyState = 1;
    secondSocket.emit('open');
    secondSocket.emit('message', {
      data: JSON.stringify({
        type: 'yjs-update',
        roomId: 'fixture-document',
        source: 'broadcast',
        update: encodedRemoteUpdate('must not apply'),
      }),
    });

    expect(provider.getDocument().getText('body').toString()).toBe('');
    expect(provider.getTerminalReason()).toBe('protocol-error');
    expect(provider.getSnapshot()).toMatchObject({
      connectionState: 'offline',
      hydrated: false,
      syncState: 'offline',
    });
  });

  it('fails a socket that never opens within the five-second attempt budget', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const provider = new LashRealtimeYjsProvider({
      createSocket: () => socket,
      doc: createRealtimeDocument(),
      session,
    });
    let observedError: unknown = null;
    const starting = provider.start().catch((error: unknown) => {
      observedError = error;
    });

    await vi.advanceTimersByTimeAsync(5_001);
    const boundedError = observedError;
    provider.destroy();
    await starting;
    vi.useRealTimers();

    expect(boundedError).toMatchObject({ kind: 'transient-exhausted' });
  });

  it('keeps retrying a hydrated named editor after 15 seconds of transport failures', async () => {
    vi.useFakeTimers();
    const first = new FakeSocket();
    const healed = new FakeSocket();
    const doc = createRealtimeDocument();
    let networkAvailable = false;
    let renewal = 0;
    let socketAttempts = 0;
    const refreshOwnerSession = vi
      .fn(async () => namedSession(`renewed-${++renewal}`))
      .mockImplementationOnce(() => {
        throw new TypeError('Network is unavailable');
      })
      .mockRejectedValueOnce(new TypeError('Network is unavailable'));
    const createSocket = vi.fn(() => {
      if (socketAttempts++ === 0) return first;
      if (!networkAvailable) throw new TypeError('Socket transport is unavailable');
      return healed;
    });
    const provider = new LashRealtimeYjsProvider({
      createSocket,
      doc,
      refreshOwnerSession,
      session: namedSession('initial'),
    });

    try {
      const starting = provider.start();
      hydrateSocket(first, namedRoomId, 5);
      await starting;
      doc.getText('body').insert(0, 'sent while connected ');
      const unacknowledged = first.sent.map((message) => JSON.parse(message))
        .find((message) => message.type === 'yjs-update');
      first.emit('close', { code: 1006 });
      doc.getText('body').insert(doc.getText('body').length, 'queued while disconnected');

      await vi.advanceTimersByTimeAsync(15_000);
      expect(provider.getSnapshot()).toMatchObject({
        syncState: 'reconnecting',
        queuedUpdateCount: 2,
        pendingUpdateCount: 0,
      });
      networkAvailable = true;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(healed.sent).toEqual([]);
      expect(refreshOwnerSession.mock.calls.length).toBeGreaterThan(3);
      expect(createSocket).toHaveBeenLastCalledWith(
        expect.any(String),
        ['lash-realtime-v5', namedSession(`renewed-${renewal}`).ticketProtocol],
      );

      hydrateSocket(healed, namedRoomId, 5);
      const updates = healed.sent.map((message) => JSON.parse(message))
        .filter((message) => message.type === 'yjs-update');
      expect(updates).toHaveLength(2);
      expect(updates[0]).toMatchObject(unacknowledged);
      expect(new Set(updates.map((message) => message.updateId)).size).toBe(2);
      for (const { updateId } of updates) {
        healed.emit('message', {
          data: JSON.stringify({ type: 'sync-ack', roomId: namedRoomId, updateId }),
        });
      }
      expect(provider.getSnapshot()).toMatchObject({
        syncState: 'saved',
        queuedUpdateCount: 0,
        pendingUpdateCount: 0,
      });
      expect(doc.getText('body').toString()).toBe('sent while connected queued while disconnected');
    } finally {
      provider.destroy();
      doc.destroy();
      vi.useRealTimers();
    }
  });

  it('bounds in-flight transport attempts and wakes an editor on online or manual retry', async () => {
    vi.useFakeTimers();
    const eventTarget = new EventTarget();
    vi.stubGlobal('window', eventTarget);
    const first = new FakeSocket();
    const stalled = new FakeSocket();
    const healed = new FakeSocket();
    const doc = createRealtimeDocument();
    const refreshOwnerSession = vi.fn<[_: string, signal: AbortSignal], Promise<OwnerRealtimeSessionV3>>()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(ownerSession('online-wake'))
      .mockResolvedValueOnce(ownerSession('manual-wake'));
    const createSocket = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(stalled)
      .mockReturnValueOnce(healed);
    const provider = new LashRealtimeYjsProvider({
      createSocket,
      doc,
      refreshOwnerSession,
      session: ownerSession('before-going-online'),
    });

    try {
      const starting = provider.start();
      hydrateSocket(first, 'opaque-room-47', 3);
      await starting;
      first.emit('close', { code: 1006 });
      await vi.advanceTimersByTimeAsync(5_250);
      expect(refreshOwnerSession.mock.calls[0]?.[1].aborted).toBe(true);
      expect(refreshOwnerSession).toHaveBeenCalledTimes(1);

      eventTarget.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshOwnerSession).toHaveBeenCalledTimes(2);
      expect(stalled.readyState).toBe(0);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(stalled.readyState).toBe(3);
      expect(provider.getSnapshot().syncState).toBe('reconnecting');

      provider.reconnectNow();
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshOwnerSession).toHaveBeenCalledTimes(3);
      hydrateSocket(healed, 'opaque-room-47', 3);
      expect(provider.getSnapshot().syncState).toBe('saved');

      healed.emit('close', { code: 1006 });
      expect(provider.destroy()).toBe(true);
      eventTarget.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(refreshOwnerSession).toHaveBeenCalledTimes(3);
    } finally {
      provider.destroy();
      doc.destroy();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it.each([
    ['authorization', 'scope-mismatch'],
    ['protocol', 'protocol-error'],
  ] as const)('ends owner retries after definitive %s renewal failure', async (kind, reason) => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const doc = createRealtimeDocument();
    const refreshOwnerSession = vi.fn().mockRejectedValue(new RealtimeProviderStartError(kind, 'Denied'));
    const provider = new LashRealtimeYjsProvider({
      createSocket: () => socket,
      doc,
      refreshOwnerSession,
      session: ownerSession('before-terminal-renewal'),
    });

    try {
      const starting = provider.start();
      hydrateSocket(socket, 'opaque-room-47', 3);
      await starting;
      socket.emit('close', { code: 1006 });
      await vi.advanceTimersByTimeAsync(30_000);
      provider.reconnectNow();
      expect(provider.getTerminalReason()).toBe(reason);
      expect(provider.getSnapshot()).toMatchObject({ syncState: 'offline', canWrite: false });
      expect(refreshOwnerSession).toHaveBeenCalledTimes(1);
    } finally {
      provider.destroy();
      doc.destroy();
      vi.useRealTimers();
    }
  });

  it.each([
    [4401, 'invalid'],
    [4403, 'scope-mismatch'],
    [4409, 'protocol-error'],
  ] as const)(
    'fails closed without scheduling reconnect for terminal socket close %s',
    async (code, reason) => {
      const socket = new FakeSocket();
      const scheduled: Array<() => void> = [];
      const provider = new LashRealtimeYjsProvider({
        createSocket: () => socket,
        doc: createRealtimeDocument(),
        session,
        setTimeoutFn: ((callback: () => void) => {
          scheduled.push(callback);
          return scheduled.length as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout,
        clearTimeoutFn: vi.fn() as unknown as typeof clearTimeout,
      });
      const starting = provider.start();
      socket.readyState = 1;
      socket.emit('open');
      socket.emit('close', { code });
      await Promise.resolve();
      const terminalReason = (
        provider as unknown as { getTerminalReason?: () => string | null }
      ).getTerminalReason?.();
      const snapshot = provider.getSnapshot();
      provider.destroy();
      await starting.catch(() => undefined);

      expect(terminalReason).toBe(reason);
      expect(snapshot).toMatchObject({
        canWrite: false,
        connectionState: 'offline',
        hydrated: false,
        syncState: 'offline',
      });
      expect(scheduled).toHaveLength(1);
    },
  );

  it('treats a server scope mismatch as terminal instead of claiming Saved', async () => {
    const socket = new FakeSocket();
    const doc = createRealtimeDocument();
    const authority = createDocumentMutationAuthority('fixture-document');
    authority.enterRemoteHydrating();
    authority.enterRemoteReady({ canWrite: true });
    const authorizedEpoch = authority.getSnapshot().epoch;
    const provider = new LashRealtimeYjsProvider({
      authority,
      createSocket: () => socket,
      doc,
      session,
    });
    const starting = provider.start();
    socket.readyState = 1;
    socket.emit('open');
    socket.emit('message', { data: roomReady });
    socket.emit('message', { data: hydrationComplete });
    await starting;

    doc.getText('content').insert(0, 'unacknowledged local edit');
    const sentUpdate = socket.sent
      .map(
        (payload) => JSON.parse(payload) as { type?: string; update?: string; updateId?: string },
      )
      .find((message) => message.type === 'yjs-update');
    expect(sentUpdate?.updateId).toBeTruthy();
    expect(sentUpdate?.update).toBeTruthy();
    expect(provider.getSnapshot()).toMatchObject({
      queuedUpdateCount: 0,
      pendingUpdateCount: 1,
      syncState: 'syncing',
    });

    socket.emit('message', {
      data: JSON.stringify({ type: 'error', code: 'scope_mismatch' }),
    });

    expect(
      (provider as unknown as { getTerminalReason?: () => string | null }).getTerminalReason?.(),
    ).toBe('scope-mismatch');
    expect(provider.getSnapshot()).toMatchObject({
      canWrite: false,
      connectionState: 'offline',
      hydrated: false,
      pendingUpdateCount: 1,
      queuedUpdateCount: 0,
      syncState: 'offline',
    });
    expect(authority.getSnapshot()).toMatchObject({
      bodyWrite: false,
      epoch: authorizedEpoch + 1,
      phase: 'revoked',
    });

    const recovery = (
      provider as unknown as {
        getUnsyncedRecoverySnapshot(): {
          authorityEpoch: number;
          documentId: string;
          principalId: string;
          updates: Array<{ bytes: Uint8Array; updateId: string }>;
        };
      }
    ).getUnsyncedRecoverySnapshot();
    expect(recovery).toMatchObject({
      authorityEpoch: authorizedEpoch,
      documentId: 'fixture-document',
      principalId: 'actor-owner',
    });
    expect(recovery.updates).toHaveLength(1);
    expect(recovery.updates[0]?.updateId).toBe(sentUpdate?.updateId);
    expect(Buffer.from(recovery.updates[0]?.bytes ?? []).toString('base64')).toBe(
      sentUpdate?.update,
    );

    const sentAtBarrier = socket.sent.length;
    provider.reconnectNow();
    expect(socket.sent).toHaveLength(sentAtBarrier);
  });

  it('applies trusted same-document remote updates for a hydrated read-only grant', async () => {
    const readSession: AuthorizedRealtimeSession = {
      ...session,
      capabilities: ['doc.read'],
      scope: 'view',
    };
    const authority = createDocumentMutationAuthority('fixture-document');
    authority.enterRemoteHydrating();
    authority.enterRemoteReady({ canWrite: false });
    const socket = new FakeSocket();
    const doc = createRealtimeDocument();
    const provider = new LashRealtimeYjsProvider({
      authority,
      createSocket: () => socket,
      doc,
      session: readSession,
    });
    const starting = provider.start();
    socket.readyState = 1;
    socket.emit('open');
    socket.emit('message', { data: roomReady });
    socket.emit('message', { data: hydrationComplete });
    await starting;

    socket.emit('message', {
      data: JSON.stringify({
        type: 'yjs-update',
        roomId: 'fixture-document',
        source: 'broadcast',
        update: encodedRemoteUpdate('read projection'),
      }),
    });

    expect(doc.getText('body').toString()).toBe('read projection');
    expect(provider.getSnapshot()).toMatchObject({
      canWrite: false,
      hydrated: true,
      pendingUpdateCount: 0,
      queuedUpdateCount: 0,
      syncState: 'saved',
    });
  });

  it('synchronously seals queued and sent-unacknowledged bytes before any destructive cleanup', async () => {
    const socket = new FakeSocket();
    const doc = createRealtimeDocument();
    const authority = createDocumentMutationAuthority('fixture-document');
    authority.enterRemoteHydrating();
    authority.enterRemoteReady({ canWrite: true });
    const provider = new LashRealtimeYjsProvider({
      authority,
      createSocket: () => socket,
      doc,
      session,
    });
    const starting = provider.start();
    socket.readyState = 1;
    socket.emit('open');
    socket.emit('message', { data: roomReady });
    socket.emit('message', { data: hydrationComplete });
    await starting;

    doc.getText('content').insert(0, 'sent but not acknowledged');
    const sentUpdate = socket.sent
      .map(
        (payload) => JSON.parse(payload) as { type?: string; update?: string; updateId?: string },
      )
      .find((message) => message.type === 'yjs-update');
    socket.readyState = 3;
    doc.getText('content').insert(doc.getText('content').length, ' then queued');
    expect(provider.getSnapshot()).toMatchObject({
      pendingUpdateCount: 1,
      queuedUpdateCount: 1,
    });

    type Seal = {
      id: string;
      snapshot: {
        authorityEpoch: number;
        baselineStateVector: Uint8Array;
        documentId: string;
        principalId: string;
        reason: string;
        scope: string | null;
        updates: Array<{ bytes: Uint8Array; updateId: string }>;
      };
    };
    const lifecycleProvider = provider as unknown as {
      sealForRecovery(reason: 'lifecycle'): Seal;
      commitDestroy(
        seal: Seal,
        disposition: { kind: 'empty' } | { kind: 'verified-receipt'; record: unknown },
      ): boolean;
    };
    const seal = lifecycleProvider.sealForRecovery('lifecycle');

    expect(seal.snapshot).toMatchObject({
      documentId: 'fixture-document',
      principalId: 'actor-owner',
      reason: 'lifecycle',
      scope: 'edit',
    });
    expect(seal.snapshot.updates).toHaveLength(2);
    expect(new Set(seal.snapshot.updates.map(({ updateId }) => updateId)).size).toBe(2);
    expect(
      seal.snapshot.updates.some(
        ({ bytes, updateId }) =>
          updateId === sentUpdate?.updateId &&
          Buffer.from(bytes).toString('base64') === sentUpdate.update,
      ),
    ).toBe(true);
    expect(provider.getSnapshot()).toMatchObject({
      pendingUpdateCount: 0,
      queuedUpdateCount: 2,
    });

    const sentAtSeal = socket.sent.length;
    const textAtSeal = doc.getText('content').toString();
    socket.emit('message', {
      data: JSON.stringify({
        type: 'yjs-update',
        roomId: 'fixture-document',
        source: 'broadcast',
        update: encodedRemoteUpdate('late remote mutation'),
      }),
    });
    doc.getText('content').insert(doc.getText('content').length, ' local after seal');
    expect(doc.getText('content').toString()).toBe(`${textAtSeal} local after seal`);
    expect(socket.sent).toHaveLength(sentAtSeal);
    expect(provider.getSnapshot()).toMatchObject({
      pendingUpdateCount: 0,
      queuedUpdateCount: 2,
    });

    expect(lifecycleProvider.sealForRecovery('lifecycle')).toBe(seal);
    expect(lifecycleProvider.commitDestroy({ ...seal, id: 'stale-seal' }, { kind: 'empty' })).toBe(
      false,
    );
    expect(lifecycleProvider.commitDestroy(seal, { kind: 'empty' })).toBe(false);
    expect(provider.getSnapshot()).toMatchObject({
      pendingUpdateCount: 0,
      queuedUpdateCount: 2,
    });
  });
});
