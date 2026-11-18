import type {
  PublicControlSessionFailureV1,
  PublicControlSessionRequestV1,
  PublicControlSessionResultV1,
  PublicDocumentAccessModeV1,
} from '@lash/types';

import { isRealtimeUpdatePayload } from './persistence';

export const PUBLIC_REALTIME_PROTOCOL_VERSION = 4 as const;
export const PUBLIC_SOCKET_PROTOCOL = 'lash-realtime-v4' as const;
export const PUBLIC_TICKET_TTL_MS = 60_000;
export const PUBLIC_RATE_KEY_LIMIT_PER_MINUTE = 30;
export const PUBLIC_ROOM_LIMIT_PER_MINUTE = 300;
export const PUBLIC_CAPABILITIES = ['doc.read'] as const;

const ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const ACTOR_ID = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/u;
const RATE_KEY = /^rate-v1-[A-Za-z0-9_-]{43}$/u;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TICKET_PROTOCOL = /^lash-public-ticket\.([A-Za-z0-9_-]{43})$/u;

const exactKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const parseOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.origin === value &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === ''
      ? url.origin
      : null;
  } catch {
    return null;
  }
};

export type PublicControlSessionRequestDecision =
  | { ok: true; request: PublicControlSessionRequestV1 }
  | { ok: false; error: 'invalid-request' };

export const parsePublicControlSessionRequest = (
  value: unknown,
  expectedRoomId: string,
): PublicControlSessionRequestDecision => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'version',
      'roomId',
      'actorId',
      'protocolVersion',
      'browserOrigin',
      'rateKey',
    ]) ||
    value.version !== 1 ||
    typeof value.roomId !== 'string' ||
    value.roomId !== expectedRoomId ||
    !ROOM_ID.test(value.roomId) ||
    typeof value.actorId !== 'string' ||
    !ACTOR_ID.test(value.actorId) ||
    value.protocolVersion !== PUBLIC_REALTIME_PROTOCOL_VERSION ||
    parseOrigin(value.browserOrigin) === null ||
    typeof value.rateKey !== 'string' ||
    !RATE_KEY.test(value.rateKey)
  ) {
    return { ok: false, error: 'invalid-request' };
  }
  return {
    ok: true,
    request: {
      version: 1,
      roomId: value.roomId,
      actorId: value.actorId,
      protocolVersion: PUBLIC_REALTIME_PROTOCOL_VERSION,
      browserOrigin: value.browserOrigin as string,
      rateKey: value.rateKey,
    },
  };
};

export interface PublicSessionAuthority {
  roomId: string;
  shareable: boolean;
  projectionSnapshotSha256: string;
  receiptSnapshotSha256: string;
  initialUpdate: string;
  mode: PublicDocumentAccessModeV1 | 'restricted';
  policyVersion: number;
  cutoffGeneration: number;
}

export interface PublicSocketTicketRecord {
  tokenHash: string;
  requestId: string;
  roomId: string;
  actorId: string;
  browserOrigin: string;
  protocolVersion: typeof PUBLIC_REALTIME_PROTOCOL_VERSION;
  mode: PublicDocumentAccessModeV1;
  policyVersion: number;
  cutoffGeneration: number;
  capabilities: ['doc.read'];
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  invalidatedAt: string | null;
}

export interface PublicSessionStore {
  transaction<T>(callback: () => T): T;
  readAuthority(): PublicSessionAuthority | null;
  hasRequest(requestId: string): boolean;
  recordRequest(requestId: string, bodySha256: string, createdAt: string): void;
  incrementRate(
    rateKey: string,
    roomId: string,
    windowStartMs: number,
    updatedAt: string,
  ): { rateKeyCount: number; roomCount: number };
  createTicket(ticket: PublicSocketTicketRecord): void;
  readTicket(tokenHash: string): PublicSocketTicketRecord | null;
  consumeTicket(tokenHash: string, consumedAt: string): boolean;
}

const failure = (error: PublicControlSessionFailureV1['error']): PublicControlSessionFailureV1 =>
  ({
    ok: false,
    version: 1,
    error,
    retryable:
      error === 'rate-limited' || error === 'readback-failed' || error === 'internal-error',
  }) as PublicControlSessionFailureV1;

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const sha256Hex = async (value: string) =>
  bytesToHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
  );

