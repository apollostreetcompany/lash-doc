import type {
  PublicDocumentAccessModeV1,
  PublicRoomHydrationCompleteFrameV1,
  PublicRoomReadyFrameV1,
} from '@lash/types';
import { DurableObject } from 'cloudflare:workers';
import type * as Y from 'yjs';

import {
  REALTIME_PROTOCOL_VERSION,
  type RealtimeCapability,
  type RealtimeInviteScope,
} from './access';
import {
  commitCollaboratorReviewOperation,
  initializeCollaboratorReviewStorage,
  readCollaboratorReviewSnapshot,
} from './collaboratorReviewStore';
import { isCurrentRoomSuggestion, prepareRoomSuggestionDecision } from './collaboratorSuggestion';
import {
  NAMED_EDIT_CAPABILITIES,
  NAMED_EDIT_PROTOCOL_VERSION,
  NAMED_EDIT_REQUEST_LIMIT,
  NAMED_EDIT_SOCKET_PROTOCOL,
  isNamedEditActorId,
  isNamedEditInviteId,
  isNamedEditOrigin,
  isNamedEditPrincipal,
  isNamedEditRoomId,
  namedEditEnabled,
  namedEditFailure,
  namedEditResponse,
  parseNamedEditCommand,
  parseNamedEditSocketProtocols,
  type NamedEditAction,
} from './namedEdit';
import {
  applyNamedEditYjsUpdate,
  applyRoomYjsUpdate,
  encodePublicYjsProjection,
  encodeRoomYjsStateVector,
  isSafePublicYjsProjection,
  loadRoomYjsProjection,
  readCanonicalRoomYjsBody,
} from './namedEditProjection';
import {
  consumeNamedEditTicket,
  executeNamedEdit,
  initializeNamedEditStorage,
  isCurrentNamedEditGrant,
  type NamedEditGrant,
} from './namedEditStore';
import {
  OWNER_REALTIME_PROTOCOL_VERSION,
  OWNER_SOCKET_PROTOCOL,
  consumeOwnerSocketTicket,
  issueOwnerSocketTicket,
  parseOwnerSessionManagementRequest,
  parseOwnerSocketProtocols,
  type OwnerSessionAuthoritySnapshot,
  type OwnerSessionControlState,
  type OwnerSessionTicketRecord,
  type OwnerSessionTicketStore,
} from './ownerSession';
import {
  REALTIME_SNAPSHOT_INTERVAL,
  REALTIME_UPDATE_BASE64_LIMIT,
  buildPromotedHydrationUpdates,
  bytesToBase64,
  encodeRealtimeCheckpoint,
  isRealtimeUpdatePayload,
  shouldCompactRealtimeUpdates,
  type PersistedRealtimeSnapshot,
  type PersistedRealtimeUpdate,
  type RealtimeUpdateSource,
} from './persistence';
import {
  executeDocumentPromotion,
  parseDocumentPromotionRequest,
  readPromotionBody,
  type DocumentPromotionStore,
  type StoredDocumentPromotionV1,
} from './promotion';
import {
  createPublicComment,
  listPublicComments,
  moderatePublicComment,
  parsePublicCommentCreateRequest,
  parsePublicCommentListRequest,
  parsePublicCommentModerationRequest,
  type PublicCommentAuthority,
  type PublicCommentModerationReceipt,
  type PublicCommentModerationStore,
  type PublicCommentStore,
  type StoredPublicCommentV1,
} from './publicComment';
import {
  parsePublicPolicyReadRequest,
  parsePublicPolicyUpdateRequest,
  readOwnerPublicPolicy,
  updateOwnerPublicPolicy,
  type PublicPolicyAuthoritySnapshot,
  type PublicPolicyMutationReceipt,
  type PublicPolicyRoomResult,
  type PublicPolicyState,
  type PublicPolicyStore,
} from './publicPolicy';
import {
  PUBLIC_CAPABILITIES,
  PUBLIC_REALTIME_PROTOCOL_VERSION,
  PUBLIC_SOCKET_PROTOCOL,
  consumePublicSocketTicket,
  issuePublicSocketTicket,
  parsePublicControlSessionRequest,
  parsePublicSocketProtocols,
  type PublicSessionAuthority,
  type PublicSessionStore,
  type PublicSocketTicketRecord,
} from './publicSession';
import { REALTIME_RUNTIME, normalizeRoomName } from './routing';
import {
  appendSharedHistoryEdit,
  initializeSharedHistoryStorage,
  parseSharedHistoryCommand,
  resolveSharedHistoryRequest,
  sharedHistoryGeneration,
} from './sharedHistory';

export { REALTIME_PROTOCOL_VERSION } from './access';

const PROTOCOL_UPGRADE_CLOSE_CODE = 4409;
const PROTOCOL_UPGRADE_CLOSE_REASON = 'protocol-upgrade-required';
const OPEN_SOCKET_READY_STATE = 1;

type AwarenessSelection = {
  from: number;
  to: number;
};

type AwarenessState = {
  actorId: string;
  label: string;
  color: string;
  selection: AwarenessSelection | null;
  updatedAt: number;
  connection: 'online';
};

type StandardSocketAttachment = {
  protocolVersion:
    | typeof REALTIME_PROTOCOL_VERSION
    | typeof OWNER_REALTIME_PROTOCOL_VERSION
    | typeof NAMED_EDIT_PROTOCOL_VERSION;
  hydrated: boolean;
  actorId: string;
  roomId: string;
  capabilities: RealtimeCapability[];
  scope?: RealtimeInviteScope;
  namedEditGrant?: NamedEditGrant;
  historyGeneration?: number;
  connectedAt: number;
  awareness?: AwarenessState;
};

export interface PublicSocketAttachment {
  protocolVersion: typeof PUBLIC_REALTIME_PROTOCOL_VERSION;
  hydrated: boolean;
  actorId: string;
  roomId: string;
  capabilities: ['doc.read'];
  mode: PublicDocumentAccessModeV1;
  policyVersion: number;
  cutoffGeneration: number;
  browserOrigin: string;
  connectedAt: number;
  scope?: undefined;
  awareness?: undefined;
  namedEditGrant?: undefined;
  historyGeneration?: undefined;
}

type SocketAttachment = StandardSocketAttachment | PublicSocketAttachment;

type ClientMessage = {
  type?: string;
  requestId?: string;
  payload?: unknown;
  update?: unknown;
  updateId?: unknown;
  awareness?: unknown;
  operationId?: unknown;
  operation?: unknown;
  historyGeneration?: unknown;
};

type UpdateRow = {
  sequence: number;
  actor_id: string;
  source: RealtimeUpdateSource;
  update_b64: string;
  created_at: string;
};

type SnapshotRow = {
  sequence: number;
  update_b64: string;
  created_at: string;
};

type PromotionRow = {
  room_id: string;
  owner_principal_id: string;
  acl_version: number;
  public_policy: string;
  public_policy_version: number;
  idempotency_hash: string;
  title: string;
  body_canonical_json: string;
  body_sha256: string;
  initial_update_b64: string;
  initial_update_sha256: string;
  snapshot_sha256: string;
  adjunct_comments: number;
  adjunct_suggestions: number;
  shareable: number;
};

type OwnerSessionAuthorityRow = {
  room_id: string;
  owner_principal_id: string;
  acl_version: number;
  projection_snapshot_sha256: string;
  receipt_snapshot_sha256: string;
  title: string;
  body_canonical_json: string;
  initial_update_b64: string;
  shareable: number;
};

type OwnerSessionTicketRow = {
  token_hash: string;
  room_id: string;
  owner_principal_id: string;
  actor_id: string;
  protocol_version: number;
  acl_version: number;
  capabilities_json: string;
  promotion_snapshot_sha256: string;
  cutoff_generation: number;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
};

type PublicPolicyAuthorityRow = {
  room_id: string;
  owner_principal_id: string;
  shareable: number;
};

type PublicPolicyRow = {
  mode: string;
  policy_version: number;
  cutoff_generation: number;
};

type PublicPolicyMutationRow = {
  mutation_id: string;
  request_body_sha256: string;
  owner_principal_id: string;
  requested_mode: string;
  expected_policy_version: number;
  result_mode: string;
  result_policy_version: number;
  result_cutoff_generation: number;
  result_changed: number;
  created_at: string;
};

type PublicSessionAuthorityRow = {
  room_id: string;
  shareable: number;
  projection_snapshot_sha256: string;
  receipt_snapshot_sha256: string;
  initial_update_b64: string;
  mode: string;
  policy_version: number;
  cutoff_generation: number;
};

type PublicSocketTicketRow = {
  token_hash: string;
  request_id: string;
  room_id: string;
  actor_id: string;
  browser_origin: string;
  protocol_version: number;
  mode: string;
  policy_version: number;
  cutoff_generation: number;
  capabilities_json: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  invalidated_at: string | null;
};

type PublicCommentRow = {
  sequence: number;
  comment_id: string;
  room_id: string;
  author_principal_id: string;
  author_alias: string;
  mutation_id: string;
  mutation_body_sha256: string;
  body: string;
  policy_version: number;
  cutoff_generation: number;
  created_at: string;
  visibility: string;
  hidden_at: string | null;
  hidden_by_principal_id: string | null;
};

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, {
    ...init,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...init.headers,
    },
  });

const isRealtimeCapability = (value: unknown): value is RealtimeCapability =>
  value === 'doc.read' || value === 'doc.edit';

const isRealtimeScope = (value: unknown): value is RealtimeInviteScope =>
  value === 'view' || value === 'comment' || value === 'suggest' || value === 'edit';

const publicPolicyStatusFor = (result: PublicPolicyRoomResult) => {
  if (result.ok) return 200;
  if (result.error === 'claim-not-found') return 404;
  if (
    result.error === 'claim-conflict' ||
    result.error === 'owner-mismatch' ||
    result.error === 'not-shareable' ||
    result.error === 'policy-conflict' ||
    result.error === 'replay-detected'
  ) {
    return 409;
  }
  return 500;
};

const isNormalizedAttachmentId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && normalizeRoomName(value) === value;

const isCanonicalOrigin = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.includes(',')) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.origin === value &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
};

const hasConsistentAttachmentCapabilities = (
  capabilities: RealtimeCapability[],
  scope: RealtimeInviteScope | undefined,
) => {
  const unique = new Set(capabilities);
  if (unique.size !== capabilities.length || !unique.has('doc.read')) return false;
  if (scope === 'view' || scope === 'comment' || scope === 'suggest') {
    return !unique.has('doc.edit');
  }
  if (scope === 'edit') return unique.has('doc.edit');
  return true;
};

const parseClientMessage = (message: string | ArrayBuffer): ClientMessage | null => {
  if (typeof message !== 'string') {
    return { type: 'binary', payload: message.byteLength };
  }
  if (message.length > REALTIME_UPDATE_BASE64_LIMIT + 16_384) return null;

  try {
    const parsed = JSON.parse(message) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as ClientMessage;
  } catch {
    return null;
  }
};

const parsePublicPing = (
  message: string | ArrayBuffer,
): { ok: true; requestId: string | null } | { ok: false } => {
  if (typeof message !== 'string' || new TextEncoder().encode(message).byteLength > 512) {
    return { ok: false };
  }
  try {
    const value = JSON.parse(message) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (
      record.type !== 'ping' ||
      !(
        (keys.length === 1 && keys[0] === 'type') ||
        (keys.length === 2 && keys[0] === 'requestId' && keys[1] === 'type')
      ) ||
      (record.requestId !== undefined &&
        (typeof record.requestId !== 'string' ||
          record.requestId.length === 0 ||
          record.requestId.length > 128))
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      requestId: typeof record.requestId === 'string' ? record.requestId : null,
    };
  } catch {
    return { ok: false };
  }
};

const isValidYjsUpdate = (update: string) => {
  return isRealtimeUpdatePayload(update);
};

const capabilitiesFromQuery = (value: string | null): RealtimeCapability[] =>
  (value ?? '')
    .split(',')
    .filter(
      (capability): capability is RealtimeCapability =>
        capability === 'doc.read' || capability === 'doc.edit',
    );

const scopeFromQuery = (value: string | null): RealtimeInviteScope | undefined =>
  value === 'view' || value === 'comment' || value === 'suggest' || value === 'edit'
    ? value
    : undefined;

const isAwarenessSelection = (value: unknown): value is AwarenessSelection => {
  if (!value || typeof value !== 'object') return false;
  const selection = value as Partial<AwarenessSelection>;
  return (
    typeof selection.from === 'number' &&
    Number.isFinite(selection.from) &&
    typeof selection.to === 'number' &&
    Number.isFinite(selection.to)
  );
};

const isAwarenessState = (value: unknown): value is AwarenessState => {
  if (!value || typeof value !== 'object') return false;
  const awareness = value as Partial<AwarenessState>;
  return (
    typeof awareness.actorId === 'string' &&
    typeof awareness.label === 'string' &&
    typeof awareness.color === 'string' &&
    typeof awareness.updatedAt === 'number' &&
    awareness.connection === 'online' &&
    (awareness.selection === null || isAwarenessSelection(awareness.selection))
  );
};

const isNamedEditGrant = (value: unknown): value is NamedEditGrant => {
  if (!value || typeof value !== 'object') return false;
  const grant = value as Partial<NamedEditGrant>;
  return isNamedEditInviteId(grant.inviteId) && Number.isSafeInteger(grant.expiresAtMs);
};

