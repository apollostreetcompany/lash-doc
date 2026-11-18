import { describe, expect, it } from 'vitest';

import {
  deriveDocumentClaimId,
  resolveOwnerSessionAlias,
} from '../../../realtime-worker/src/documentClaim';
import {
  OWNER_REALTIME_PROTOCOL_VERSION,
  OWNER_SOCKET_PROTOCOL,
  consumeOwnerSocketTicket,
  issueOwnerSocketTicket,
  parseOwnerSessionManagementRequest,
  parseOwnerSocketProtocols,
  type OwnerSessionAuthoritySnapshot,
  type OwnerSessionTicketRecord,
  type OwnerSessionTicketStore,
} from '../../../realtime-worker/src/ownerSession';

const PRINCIPAL = `account:v1:${'a'.repeat(43)}`;
const LOCAL_DOCUMENT_ID = 'doc-alpha';
const CLAIM_ID = 'claim-v1-9d05c49f61f58ffa69b8c098851879494c21aea1988e336055c1f646e9ad5543';
const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const SNAPSHOT_SHA = 's'.repeat(43);
const ACTOR_ID = 'owner-one';
const NOW = Date.parse('2026-07-30T00:00:00.000Z');

const request = {
  version: 1 as const,
  claimId: CLAIM_ID,
  ownerPrincipalId: PRINCIPAL,
  localDocumentId: LOCAL_DOCUMENT_ID,
  actorId: ACTOR_ID,
  protocolVersion: 3 as const,
};

const authority = (): OwnerSessionAuthoritySnapshot => ({
  roomId: ROOM_ID,
  ownerPrincipalId: PRINCIPAL,
  aclVersion: 1,
  promotionSnapshotSha256: SNAPSHOT_SHA,
  receiptSnapshotSha256: SNAPSHOT_SHA,
  title: 'Promoted title',
  bodyCanonicalJson:
    '{"content":[{"content":[{"text":"Promoted body","type":"text"}],"type":"paragraph"}],"type":"doc"}',
  initialUpdate:
    'AQTvjKbdDgAHAQdjb250ZW50AwlwYXJhZ3JhcGgHAO+Mpt0OAAYEAO+Mpt0OAQ1Qcm9tb3RlZCBib2R5KAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==',
  shareable: true,
});

class MemoryTicketStore implements OwnerSessionTicketStore {
  authority: OwnerSessionAuthoritySnapshot | null = authority();
  frozen = false;
  blockNewSessions = false;
  cutoffGeneration = 0;
  tickets = new Map<string, OwnerSessionTicketRecord>();
  managementRequests = new Set<string>();

  transaction<T>(callback: () => T): T {
    return callback();
  }

  readAuthority() {
    return this.authority ? structuredClone(this.authority) : null;
  }

  readControl() {
    return {
      frozen: this.frozen,
      blockNewSessions: this.blockNewSessions,
      cutoffGeneration: this.cutoffGeneration,
    };
  }

  readTicket(tokenHash: string) {
    const ticket = this.tickets.get(tokenHash);
    return ticket ? structuredClone(ticket) : null;
  }

  createTicket(ticket: OwnerSessionTicketRecord) {
    if (this.tickets.has(ticket.tokenHash)) throw new Error('ticket collision');
    this.tickets.set(ticket.tokenHash, structuredClone(ticket));
  }

  markTicketConsumed(tokenHash: string, consumedAt: string) {
    const ticket = this.tickets.get(tokenHash);
    if (!ticket || ticket.consumedAt !== null) return false;
    ticket.consumedAt = consumedAt;
    return true;
  }

  hasManagementRequest(requestId: string) {
    return this.managementRequests.has(requestId);
  }

  recordManagementRequest(input: { requestId: string }) {
    this.managementRequests.add(input.requestId);
  }
}

const issue = (store = new MemoryTicketStore()) =>
  issueOwnerSocketTicket({
    store,
    request,
    roomId: ROOM_ID,
    promotionSnapshotSha256: SNAPSHOT_SHA,
    nowMs: NOW,
    randomBytes: () => Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  });