const validAuthority = (
  authority: PublicSessionAuthority | null,
  roomId: string,
): authority is PublicSessionAuthority & { mode: PublicDocumentAccessModeV1 } =>
  authority !== null &&
  authority.roomId === roomId &&
  ROOM_ID.test(authority.roomId) &&
  authority.shareable === true &&
  BASE64URL_SHA256.test(authority.projectionSnapshotSha256) &&
  authority.projectionSnapshotSha256 === authority.receiptSnapshotSha256 &&
  typeof authority.initialUpdate === 'string' &&
  isRealtimeUpdatePayload(authority.initialUpdate) &&
  (authority.mode === 'read' || authority.mode === 'comment') &&
  Number.isSafeInteger(authority.policyVersion) &&
  authority.policyVersion >= 1 &&
  Number.isSafeInteger(authority.cutoffGeneration) &&
  authority.cutoffGeneration >= 0;

const validTicket = (ticket: PublicSocketTicketRecord) =>
  SHA256_HEX.test(ticket.tokenHash) &&
  LOWERCASE_UUID_V4.test(ticket.requestId) &&
  ROOM_ID.test(ticket.roomId) &&
  ACTOR_ID.test(ticket.actorId) &&
  parseOrigin(ticket.browserOrigin) !== null &&
  ticket.protocolVersion === PUBLIC_REALTIME_PROTOCOL_VERSION &&
  (ticket.mode === 'read' || ticket.mode === 'comment') &&
  Number.isSafeInteger(ticket.policyVersion) &&
  ticket.policyVersion >= 1 &&
  Number.isSafeInteger(ticket.cutoffGeneration) &&
  ticket.cutoffGeneration >= 0 &&
  ticket.capabilities.length === 1 &&
  ticket.capabilities[0] === 'doc.read' &&
  Number.isFinite(Date.parse(ticket.issuedAt)) &&
  new Date(ticket.issuedAt).toISOString() === ticket.issuedAt &&
  Number.isFinite(Date.parse(ticket.expiresAt)) &&
  new Date(ticket.expiresAt).toISOString() === ticket.expiresAt &&
  (ticket.consumedAt === null ||
    (Number.isFinite(Date.parse(ticket.consumedAt)) &&
      new Date(ticket.consumedAt).toISOString() === ticket.consumedAt)) &&
  (ticket.invalidatedAt === null ||
    (Number.isFinite(Date.parse(ticket.invalidatedAt)) &&
      new Date(ticket.invalidatedAt).toISOString() === ticket.invalidatedAt));

export const issuePublicSocketTicket = async (input: {
  store: PublicSessionStore;
  request: PublicControlSessionRequestV1;
  requestId: string;
  bodySha256: string;
  nowMs: number;
  randomBytes: () => Uint8Array;
}): Promise<PublicControlSessionResultV1> => {
  if (
    !LOWERCASE_UUID_V4.test(input.requestId) ||
    !BASE64URL_SHA256.test(input.bodySha256) ||
    !Number.isSafeInteger(input.nowMs)
  ) {
    return failure('internal-error');
  }
  const parsed = parsePublicControlSessionRequest(input.request, input.request.roomId);
  if (!parsed.ok) return failure('invalid-request');

  let random: Uint8Array;
  try {
    random = input.randomBytes();
  } catch {
    return failure('internal-error');
  }
  if (!(random instanceof Uint8Array) || random.byteLength !== 32) {
    return failure('internal-error');
  }
  const token = bytesToBase64Url(random);
  if (!BASE64URL_SHA256.test(token)) return failure('internal-error');
  const tokenHash = await sha256Hex(token);
  const issuedAt = new Date(input.nowMs).toISOString();
  const expiresAt = new Date(input.nowMs + PUBLIC_TICKET_TTL_MS).toISOString();
  const windowStartMs = Math.floor(input.nowMs / 60_000) * 60_000;

  try {
    return input.store.transaction<PublicControlSessionResultV1>(() => {
      if (input.store.hasRequest(input.requestId)) return failure('replay-detected');
      input.store.recordRequest(input.requestId, input.bodySha256, issuedAt);
      const counts = input.store.incrementRate(
        input.request.rateKey,
        input.request.roomId,
        windowStartMs,
        issuedAt,
      );
      if (
        counts.rateKeyCount > PUBLIC_RATE_KEY_LIMIT_PER_MINUTE ||
        counts.roomCount > PUBLIC_ROOM_LIMIT_PER_MINUTE
      ) {
        return failure('rate-limited');
      }
      const authority = input.store.readAuthority();
      if (!validAuthority(authority, input.request.roomId)) {
        return failure('document-unavailable');
      }
      const ticket: PublicSocketTicketRecord = {
        tokenHash,
        requestId: input.requestId,
        roomId: input.request.roomId,
        actorId: input.request.actorId,
        browserOrigin: input.request.browserOrigin,
        protocolVersion: PUBLIC_REALTIME_PROTOCOL_VERSION,
        mode: authority.mode,
        policyVersion: authority.policyVersion,
        cutoffGeneration: authority.cutoffGeneration,
        capabilities: [...PUBLIC_CAPABILITIES],
        issuedAt,
        expiresAt,
        consumedAt: null,
        invalidatedAt: null,
      };
      input.store.createTicket(ticket);
      const readback = input.store.readTicket(tokenHash);
      if (
        !readback ||
        !validTicket(readback) ||
        JSON.stringify(readback) !== JSON.stringify(ticket)
      ) {
        throw new Error('public ticket readback mismatch');
      }
      return {
        ok: true,
        version: 1,
        authorization: {
          roomId: input.request.roomId,
          mode: authority.mode,
          policyVersion: authority.policyVersion,
          cutoffGeneration: authority.cutoffGeneration,
        },
        grant: {
          source: 'public',
          capabilities: [...PUBLIC_CAPABILITIES],
          protocolVersion: PUBLIC_REALTIME_PROTOCOL_VERSION,
        },
        socket: {
          path: `/api/realtime/rooms/${input.request.roomId}/socket?protocolVersion=4&actorId=${encodeURIComponent(input.request.actorId)}`,
          protocol: PUBLIC_SOCKET_PROTOCOL,
          ticketProtocol: `lash-public-ticket.${token}`,
          expiresAt,
        },
      };
    });
  } catch {
    return failure('internal-error');
  }
};

