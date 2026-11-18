import type { OwnerSessionManagementFailureV1, OwnerSessionManagementRequestV1 } from '@lash/types';

import { deriveDocumentClaimId } from './documentClaim';
import { base64ToBytes, isRealtimeUpdatePayload } from './persistence';
import { canonicalizePromotionJson, projectionMatchesInitialUpdate } from './promotion';

export const OWNER_REALTIME_PROTOCOL_VERSION = 3 as const;
export const OWNER_SOCKET_PROTOCOL = 'lash-realtime-v3' as const;
export const OWNER_SESSION_TICKET_TTL_MS = 60_000;
export const OWNER_CAPABILITIES = ['doc.read', 'doc.edit'] as const;

const ACCOUNT_PRINCIPAL = /^account:v1:[A-Za-z0-9_-]{43}$/u;
const CLAIM_ID = /^claim-v1-[0-9a-f]{64}$/u;
const LOCAL_DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const ACTOR_ID = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/u;
const DOCUMENT_ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const TICKET_PROTOCOL = /^lash-ticket\.([A-Za-z0-9_-]{43})$/u;

export const isCanonicalOwnerActorId = (value: unknown): value is string =>
  typeof value === 'string' && ACTOR_ID.test(value);

const exactKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
};

export type OwnerSessionRequestParseDecision =
  | { ok: true; request: OwnerSessionManagementRequestV1 }
  | { ok: false; error: 'invalid-request' };

export const parseOwnerSessionManagementRequest = async (
  value: unknown,
  expectedClaimId: string,
): Promise<OwnerSessionRequestParseDecision> => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'version',
      'claimId',
      'ownerPrincipalId',
      'localDocumentId',
      'actorId',
      'protocolVersion',
    ]) ||
    value.version !== 1 ||
    typeof value.claimId !== 'string' ||
    value.claimId !== expectedClaimId ||
    !CLAIM_ID.test(value.claimId) ||
    typeof value.ownerPrincipalId !== 'string' ||
    !ACCOUNT_PRINCIPAL.test(value.ownerPrincipalId) ||
    typeof value.localDocumentId !== 'string' ||
    !LOCAL_DOCUMENT_ID.test(value.localDocumentId) ||
    !isCanonicalOwnerActorId(value.actorId) ||
    value.protocolVersion !== OWNER_REALTIME_PROTOCOL_VERSION
  ) {
    return { ok: false, error: 'invalid-request' };
  }
  if (
    (await deriveDocumentClaimId(value.ownerPrincipalId, value.localDocumentId)) !== value.claimId
  ) {
    return { ok: false, error: 'invalid-request' };
  }
  return {
    ok: true,
    request: {
      version: 1,
      claimId: value.claimId,
      ownerPrincipalId: value.ownerPrincipalId,
      localDocumentId: value.localDocumentId,
      actorId: value.actorId,
      protocolVersion: OWNER_REALTIME_PROTOCOL_VERSION,
    },
  };
};

export type OwnerSessionTerminalError =
  | 'claim-not-found'
  | 'claim-conflict'
  | 'owner-mismatch'
  | 'not-shareable';

export type OwnerSessionFailure = OwnerSessionManagementFailureV1;

export interface OwnerRoomSessionSuccessV1 {
  ok: true;
  version: 1;
  roomId: string;
  ownerPrincipalId: string;
  promotionSnapshotSha256: string;
  grant: {
    source: 'owner';
    capabilities: ['doc.read', 'doc.edit'];
    aclVersion: number;
    protocolVersion: typeof OWNER_REALTIME_PROTOCOL_VERSION;
  };
  socket: {
    path: string;
    ticket: string;
    expiresAt: string;
  };
}

export type OwnerSessionResult = OwnerRoomSessionSuccessV1 | OwnerSessionFailure;

export interface OwnerSessionAuthoritySnapshot {
  roomId: string;
  ownerPrincipalId: string;
  aclVersion: number;
  promotionSnapshotSha256: string;
  receiptSnapshotSha256: string;
  title: string;
  bodyCanonicalJson: string;
  initialUpdate: string;
  shareable: boolean;
}