export const isCurrentSocketAttachment = (value: unknown): value is SocketAttachment => {
  if (!value || typeof value !== 'object') return false;
  const attachment = value as {
    protocolVersion?: unknown;
    hydrated?: unknown;
    actorId?: unknown;
    roomId?: unknown;
    capabilities?: unknown;
    mode?: unknown;
    policyVersion?: unknown;
    cutoffGeneration?: unknown;
    browserOrigin?: unknown;
    connectedAt?: unknown;
    scope?: unknown;
    awareness?: unknown;
    namedEditGrant?: unknown;
    historyGeneration?: unknown;
  };
  const capabilities = attachment.capabilities;
  if (attachment.protocolVersion === PUBLIC_REALTIME_PROTOCOL_VERSION) {
    return (
      typeof attachment.hydrated === 'boolean' &&
      isNormalizedAttachmentId(attachment.actorId) &&
      isNormalizedAttachmentId(attachment.roomId) &&
      Array.isArray(capabilities) &&
      capabilities.length === 1 &&
      capabilities[0] === 'doc.read' &&
      (attachment.mode === 'read' || attachment.mode === 'comment') &&
      Number.isSafeInteger(attachment.policyVersion) &&
      Number(attachment.policyVersion) >= 1 &&
      Number.isSafeInteger(attachment.cutoffGeneration) &&
      Number(attachment.cutoffGeneration) >= 0 &&
      isCanonicalOrigin(attachment.browserOrigin) &&
      typeof attachment.connectedAt === 'number' &&
      Number.isFinite(attachment.connectedAt) &&
      attachment.scope === undefined &&
      attachment.awareness === undefined &&
      attachment.namedEditGrant === undefined &&
      attachment.historyGeneration === undefined
    );
  }
  const isNamed = attachment.protocolVersion === NAMED_EDIT_PROTOCOL_VERSION;
  return (
    (attachment.protocolVersion === REALTIME_PROTOCOL_VERSION ||
      attachment.protocolVersion === OWNER_REALTIME_PROTOCOL_VERSION ||
      isNamed) &&
    typeof attachment.hydrated === 'boolean' &&
    isNormalizedAttachmentId(attachment.actorId) &&
    isNormalizedAttachmentId(attachment.roomId) &&
    (attachment.protocolVersion !== REALTIME_PROTOCOL_VERSION ||
      !isNamedEditRoomId(attachment.roomId)) &&
    Array.isArray(capabilities) &&
    capabilities.every(isRealtimeCapability) &&
    typeof attachment.connectedAt === 'number' &&
    Number.isFinite(attachment.connectedAt) &&
    (attachment.scope === undefined || isRealtimeScope(attachment.scope)) &&
    hasConsistentAttachmentCapabilities(capabilities, attachment.scope) &&
    (attachment.historyGeneration === undefined ||
      (attachment.protocolVersion !== REALTIME_PROTOCOL_VERSION &&
        Number.isSafeInteger(attachment.historyGeneration) &&
        Number(attachment.historyGeneration) >= 0)) &&
    (isNamed
      ? isNamedEditGrant(attachment.namedEditGrant) &&
        isNamedEditRoomId(attachment.roomId) &&
        isNamedEditActorId(attachment.actorId) &&
        attachment.scope === 'edit'
      : attachment.namedEditGrant === undefined) &&
    (attachment.awareness === undefined ||
      (isAwarenessState(attachment.awareness) &&
        attachment.awareness.actorId === attachment.actorId))
  );
};

const readAttachment = (ws: WebSocket): SocketAttachment | null => {
  const value = ws.deserializeAttachment() as unknown;
  return isCurrentSocketAttachment(value) ? value : null;
};

export const closeStalePublicSockets = (
  sockets: WebSocket[],
  current: {
    mode: PublicPolicyState['mode'];
    policyVersion: number;
    cutoffGeneration: number;
  },
) => {
  let closed = 0;
  for (const socket of sockets) {
    const attachment = readAttachment(socket);
    if (
      !attachment ||
      attachment.protocolVersion !== PUBLIC_REALTIME_PROTOCOL_VERSION ||
      (attachment.mode === current.mode &&
        attachment.policyVersion === current.policyVersion &&
        attachment.cutoffGeneration === current.cutoffGeneration)
    ) {
      continue;
    }
    socket.close(4403, 'public-policy-changed');
    closed += 1;
  }
  return closed;
};

const isOpenSocket = (ws: WebSocket) => ws.readyState === OPEN_SOCKET_READY_STATE;

export const buildRoomHydrationFrames = (input: {
  roomId: string;
  updates: string[];
  protocolVersion?: StandardSocketAttachment['protocolVersion'];
  historyGeneration?: number;
}): Array<Record<string, unknown>> => [
  {
    type: 'room-ready',
    roomId: input.roomId,
    protocolVersion: input.protocolVersion ?? REALTIME_PROTOCOL_VERSION,
    ...(input.historyGeneration !== undefined
      ? { historyGeneration: input.historyGeneration }
      : {}),
  },
  ...input.updates.map((update) => ({
    type: 'yjs-update',
    actorId: 'system',
    roomId: input.roomId,
    source: 'hydrate',
    update,
  })),
  {
    type: 'room-hydration-complete',
    roomId: input.roomId,
    protocolVersion: input.protocolVersion ?? REALTIME_PROTOCOL_VERSION,
    ...(input.historyGeneration !== undefined
      ? { historyGeneration: input.historyGeneration }
      : {}),
    persistedUpdates: input.updates.length,
  },
];

export const buildPublicRoomHydrationFrames = (input: {
  roomId: string;
  mode: PublicDocumentAccessModeV1;
  policyVersion: number;
  cutoffGeneration: number;
  highWaterSequence: number;
  updates: string[];
}): Array<
  PublicRoomReadyFrameV1 | PublicRoomHydrationCompleteFrameV1 | Record<string, unknown>
> => [
  {
    type: 'room-ready',
    roomId: input.roomId,
    protocolVersion: PUBLIC_REALTIME_PROTOCOL_VERSION,
    mode: input.mode,
    policyVersion: input.policyVersion,
    cutoffGeneration: input.cutoffGeneration,
    highWaterSequence: input.highWaterSequence,
  },
  ...input.updates.map((update) => ({
    type: 'yjs-update',
    roomId: input.roomId,
    update,
  })),
  {
    type: 'room-hydration-complete',
    roomId: input.roomId,
    protocolVersion: PUBLIC_REALTIME_PROTOCOL_VERSION,
    mode: input.mode,
    policyVersion: input.policyVersion,
    cutoffGeneration: input.cutoffGeneration,
    highWaterSequence: input.highWaterSequence,
    persistedUpdates: input.updates.length,
  },
];

const awarenessFromMessage = (
  raw: unknown,
  attachment: SocketAttachment,
): AwarenessState | null => {
  if (!raw || typeof raw !== 'object') return null;
  const awareness = raw as {
    label?: unknown;
    color?: unknown;
    selection?: unknown;
  };
  const label =
    typeof awareness.label === 'string' && awareness.label.trim()
      ? awareness.label.trim().slice(0, 80)
      : attachment.actorId;
  const color =
    typeof awareness.color === 'string' && /^#[0-9a-f]{6}$/iu.test(awareness.color)
      ? awareness.color
      : '#64748b';
  const selection =
    awareness.selection === null
      ? null
      : isAwarenessSelection(awareness.selection)
        ? {
            from: Math.max(0, Math.floor(awareness.selection.from)),
            to: Math.max(0, Math.floor(awareness.selection.to)),
          }
        : null;
  return {
    actorId: attachment.actorId,
    label,
    color,
    selection,
    updatedAt: Date.now(),
    connection: 'online',
  };
};

const defaultAwareness = (attachment: SocketAttachment): AwarenessState => ({
  actorId: attachment.actorId,
  label: attachment.actorId,
  color: '#64748b',
  selection: null,
  updatedAt: attachment.connectedAt,
  connection: 'online',
});

const updateFromRow = (row: UpdateRow): PersistedRealtimeUpdate => ({
  sequence: row.sequence,
  actorId: row.actor_id,
  source: row.source,
  update: row.update_b64,
  createdAt: row.created_at,
});

const snapshotFromRow = (row: SnapshotRow | undefined): PersistedRealtimeSnapshot | null =>
  row
    ? {
        sequence: row.sequence,
        update: row.update_b64,
        createdAt: row.created_at,
      }
    : null;

class SqlDocumentPromotionStore implements DocumentPromotionStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  transaction<T>(callback: () => T): T {
    return this.storage.transactionSync(callback);
  }

  readPromotion(): StoredDocumentPromotionV1 | null {
    const row = this.storage.sql
      .exec<PromotionRow>(
        `
        SELECT
          projection.room_id,
          owner.owner_principal_id,
          owner.acl_version,
          policy.public_policy,
          policy.public_policy_version,
          receipt.idempotency_hash,
          projection.title,
          projection.body_canonical_json,
          projection.body_sha256,
          projection.initial_update_b64,
          projection.initial_update_sha256,
          projection.snapshot_sha256,
          projection.adjunct_comments,
          projection.adjunct_suggestions,
          projection.shareable
        FROM document_owner_v1 AS owner
        JOIN document_public_policy_v1 AS policy ON policy.singleton = owner.singleton
        JOIN document_projection_v1 AS projection ON projection.singleton = owner.singleton
        JOIN document_promotion_receipt_v1 AS receipt ON receipt.singleton = owner.singleton
        WHERE owner.singleton = 1
        LIMIT 1
      `,
      )
      .toArray()[0];
    if (!row) return null;
    return {
      roomId: row.room_id,
      ownerPrincipalId: row.owner_principal_id,
      aclVersion: row.acl_version === 1 ? 1 : (row.acl_version as 1),
      publicPolicy:
        row.public_policy === 'restricted' ? 'restricted' : (row.public_policy as 'restricted'),
      publicPolicyVersion: row.public_policy_version === 1 ? 1 : (row.public_policy_version as 1),
      idempotencyHash: row.idempotency_hash,
      title: row.title,
      bodyCanonicalJson: row.body_canonical_json,
      bodySha256: row.body_sha256,
      initialUpdate: row.initial_update_b64,
      initialUpdateSha256: row.initial_update_sha256,
      snapshotSha256: row.snapshot_sha256,
      adjunctComments: row.adjunct_comments === 0 ? 0 : (row.adjunct_comments as 0),
      adjunctSuggestions: row.adjunct_suggestions === 0 ? 0 : (row.adjunct_suggestions as 0),
      shareable: row.shareable === 1,
    };
  }

  hasPromotionState(): boolean {
    const row = this.storage.sql
      .exec<{ count: number }>(
        `
        SELECT (
          (SELECT COUNT(*) FROM document_owner_v1) +
          (SELECT COUNT(*) FROM document_public_policy_v1) +
          (SELECT COUNT(*) FROM document_projection_v1) +
          (SELECT COUNT(*) FROM document_promotion_receipt_v1) +
          (SELECT COUNT(*) FROM yjs_updates) +
          (SELECT COUNT(*) FROM yjs_snapshots)
        ) AS count
      `,
      )
      .toArray()[0];
    return (row?.count ?? 0) > 0;
  }

  hasManagementRequest(requestId: string): boolean {
    const row = this.storage.sql
      .exec<{
        count: number;
      }>(
        'SELECT COUNT(*) AS count FROM management_request_replay_v1 WHERE request_id = ?',
        requestId,
      )
      .toArray()[0];
    return (row?.count ?? 0) > 0;
  }

  createPromotion(record: StoredDocumentPromotionV1, createdAt: string): void {
    this.storage.sql.exec(
      `INSERT INTO document_owner_v1
         (singleton, owner_principal_id, acl_version, created_at)
       VALUES (1, ?, 1, ?)`,
      record.ownerPrincipalId,
      createdAt,
    );
    this.storage.sql.exec(
      `INSERT INTO document_public_policy_v1
         (singleton, public_policy, public_policy_version, created_at)
       VALUES (1, 'restricted', 1, ?)`,
      createdAt,
    );
    this.storage.sql.exec(
      `INSERT INTO document_public_policy_v2
         (singleton, mode, policy_version, cutoff_generation,
          updated_by_principal_id, created_at, updated_at)
       VALUES (1, 'restricted', 1, 0, ?, ?, ?)`,
      record.ownerPrincipalId,
      createdAt,
      createdAt,
    );
    this.storage.sql.exec(
      `INSERT INTO document_projection_v1
         (singleton, room_id, title, body_canonical_json, body_sha256,
          initial_update_b64, initial_update_sha256, snapshot_sha256,
          adjunct_comments, adjunct_suggestions, shareable, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
      record.roomId,
      record.title,
      record.bodyCanonicalJson,
      record.bodySha256,
      record.initialUpdate,
      record.initialUpdateSha256,
      record.snapshotSha256,
      createdAt,
    );
    this.storage.sql.exec(
      `INSERT INTO document_promotion_receipt_v1
         (singleton, idempotency_hash, owner_principal_id, snapshot_sha256, created_at)
       VALUES (1, ?, ?, ?, ?)`,
      record.idempotencyHash,
      record.ownerPrincipalId,
      record.snapshotSha256,
      createdAt,
    );
  }

  markPromotionShareable(): void {
    this.storage.sql.exec(
      `UPDATE document_projection_v1
       SET shareable = 1
       WHERE singleton = 1 AND shareable = 0`,
    );
  }

  recordSuccessfulRequest(input: {
    requestId: string;
    bodySha256: string;
    ownerPrincipalId: string;
    createdAt: string;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO management_request_replay_v1
         (request_id, body_sha256, created_at)
       VALUES (?, ?, ?)`,
      input.requestId,
      input.bodySha256,
      input.createdAt,
    );
    this.storage.sql.exec(
      `INSERT INTO document_audit_v1
         (event_type, principal_id, request_id, body_sha256, created_at)
       VALUES ('document.promoted', ?, ?, ?, ?)`,
      input.ownerPrincipalId,
      input.requestId,
      input.bodySha256,
      input.createdAt,
    );
  }
}

