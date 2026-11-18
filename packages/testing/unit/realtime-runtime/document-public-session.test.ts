import { describe, expect, it } from 'vitest';

import {
  consumePublicSocketTicket,
  issuePublicSocketTicket,
  parsePublicControlSessionRequest,
  parsePublicSocketProtocols,
  type PublicSessionAuthority,
  type PublicSessionStore,
  type PublicSocketTicketRecord,
} from '../../../realtime-worker/src/publicSession';

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const ACTOR_ID = 'public-reader';
const ORIGIN = 'https://lash.example';
const RATE_KEY = `rate-v1-${'r'.repeat(43)}`;
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const BODY_SHA = 'b'.repeat(43);
const TOKEN = 't'.repeat(43);
const INITIAL_UPDATE =
  'AQTvjKbdDgAHAQdjb250ZW50AwlwYXJhZ3JhcGgHAO+Mpt0OAAYEAO+Mpt0OAQ1Qcm9tb3RlZCBib2R5KAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';

const request = {
  version: 1 as const,
  roomId: ROOM_ID,
  actorId: ACTOR_ID,
  protocolVersion: 4 as const,
  browserOrigin: ORIGIN,
  rateKey: RATE_KEY,
};

class MemoryPublicSessionStore implements PublicSessionStore {
  authority: PublicSessionAuthority | null = {
    roomId: ROOM_ID,
    shareable: true,
    projectionSnapshotSha256: 'p'.repeat(43),
    receiptSnapshotSha256: 'p'.repeat(43),
    initialUpdate: INITIAL_UPDATE,
    mode: 'read',
    policyVersion: 2,
    cutoffGeneration: 1,
  };
  readonly tickets = new Map<string, PublicSocketTicketRecord>();
  readonly requests = new Set<string>();
  rateKeyCount = 0;
  roomCount = 0;

  transaction<T>(callback: () => T): T {
    return callback();
  }

  readAuthority() {
    return this.authority ? structuredClone(this.authority) : null;
  }

  hasRequest(requestId: string) {
    return this.requests.has(requestId);
  }

  recordRequest(requestId: string) {
    this.requests.add(requestId);
  }

  incrementRate(_rateKey: string, _roomId: string) {
    this.rateKeyCount += 1;
    this.roomCount += 1;
    return { rateKeyCount: this.rateKeyCount, roomCount: this.roomCount };
  }

  createTicket(ticket: PublicSocketTicketRecord) {
    this.tickets.set(ticket.tokenHash, structuredClone(ticket));
  }

  readTicket(tokenHash: string) {
    const ticket = this.tickets.get(tokenHash);
    return ticket ? structuredClone(ticket) : null;
  }

  consumeTicket(tokenHash: string, consumedAt: string) {
    const ticket = this.tickets.get(tokenHash);
    if (!ticket || ticket.consumedAt !== null || ticket.invalidatedAt !== null) return false;
    ticket.consumedAt = consumedAt;
    return true;
  }
}

const issue = (
  store: MemoryPublicSessionStore,
  overrides: Partial<Parameters<typeof issuePublicSocketTicket>[0]> = {},
) =>
  issuePublicSocketTicket({
    store,
    request,
    requestId: REQUEST_ID,
    bodySha256: BODY_SHA,
    nowMs: Date.parse('2026-07-30T00:00:00.000Z'),
    randomBytes: () => new TextEncoder().encode('t'.repeat(32)),
    ...overrides,
  });