export interface OwnerSessionControlState {
  frozen: boolean;
  blockNewSessions: boolean;
  cutoffGeneration: number;
}

export interface OwnerSessionTicketRecord {
  tokenHash: string;
  roomId: string;
  ownerPrincipalId: string;
  actorId: string;
  protocolVersion: typeof OWNER_REALTIME_PROTOCOL_VERSION;
  aclVersion: number;
  capabilities: ['doc.read', 'doc.edit'];
  promotionSnapshotSha256: string;
  cutoffGeneration: number;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface OwnerSessionTicketStore {
  transaction<T>(callback: () => T): T;
  readAuthority(): OwnerSessionAuthoritySnapshot | null;
  readControl(): OwnerSessionControlState;
  readTicket(tokenHash: string): OwnerSessionTicketRecord | null;
  createTicket(ticket: OwnerSessionTicketRecord): void;
  markTicketConsumed(tokenHash: string, consumedAt: string): boolean;
  hasManagementRequest(requestId: string): boolean;
  recordManagementRequest(input: {
    requestId: string;
    bodySha256: string;
    ownerPrincipalId: string;
    createdAt: string;
  }): void;
}

const failure = (
  error: OwnerSessionTerminalError | 'readback-failed' | 'internal-error',
): OwnerSessionFailure =>
  error === 'readback-failed' || error === 'internal-error'
    ? { ok: false, version: 1, error, retryable: true }
    : { ok: false, version: 1, error, retryable: false };

const isReadableAuthority = (authority: OwnerSessionAuthoritySnapshot) => {
  if (
    !DOCUMENT_ROOM_ID.test(authority.roomId) ||
    !ACCOUNT_PRINCIPAL.test(authority.ownerPrincipalId) ||
    !Number.isSafeInteger(authority.aclVersion) ||
    authority.aclVersion < 1 ||
    !BASE64URL_SHA256.test(authority.promotionSnapshotSha256) ||
    !BASE64URL_SHA256.test(authority.receiptSnapshotSha256) ||
    authority.promotionSnapshotSha256 !== authority.receiptSnapshotSha256 ||
    typeof authority.title !== 'string' ||
    authority.title.normalize('NFC') !== authority.title ||
    typeof authority.bodyCanonicalJson !== 'string' ||
    typeof authority.initialUpdate !== 'string' ||
    typeof authority.shareable !== 'boolean'
  ) {
    return false;
  }
  try {
    return (
      canonicalizePromotionJson(JSON.parse(authority.bodyCanonicalJson)) ===
        authority.bodyCanonicalJson &&
      isRealtimeUpdatePayload(authority.initialUpdate) &&
      projectionMatchesInitialUpdate(
        base64ToBytes(authority.initialUpdate),
        authority.title,
        authority.bodyCanonicalJson,
      )
    );
  } catch {
    return false;
  }
};

const validateAuthority = (
  authority: OwnerSessionAuthoritySnapshot | null,
  control: OwnerSessionControlState,
  expected: {
    roomId: string;
    ownerPrincipalId: string;
    promotionSnapshotSha256: string;
  },
): OwnerSessionFailure | null => {
  if (!authority) return failure('claim-conflict');
  if (authority.ownerPrincipalId !== expected.ownerPrincipalId) return failure('owner-mismatch');
  if (
    authority.roomId !== expected.roomId ||
    authority.promotionSnapshotSha256 !== expected.promotionSnapshotSha256 ||
    authority.receiptSnapshotSha256 !== expected.promotionSnapshotSha256
  ) {
    return failure('claim-conflict');
  }
  if (!authority.shareable || control.frozen || control.blockNewSessions) {
    return failure('not-shareable');
  }
  if (!isReadableAuthority(authority)) return failure('readback-failed');
  if (!Number.isSafeInteger(control.cutoffGeneration) || control.cutoffGeneration < 0) {
    return failure('readback-failed');
  }
  return null;
};

export const issueOwnerSocketTicket = async (input: {
  store: OwnerSessionTicketStore;
  request: OwnerSessionManagementRequestV1;
  roomId: string;
  promotionSnapshotSha256: string;
  nowMs: number;
  randomBytes: () => Uint8Array;
  requestId?: string;
  bodySha256?: string;
}): Promise<OwnerSessionResult> => {
  if (
    !DOCUMENT_ROOM_ID.test(input.roomId) ||
    !BASE64URL_SHA256.test(input.promotionSnapshotSha256) ||
    !Number.isSafeInteger(input.nowMs) ||
    (input.requestId === undefined) !== (input.bodySha256 === undefined) ||
    (input.requestId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        input.requestId,
      )) ||
    (input.bodySha256 !== undefined && !BASE64URL_SHA256.test(input.bodySha256))
  ) {
    return failure('internal-error');
  }
  let tokenBytes: Uint8Array;
  try {
    tokenBytes = input.randomBytes();
  } catch {
    return failure('internal-error');
  }
  if (!(tokenBytes instanceof Uint8Array) || tokenBytes.byteLength !== 32) {
    return failure('internal-error');
  }
  const token = bytesToBase64Url(tokenBytes);
  if (!BASE64URL_SHA256.test(token)) return failure('internal-error');
  const tokenHash = await sha256Hex(token);
  const issuedAt = new Date(input.nowMs).toISOString();
  const expiresAt = new Date(input.nowMs + OWNER_SESSION_TICKET_TTL_MS).toISOString();