class SqlOwnerSessionTicketStore implements OwnerSessionTicketStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  transaction<T>(callback: () => T): T {
    return this.storage.transactionSync(callback);
  }

  readAuthority(): OwnerSessionAuthoritySnapshot | null {
    const row = this.storage.sql
      .exec<OwnerSessionAuthorityRow>(
        `SELECT projection.room_id,
                owner.owner_principal_id,
                owner.acl_version,
                projection.snapshot_sha256 AS projection_snapshot_sha256,
                receipt.snapshot_sha256 AS receipt_snapshot_sha256,
                projection.title,
                projection.body_canonical_json,
                projection.initial_update_b64,
                projection.shareable
         FROM document_owner_v1 AS owner
         JOIN document_projection_v1 AS projection ON projection.singleton = owner.singleton
         JOIN document_promotion_receipt_v1 AS receipt ON receipt.singleton = owner.singleton
         WHERE owner.singleton = 1
         LIMIT 1`,
      )
      .toArray()[0];
    return row
      ? {
          roomId: row.room_id,
          ownerPrincipalId: row.owner_principal_id,
          aclVersion: row.acl_version,
          promotionSnapshotSha256: row.projection_snapshot_sha256,
          receiptSnapshotSha256: row.receipt_snapshot_sha256,
          title: row.title,
          bodyCanonicalJson: row.body_canonical_json,
          initialUpdate: row.initial_update_b64,
          shareable: row.shareable === 1,
        }
      : null;
  }

  readControl(): OwnerSessionControlState {
    const row = this.storage.sql
      .exec<{
        frozen: number;
        block_new_sessions: number;
        cutoff_generation: number;
      }>(
        `SELECT frozen, block_new_sessions, cutoff_generation
         FROM owner_session_control_v1
         WHERE singleton = 1
         LIMIT 1`,
      )
      .toArray()[0];
    return {
      frozen: row?.frozen === 1,
      blockNewSessions: row?.block_new_sessions === 1,
      cutoffGeneration: row?.cutoff_generation ?? 0,
    };
  }

  readTicket(tokenHash: string): OwnerSessionTicketRecord | null {
    const row = this.storage.sql
      .exec<OwnerSessionTicketRow>(
        `SELECT token_hash, room_id, owner_principal_id, actor_id, protocol_version,
                acl_version, capabilities_json, promotion_snapshot_sha256,
                cutoff_generation, issued_at, expires_at, consumed_at
         FROM owner_socket_ticket_v1
         WHERE token_hash = ?
         LIMIT 1`,
        tokenHash,
      )
      .toArray()[0];
    if (!row) return null;
    let capabilities: unknown;
    try {
      capabilities = JSON.parse(row.capabilities_json);
    } catch {
      capabilities = null;
    }
    return {
      tokenHash: row.token_hash,
      roomId: row.room_id,
      ownerPrincipalId: row.owner_principal_id,
      actorId: row.actor_id,
      protocolVersion: row.protocol_version as 3,
      aclVersion: row.acl_version,
      capabilities: capabilities as ['doc.read', 'doc.edit'],
      promotionSnapshotSha256: row.promotion_snapshot_sha256,
      cutoffGeneration: row.cutoff_generation,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
    };
  }

  createTicket(ticket: OwnerSessionTicketRecord): void {
    this.storage.sql.exec(
      `INSERT INTO owner_socket_ticket_v1
         (token_hash, room_id, owner_principal_id, actor_id, protocol_version,
          acl_version, capabilities_json, promotion_snapshot_sha256,
          cutoff_generation, issued_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ticket.tokenHash,
      ticket.roomId,
      ticket.ownerPrincipalId,
      ticket.actorId,
      ticket.protocolVersion,
      ticket.aclVersion,
      JSON.stringify(ticket.capabilities),
      ticket.promotionSnapshotSha256,
      ticket.cutoffGeneration,
      ticket.issuedAt,
      ticket.expiresAt,
    );
  }

  markTicketConsumed(tokenHash: string, consumedAt: string): boolean {
    const row = this.storage.sql
      .exec<{ token_hash: string }>(
        `UPDATE owner_socket_ticket_v1
         SET consumed_at = ?
         WHERE token_hash = ? AND consumed_at IS NULL
         RETURNING token_hash`,
        consumedAt,
        tokenHash,
      )
      .toArray()[0];
    return row?.token_hash === tokenHash;
  }

  hasManagementRequest(requestId: string): boolean {
    const row = this.storage.sql
      .exec<{
        count: number;
      }>(
        'SELECT COUNT(*) AS count FROM management_request_replay_v1 WHERE request_id = ?',
        requestId,
      )
      .toArray()[0];
    return (row?.count ?? 0) > 0;
  }

  recordManagementRequest(input: {
    requestId: string;
    bodySha256: string;
    ownerPrincipalId: string;
    createdAt: string;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO management_request_replay_v1 (request_id, body_sha256, created_at)
       VALUES (?, ?, ?)`,
      input.requestId,
      input.bodySha256,
      input.createdAt,
    );
    this.storage.sql.exec(
      `INSERT INTO document_audit_v1
         (event_type, principal_id, request_id, body_sha256, created_at)
       VALUES ('owner.session-issued', ?, ?, ?, ?)`,
      input.ownerPrincipalId,
      input.requestId,
      input.bodySha256,
      input.createdAt,
    );
  }
}