export type PublicSocketProtocolDecision =
  | { ok: true; ticketProtocol: string; token: string }
  | { ok: false };

export const parsePublicSocketProtocols = (header: string | null): PublicSocketProtocolDecision => {
  if (!header) return { ok: false };
  const values = header.split(',').map((value) => value.trim());
  if (values.length !== 2 || values[0] !== PUBLIC_SOCKET_PROTOCOL) return { ok: false };
  const match = TICKET_PROTOCOL.exec(values[1] ?? '');
  return match ? { ok: true, ticketProtocol: values[1]!, token: match[1]! } : { ok: false };
};

export type PublicSocketConsumeDecision =
  | {
      ok: true;
      grant: {
        actorId: string;
        roomId: string;
        browserOrigin: string;
        mode: PublicDocumentAccessModeV1;
        policyVersion: number;
        cutoffGeneration: number;
        capabilities: ['doc.read'];
        protocolVersion: typeof PUBLIC_REALTIME_PROTOCOL_VERSION;
      };
    }
  | { ok: false; error: 'invalid-ticket' };

export const consumePublicSocketTicket = async (input: {
  store: PublicSessionStore;
  token: string;
  roomId: string;
  actorId: string;
  browserOrigin: string;
  protocolVersion: number;
  nowMs: number;
}): Promise<PublicSocketConsumeDecision> => {
  if (
    !BASE64URL_SHA256.test(input.token) ||
    !ROOM_ID.test(input.roomId) ||
    !ACTOR_ID.test(input.actorId) ||
    parseOrigin(input.browserOrigin) === null ||
    input.protocolVersion !== PUBLIC_REALTIME_PROTOCOL_VERSION ||
    !Number.isSafeInteger(input.nowMs)
  ) {
    return { ok: false, error: 'invalid-ticket' };
  }
  const tokenHash = await sha256Hex(input.token);
  try {
    return input.store.transaction<PublicSocketConsumeDecision>(() => {
      const ticket = input.store.readTicket(tokenHash);
      const authority = input.store.readAuthority();
      if (
        !ticket ||
        !validTicket(ticket) ||
        ticket.consumedAt !== null ||
        ticket.invalidatedAt !== null ||
        ticket.roomId !== input.roomId ||
        ticket.actorId !== input.actorId ||
        ticket.browserOrigin !== input.browserOrigin ||
        ticket.protocolVersion !== PUBLIC_REALTIME_PROTOCOL_VERSION ||
        ticket.expiresAt <= new Date(input.nowMs).toISOString() ||
        !validAuthority(authority, input.roomId) ||
        authority.mode !== ticket.mode ||
        authority.policyVersion !== ticket.policyVersion ||
        authority.cutoffGeneration !== ticket.cutoffGeneration ||
        !input.store.consumeTicket(tokenHash, new Date(input.nowMs).toISOString())
      ) {
        return { ok: false, error: 'invalid-ticket' };
      }
      return {
        ok: true,
        grant: {
          actorId: ticket.actorId,
          roomId: ticket.roomId,
          browserOrigin: ticket.browserOrigin,
          mode: ticket.mode,
          policyVersion: ticket.policyVersion,
          cutoffGeneration: ticket.cutoffGeneration,
          capabilities: [...PUBLIC_CAPABILITIES],
          protocolVersion: PUBLIC_REALTIME_PROTOCOL_VERSION,
        },
      };
    });
  } catch {
    return { ok: false, error: 'invalid-ticket' };
  }
};