  try {
    const outcome = input.store.transaction<OwnerSessionFailure | OwnerRoomSessionSuccessV1>(() => {
      if (input.requestId && input.store.hasManagementRequest(input.requestId)) {
        return failure('claim-conflict');
      }
      const authority = input.store.readAuthority();
      const control = input.store.readControl();
      const invalid = validateAuthority(authority, control, {
        roomId: input.roomId,
        ownerPrincipalId: input.request.ownerPrincipalId,
        promotionSnapshotSha256: input.promotionSnapshotSha256,
      });
      if (invalid) return invalid;
      if (!authority) return failure('claim-conflict');
      input.store.createTicket({
        tokenHash,
        roomId: input.roomId,
        ownerPrincipalId: input.request.ownerPrincipalId,
        actorId: input.request.actorId,
        protocolVersion: OWNER_REALTIME_PROTOCOL_VERSION,
        aclVersion: authority.aclVersion,
        capabilities: [...OWNER_CAPABILITIES],
        promotionSnapshotSha256: input.promotionSnapshotSha256,
        cutoffGeneration: control.cutoffGeneration,
        issuedAt,
        expiresAt,
        consumedAt: null,
      });
      const readback = input.store.readTicket(tokenHash);
      if (
        !readback ||
        readback.tokenHash !== tokenHash ||
        readback.roomId !== input.roomId ||
        readback.ownerPrincipalId !== input.request.ownerPrincipalId ||
        readback.actorId !== input.request.actorId ||
        readback.protocolVersion !== OWNER_REALTIME_PROTOCOL_VERSION ||
        readback.aclVersion !== authority.aclVersion ||
        readback.capabilities.length !== 2 ||
        readback.capabilities[0] !== 'doc.read' ||
        readback.capabilities[1] !== 'doc.edit' ||
        readback.promotionSnapshotSha256 !== input.promotionSnapshotSha256 ||
        readback.cutoffGeneration !== control.cutoffGeneration ||
        readback.issuedAt !== issuedAt ||
        readback.expiresAt !== expiresAt ||
        readback.consumedAt !== null
      ) {
        throw new Error('ticket readback mismatch');
      }
      if (input.requestId && input.bodySha256) {
        input.store.recordManagementRequest({
          requestId: input.requestId,
          bodySha256: input.bodySha256,
          ownerPrincipalId: input.request.ownerPrincipalId,
          createdAt: issuedAt,
        });
      }
      return {
        ok: true,
        version: 1,
        roomId: input.roomId,
        ownerPrincipalId: input.request.ownerPrincipalId,
        promotionSnapshotSha256: input.promotionSnapshotSha256,
        grant: {
          source: 'owner',
          capabilities: [...OWNER_CAPABILITIES],
          aclVersion: authority.aclVersion,
          protocolVersion: OWNER_REALTIME_PROTOCOL_VERSION,
        },
        socket: {
          path: `/api/realtime/rooms/${input.roomId}/socket?protocolVersion=3&actorId=${input.request.actorId}`,
          ticket: `lash-ticket.${token}`,
          expiresAt,
        },
      };
    });
    return outcome;
  } catch {
    return failure('internal-error');
  }
};