class SqlPublicPolicyStore implements PublicPolicyStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  transaction<T>(callback: () => T): T {
    return this.storage.transactionSync(callback);
  }

  readAuthority(): PublicPolicyAuthoritySnapshot | null {
    const row = this.storage.sql
      .exec<PublicPolicyAuthorityRow>(
        `SELECT projection.room_id,
                owner.owner_principal_id,
                projection.shareable
         FROM document_owner_v1 AS owner
         JOIN document_projection_v1 AS projection ON projection.singleton = owner.singleton
         WHERE owner.singleton = 1
         LIMIT 1`,
      )
      .toArray()[0];
    return row
      ? {
          roomId: row.room_id,
          ownerPrincipalId: row.owner_principal_id,
          shareable: row.shareable === 1,
        }
      : null;
  }

  readPolicy(): PublicPolicyState | null {
    const row = this.storage.sql
      .exec<PublicPolicyRow>(
        `SELECT mode, policy_version, cutoff_generation
         FROM document_public_policy_v2
         WHERE singleton = 1
         LIMIT 1`,
      )
      .toArray()[0];
    return row
      ? {
          mode: row.mode as PublicPolicyState['mode'],
          policyVersion: row.policy_version,
          cutoffGeneration: row.cutoff_generation,
        }
      : null;
  }

  readMutation(mutationId: string): PublicPolicyMutationReceipt | null {
    const row = this.storage.sql
      .exec<PublicPolicyMutationRow>(
        `SELECT mutation_id, request_body_sha256, owner_principal_id,
                requested_mode, expected_policy_version, result_mode,
                result_policy_version, result_cutoff_generation,
                result_changed, created_at
         FROM document_public_policy_mutation_v1
         WHERE mutation_id = ?
         LIMIT 1`,
        mutationId,
      )
      .toArray()[0];
    return row
      ? {
          mutationId: row.mutation_id,
          bodySha256: row.request_body_sha256,
          ownerPrincipalId: row.owner_principal_id,
          mode: row.requested_mode as PublicPolicyMutationReceipt['mode'],
          expectedPolicyVersion: row.expected_policy_version,
          resultMode: row.result_mode as PublicPolicyMutationReceipt['resultMode'],
          resultPolicyVersion: row.result_policy_version,
          resultCutoffGeneration: row.result_cutoff_generation,
          resultChanged: row.result_changed === 1,
          createdAt: row.created_at,
        }
      : null;
  }

  updatePolicy(next: PublicPolicyState, ownerPrincipalId: string, changedAt: string): void {
    this.storage.sql.exec(
      `UPDATE document_public_policy_v2
       SET mode = ?,
           policy_version = ?,
           cutoff_generation = ?,
           updated_by_principal_id = ?,
           updated_at = ?
       WHERE singleton = 1`,
      next.mode,
      next.policyVersion,
      next.cutoffGeneration,
      ownerPrincipalId,
      changedAt,
    );
    this.storage.sql.exec(
      `UPDATE public_socket_ticket_v1
       SET invalidated_at = ?
       WHERE consumed_at IS NULL
         AND invalidated_at IS NULL
         AND cutoff_generation < ?`,
      changedAt,
      next.cutoffGeneration,
    );
  }

  createMutation(receipt: PublicPolicyMutationReceipt): void {
    this.storage.sql.exec(
      `INSERT INTO document_public_policy_mutation_v1
         (mutation_id, request_body_sha256, owner_principal_id,
          requested_mode, expected_policy_version, result_mode,
          result_policy_version, result_cutoff_generation,
          result_changed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      receipt.mutationId,
      receipt.bodySha256,
      receipt.ownerPrincipalId,
      receipt.mode,
      receipt.expectedPolicyVersion,
      receipt.resultMode,
      receipt.resultPolicyVersion,
      receipt.resultCutoffGeneration,
      receipt.resultChanged ? 1 : 0,
      receipt.createdAt,
    );
    this.storage.sql.exec(
      `INSERT INTO document_audit_v1
         (event_type, principal_id, request_id, body_sha256, created_at)
       VALUES ('document.public-policy.updated', ?, ?, ?, ?)`,
      receipt.ownerPrincipalId,
      receipt.mutationId,
      receipt.bodySha256,
      receipt.createdAt,
    );
  }
}

class SqlPublicSessionStore implements PublicSessionStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  transaction<T>(callback: () => T): T {
    return this.storage.transactionSync(callback);
  }

  readAuthority(): PublicSessionAuthority | null {
    const row = this.storage.sql
      .exec<PublicSessionAuthorityRow>(
        `SELECT projection.room_id,
                projection.shareable,
                projection.snapshot_sha256 AS projection_snapshot_sha256,
                receipt.snapshot_sha256 AS receipt_snapshot_sha256,
                projection.initial_update_b64,
                policy.mode,
                policy.policy_version,
                policy.cutoff_generation
         FROM document_projection_v1 AS projection
         JOIN document_promotion_receipt_v1 AS receipt
           ON receipt.singleton = projection.singleton
         JOIN document_public_policy_v2 AS policy
           ON policy.singleton = projection.singleton
         WHERE projection.singleton = 1
         LIMIT 1`,
      )
      .toArray()[0];
    return row
      ? {
          roomId: row.room_id,
          shareable: row.shareable === 1,
          projectionSnapshotSha256: row.projection_snapshot_sha256,
          receiptSnapshotSha256: row.receipt_snapshot_sha256,
          initialUpdate: row.initial_update_b64,
          mode: row.mode as PublicSessionAuthority['mode'],
          policyVersion: row.policy_version,
          cutoffGeneration: row.cutoff_generation,
        }
      : null;
  }

  hasRequest(requestId: string): boolean {
    const row = this.storage.sql
      .exec<{
        count: number;
      }>('SELECT COUNT(*) AS count FROM public_control_request_v1 WHERE request_id = ?', requestId)
      .toArray()[0];
    return (row?.count ?? 0) > 0;
  }

  recordRequest(requestId: string, bodySha256: string, createdAt: string): void {
    this.storage.sql.exec(
      `INSERT INTO public_control_request_v1
         (request_id, body_sha256, created_at)
       VALUES (?, ?, ?)`,
      requestId,
      bodySha256,
      createdAt,
    );
  }

  incrementRate(
    rateKey: string,
    roomId: string,
    windowStartMs: number,
    updatedAt: string,
  ): { rateKeyCount: number; roomCount: number } {
    this.storage.sql.exec(
      'DELETE FROM public_session_rate_counter_v1 WHERE window_start_ms < ?',
      windowStartMs - 60_000,
    );
    const increment = (scope: 'rate-key' | 'room', key: string) =>
      this.storage.sql
        .exec<{ count: number }>(
          `INSERT INTO public_session_rate_counter_v1
             (scope, counter_key, window_start_ms, count, updated_at)
           VALUES (?, ?, ?, 1, ?)
           ON CONFLICT(scope, counter_key, window_start_ms)
           DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
           RETURNING count`,
          scope,
          key,
          windowStartMs,
          updatedAt,
        )
        .toArray()[0]?.count ?? Number.MAX_SAFE_INTEGER;
    return {
      rateKeyCount: increment('rate-key', rateKey),
      roomCount: increment('room', roomId),
    };
  }

  createTicket(ticket: PublicSocketTicketRecord): void {
    this.storage.sql.exec(
      `INSERT INTO public_socket_ticket_v1
         (token_hash, request_id, room_id, actor_id, browser_origin,
          protocol_version, mode, policy_version, cutoff_generation,
          capabilities_json, issued_at, expires_at, consumed_at, invalidated_at)
       VALUES (?, ?, ?, ?, ?, 4, ?, ?, ?, '["doc.read"]', ?, ?, NULL, NULL)`,
      ticket.tokenHash,
      ticket.requestId,
      ticket.roomId,
      ticket.actorId,
      ticket.browserOrigin,
      ticket.mode,
      ticket.policyVersion,
      ticket.cutoffGeneration,
      ticket.issuedAt,
      ticket.expiresAt,
    );
  }

  readTicket(tokenHash: string): PublicSocketTicketRecord | null {
    const row = this.storage.sql
      .exec<PublicSocketTicketRow>(
        `SELECT token_hash, request_id, room_id, actor_id, browser_origin,
                protocol_version, mode, policy_version, cutoff_generation,
                capabilities_json, issued_at, expires_at, consumed_at, invalidated_at
         FROM public_socket_ticket_v1
         WHERE token_hash = ?
         LIMIT 1`,
        tokenHash,
      )
      .toArray()[0];
    if (!row) return null;
    let capabilities: unknown = null;
    try {
      capabilities = JSON.parse(row.capabilities_json);
    } catch {
      capabilities = null;
    }
    return {
      tokenHash: row.token_hash,
      requestId: row.request_id,
      roomId: row.room_id,
      actorId: row.actor_id,
      browserOrigin: row.browser_origin,
      protocolVersion: row.protocol_version as 4,
      mode: row.mode as PublicDocumentAccessModeV1,
      policyVersion: row.policy_version,
      cutoffGeneration: row.cutoff_generation,
      capabilities: capabilities as ['doc.read'],
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      invalidatedAt: row.invalidated_at,
    };
  }

  consumeTicket(tokenHash: string, consumedAt: string): boolean {
    const row = this.storage.sql
      .exec<{ token_hash: string }>(
        `UPDATE public_socket_ticket_v1
         SET consumed_at = ?
         WHERE token_hash = ?
           AND consumed_at IS NULL
           AND invalidated_at IS NULL
         RETURNING token_hash`,
        consumedAt,
        tokenHash,
      )
      .toArray()[0];
    return row?.token_hash === tokenHash;
  }
}

const publicCommentFromRow = (row: PublicCommentRow): StoredPublicCommentV1 => ({
  id: row.comment_id,
  sequence: row.sequence,
  roomId: row.room_id,
  authorPrincipalId: row.author_principal_id,
  authorAlias: row.author_alias,
  mutationId: row.mutation_id,
  mutationBodySha256: row.mutation_body_sha256,
  body: row.body,
  policyVersion: row.policy_version,
  cutoffGeneration: row.cutoff_generation,
  createdAt: row.created_at,
  visibility: row.visibility as StoredPublicCommentV1['visibility'],
  hiddenAt: row.hidden_at,
  hiddenByPrincipalId: row.hidden_by_principal_id,
});

class SqlPublicCommentStore implements PublicCommentStore, PublicCommentModerationStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  transaction<T>(callback: () => T): T {
    return this.storage.transactionSync(callback);
  }

  hasTransportRequest(requestId: string): boolean {
    return (
      (this.storage.sql
        .exec<{
          count: number;
        }>(
          'SELECT COUNT(*) AS count FROM public_comment_request_v1 WHERE request_id = ?',
          requestId,
        )
        .toArray()[0]?.count ?? 0) > 0
    );
  }

  recordTransportRequest(requestId: string, bodySha256: string, createdAt: string): void {
    this.storage.sql.exec(
      `INSERT INTO public_comment_request_v1 (request_id, body_sha256, created_at)
       VALUES (?, ?, ?)`,
      requestId,
      bodySha256,
      createdAt,
    );
  }

  readAuthority(): PublicCommentAuthority | null {
    const row = this.storage.sql
      .exec<{
        room_id: string;
        shareable: number;
        mode: string;
        policy_version: number;
        cutoff_generation: number;
      }>(
        `SELECT projection.room_id, projection.shareable, policy.mode,
                policy.policy_version, policy.cutoff_generation
         FROM document_projection_v1 AS projection
         JOIN document_public_policy_v2 AS policy ON policy.singleton = projection.singleton
         WHERE projection.singleton = 1
         LIMIT 1`,
      )
      .toArray()[0];
    return row
      ? {
          roomId: row.room_id,
          shareable: row.shareable === 1,
          mode: row.mode as PublicCommentAuthority['mode'],
          policyVersion: row.policy_version,
          cutoffGeneration: row.cutoff_generation,
        }
      : null;
  }

  private increment(
    scope: string,
    key: string,
    windowStartMs: number,
    windowSeconds: number,
    updatedAt: string,
  ) {
    return (
      this.storage.sql
        .exec<{ count: number }>(
          `INSERT INTO public_comment_rate_v1
             (scope, counter_key, window_start_ms, window_seconds, count, updated_at)
           VALUES (?, ?, ?, ?, 1, ?)
           ON CONFLICT(scope, counter_key, window_start_ms, window_seconds)
           DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
           RETURNING count`,
          scope,
          key,
          windowStartMs,
          windowSeconds,
          updatedAt,
        )
        .toArray()[0]?.count ?? Number.MAX_SAFE_INTEGER
    );
  }

  incrementListRate(rateKey: string, roomId: string, minuteStartMs: number, updatedAt: string) {
    this.storage.sql.exec(
      'DELETE FROM public_comment_rate_v1 WHERE window_start_ms + (window_seconds * 1000) < ?',
      minuteStartMs - 86_400_000,
    );
    return {
      rateKeyMinute: this.increment('list-rate-key', rateKey, minuteStartMs, 60, updatedAt),
      roomMinute: this.increment('list-room', roomId, minuteStartMs, 60, updatedAt),
    };
  }

  incrementCreateRate(
    principalId: string,
    roomId: string,
    minuteStartMs: number,
    dayStartMs: number,
    hourStartMs: number,
    updatedAt: string,
  ) {
    this.storage.sql.exec(
      'DELETE FROM public_comment_rate_v1 WHERE window_start_ms + (window_seconds * 1000) < ?',
      minuteStartMs - 172_800_000,
    );
    return {
      principalMinute: this.increment(
        'create-principal-minute',
        `${principalId}:${roomId}`,
        minuteStartMs,
        60,
        updatedAt,
      ),
      principalDay: this.increment(
        'create-principal-day',
        `${principalId}:${roomId}`,
        dayStartMs,
        86_400,
        updatedAt,
      ),
      roomHour: this.increment('create-room-hour', roomId, hourStartMs, 3_600, updatedAt),
    };
  }

  readCommentByMutation(mutationId: string): StoredPublicCommentV1 | null {
    const row = this.storage.sql
      .exec<PublicCommentRow>(
        `SELECT sequence, comment_id, room_id, author_principal_id, author_alias,
                mutation_id, mutation_body_sha256, body, policy_version,
                cutoff_generation, created_at, visibility, hidden_at,
                hidden_by_principal_id
         FROM public_comment_v1
         WHERE mutation_id = ?
         LIMIT 1`,
        mutationId,
      )
      .toArray()[0];
    return row ? publicCommentFromRow(row) : null;
  }

  readCommentById(commentId: string): StoredPublicCommentV1 | null {
    const row = this.storage.sql
      .exec<PublicCommentRow>(
        `SELECT sequence, comment_id, room_id, author_principal_id, author_alias,
                mutation_id, mutation_body_sha256, body, policy_version,
                cutoff_generation, created_at, visibility, hidden_at,
                hidden_by_principal_id
         FROM public_comment_v1
         WHERE comment_id = ?
         LIMIT 1`,
        commentId,
      )
      .toArray()[0];
    return row ? publicCommentFromRow(row) : null;
  }

  insertComment(comment: Omit<StoredPublicCommentV1, 'sequence'>): void {
    this.storage.sql.exec(
      `INSERT INTO public_comment_v1
         (comment_id, room_id, author_principal_id, author_alias, mutation_id,
          mutation_body_sha256, body, policy_version, cutoff_generation,
          created_at, visibility, hidden_at, hidden_by_principal_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', NULL, NULL)`,
      comment.id,
      comment.roomId,
      comment.authorPrincipalId,
      comment.authorAlias,
      comment.mutationId,
      comment.mutationBodySha256,
      comment.body,
      comment.policyVersion,
      comment.cutoffGeneration,
      comment.createdAt,
    );
  }

  listVisibleComments(beforeSequence: number | null, limit: number): StoredPublicCommentV1[] {
    return this.storage.sql
      .exec<PublicCommentRow>(
        `SELECT sequence, comment_id, room_id, author_principal_id, author_alias,
                mutation_id, mutation_body_sha256, body, policy_version,
                cutoff_generation, created_at, visibility, hidden_at,
                hidden_by_principal_id
         FROM public_comment_v1
         WHERE visibility = 'visible'
           AND (? IS NULL OR sequence < ?)
         ORDER BY sequence DESC
         LIMIT ?`,
        beforeSequence,
        beforeSequence,
        limit,
      )
      .toArray()
      .map(publicCommentFromRow);
  }

  recordCreateAudit(input: {
    commentId: string;
    mutationId: string;
    principalId: string;
    createdAt: string;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO public_comment_audit_v1
         (event_type, comment_id, mutation_id, principal_id, created_at)
       VALUES ('public.comment.created', ?, ?, ?, ?)`,
      input.commentId,
      input.mutationId,
      input.principalId,
      input.createdAt,
    );
  }

  readModerationAuthority() {
    const row = this.storage.sql
      .exec<{
        room_id: string;
        owner_principal_id: string;
        shareable: number;
        mode: string;
        policy_version: number;
        cutoff_generation: number;
      }>(
        `SELECT projection.room_id, owner.owner_principal_id, projection.shareable,
                policy.mode, policy.policy_version, policy.cutoff_generation
         FROM document_owner_v1 AS owner
         JOIN document_projection_v1 AS projection ON projection.singleton = owner.singleton
         JOIN document_public_policy_v2 AS policy ON policy.singleton = owner.singleton
         WHERE owner.singleton = 1
         LIMIT 1`,
      )
      .toArray()[0];
    return row
      ? {
          roomId: row.room_id,
          ownerPrincipalId: row.owner_principal_id,
          shareable: row.shareable === 1,
          mode: row.mode as PublicCommentAuthority['mode'],
          policyVersion: row.policy_version,
          cutoffGeneration: row.cutoff_generation,
        }
      : null;
  }

  readModeration(mutationId: string): PublicCommentModerationReceipt | null {
    const row = this.storage.sql
      .exec<{
        mutation_id: string;
        request_body_sha256: string;
        claim_id: string;
        room_id: string;
        comment_id: string;
        owner_principal_id: string;
        result_changed: number;
        policy_version: number;
        cutoff_generation: number;
        moderated_at: string;
      }>(
        `SELECT mutation_id, request_body_sha256, claim_id, room_id, comment_id,
                owner_principal_id, result_changed, policy_version,
                cutoff_generation, moderated_at
         FROM public_comment_moderation_v1
         WHERE mutation_id = ?
         LIMIT 1`,
        mutationId,
      )
      .toArray()[0];
    return row
      ? {
          mutationId: row.mutation_id,
          requestBodySha256: row.request_body_sha256,
          claimId: row.claim_id,
          roomId: row.room_id,
          commentId: row.comment_id,
          ownerPrincipalId: row.owner_principal_id,
          changed: row.result_changed === 1,
          policyVersion: row.policy_version,
          cutoffGeneration: row.cutoff_generation,
          moderatedAt: row.moderated_at,
        }
      : null;
  }

  hideComment(commentId: string, ownerPrincipalId: string, hiddenAt: string): boolean {
    return (
      this.storage.sql
        .exec<{ comment_id: string }>(
          `UPDATE public_comment_v1
           SET visibility = 'hidden', hidden_at = ?, hidden_by_principal_id = ?
           WHERE comment_id = ? AND visibility = 'visible'
           RETURNING comment_id`,
          hiddenAt,
          ownerPrincipalId,
          commentId,
        )
        .toArray()[0]?.comment_id === commentId
    );
  }

  createModeration(receipt: PublicCommentModerationReceipt): void {
    this.storage.sql.exec(
      `INSERT INTO public_comment_moderation_v1
         (mutation_id, request_body_sha256, claim_id, room_id, comment_id,
          owner_principal_id, result_changed, policy_version, cutoff_generation,
          moderated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      receipt.mutationId,
      receipt.requestBodySha256,
      receipt.claimId,
      receipt.roomId,
      receipt.commentId,
      receipt.ownerPrincipalId,
      receipt.changed ? 1 : 0,
      receipt.policyVersion,
      receipt.cutoffGeneration,
      receipt.moderatedAt,
    );
  }

  recordHideAudit(input: {
    commentId: string;
    mutationId: string;
    principalId: string;
    createdAt: string;
  }): void {
    this.storage.sql.exec(
      `INSERT INTO public_comment_audit_v1
         (event_type, comment_id, mutation_id, principal_id, created_at)
       VALUES ('public.comment.hidden', ?, ?, ?, ?)`,
      input.commentId,
      input.mutationId,
      input.principalId,
      input.createdAt,
    );
  }
}

export class LashRealtimeRoom extends DurableObject<Env> {
  private projectionCache: Y.Doc | null = null;
  private canonicalBodyCache: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS yjs_updates (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id TEXT NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('client', 'restore')),
          update_b64 TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS yjs_snapshots (
          sequence INTEGER PRIMARY KEY,
          update_b64 TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS document_owner_v1 (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          owner_principal_id TEXT NOT NULL,
          acl_version INTEGER NOT NULL CHECK (acl_version = 1),
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TRIGGER IF NOT EXISTS document_owner_v1_no_update
        BEFORE UPDATE ON document_owner_v1
        BEGIN
          SELECT RAISE(ABORT, 'document owner is immutable');
        END
      `);
      this.ctx.storage.sql.exec(`
        CREATE TRIGGER IF NOT EXISTS document_owner_v1_no_delete
        BEFORE DELETE ON document_owner_v1
        BEGIN
          SELECT RAISE(ABORT, 'document owner is immutable');
        END
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS document_public_policy_v1 (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          public_policy TEXT NOT NULL CHECK (public_policy = 'restricted'),
          public_policy_version INTEGER NOT NULL CHECK (public_policy_version = 1),
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS document_public_policy_v2 (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          mode TEXT NOT NULL CHECK (mode IN ('restricted', 'read', 'comment')),
          policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
          cutoff_generation INTEGER NOT NULL CHECK (cutoff_generation >= 0),
          updated_by_principal_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS document_projection_v1 (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          room_id TEXT NOT NULL,
          title TEXT NOT NULL,
          body_canonical_json TEXT NOT NULL,
          body_sha256 TEXT NOT NULL,
          initial_update_b64 TEXT NOT NULL,
          initial_update_sha256 TEXT NOT NULL,
          snapshot_sha256 TEXT NOT NULL,
          adjunct_comments INTEGER NOT NULL CHECK (adjunct_comments = 0),
          adjunct_suggestions INTEGER NOT NULL CHECK (adjunct_suggestions = 0),
          shareable INTEGER NOT NULL CHECK (shareable IN (0, 1)),
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS document_promotion_receipt_v1 (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          idempotency_hash TEXT NOT NULL UNIQUE,
          owner_principal_id TEXT NOT NULL,
          snapshot_sha256 TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS management_request_replay_v1 (
          request_id TEXT PRIMARY KEY,
          body_sha256 TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS document_audit_v1 (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          request_id TEXT NOT NULL,
          body_sha256 TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS document_public_policy_mutation_v1 (
          mutation_id TEXT PRIMARY KEY,
          request_body_sha256 TEXT NOT NULL,
          owner_principal_id TEXT NOT NULL,
          requested_mode TEXT NOT NULL
            CHECK (requested_mode IN ('restricted', 'read', 'comment')),
          expected_policy_version INTEGER NOT NULL CHECK (expected_policy_version >= 1),
          result_mode TEXT NOT NULL
            CHECK (result_mode IN ('restricted', 'read', 'comment')),
          result_policy_version INTEGER NOT NULL CHECK (result_policy_version >= 1),
          result_cutoff_generation INTEGER NOT NULL CHECK (result_cutoff_generation >= 0),
          result_changed INTEGER NOT NULL CHECK (result_changed IN (0, 1)),
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS public_control_request_v1 (
          request_id TEXT PRIMARY KEY,
          body_sha256 TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS public_session_rate_counter_v1 (
          scope TEXT NOT NULL CHECK (scope IN ('rate-key', 'room')),
          counter_key TEXT NOT NULL,
          window_start_ms INTEGER NOT NULL CHECK (window_start_ms >= 0),
          count INTEGER NOT NULL CHECK (count >= 1),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (scope, counter_key, window_start_ms)
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS public_socket_ticket_v1 (
          token_hash TEXT PRIMARY KEY,
          request_id TEXT NOT NULL UNIQUE,
          room_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          browser_origin TEXT NOT NULL,
          protocol_version INTEGER NOT NULL CHECK (protocol_version = 4),
          mode TEXT NOT NULL CHECK (mode IN ('read', 'comment')),
          policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
          cutoff_generation INTEGER NOT NULL CHECK (cutoff_generation >= 0),
          capabilities_json TEXT NOT NULL CHECK (capabilities_json = '["doc.read"]'),
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          invalidated_at TEXT
        )
      `);
      this.ctx.storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS public_socket_ticket_expiry_idx ON public_socket_ticket_v1(expires_at)',
      );
      this.ctx.storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS public_session_rate_window_idx ON public_session_rate_counter_v1(window_start_ms)',
      );
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS public_comment_request_v1 (
          request_id TEXT PRIMARY KEY,
          body_sha256 TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS public_comment_v1 (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          comment_id TEXT NOT NULL UNIQUE,
          room_id TEXT NOT NULL,
          author_principal_id TEXT NOT NULL,
          author_alias TEXT NOT NULL,
          mutation_id TEXT NOT NULL UNIQUE,
          mutation_body_sha256 TEXT NOT NULL,
          body TEXT NOT NULL,
          policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
          cutoff_generation INTEGER NOT NULL CHECK (cutoff_generation >= 0),
          created_at TEXT NOT NULL,
          visibility TEXT NOT NULL CHECK (visibility IN ('visible', 'hidden')),
          hidden_at TEXT,
          hidden_by_principal_id TEXT
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS public_comment_rate_v1 (
          scope TEXT NOT NULL,
          counter_key TEXT NOT NULL,
          window_start_ms INTEGER NOT NULL CHECK (window_start_ms >= 0),
          window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
          count INTEGER NOT NULL CHECK (count >= 1),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (scope, counter_key, window_start_ms, window_seconds)
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS public_comment_audit_v1 (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL
            CHECK (event_type IN ('public.comment.created', 'public.comment.hidden')),
          comment_id TEXT NOT NULL,
          mutation_id TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS public_comment_moderation_v1 (
          mutation_id TEXT PRIMARY KEY,
          request_body_sha256 TEXT NOT NULL,
          claim_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          comment_id TEXT NOT NULL,
          owner_principal_id TEXT NOT NULL,
          result_changed INTEGER NOT NULL CHECK (result_changed IN (0, 1)),
          policy_version INTEGER NOT NULL,
          cutoff_generation INTEGER NOT NULL,
          moderated_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS public_comment_visible_sequence_idx ON public_comment_v1(visibility, sequence)',
      );
      this.ctx.storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS public_comment_rate_expiry_idx ON public_comment_rate_v1(window_start_ms)',
      );
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS owner_session_control_v1 (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          frozen INTEGER NOT NULL CHECK (frozen IN (0, 1)),
          block_new_sessions INTEGER NOT NULL CHECK (block_new_sessions IN (0, 1)),
          cutoff_generation INTEGER NOT NULL CHECK (cutoff_generation >= 0),
          updated_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS owner_socket_ticket_v1 (
          token_hash TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          owner_principal_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          protocol_version INTEGER NOT NULL CHECK (protocol_version = 3),
          acl_version INTEGER NOT NULL CHECK (acl_version > 0),
          capabilities_json TEXT NOT NULL CHECK (capabilities_json = '["doc.read","doc.edit"]'),
          promotion_snapshot_sha256 TEXT NOT NULL,
          cutoff_generation INTEGER NOT NULL CHECK (cutoff_generation >= 0),
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT
        )
      `);
      this.ctx.storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS owner_socket_ticket_expiry_idx ON owner_socket_ticket_v1(expires_at)',
      );
      this.ctx.storage.sql.exec(`
        INSERT OR IGNORE INTO document_public_policy_v2
          (singleton, mode, policy_version, cutoff_generation,
           updated_by_principal_id, created_at, updated_at)
        SELECT legacy.singleton,
               'restricted',
               1,
               0,
               owner.owner_principal_id,
               legacy.created_at,
               legacy.created_at
        FROM document_public_policy_v1 AS legacy
        JOIN document_owner_v1 AS owner ON owner.singleton = legacy.singleton
        WHERE legacy.singleton = 1
      `);
      this.ctx.storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS yjs_updates_sequence_idx ON yjs_updates(sequence)',
      );
      initializeNamedEditStorage(this.ctx.storage);
      initializeCollaboratorReviewStorage(this.ctx.storage);
      initializeSharedHistoryStorage(this.ctx.storage);
      this.currentSockets({ hydratedOnly: false });
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__lash-room/named-edit/')) return this.namedEdit(request);
    if (url.pathname === '/__lash-room/promote') {
      return this.promote(request);
    }
    if (url.pathname === '/__lash-room/owner-session') {
      return this.ownerSession(request);
    }
    if (url.pathname === '/__lash-room/public-session') {
      return this.publicSession(request);
    }
    if (
      url.pathname === '/__lash-room/public-comments/list' ||
      url.pathname === '/__lash-room/public-comments/create'
    ) {
      return this.publicComments(request, url.pathname.endsWith('/list') ? 'list' : 'create');
    }
    if (url.pathname === '/__lash-room/public-comments/moderate') {
      return this.publicCommentModeration(request);
    }
    if (
      url.pathname === '/__lash-room/public-policy/read' ||
      url.pathname === '/__lash-room/public-policy/update'
    ) {
      return this.publicPolicy(request, url.pathname.endsWith('/read') ? 'read' : 'update');
    }
    const actorId = normalizeRoomName(url.searchParams.get('actorId')) ?? null;
    const roomId = normalizeRoomName(url.searchParams.get('roomId')) ?? 'unknown-room';
    const protocolVersion = Number(url.searchParams.get('protocolVersion'));
    if (
      protocolVersion !== REALTIME_PROTOCOL_VERSION &&
      protocolVersion !== OWNER_REALTIME_PROTOCOL_VERSION &&
      protocolVersion !== PUBLIC_REALTIME_PROTOCOL_VERSION &&
      protocolVersion !== NAMED_EDIT_PROTOCOL_VERSION
    ) {
      return json({ ok: false, error: 'protocol-mismatch', retryable: false }, { status: 409 });
    }
    if (!actorId) {
      return json({ ok: false, error: 'forbidden', reason: 'missing-actor' }, { status: 403 });
    }
    if (protocolVersion === REALTIME_PROTOCOL_VERSION && isNamedEditRoomId(roomId)) {
      return json({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    if (url.pathname === '/__lash-room/health') {
      const snapshot = this.latestSnapshot();
      return json({
        ok: true,
        actorId,
        roomId,
        runtime: REALTIME_RUNTIME,
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        connections: this.currentSockets().length,
        persistence: {
          updates: this.updateCount(),
          snapshotSequence: snapshot?.sequence ?? null,
          hydrationUpdates: this.hydrationUpdates().length,
        },
      });
    }

    if (url.pathname === '/__lash-room/socket') {
      return this.acceptSocket(request, roomId, actorId, protocolVersion);
    }

    if (url.pathname === '/__lash-room/restore') {
      return this.restore(request, roomId, actorId);
    }

    return json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!isOpenSocket(ws)) return;
    const attachment = readAttachment(ws);
    if (!attachment || !attachment.hydrated) {
      this.closeProtocolOldSocket(ws);
      return;
    }
    if (
      attachment.protocolVersion === NAMED_EDIT_PROTOCOL_VERSION &&
      !this.keepNamedEditSocket(ws, attachment)
    ) {
      return;
    }
    if (attachment.protocolVersion === PUBLIC_REALTIME_PROTOCOL_VERSION) {
      if (!this.isCurrentPublicPolicy(attachment) || !this.publicProjectionCanBeShared()) {
        ws.close(4403, 'public-policy-changed');
        return;
      }
      const ping = parsePublicPing(message);
      if (!ping.ok) {
        ws.close(4403, 'public-read-only');
        return;
      }
      ws.send(
        JSON.stringify({
          type: 'pong',
          requestId: ping.requestId,
          roomId: attachment.roomId,
          protocolVersion: PUBLIC_REALTIME_PROTOCOL_VERSION,
        }),
      );
      return;
    }
    if (!this.keepCurrentHistorySocket(ws, attachment)) return;
    const parsed = parseClientMessage(message);
    if (!parsed) {
      ws.send(
        JSON.stringify({
          type: 'error',
          roomId: attachment.roomId,
          code: 'invalid_json',
        }),
      );
      return;
    }

    if (parsed.type === 'review-operation') {
      if (this.isPrivateReviewSocket(attachment)) {
        if ((parsed.historyGeneration ?? 0) !== (attachment.historyGeneration ?? 0)) {
          ws.close(4410, 'document-restored');
          return;
        }
        this.handleReviewOperation(ws, attachment, parsed);
      }
      return;
    }
    if (typeof parsed.type === 'string' && parsed.type.startsWith('shared-history-')) {
      if (this.isSharedHistorySocket(attachment)) this.handleSharedHistory(ws, attachment, parsed);
      return;
    }

    if (parsed.type === 'ping') {
      ws.send(
        JSON.stringify({
          type: 'pong',
          requestId: parsed.requestId ?? null,
          actorId: attachment.actorId,
          roomId: attachment.roomId,
          protocolVersion: attachment.protocolVersion,
          connections: this.currentSockets().length,
        }),
      );
      return;
    }

    if (parsed.type === 'broadcast') {
      if (attachment.protocolVersion === NAMED_EDIT_PROTOCOL_VERSION) return;
      const payload = JSON.stringify({
        type: 'broadcast',
        actorId: attachment.actorId,
        requestId: parsed.requestId ?? null,
        roomId: attachment.roomId,
        payload: parsed.payload ?? null,
      });
      for (const peer of this.currentSockets().filter(
        ({ attachment: peerAttachment }) =>
          peerAttachment.protocolVersion !== PUBLIC_REALTIME_PROTOCOL_VERSION,
      )) {
        peer.ws.send(payload);
      }
      return;
    }

    if (parsed.type === 'awareness-update') {
      const awareness = awarenessFromMessage(parsed.awareness, attachment);
      if (!awareness) {
        ws.send(
          JSON.stringify({
            type: 'error',
            roomId: attachment.roomId,
            code: 'invalid_awareness_update',
          }),
        );
        return;
      }
      ws.serializeAttachment({
        ...attachment,
        awareness,
      } satisfies SocketAttachment);
      this.broadcastAwareness(attachment.roomId);
      return;
    }

    if (parsed.type === 'yjs-update') {
      if (!attachment.capabilities.includes('doc.edit')) {
        ws.send(
          JSON.stringify({
            type: 'error',
            roomId: attachment.roomId,
            code: 'scope_mismatch',
          }),
        );
        return;
      }
      if (typeof parsed.update !== 'string') {
        ws.send(
          JSON.stringify({
            type: 'error',
            roomId: attachment.roomId,
            code: 'invalid_yjs_update',
          }),
        );
        return;
      }
      if (!isValidYjsUpdate(parsed.update)) {
        ws.send(
          JSON.stringify({
            type: 'error',
            roomId: attachment.roomId,
            code: 'invalid_yjs_update',
          }),
        );
        return;
      }
      const recordHistory =
        this.isPrivateReviewSocket(attachment) || this.isSharedHistorySocket(attachment);
      if (
        recordHistory &&
        (parsed.historyGeneration ?? 0) !== (attachment.historyGeneration ?? 0)
      ) {
        ws.close(4410, 'document-restored');
        return;
      }
      const beforeBody = recordHistory ? this.readCanonicalBody() : null;
      const publicStateVector = this.readPublicStateVector();
      const afterBody = beforeBody !== null ? this.validateAccountProjection(parsed.update) : null;
      if (recordHistory && (beforeBody === null || afterBody === null)) {
        ws.close(4409, 'invalid-document-update');
        return;
      }
      let persisted: PersistedRealtimeUpdate;
      try {
        persisted = this.appendUpdate(
          attachment.actorId,
          'client',
          parsed.update,
          beforeBody !== null && afterBody !== null
            ? {
                roomId: attachment.roomId,
                actorRole: this.historyActorRole(attachment),
                beforeBody,
                afterBody,
              }
            : undefined,
        );
      } catch {
        ws.close(1011, 'document-write-unavailable');
        return;
      }
      if (typeof parsed.updateId === 'string') {
        ws.send(
          JSON.stringify({
            type: 'sync-ack',
            actorId: attachment.actorId,
            roomId: attachment.roomId,
            updateId: parsed.updateId,
            sequence: persisted.sequence,
          }),
        );
      }
      this.broadcastYjsUpdate(attachment.roomId, persisted, { exclude: ws, publicStateVector });
      return;
    }

    ws.send(
      JSON.stringify({
        type: 'error',
        roomId: attachment.roomId,
        code: 'unknown_message_type',
      }),
    );
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const attachment = readAttachment(ws);
    if (!attachment) return;
    if (attachment.protocolVersion === PUBLIC_REALTIME_PROTOCOL_VERSION) return;
    this.broadcastAwareness(attachment.roomId, ws);
  }

  private async acceptSocket(
    request: Request,
    roomId: string,
    actorId: string,
    protocolVersion:
      | typeof REALTIME_PROTOCOL_VERSION
      | typeof OWNER_REALTIME_PROTOCOL_VERSION
      | typeof PUBLIC_REALTIME_PROTOCOL_VERSION
      | typeof NAMED_EDIT_PROTOCOL_VERSION,
  ): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ ok: false, error: 'expected_websocket' }, { status: 426 });
    }
    const url = new URL(request.url);
    if (url.searchParams.get('protocolVersion') !== String(protocolVersion)) {
      return json({ ok: false, error: 'protocol-mismatch', retryable: false }, { status: 409 });
    }
    let capabilities: RealtimeCapability[];
    let scope: RealtimeInviteScope | undefined;
    let namedEditGrant: NamedEditGrant | undefined;
    let historyGeneration: number | undefined;
    let publicGrant:
      | {
          browserOrigin: string;
          mode: PublicDocumentAccessModeV1;
          policyVersion: number;
          cutoffGeneration: number;
        }
      | undefined;
    if (protocolVersion === PUBLIC_REALTIME_PROTOCOL_VERSION) {
      const query = [...url.searchParams.entries()];
      const protocols = parsePublicSocketProtocols(request.headers.get('sec-websocket-protocol'));
      const browserOrigin = request.headers.get('origin');
      if (
        query.length !== 3 ||
        query[0]?.[0] !== 'protocolVersion' ||
        query[0]?.[1] !== '4' ||
        query[1]?.[0] !== 'actorId' ||
        query[1]?.[1] !== actorId ||
        query[2]?.[0] !== 'roomId' ||
        query[2]?.[1] !== roomId ||
        !protocols.ok ||
        !isCanonicalOrigin(browserOrigin) ||
        request.headers.has('authorization') ||
        !this.publicProjectionCanBeShared()
      ) {
        return json({ ok: false, error: 'forbidden' }, { status: 403 });
      }
      const consumed = await consumePublicSocketTicket({
        store: new SqlPublicSessionStore(this.ctx.storage),
        token: protocols.token,
        roomId,
        actorId,
        browserOrigin,
        protocolVersion,
        nowMs: Date.now(),
      });
      if (!consumed.ok || !this.publicProjectionCanBeShared()) {
        return json({ ok: false, error: 'forbidden' }, { status: 403 });
      }
      capabilities = consumed.grant.capabilities;
      scope = undefined;
      publicGrant = {
        browserOrigin: consumed.grant.browserOrigin,
        mode: consumed.grant.mode,
        policyVersion: consumed.grant.policyVersion,
        cutoffGeneration: consumed.grant.cutoffGeneration,
      };
    } else if (protocolVersion === NAMED_EDIT_PROTOCOL_VERSION) {
      const query = [...url.searchParams.entries()];
      const token = parseNamedEditSocketProtocols(request.headers.get('sec-websocket-protocol'));
      const origin = request.headers.get('origin');
      if (
        !this.namedEditIsEnabled() ||
        !isNamedEditRoomId(roomId) ||
        !isNamedEditActorId(actorId) ||
        query.length !== 3 ||
        query[0]?.[0] !== 'protocolVersion' ||
        query[1]?.[0] !== 'actorId' ||
        query[1]?.[1] !== actorId ||
        query[2]?.[0] !== 'roomId' ||
        query[2]?.[1] !== roomId ||
        !token ||
        !isNamedEditOrigin(origin) ||
        request.headers.has('authorization')
      ) {
        return namedEditResponse(namedEditFailure('forbidden'));
      }
      const grant = await consumeNamedEditTicket({
        storage: this.ctx.storage,
        roomId,
        actorId,
        browserOrigin: origin,
        token,
        nowMs: Date.now(),
      });
      if (!grant || !this.namedEditGrantIsCurrent(roomId, grant, Date.now())) {
        return namedEditResponse(namedEditFailure('forbidden'));
      }
      capabilities = [...NAMED_EDIT_CAPABILITIES];
      scope = 'edit';
      namedEditGrant = grant;
      historyGeneration = sharedHistoryGeneration(this.ctx.storage);
    } else if (protocolVersion === OWNER_REALTIME_PROTOCOL_VERSION) {
      const query = [...url.searchParams.entries()];
      if (
        query.length !== 3 ||
        query[0]?.[0] !== 'protocolVersion' ||
        query[0]?.[1] !== '3' ||
        query[1]?.[0] !== 'actorId' ||
        query[1]?.[1] !== actorId ||
        query[2]?.[0] !== 'roomId' ||
        query[2]?.[1] !== roomId
      ) {
        return json({ ok: false, error: 'forbidden' }, { status: 403 });
      }
      const protocols = parseOwnerSocketProtocols(request.headers.get('sec-websocket-protocol'));
      if (!protocols.ok) {
        return json({ ok: false, error: 'forbidden' }, { status: 403 });
      }
      const consumed = await consumeOwnerSocketTicket({
        store: new SqlOwnerSessionTicketStore(this.ctx.storage),
        token: protocols.token,
        roomId,
        actorId,
        protocolVersion,
        nowMs: Date.now(),
      });
      if (!consumed.ok) {
        return json({ ok: false, error: 'forbidden' }, { status: 403 });
      }
      capabilities = consumed.grant.capabilities;
      scope = undefined;
      if (this.namedEditIsEnabled() || this.hasSharedHistory()) {
        historyGeneration = sharedHistoryGeneration(this.ctx.storage);
      }
    } else {
      capabilities = capabilitiesFromQuery(url.searchParams.get('capabilities'));
      scope = scopeFromQuery(url.searchParams.get('scope'));
    }

    if (
      (protocolVersion === OWNER_REALTIME_PROTOCOL_VERSION ||
        protocolVersion === NAMED_EDIT_PROTOCOL_VERSION) &&
      !this.repairLegacyCheckpointGap()
    ) {
      return json({ ok: false, error: 'document-write-unavailable' }, { status: 503 });
    }
    this.currentSockets({ hydratedOnly: false });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    const connectedAt = Date.now();
    let pendingAttachment: SocketAttachment;
    if (protocolVersion === PUBLIC_REALTIME_PROTOCOL_VERSION) {
      if (!publicGrant) {
        return json({ ok: false, error: 'forbidden' }, { status: 403 });
      }
      pendingAttachment = {
        protocolVersion,
        hydrated: false,
        actorId,
        roomId,
        capabilities: [...PUBLIC_CAPABILITIES],
        ...publicGrant,
        connectedAt,
      };
    } else {
      pendingAttachment = {
        protocolVersion,
        hydrated: false,
        actorId,
        roomId,
        capabilities,
        ...(scope ? { scope } : {}),
        ...(namedEditGrant ? { namedEditGrant } : {}),
        ...(historyGeneration !== undefined ? { historyGeneration } : {}),
        connectedAt,
      };
    }
    server.serializeAttachment(pendingAttachment);
    let hydrated = false;
    try {
      const frames =
        protocolVersion === PUBLIC_REALTIME_PROTOCOL_VERSION && publicGrant
          ? buildPublicRoomHydrationFrames({
              roomId,
              ...publicGrant,
              ...this.publicHydrationInventory(),
            })
          : buildRoomHydrationFrames({
              roomId,
              updates: this.hydrationUpdates(),
              protocolVersion: protocolVersion as StandardSocketAttachment['protocolVersion'],
              historyGeneration,
            });
      for (const frame of frames) {
        if (!isOpenSocket(server)) throw new Error('socket-not-open');
        server.send(JSON.stringify(frame));
      }
      if (this.isPrivateReviewSocket(pendingAttachment)) {
        server.send(
          JSON.stringify({
            type: 'review-snapshot',
            roomId,
            operations: readCollaboratorReviewSnapshot(this.ctx.storage),
          }),
        );
      }
      if (!isOpenSocket(server)) throw new Error('socket-not-open');
      server.serializeAttachment({
        ...pendingAttachment,
        hydrated: true,
      } satisfies SocketAttachment);
      hydrated = true;
    } catch {
      if (isOpenSocket(server)) {
        server.close(1011, 'hydration-failed');
      }
    }
    if (hydrated && protocolVersion !== PUBLIC_REALTIME_PROTOCOL_VERSION) {
      this.broadcastAwareness(roomId);
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers:
        protocolVersion === OWNER_REALTIME_PROTOCOL_VERSION
          ? { 'sec-websocket-protocol': OWNER_SOCKET_PROTOCOL }
          : protocolVersion === PUBLIC_REALTIME_PROTOCOL_VERSION
            ? { 'sec-websocket-protocol': PUBLIC_SOCKET_PROTOCOL }
            : protocolVersion === NAMED_EDIT_PROTOCOL_VERSION
              ? { 'sec-websocket-protocol': NAMED_EDIT_SOCKET_PROTOCOL }
              : undefined,
    });
  }

  private broadcastAwareness(roomId: string, exclude?: WebSocket) {
    const roomSockets = this.currentSockets({ exclude, roomId }).filter(
      ({ attachment }) => attachment.protocolVersion !== PUBLIC_REALTIME_PROTOCOL_VERSION,
    );
    const peers = roomSockets
      .map((peer) => peer.attachment)
      .map((attachment) => attachment.awareness ?? defaultAwareness(attachment));
    const payload = JSON.stringify({
      type: 'awareness-state',
      roomId,
      peers,
    });
    for (const peer of roomSockets) {
      peer.ws.send(payload);
    }
  }

  private isCurrentPublicPolicy(attachment: PublicSocketAttachment) {
    const row = this.ctx.storage.sql
      .exec<PublicPolicyRow>(
        `SELECT mode, policy_version, cutoff_generation
         FROM document_public_policy_v2
         WHERE singleton = 1
         LIMIT 1`,
      )
      .toArray()[0];
    return (
      row !== undefined &&
      row.mode === attachment.mode &&
      row.policy_version === attachment.policyVersion &&
      row.cutoff_generation === attachment.cutoffGeneration
    );
  }

  private namedEditIsEnabled() {
    return namedEditEnabled(this.env as Env & Parameters<typeof namedEditEnabled>[0]);
  }

  private isPrivateReviewSocket(attachment: SocketAttachment) {
    return (
      this.namedEditIsEnabled() &&
      (attachment.protocolVersion === OWNER_REALTIME_PROTOCOL_VERSION ||
        attachment.protocolVersion === NAMED_EDIT_PROTOCOL_VERSION) &&
      attachment.capabilities.includes('doc.edit')
    );
  }

  private historyActorRole(attachment: StandardSocketAttachment): 'owner' | 'editor' {
    return attachment.protocolVersion === OWNER_REALTIME_PROTOCOL_VERSION ? 'owner' : 'editor';
  }

  private isSharedHistorySocket(attachment: StandardSocketAttachment) {
    return (
      attachment.protocolVersion !== REALTIME_PROTOCOL_VERSION &&
      attachment.historyGeneration !== undefined &&
      attachment.capabilities.includes('doc.edit')
    );
  }

  private hasSharedHistory() {
    return (
      this.ctx.storage.sql
        .exec('SELECT 1 FROM shared_history_state_v1 WHERE singleton = 1')
        .toArray().length > 0
    );
  }

  private isCurrentHistorySocket(attachment: StandardSocketAttachment) {
    return (
      attachment.protocolVersion === REALTIME_PROTOCOL_VERSION ||
      (attachment.historyGeneration ?? 0) === sharedHistoryGeneration(this.ctx.storage)
    );
  }

  private keepCurrentHistorySocket(ws: WebSocket, attachment: StandardSocketAttachment) {
    if (this.isCurrentHistorySocket(attachment)) return true;
    try {
      ws.close(4410, 'document-restored');
    } catch {
      // A hibernated socket may already be closed. It is excluded either way.
    }
    return false;
  }

  private handleSharedHistory(
    ws: WebSocket,
    attachment: StandardSocketAttachment,
    message: ClientMessage,
  ) {
    const command = parseSharedHistoryCommand(message);
    if (!command) return;
    const { roomId, actorId } = attachment;
    const publicStateVector =
      command.type === 'shared-history-restore' ? this.readPublicStateVector() : undefined;
    const result = resolveSharedHistoryRequest({
      storage: this.ctx.storage,
      roomId,
      actorId,
      actorRole: this.historyActorRole(attachment),
      command,
      getCurrentProjection: () => this.loadProjection(),
      initialUpdate: () => this.initialPromotionUpdate(),
      prepareReplay: (sequence) => this.repairHistoryCheckpointsThrough(sequence),
      insertRestoreUpdate: (update) => this.insertUpdate(actorId, 'restore', update),
      isCurrent: () =>
        this.isSharedHistorySocket(attachment) && this.isCurrentHistorySocket(attachment),
    });
    try {
      ws.send(JSON.stringify(result.frame));
    } finally {
      if (result.restored) {
        this.advanceProjection(result.restored.update);
        // Account sockets from the previous generation are cut off before this
        // delivery. Public viewers receive only the current projected body.
        this.broadcastYjsUpdate(roomId, result.restored, { publicStateVector });
      }
    }
  }

  private handleReviewOperation(
    ws: WebSocket,
    attachment: StandardSocketAttachment,
    message: ClientMessage,
  ) {
    const { roomId, actorId } = attachment;
    const operationId = isNamedEditInviteId(message.operationId) ? message.operationId : null;
    const publicStateVector = this.readPublicStateVector();
    const appended: { update?: PersistedRealtimeUpdate } = {};
    let committed: ReturnType<typeof commitCollaboratorReviewOperation>;
    try {
      committed = commitCollaboratorReviewOperation({
        storage: this.ctx.storage,
        actorId,
        operationId,
        operation: message.operation,
        suggestions: {
          validateProposal: (proposal) => {
            const projection = loadRoomYjsProjection(this.hydrationUpdates());
            if (!projection) return false;
            try {
              return isCurrentRoomSuggestion(projection, proposal);
            } finally {
              projection.destroy();
            }
          },
          applyProposal: (proposal) => {
            const projection = loadRoomYjsProjection(this.hydrationUpdates());
            if (!projection) return null;
            try {
              const beforeBody = readCanonicalRoomYjsBody(projection);
              if (beforeBody === null) return null;
              const update = prepareRoomSuggestionDecision(projection, proposal);
              if (!update) return null;
              const afterBody = readCanonicalRoomYjsBody(projection);
              if (afterBody === null || afterBody === beforeBody) return null;
              appended.update = this.insertUpdate(
                actorId,
                'client',
                bytesToBase64(update),
                projection,
              );
              appendSharedHistoryEdit({
                storage: this.ctx.storage,
                roomId,
                actorRole: this.historyActorRole(attachment),
                beforeBody,
                afterBody,
                update: appended.update,
                source: 'suggestion-accept',
              });
              return appended.update.sequence;
            } finally {
              projection.destroy();
            }
          },
        },
      });
    } catch {
      ws.send(
        JSON.stringify({ type: 'review-error', roomId, operationId, code: 'review_unavailable' }),
      );
      return;
    }
    if (!committed.ok) {
      ws.send(JSON.stringify({ type: 'review-error', roomId, operationId, code: committed.code }));
      return;
    }
    const payload = JSON.stringify({
      type: 'review-operation',
      roomId,
      operation: committed.operation,
    });
    if (committed.duplicate) {
      ws.send(payload);
    } else {
      if (appended.update) {
        this.advanceProjection(appended.update.update);
        this.broadcastYjsUpdate(roomId, appended.update, { publicStateVector });
      }
      for (const peer of this.currentSockets({ roomId })) {
        if (this.isPrivateReviewSocket(peer.attachment)) peer.ws.send(payload);
      }
    }
    ws.send(
      JSON.stringify({
        type: 'review-ack',
        roomId,
        operationId,
        sequence: committed.operation.sequence,
      }),
    );
  }

  private readPublicStateVector() {
    return this.projectionCache ? encodeRoomYjsStateVector(this.projectionCache) : undefined;
  }

  private broadcastYjsUpdate(
    roomId: string,
    persisted: PersistedRealtimeUpdate,
    options: { exclude?: WebSocket; publicStateVector?: Uint8Array } = {},
  ) {
    const payload = JSON.stringify({
      type: 'yjs-update',
      actorId: persisted.actorId,
      roomId,
      sequence: persisted.sequence,
      source: persisted.source,
      update: persisted.update,
    });
    let publicPayload: string | null | undefined;
    for (const peer of this.currentSockets({ roomId, exclude: options.exclude })) {
      if (peer.attachment.protocolVersion !== PUBLIC_REALTIME_PROTOCOL_VERSION) {
        peer.ws.send(payload);
        continue;
      }
      if (publicPayload === undefined) {
        const projection = this.loadProjection();
        const update =
          projection && encodePublicYjsProjection(projection, options.publicStateVector);
        publicPayload = update ? JSON.stringify({ type: 'yjs-update', roomId, update }) : null;
      }
      if (publicPayload) peer.ws.send(publicPayload);
      else this.closePublicPolicyChangedSocket(peer.ws);
    }
  }

  private loadProjection(): Y.Doc | null {
    this.projectionCache ??= loadRoomYjsProjection(this.hydrationUpdates());
    return this.projectionCache;
  }

  private clearProjection() {
    this.projectionCache?.destroy();
    this.projectionCache = null;
    this.canonicalBodyCache = null;
  }

  private publicProjectionCanBeShared() {
    const projection = this.loadProjection();
    return projection !== null && isSafePublicYjsProjection(projection);
  }

  private readCanonicalBody() {
    const projection = this.loadProjection();
    if (!projection) return null;
    this.canonicalBodyCache ??= readCanonicalRoomYjsBody(projection);
    return this.canonicalBodyCache;
  }

  private validateAccountProjection(update: string) {
    const projection = this.loadProjection();
    const body = projection && applyNamedEditYjsUpdate(projection, update);
    if (body !== null) return body;
    this.clearProjection();
    return null;
  }

  private advanceProjection(update: string) {
    this.canonicalBodyCache = null;
    if (this.projectionCache && !applyRoomYjsUpdate(this.projectionCache, update)) {
      this.clearProjection();
    }
  }

  private namedEditGrantIsCurrent(roomId: string, grant: NamedEditGrant, nowMs: number) {
    return (
      this.namedEditIsEnabled() &&
      isCurrentNamedEditGrant({ storage: this.ctx.storage, roomId, grant, nowMs })
    );
  }

  private keepNamedEditSocket(ws: WebSocket, attachment: StandardSocketAttachment) {
    const grant = attachment.namedEditGrant;
    const now = Date.now();
    if (grant && this.namedEditGrantIsCurrent(attachment.roomId, grant, now)) return true;
    try {
      if (grant && grant.expiresAtMs <= now) {
        ws.close(1012, 'named-session-expired');
      } else {
        ws.close(4403, 'named-access-revoked');
      }
    } catch {
      // A hibernated socket may already be closed. It is excluded either way.
    }
    return false;
  }

  private async namedEdit(request: Request): Promise<Response> {
    if (!this.namedEditIsEnabled()) {
      return namedEditResponse(namedEditFailure('named-edit-disabled'));
    }
    const url = new URL(request.url);
    const route = /^\/__lash-room\/named-edit\/([^/]+)\/(issue|list|revoke|session)$/u.exec(
      url.pathname,
    );
    const roomId = route?.[1];
    const principalId = request.headers.get('x-lash-control-principal-id');
    const requestId = request.headers.get('x-lash-control-request-id');
    if (
      request.method !== 'POST' ||
      url.search !== '' ||
      request.headers.get('x-lash-internal-management') !== 'named-edit-v1' ||
      !isNamedEditRoomId(roomId) ||
      !isNamedEditPrincipal(principalId) ||
      !isNamedEditInviteId(requestId)
    ) {
      return namedEditResponse(namedEditFailure('unauthorized'));
    }
    const body = await readPromotionBody(request, NAMED_EDIT_REQUEST_LIMIT);
    const command = body.ok
      ? parseNamedEditCommand(route![2] as NamedEditAction, body.value)
      : null;
    if (!command) return namedEditResponse(namedEditFailure('invalid-request'));
    const result = await executeNamedEdit({
      storage: this.ctx.storage,
      command,
      principalId,
      roomId,
      requestId,
      nowMs: Date.now(),
    });
    if (result.ok && command.action === 'revoke') this.broadcastAwareness(roomId);
    return namedEditResponse(result);
  }

  private latestSnapshot(throughSequence?: number): PersistedRealtimeSnapshot | null {
    if (throughSequence !== undefined) {
      return snapshotFromRow(
        this.ctx.storage.sql
          .exec<SnapshotRow>(
            `SELECT sequence, update_b64, created_at FROM yjs_snapshots WHERE sequence <= ?
             ORDER BY sequence DESC LIMIT 1`,
            throughSequence,
          )
          .toArray()[0],
      );
    }
    return snapshotFromRow(
      this.ctx.storage.sql
        .exec<SnapshotRow>(
          'SELECT sequence, update_b64, created_at FROM yjs_snapshots ORDER BY sequence DESC LIMIT 1',
        )
        .toArray()[0],
    );
  }

  private updatesAfter(sequence: number): PersistedRealtimeUpdate[] {
    return this.ctx.storage.sql
      .exec<UpdateRow>(
        `SELECT sequence, actor_id, source, update_b64, created_at
         FROM yjs_updates
         WHERE sequence > ?
         ORDER BY sequence ASC`,
        sequence,
      )
      .toArray()
      .map(updateFromRow);
  }

  private updateCount() {
    const row = this.ctx.storage.sql
      .exec<{ count: number }>('SELECT COUNT(*) AS count FROM yjs_updates')
      .toArray()[0];
    return row.count;
  }

  private hydrationUpdates() {
    const snapshot = this.latestSnapshot();
    return buildPromotedHydrationUpdates(
      this.initialPromotionUpdate(),
      snapshot,
      this.updatesAfter(snapshot?.sequence ?? 0),
    );
  }

  private publicHydrationInventory() {
    const highWaterSequence =
      this.ctx.storage.sql
        .exec<{ sequence: number | null }>('SELECT MAX(sequence) AS sequence FROM yjs_updates')
        .toArray()[0]?.sequence ?? 0;
    const projection = this.loadProjection();
    const update = projection && encodePublicYjsProjection(projection);
    if (!update) throw new Error('Public document projection is unavailable.');
    return {
      highWaterSequence,
      updates: [update],
    };
  }

  private initialPromotionUpdate() {
    const row = this.ctx.storage.sql
      .exec<{ initial_update_b64: string }>(
        `SELECT initial_update_b64
         FROM document_projection_v1
         WHERE singleton = 1 AND shareable = 1
         LIMIT 1`,
      )
      .toArray()[0];
    return row?.initial_update_b64 ?? null;
  }

  private appendUpdate(
    actorId: string,
    source: RealtimeUpdateSource,
    update: string,
    history?: {
      roomId: string;
      actorRole: 'owner' | 'editor';
      beforeBody: string;
      afterBody: string;
    },
  ): PersistedRealtimeUpdate {
    try {
      const persisted = this.ctx.storage.transactionSync(() => {
        const row = this.insertUpdate(
          actorId,
          source,
          update,
          history ? this.projectionCache : null,
        );
        if (history)
          appendSharedHistoryEdit({ storage: this.ctx.storage, ...history, update: row });
        return row;
      });
      if (history) this.canonicalBodyCache = history.afterBody;
      else this.advanceProjection(update);
      return persisted;
    } catch (error) {
      this.clearProjection();
      throw error;
    }
  }

  private insertUpdate(
    actorId: string,
    source: RealtimeUpdateSource,
    update: string,
    acceptedProjection: Y.Doc | null = null,
  ): PersistedRealtimeUpdate {
    if (!isRealtimeUpdatePayload(update)) throw new Error('Invalid document update.');
    const candidate =
      acceptedProjection ?? loadRoomYjsProjection([...this.hydrationUpdates(), update]);
    if (!candidate) throw new Error('Document update could not be applied.');
    let checkpoint: Uint8Array | null;
    try {
      checkpoint = encodeRealtimeCheckpoint(candidate);
    } finally {
      if (!acceptedProjection) candidate.destroy();
    }
    if (!checkpoint) throw new Error('Document exceeds the durable checkpoint limit.');

    const createdAt = new Date().toISOString();
    const row = this.ctx.storage.sql
      .exec<{ sequence: number }>(
        `INSERT INTO yjs_updates (actor_id, source, update_b64, created_at)
         VALUES (?, ?, ?, ?)
         RETURNING sequence`,
        actorId,
        source,
        update,
        createdAt,
      )
      .toArray()[0];
    this.writeCheckpointIfDue(row.sequence, checkpoint, createdAt);
    return {
      sequence: row.sequence,
      actorId,
      source,
      update,
      createdAt,
    };
  }

  private writeCheckpointIfDue(sequence: number, checkpoint: Uint8Array, createdAt: string) {
    const snapshot = this.latestSnapshot();
    const snapshotSequence = snapshot?.sequence ?? 0;
    if (!shouldCompactRealtimeUpdates(sequence - snapshotSequence)) return;
    const initialUpdate = this.initialPromotionUpdate();
    if (initialUpdate && sequence - snapshotSequence > REALTIME_SNAPSHOT_INTERVAL) {
      this.retainMissingHistoryCheckpoints(sequence - 1, initialUpdate, snapshot);
    }
    this.writeSnapshot(sequence, checkpoint, createdAt);
    if (!initialUpdate) {
      this.ctx.storage.sql.exec('DELETE FROM yjs_snapshots WHERE sequence < ?', sequence);
    }
  }

  private writeSnapshot(sequence: number, checkpoint: Uint8Array, createdAt: string) {
    this.ctx.storage.sql.exec(
      `INSERT INTO yjs_snapshots (sequence, update_b64, created_at)
       VALUES (?, ?, ?)`,
      sequence,
      bytesToBase64(checkpoint),
      createdAt,
    );
  }

  private repairLegacyCheckpointGap() {
    const head =
      this.ctx.storage.sql
        .exec<{ sequence: number | null }>('SELECT MAX(sequence) AS sequence FROM yjs_updates')
        .toArray()[0]?.sequence ?? 0;
    return this.repairHistoryCheckpointsThrough(head);
  }

  private repairHistoryCheckpointsThrough(sequence: number) {
    const snapshot = this.latestSnapshot(sequence);
    if (!shouldCompactRealtimeUpdates(sequence - (snapshot?.sequence ?? 0))) return true;
    const initialUpdate = this.initialPromotionUpdate();
    if (!initialUpdate) return false;
    try {
      this.ctx.storage.transactionSync(() =>
        this.retainMissingHistoryCheckpoints(sequence, initialUpdate, snapshot),
      );
      return true;
    } catch {
      return false;
    }
  }

  private retainMissingHistoryCheckpoints(
    throughSequence: number,
    initialUpdate: string,
    snapshot: PersistedRealtimeSnapshot | null,
  ) {
    let sequence = snapshot?.sequence ?? 0;
    if (!shouldCompactRealtimeUpdates(throughSequence - sequence)) return;
    const doc = loadRoomYjsProjection([snapshot?.update ?? initialUpdate]);
    if (!doc) throw new Error('Durable history checkpoint could not be opened.');
    try {
      while (shouldCompactRealtimeUpdates(throughSequence - sequence)) {
        const updates = this.ctx.storage.sql
          .exec<UpdateRow>(
            `SELECT sequence, actor_id, source, update_b64, created_at FROM yjs_updates
             WHERE sequence > ? AND sequence <= ? ORDER BY sequence LIMIT ?`,
            sequence,
            throughSequence,
            REALTIME_SNAPSHOT_INTERVAL,
          )
          .toArray();
        if (updates.length < REALTIME_SNAPSHOT_INTERVAL) return;
        if (updates.some((row) => !applyRoomYjsUpdate(doc, row.update_b64))) {
          throw new Error('Durable history could not be reconstructed.');
        }
        const checkpoint = encodeRealtimeCheckpoint(doc);
        if (!checkpoint) throw new Error('Durable history exceeds the checkpoint limit.');
        const latest = updates.at(-1)!;
        this.writeSnapshot(latest.sequence, checkpoint, latest.created_at);
        sequence = latest.sequence;
      }
    } finally {
      doc.destroy();
    }
  }

  private async restore(request: Request, roomId: string, actorId: string): Promise<Response> {
    const body = await readPromotionBody(request, REALTIME_UPDATE_BASE64_LIMIT + 1024);
    if (!body.ok || !body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
      return json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    const update = (body.value as { update?: unknown }).update;
    if (typeof update !== 'string' || !isValidYjsUpdate(update)) {
      return json({ ok: false, error: 'invalid_yjs_update' }, { status: 400 });
    }

    let persisted: PersistedRealtimeUpdate;
    try {
      persisted = this.appendUpdate(actorId, 'restore', update);
    } catch {
      return json({ ok: false, error: 'document-write-unavailable' }, { status: 503 });
    }
    this.broadcastYjsUpdate(roomId, persisted);

    return json({
      ok: true,
      roomId,
      sequence: persisted.sequence,
      source: persisted.source,
    });
  }

  private async publicComments(request: Request, action: 'list' | 'create'): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== 'POST' ||
      url.pathname !== `/__lash-room/public-comments/${action}` ||
      url.search !== '' ||
      request.headers.get('x-lash-internal-management') !== 'public-comment-v1'
    ) {
      return json(
        { ok: false, version: 1, error: 'unauthorized', retryable: false },
        { status: 401 },
      );
    }
    const body = await readPromotionBody(request);
    const maxBytes = action === 'list' ? 1_024 : 8_192;
    if (
      !body.ok ||
      body.body.byteLength > maxBytes ||
      !body.value ||
      typeof body.value !== 'object' ||
      Array.isArray(body.value)
    ) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: body.ok && body.body.byteLength > maxBytes ? 413 : 400 },
      );
    }
    const command = body.value as Record<string, unknown>;
    if (
      Object.keys(command).sort().join(',') !== 'bodySha256,publicComment,requestId,version' ||
      command.version !== 1 ||
      typeof command.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        command.requestId,
      ) ||
      typeof command.bodySha256 !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(command.bodySha256) ||
      !command.publicComment ||
      typeof command.publicComment !== 'object' ||
      Array.isArray(command.publicComment)
    ) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 400 },
      );
    }
    const publicComment = command.publicComment as Record<string, unknown>;
    const roomId = typeof publicComment.roomId === 'string' ? publicComment.roomId : '';
    const parsed =
      action === 'list'
        ? parsePublicCommentListRequest(publicComment, roomId)
        : parsePublicCommentCreateRequest(
            publicComment,
            roomId,
            typeof publicComment.commenterPrincipalId === 'string'
              ? publicComment.commenterPrincipalId
              : '',
          );
    if (!parsed.ok) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 400 },
      );
    }
    const store = new SqlPublicCommentStore(this.ctx.storage);
    const execution =
      action === 'list'
        ? listPublicComments({
            store,
            request: parsed.request as import('@lash/types').PublicCommentListRequestV1,
            requestId: command.requestId,
            bodySha256: command.bodySha256,
            nowMs: Date.now(),
          })
        : createPublicComment({
            store,
            request: parsed.request as import('@lash/types').PublicCommentCreateRequestV1,
            requestId: command.requestId,
            bodySha256: command.bodySha256,
            nowMs: Date.now(),
            randomUUID: () => crypto.randomUUID(),
          });
    return json(execution.result, {
      status: execution.status,
      headers:
        execution.retryAfterSeconds === undefined
          ? undefined
          : { 'retry-after': String(Math.min(86_400, execution.retryAfterSeconds)) },
    });
  }

  private async publicCommentModeration(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== 'POST' ||
      url.pathname !== '/__lash-room/public-comments/moderate' ||
      url.search !== '' ||
      request.headers.get('x-lash-internal-management') !== 'public-comment-moderation-v1'
    ) {
      return json(
        { ok: false, version: 1, error: 'unauthorized', retryable: false },
        { status: 401 },
      );
    }
    const body = await readPromotionBody(request);
    if (
      !body.ok ||
      body.body.byteLength > 4_096 ||
      !body.value ||
      typeof body.value !== 'object' ||
      Array.isArray(body.value)
    ) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: body.ok && body.body.byteLength > 4_096 ? 413 : 400 },
      );
    }
    const command = body.value as Record<string, unknown>;
    if (
      Object.keys(command).sort().join(',') !== 'bodySha256,publicComment,requestId,version' ||
      command.version !== 1 ||
      typeof command.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        command.requestId,
      ) ||
      typeof command.bodySha256 !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(command.bodySha256) ||
      !command.publicComment ||
      typeof command.publicComment !== 'object' ||
      Array.isArray(command.publicComment)
    ) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 400 },
      );
    }
    const internal = command.publicComment as Record<string, unknown>;
    const roomId = typeof internal.roomId === 'string' ? internal.roomId : '';
    const { roomId: _roomId, ...external } = internal;
    const parsed = await parsePublicCommentModerationRequest(
      external,
      typeof external.claimId === 'string' ? external.claimId : '',
      typeof external.ownerPrincipalId === 'string' ? external.ownerPrincipalId : '',
    );
    if (!parsed.ok || !/^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u.test(roomId)) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 400 },
      );
    }
    const resultValue = moderatePublicComment({
      store: new SqlPublicCommentStore(this.ctx.storage),
      request: { ...parsed.request, roomId },
      bodySha256: command.bodySha256,
      moderatedAt: new Date().toISOString(),
    });
    const status = resultValue.ok
      ? 200
      : resultValue.error === 'claim-not-found' || resultValue.error === 'comment-not-found'
        ? 404
        : resultValue.error === 'claim-conflict' ||
            resultValue.error === 'owner-mismatch' ||
            resultValue.error === 'not-shareable' ||
            resultValue.error === 'policy-conflict' ||
            resultValue.error === 'replay-detected'
          ? 409
          : 500;
    return json(resultValue, { status });
  }

  private async publicSession(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== 'POST' ||
      url.pathname !== '/__lash-room/public-session' ||
      url.search !== '' ||
      request.headers.get('x-lash-internal-management') !== 'public-session-v1'
    ) {
      return json(
        { ok: false, version: 1, error: 'unauthorized', retryable: false },
        { status: 401 },
      );
    }
    const body = await readPromotionBody(request);
    if (
      !body.ok ||
      body.body.byteLength > 2048 ||
      !body.value ||
      typeof body.value !== 'object' ||
      Array.isArray(body.value)
    ) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 400 },
      );
    }
    const command = body.value as Record<string, unknown>;
    if (
      Object.keys(command).sort().join(',') !== 'bodySha256,publicSession,requestId,version' ||
      command.version !== 1 ||
      typeof command.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        command.requestId,
      ) ||
      typeof command.bodySha256 !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(command.bodySha256) ||
      !command.publicSession ||
      typeof command.publicSession !== 'object' ||
      Array.isArray(command.publicSession)
    ) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 400 },
      );
    }
    const roomId =
      typeof (command.publicSession as Record<string, unknown>).roomId === 'string'
        ? String((command.publicSession as Record<string, unknown>).roomId)
        : '';
    const parsed = parsePublicControlSessionRequest(command.publicSession, roomId);
    if (!parsed.ok) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 400 },
      );
    }
    if (!this.publicProjectionCanBeShared()) {
      return json(
        { ok: false, version: 1, error: 'document-unavailable', retryable: false },
        { status: 404 },
      );
    }
    const result = await issuePublicSocketTicket({
      store: new SqlPublicSessionStore(this.ctx.storage),
      request: parsed.request,
      requestId: command.requestId,
      bodySha256: command.bodySha256,
      nowMs: Date.now(),
      randomBytes: () => crypto.getRandomValues(new Uint8Array(32)),
    });
    const status = result.ok
      ? 200
      : result.error === 'invalid-request'
        ? 400
        : result.error === 'unauthorized'
          ? 401
          : result.error === 'document-unavailable'
            ? 404
            : result.error === 'replay-detected' || result.error === 'protocol-mismatch'
              ? 409
              : result.error === 'rate-limited'
                ? 429
                : 500;
    return json(result, { status });
  }

  private async ownerSession(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== 'POST' ||
      url.pathname !== '/__lash-room/owner-session' ||
      url.search.length !== 0 ||
      request.headers.get('x-lash-internal-management') !== 'owner-session-v1'
    ) {
      return json(
        { ok: false, version: 1, error: 'claim-conflict', retryable: false },
        {
          status: 404,
        },
      );
    }
    const bodyDecision = await readPromotionBody(request);
    if (
      !bodyDecision.ok ||
      bodyDecision.body.byteLength > 4096 ||
      !bodyDecision.value ||
      typeof bodyDecision.value !== 'object' ||
      Array.isArray(bodyDecision.value)
    ) {
      return json(
        { ok: false, version: 1, error: 'claim-conflict', retryable: false },
        {
          status: 400,
        },
      );
    }
    const command = bodyDecision.value as Record<string, unknown>;
    if (
      Object.keys(command).sort().join(',') !== 'bodySha256,ownerSession,requestId,version' ||
      command.version !== 1 ||
      typeof command.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        command.requestId,
      ) ||
      typeof command.bodySha256 !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(command.bodySha256) ||
      !command.ownerSession ||
      typeof command.ownerSession !== 'object' ||
      Array.isArray(command.ownerSession)
    ) {
      return json(
        { ok: false, version: 1, error: 'claim-conflict', retryable: false },
        {
          status: 400,
        },
      );
    }
    const ownerSession = command.ownerSession as Record<string, unknown>;
    if (
      Object.keys(ownerSession).sort().join(',') !==
        'actorId,claimId,localDocumentId,ownerPrincipalId,promotionSnapshotSha256,protocolVersion,roomId,version' ||
      typeof ownerSession.roomId !== 'string' ||
      typeof ownerSession.promotionSnapshotSha256 !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(ownerSession.promotionSnapshotSha256)
    ) {
      return json(
        { ok: false, version: 1, error: 'claim-conflict', retryable: false },
        {
          status: 400,
        },
      );
    }
    const parsed = await parseOwnerSessionManagementRequest(
      {
        version: ownerSession.version,
        claimId: ownerSession.claimId,
        ownerPrincipalId: ownerSession.ownerPrincipalId,
        localDocumentId: ownerSession.localDocumentId,
        actorId: ownerSession.actorId,
        protocolVersion: ownerSession.protocolVersion,
      },
      typeof ownerSession.claimId === 'string' ? ownerSession.claimId : '',
    );
    if (!parsed.ok) {
      return json(
        { ok: false, version: 1, error: 'claim-conflict', retryable: false },
        {
          status: 400,
        },
      );
    }

    const result = await issueOwnerSocketTicket({
      store: new SqlOwnerSessionTicketStore(this.ctx.storage),
      request: parsed.request,
      roomId: ownerSession.roomId,
      promotionSnapshotSha256: ownerSession.promotionSnapshotSha256,
      requestId: command.requestId,
      bodySha256: command.bodySha256,
      nowMs: Date.now(),
      randomBytes: () => crypto.getRandomValues(new Uint8Array(32)),
    });
    const status = result.ok
      ? 200
      : result.error === 'claim-not-found'
        ? 404
        : result.error === 'claim-conflict' ||
            result.error === 'owner-mismatch' ||
            result.error === 'not-shareable'
          ? 409
          : 500;
    return json(result, { status });
  }

  private async publicPolicy(request: Request, action: 'read' | 'update'): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== 'POST' ||
      url.pathname !== `/__lash-room/public-policy/${action}` ||
      url.search.length !== 0 ||
      request.headers.get('x-lash-internal-management') !== 'public-policy-v1'
    ) {
      return json(
        { ok: false, version: 1, error: 'claim-conflict', retryable: false },
        { status: 404 },
      );
    }
    const bodyDecision = await readPromotionBody(request);
    if (
      !bodyDecision.ok ||
      bodyDecision.body.byteLength > 4096 ||
      !bodyDecision.value ||
      typeof bodyDecision.value !== 'object' ||
      Array.isArray(bodyDecision.value)
    ) {
      return json(
        { ok: false, version: 1, error: 'claim-conflict', retryable: false },
        { status: 400 },
      );
    }
    const command = bodyDecision.value as Record<string, unknown>;
    if (
      Object.keys(command).sort().join(',') !== 'bodySha256,publicPolicy,requestId,version' ||
      command.version !== 1 ||
      typeof command.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        command.requestId,
      ) ||
      typeof command.bodySha256 !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(command.bodySha256) ||
      !command.publicPolicy ||
      typeof command.publicPolicy !== 'object' ||
      Array.isArray(command.publicPolicy)
    ) {
      return json(
        { ok: false, version: 1, error: 'claim-conflict', retryable: false },
        { status: 400 },
      );
    }
    const publicPolicy = command.publicPolicy as Record<string, unknown>;
    const expectedKeys =
      action === 'read'
        ? 'claimId,localDocumentId,ownerPrincipalId,roomId,version'
        : 'claimId,expectedPolicyVersion,localDocumentId,mode,mutationId,ownerPrincipalId,roomId,version';
    if (
      Object.keys(publicPolicy).sort().join(',') !== expectedKeys ||
      typeof publicPolicy.roomId !== 'string' ||
      !/^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u.test(publicPolicy.roomId)
    ) {
      return json(
        { ok: false, version: 1, error: 'claim-conflict', retryable: false },
        { status: 400 },
      );
    }
    const requestValue = {
      version: publicPolicy.version,
      claimId: publicPolicy.claimId,
      ownerPrincipalId: publicPolicy.ownerPrincipalId,
      localDocumentId: publicPolicy.localDocumentId,
      ...(action === 'update'
        ? {
            mode: publicPolicy.mode,
            expectedPolicyVersion: publicPolicy.expectedPolicyVersion,
            mutationId: publicPolicy.mutationId,
          }
        : {}),
    };
    const store = new SqlPublicPolicyStore(this.ctx.storage);
    let result: PublicPolicyRoomResult;
    if (action === 'read') {
      const parsed = await parsePublicPolicyReadRequest(
        requestValue,
        typeof publicPolicy.claimId === 'string' ? publicPolicy.claimId : '',
      );
      if (!parsed.ok) {
        return json(
          { ok: false, version: 1, error: 'claim-conflict', retryable: false },
          { status: 400 },
        );
      }
      result = readOwnerPublicPolicy({
        store,
        request: parsed.request,
        roomId: publicPolicy.roomId,
      });
    } else {
      const parsed = await parsePublicPolicyUpdateRequest(
        requestValue,
        typeof publicPolicy.claimId === 'string' ? publicPolicy.claimId : '',
      );
      if (!parsed.ok) {
        return json(
          { ok: false, version: 1, error: 'claim-conflict', retryable: false },
          { status: 400 },
        );
      }
      result = updateOwnerPublicPolicy({
        store,
        request: parsed.request,
        roomId: publicPolicy.roomId,
        bodySha256: command.bodySha256,
        changedAt: new Date().toISOString(),
        canShareProjection: () => this.publicProjectionCanBeShared(),
      });
    }
    if (result.ok && 'changed' in result && result.changed) {
      closeStalePublicSockets(this.ctx.getWebSockets(), {
        mode: result.mode,
        policyVersion: result.policyVersion,
        cutoffGeneration: result.cutoffGeneration,
      });
    }
    if ((result.ok || result.error === 'policy-conflict') && !this.publicProjectionCanBeShared()) {
      if (result.ok) result = { ...result, publicPath: null, publicProjectionBlocked: true };
      else
        result = {
          ...result,
          state: { ...result.state, publicPath: null, publicProjectionBlocked: true },
        };
    }
    return json(result, { status: publicPolicyStatusFor(result) });
  }

  private async promote(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== 'POST' ||
      url.search.length !== 0 ||
      request.headers.get('x-lash-internal-management') !== 'promotion-v1'
    ) {
      return json(
        { ok: false, version: 1, error: 'unauthorized', retryable: false },
        {
          status: 404,
        },
      );
    }
    const bodyDecision = await readPromotionBody(request);
    if (!bodyDecision.ok) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        {
          status: bodyDecision.status,
        },
      );
    }
    const value = bodyDecision.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 400 },
      );
    }
    const command = value as Record<string, unknown>;
    const keys = Object.keys(command).sort();
    if (
      keys.length !== 4 ||
      keys[0] !== 'bodySha256' ||
      keys[1] !== 'promotion' ||
      keys[2] !== 'requestId' ||
      keys[3] !== 'version' ||
      command.version !== 1 ||
      typeof command.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        command.requestId,
      ) ||
      typeof command.bodySha256 !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(command.bodySha256)
    ) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 400 },
      );
    }
    const roomId =
      command.promotion &&
      typeof command.promotion === 'object' &&
      !Array.isArray(command.promotion) &&
      typeof (command.promotion as Record<string, unknown>).roomId === 'string'
        ? ((command.promotion as Record<string, unknown>).roomId as string)
        : '';
    const parsed = await parseDocumentPromotionRequest(command.promotion, roomId);
    if (!parsed.ok) {
      return json(
        { ok: false, version: 1, error: 'invalid-request', retryable: false },
        { status: 400 },
      );
    }
    const result = executeDocumentPromotion(new SqlDocumentPromotionStore(this.ctx.storage), {
      request: parsed.request,
      requestId: command.requestId,
      bodySha256: command.bodySha256,
      createdAt: new Date().toISOString(),
    });
    const status = result.ok
      ? 200
      : result.error === 'promotion-not-found'
        ? 404
        : result.error === 'replay-detected' ||
            result.error === 'owner-mismatch' ||
            result.error === 'promotion-conflict'
          ? 409
          : 500;
    return json(result, { status });
  }

  private closeProtocolOldSocket(ws: WebSocket) {
    try {
      ws.close(PROTOCOL_UPGRADE_CLOSE_CODE, PROTOCOL_UPGRADE_CLOSE_REASON);
    } catch {
      // A hibernated peer may already be closed. Exclusion remains the boundary.
    }
  }

  private closePublicPolicyChangedSocket(ws: WebSocket) {
    try {
      ws.close(4403, 'public-policy-changed');
    } catch {
      // A hibernated peer may already be closed. Exclusion remains the boundary.
    }
  }

  private currentSockets(
    options: {
      exclude?: WebSocket;
      hydratedOnly?: boolean;
      roomId?: string;
    } = {},
  ): Array<{ ws: WebSocket; attachment: SocketAttachment }> {
    const current: Array<{ ws: WebSocket; attachment: SocketAttachment }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (!isOpenSocket(ws)) continue;
      const attachment = readAttachment(ws);
      if (!attachment) {
        this.closeProtocolOldSocket(ws);
        continue;
      }
      if (
        attachment.protocolVersion === PUBLIC_REALTIME_PROTOCOL_VERSION &&
        attachment.hydrated &&
        (!this.isCurrentPublicPolicy(attachment) || !this.publicProjectionCanBeShared())
      ) {
        this.closePublicPolicyChangedSocket(ws);
        continue;
      }
      if (
        attachment.protocolVersion === NAMED_EDIT_PROTOCOL_VERSION &&
        !this.keepNamedEditSocket(ws, attachment)
      ) {
        continue;
      }
      if (
        attachment.protocolVersion !== PUBLIC_REALTIME_PROTOCOL_VERSION &&
        !this.keepCurrentHistorySocket(ws, attachment)
      ) {
        continue;
      }
      if (options.exclude === ws) continue;
      if (options.hydratedOnly !== false && !attachment.hydrated) continue;
      if (options.roomId && attachment.roomId !== options.roomId) continue;
      current.push({ ws, attachment });
    }
    return current;
  }
}