describe('owner-session management parsing', () => {
  it('accepts only the exact claim-bound protocol-v3 body', async () => {
    await expect(deriveDocumentClaimId(PRINCIPAL, LOCAL_DOCUMENT_ID)).resolves.toBe(CLAIM_ID);
    await expect(parseOwnerSessionManagementRequest(request, CLAIM_ID)).resolves.toEqual({
      ok: true,
      request,
    });

    for (const invalid of [
      { ...request, claimId: `claim-v1-${'0'.repeat(64)}` },
      { ...request, ownerPrincipalId: `account:v1:${'b'.repeat(43)}` },
      { ...request, localDocumentId: ' padded' },
      { ...request, actorId: 'Owner One' },
      { ...request, actorId: `${'a'.repeat(97)}` },
      { ...request, protocolVersion: 2 },
      { ...request, capabilities: ['doc.read', 'doc.edit'] },
      { ...request, roomId: ROOM_ID },
    ]) {
      await expect(parseOwnerSessionManagementRequest(invalid, CLAIM_ID)).resolves.toEqual({
        ok: false,
        error: 'invalid-request',
      });
    }
  });

  it('resolves only the immutable exact alias and never accepts a remap hint', () => {
    const alias = {
      claimId: CLAIM_ID,
      ownerPrincipalId: PRINCIPAL,
      canonicalLocalDocumentId: LOCAL_DOCUMENT_ID,
      roomId: ROOM_ID,
      promotionSnapshotSha256: SNAPSHOT_SHA,
      createdAt: '2026-07-30T00:00:00.000Z',
    };
    expect(resolveOwnerSessionAlias(alias, request)).toEqual({
      ok: true,
      roomId: ROOM_ID,
      promotionSnapshotSha256: SNAPSHOT_SHA,
    });
    expect(resolveOwnerSessionAlias(null, request)).toMatchObject({
      ok: false,
      error: 'claim-not-found',
    });
    expect(
      resolveOwnerSessionAlias(
        { ...alias, ownerPrincipalId: `account:v1:${'b'.repeat(43)}` },
        request,
      ),
    ).toMatchObject({ ok: false, error: 'owner-mismatch' });
    expect(
      resolveOwnerSessionAlias({ ...alias, canonicalLocalDocumentId: 'other-doc' }, request),
    ).toMatchObject({ ok: false, error: 'claim-conflict' });
  });
});