export type OwnerSocketProtocolDecision =
  | { ok: true; ticket: string; token: string }
  | { ok: false };

export const parseOwnerSocketProtocols = (header: string | null): OwnerSocketProtocolDecision => {
  if (!header) return { ok: false };
  const values = header.split(',').map((value) => value.trim());
  if (values.length !== 2 || values[0] !== OWNER_SOCKET_PROTOCOL) return { ok: false };
  const match = TICKET_PROTOCOL.exec(values[1] ?? '');
  return match ? { ok: true, ticket: values[1]!, token: match[1]! } : { ok: false };
};

export type OwnerSocketConsumeDecision =
  | {
      ok: true;
      grant: {
        actorId: string;
        roomId: string;
        capabilities: ['doc.read', 'doc.edit'];
        aclVersion: number;
        protocolVersion: typeof OWNER_REALTIME_PROTOCOL_VERSION;
      };
    }
  | { ok: false; error: 'invalid-ticket' };

export const consumeOwnerSocketTicket = async (input: {
  store: OwnerSessionTicketStore;
  token: string;
  roomId: string;
  actorId: string;
  protocolVersion: number;
  nowMs: number;
}): Promise<OwnerSocketConsumeDecision> => {
  if (
    !BASE64URL_SHA256.test(input.token) ||
    !DOCUMENT_ROOM_ID.test(input.roomId) ||
    !ACTOR_ID.test(input.actorId) ||
    input.protocolVersion !== OWNER_REALTIME_PROTOCOL_VERSION ||
    !Number.isSafeInteger(input.nowMs)
  ) {
    return { ok: false, error: 'invalid-ticket' };
  }
  const tokenHash = await sha256Hex(input.token);
  try {
    return input.store.transaction<OwnerSocketConsumeDecision>(() => {
      const ticket = input.store.readTicket(tokenHash);
      if (
        !ticket ||
        ticket.consumedAt !== null ||
        ticket.roomId !== input.roomId ||
        ticket.actorId !== input.actorId ||
        ticket.protocolVersion !== OWNER_REALTIME_PROTOCOL_VERSION ||
        ticket.capabilities.length !== 2 ||
        ticket.capabilities[0] !== 'doc.read' ||
        ticket.capabilities[1] !== 'doc.edit' ||
        ticket.expiresAt <= new Date(input.nowMs).toISOString()
      ) {
        return { ok: false, error: 'invalid-ticket' };
      }
      const control = input.store.readControl();
      if (
        control.frozen ||
        control.blockNewSessions ||
        control.cutoffGeneration !== ticket.cutoffGeneration
      ) {
        return { ok: false, error: 'invalid-ticket' };
      }
      const authority = input.store.readAuthority();
      const invalid = validateAuthority(authority, control, {
        roomId: ticket.roomId,
        ownerPrincipalId: ticket.ownerPrincipalId,
        promotionSnapshotSha256: ticket.promotionSnapshotSha256,
      });
      if (
        invalid ||
        !authority ||
        authority.aclVersion !== ticket.aclVersion ||
        !input.store.markTicketConsumed(tokenHash, new Date(input.nowMs).toISOString())
      ) {
        return { ok: false, error: 'invalid-ticket' };
      }
      return {
        ok: true,
        grant: {
          actorId: ticket.actorId,
          roomId: ticket.roomId,
          capabilities: [...OWNER_CAPABILITIES],
          aclVersion: ticket.aclVersion,
          protocolVersion: OWNER_REALTIME_PROTOCOL_VERSION,
        },
      };
    });
  } catch {
    return { ok: false, error: 'invalid-ticket' };
  }
};