describe('public protocol-v4 session authority', () => {
  it('parses only the exact room/actor/origin/rate-key request and makes Edit absent', () => {
    expect(parsePublicControlSessionRequest(request, ROOM_ID)).toEqual({
      ok: true,
      request,
    });
    for (const invalid of [
      { ...request, mode: 'edit' },
      { ...request, capabilities: ['doc.edit'] },
      { ...request, protocolVersion: 3 },
      { ...request, browserOrigin: 'https://lash.example/path' },
      { ...request, browserOrigin: 'javascript:alert(1)' },
      { ...request, rateKey: `rate-v1.${'r'.repeat(43)}` },
      { ...request, roomId: `doc-v1-${'b'.repeat(64)}` },
      { ...request, extra: true },
    ]) {
      expect(parsePublicControlSessionRequest(invalid, ROOM_ID)).toEqual({
        ok: false,
        error: 'invalid-request',
      });
    }
  });

  it('issues read and comment as the same exact read-only grant with hash-only storage', async () => {
    for (const mode of ['read', 'comment'] as const) {
      const store = new MemoryPublicSessionStore();
      store.authority!.mode = mode;
      const result = await issue(store);
      expect(result).toEqual({
        ok: true,
        version: 1,
        authorization: {
          roomId: ROOM_ID,
          mode,
          policyVersion: 2,
          cutoffGeneration: 1,
        },
        grant: {
          source: 'public',
          capabilities: ['doc.read'],
          protocolVersion: 4,
        },
        socket: {
          path: `/api/realtime/rooms/${ROOM_ID}/socket?protocolVersion=4&actorId=${ACTOR_ID}`,
          protocol: 'lash-realtime-v4',
          ticketProtocol: expect.stringMatching(/^lash-public-ticket\.[A-Za-z0-9_-]{43}$/u),
          expiresAt: '2026-07-30T00:01:00.000Z',
        },
      });
      expect([...store.tickets.keys()]).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/u)]);
      expect(JSON.stringify([...store.tickets.values()])).not.toContain(TOKEN);
      expect([...store.tickets.values()][0]).toMatchObject({
        roomId: ROOM_ID,
        actorId: ACTOR_ID,
        browserOrigin: ORIGIN,
        protocolVersion: 4,
        mode,
        policyVersion: 2,
        cutoffGeneration: 1,
        capabilities: ['doc.read'],
        requestId: REQUEST_ID,
        consumedAt: null,
        invalidatedAt: null,
      });
    }
  });

  it('fails unavailable for restricted, missing, incomplete, or unshareable authority', async () => {
    for (const authority of [
      null,
      { ...new MemoryPublicSessionStore().authority!, shareable: false },
      { ...new MemoryPublicSessionStore().authority!, mode: 'restricted' as const },
      {
        ...new MemoryPublicSessionStore().authority!,
        receiptSnapshotSha256: 'x'.repeat(43),
      },
      { ...new MemoryPublicSessionStore().authority!, initialUpdate: '' },
    ]) {
      const store = new MemoryPublicSessionStore();
      store.authority = authority;
      await expect(issue(store)).resolves.toEqual({
        ok: false,
        version: 1,
        error: 'document-unavailable',
        retryable: false,
      });
      expect(store.tickets.size).toBe(0);
    }
  });

  it('rejects request replay and enforces both persisted minute limits', async () => {
    const replay = new MemoryPublicSessionStore();
    expect((await issue(replay)).ok).toBe(true);
    await expect(issue(replay)).resolves.toEqual({
      ok: false,
      version: 1,
      error: 'replay-detected',
      retryable: false,
    });

    for (const [rateKeyCount, roomCount] of [
      [30, 1],
      [1, 300],
    ]) {
      const store = new MemoryPublicSessionStore();
      store.rateKeyCount = rateKeyCount;
      store.roomCount = roomCount;
      await expect(issue(store)).resolves.toEqual({
        ok: false,
        version: 1,
        error: 'rate-limited',
        retryable: true,
      });
      expect(store.tickets.size).toBe(0);
    }
  });

  it('parses the fixed/ticket protocols and consumes once with exact current bindings', async () => {
    const store = new MemoryPublicSessionStore();
    const issued = await issue(store);
    if (!issued.ok) throw new Error('expected ticket');
    const parsed = parsePublicSocketProtocols(
      `${issued.socket.protocol}, ${issued.socket.ticketProtocol}`,
    );
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) throw new Error('expected protocols');

    await expect(
      consumePublicSocketTicket({
        store,
        token: parsed.token,
        roomId: ROOM_ID,
        actorId: ACTOR_ID,
        browserOrigin: ORIGIN,
        protocolVersion: 4,
        nowMs: Date.parse('2026-07-30T00:00:30.000Z'),
      }),
    ).resolves.toEqual({
      ok: true,
      grant: {
        actorId: ACTOR_ID,
        roomId: ROOM_ID,
        browserOrigin: ORIGIN,
        mode: 'read',
        policyVersion: 2,
        cutoffGeneration: 1,
        capabilities: ['doc.read'],
        protocolVersion: 4,
      },
    });
    await expect(
      consumePublicSocketTicket({
        store,
        token: parsed.token,
        roomId: ROOM_ID,
        actorId: ACTOR_ID,
        browserOrigin: ORIGIN,
        protocolVersion: 4,
        nowMs: Date.parse('2026-07-30T00:00:31.000Z'),
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid-ticket' });
  });

  it('rejects expiry and every wrong room/actor/origin/protocol/mode/version/cutoff binding', async () => {
    for (const change of [
      { roomId: `doc-v1-${'b'.repeat(64)}` },
      { actorId: 'other-reader' },
      { browserOrigin: 'https://other.example' },
      { protocolVersion: 3 },
      { authority: { mode: 'comment' as const } },
      { authority: { policyVersion: 3 } },
      { authority: { cutoffGeneration: 2 } },
      { nowMs: Date.parse('2026-07-30T00:01:00.000Z') },
    ]) {
      const store = new MemoryPublicSessionStore();
      const issued = await issue(store);
      if (!issued.ok) throw new Error('expected ticket');
      const parsed = parsePublicSocketProtocols(
        `${issued.socket.protocol},${issued.socket.ticketProtocol}`,
      );
      if (!parsed.ok) throw new Error('expected protocols');
      if (change.authority) Object.assign(store.authority!, change.authority);
      await expect(
        consumePublicSocketTicket({
          store,
          token: parsed.token,
          roomId: change.roomId ?? ROOM_ID,
          actorId: change.actorId ?? ACTOR_ID,
          browserOrigin: change.browserOrigin ?? ORIGIN,
          protocolVersion: change.protocolVersion ?? 4,
          nowMs: change.nowMs ?? Date.parse('2026-07-30T00:00:30.000Z'),
        }),
      ).resolves.toEqual({ ok: false, error: 'invalid-ticket' });
    }
  });
});