describe('owner-session room authority and ticket', () => {
  it('issues exactly one bounded random read+edit ticket after literal authority readback', async () => {
    const store = new MemoryTicketStore();
    await expect(issue(store)).resolves.toEqual({
      ok: true,
      version: 1,
      roomId: ROOM_ID,
      ownerPrincipalId: PRINCIPAL,
      promotionSnapshotSha256: SNAPSHOT_SHA,
      grant: {
        source: 'owner',
        capabilities: ['doc.read', 'doc.edit'],
        aclVersion: 1,
        protocolVersion: OWNER_REALTIME_PROTOCOL_VERSION,
      },
      socket: {
        path: `/api/realtime/rooms/${ROOM_ID}/socket?protocolVersion=3&actorId=${ACTOR_ID}`,
        ticket: 'lash-ticket.AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA',
        expiresAt: '2026-07-30T00:01:00.000Z',
      },
    });
    expect(store.tickets.size).toBe(1);
    const [stored] = [...store.tickets.values()];
    expect(stored).toMatchObject({
      roomId: ROOM_ID,
      ownerPrincipalId: PRINCIPAL,
      actorId: ACTOR_ID,
      protocolVersion: 3,
      aclVersion: 1,
      capabilities: ['doc.read', 'doc.edit'],
      consumedAt: null,
    });
    expect(JSON.stringify(stored)).not.toContain('AQIDBAUG');
  });

  it.each([
    ['missing authority', (store: MemoryTicketStore) => (store.authority = null), 'claim-conflict'],
    [
      'owner mismatch',
      (store: MemoryTicketStore) => {
        store.authority = { ...authority(), ownerPrincipalId: `account:v1:${'b'.repeat(43)}` };
      },
      'owner-mismatch',
    ],
    [
      'room mismatch',
      (store: MemoryTicketStore) => {
        store.authority = { ...authority(), roomId: `doc-v1-${'b'.repeat(64)}` };
      },
      'claim-conflict',
    ],
    [
      'snapshot mismatch',
      (store: MemoryTicketStore) => {
        store.authority = { ...authority(), promotionSnapshotSha256: 'x'.repeat(43) };
      },
      'claim-conflict',
    ],
    [
      'not shareable',
      (store: MemoryTicketStore) => {
        store.authority = { ...authority(), shareable: false };
      },
      'not-shareable',
    ],
    [
      'frozen',
      (store: MemoryTicketStore) => {
        store.frozen = true;
      },
      'not-shareable',
    ],
    [
      'cut off',
      (store: MemoryTicketStore) => {
        store.blockNewSessions = true;
      },
      'not-shareable',
    ],
    [
      'unreadable projection',
      (store: MemoryTicketStore) => {
        store.authority = { ...authority(), bodyCanonicalJson: '{' };
      },
      'readback-failed',
    ],
    [
      'internally inconsistent projection',
      (store: MemoryTicketStore) => {
        store.authority = {
          ...authority(),
          bodyCanonicalJson:
            '{"content":[{"content":[{"text":"Different body","type":"text"}],"type":"paragraph"}],"type":"doc"}',
        };
      },
      'readback-failed',
    ],
  ])('does not issue for %s', async (_label, mutate, error) => {
    const store = new MemoryTicketStore();
    mutate(store);
    await expect(issue(store)).resolves.toMatchObject({ ok: false, error });
    expect(store.tickets.size).toBe(0);
  });

  it('parses only the exact two ordered owner subprotocols', () => {
    const ticket = 'lash-ticket.AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
    expect(parseOwnerSocketProtocols(`${OWNER_SOCKET_PROTOCOL}, ${ticket}`)).toEqual({
      ok: true,
      ticket,
      token: ticket.slice('lash-ticket.'.length),
    });
    for (const header of [
      null,
      ticket,
      `${ticket}, ${OWNER_SOCKET_PROTOCOL}`,
      `${OWNER_SOCKET_PROTOCOL}, ${ticket}, extra`,
      `${OWNER_SOCKET_PROTOCOL}, lash-ticket.${'a'.repeat(42)}`,
      `${OWNER_SOCKET_PROTOCOL}, lash-ticket.${'a'.repeat(43)}=`,
    ]) {
      expect(parseOwnerSocketProtocols(header)).toEqual({ ok: false });
    }
  });

  it('atomically consumes once and rejects expiry, binding changes, and broadened capabilities', async () => {
    const store = new MemoryTicketStore();
    const issued = await issue(store);
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error('expected ticket');
    const ticket = issued.socket.ticket;
    const consume = (overrides: Record<string, unknown> = {}) =>
      consumeOwnerSocketTicket({
        store,
        token: ticket.slice('lash-ticket.'.length),
        roomId: ROOM_ID,
        actorId: ACTOR_ID,
        protocolVersion: 3,
        nowMs: NOW + 1,
        ...overrides,
      });

    const [first, second] = await Promise.all([consume(), consume()]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].filter((result) => !result.ok)).toHaveLength(1);

    for (const overrides of [
      { roomId: `doc-v1-${'b'.repeat(64)}` },
      { actorId: 'other-owner' },
      { protocolVersion: 2 },
      { nowMs: NOW + 60_000 },
    ]) {
      const freshStore = new MemoryTicketStore();
      const fresh = await issue(freshStore);
      if (!fresh.ok) throw new Error('expected ticket');
      await expect(
        consumeOwnerSocketTicket({
          store: freshStore,
          token: fresh.socket.ticket.slice('lash-ticket.'.length),
          roomId: ROOM_ID,
          actorId: ACTOR_ID,
          protocolVersion: 3,
          nowMs: NOW + 1,
          ...overrides,
        }),
      ).resolves.toEqual({ ok: false, error: 'invalid-ticket' });
    }

    const broadenedStore = new MemoryTicketStore();
    const broadened = await issue(broadenedStore);
    if (!broadened.ok) throw new Error('expected ticket');
    const [record] = [...broadenedStore.tickets.values()];
    record.capabilities = ['doc.read', 'doc.edit', 'doc.share'] as never;
    await expect(
      consumeOwnerSocketTicket({
        store: broadenedStore,
        token: broadened.socket.ticket.slice('lash-ticket.'.length),
        roomId: ROOM_ID,
        actorId: ACTOR_ID,
        protocolVersion: 3,
        nowMs: NOW + 1,
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid-ticket' });
  });

  it('rejects an unconsumed ticket after the current authority ACL advances', async () => {
    const store = new MemoryTicketStore();
    const issued = await issue(store);
    if (!issued.ok) throw new Error('expected ticket');
    store.authority = { ...authority(), aclVersion: 2 };

    await expect(
      consumeOwnerSocketTicket({
        store,
        token: issued.socket.ticket.slice('lash-ticket.'.length),
        roomId: ROOM_ID,
        actorId: ACTOR_ID,
        protocolVersion: 3,
        nowMs: NOW + 1,
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid-ticket' });
    expect([...store.tickets.values()][0]?.consumedAt).toBeNull();
  });
});
