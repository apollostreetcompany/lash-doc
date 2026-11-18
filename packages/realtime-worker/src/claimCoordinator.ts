import { DurableObject } from 'cloudflare:workers';

import { parsePublicAccessMode } from './documentAuthority';
import {
  coordinateDocumentClaimPromotion,
  parseDocumentClaimPromotionRequest,
  resolveOwnerSessionAlias,
  type DocumentClaimAliasStore,
  type DocumentClaimAliasV1,
  type RoomPromotionCall,
} from './documentClaim';
import {
  OWNER_REALTIME_PROTOCOL_VERSION,
  OWNER_SOCKET_PROTOCOL,
  parseOwnerSessionManagementRequest,
  type OwnerSessionResult,
} from './ownerSession';
import { readPromotionBody, type ExecuteDocumentPromotionResult } from './promotion';
import {
  parsePublicCommentModerationRequest,
  type PublicCommentModerationResult,
} from './publicComment';
import {
  parsePublicPolicyReadRequest,
  parsePublicPolicyUpdateRequest,
  type PublicPolicyRoomResult,
} from './publicPolicy';

type ClaimCoordinatorEnvironment = Env & {
  LASH_REALTIME_ROOM: DurableObjectNamespace;
};

type AliasRow = {
  claim_id: string;
  owner_principal_id: string;
  canonical_local_document_id: string;
  room_id: string;
  promotion_snapshot_sha256: string;
  created_at: string;
};

const json = (body: unknown, status: number) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });

const exactKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};

const isBoundedOwnerTicketExpiry = (value: unknown) => {
  if (typeof value !== 'string') return false;
  const expiresAt = Date.parse(value);
  const now = Date.now();
  return (
    Number.isFinite(expiresAt) &&
    new Date(expiresAt).toISOString() === value &&
    expiresAt > now &&
    expiresAt <= now + 60_000
  );
};

const statusFor = (result: Awaited<ReturnType<typeof coordinateDocumentClaimPromotion>>) => {
  if (result.ok) return 200;
  if (result.error === 'promotion-not-found') return 404;
  if (
    result.error === 'claim-conflict' ||
    result.error === 'promotion-conflict' ||
    result.error === 'owner-mismatch' ||
    result.error === 'replay-detected'
  ) {
    return 409;
  }
  return result.retryable ? 500 : 400;
};

const roomStatusFor = (result: ExecuteDocumentPromotionResult) => {
  if (result.ok) return 200;
  if (result.error === 'promotion-not-found') return 404;
  if (
    result.error === 'promotion-conflict' ||
    result.error === 'owner-mismatch' ||
    result.error === 'replay-detected'
  ) {
    return 409;
  }
  return result.retryable ? 500 : 400;
};

const ownerSessionStatusFor = (result: OwnerSessionResult) => {
  if (result.ok) return 200;
  if (result.error === 'claim-not-found') return 404;
  if (
    result.error === 'claim-conflict' ||
    result.error === 'owner-mismatch' ||
    result.error === 'not-shareable'
  ) {
    return 409;
  }
  return 500;
};

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

const publicCommentModerationStatusFor = (result: PublicCommentModerationResult) => {
  if (result.ok) return 200;
  if (result.error === 'claim-not-found' || result.error === 'comment-not-found') return 404;
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

const isPublicPolicyRoomResult = (
  value: unknown,
  action: 'read' | 'update',
): value is PublicPolicyRoomResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.version !== 1 || typeof result.ok !== 'boolean') return false;
  if (!result.ok) {
    if (result.error === 'policy-conflict') {
      if (
        !exactKeys(result, ['ok', 'version', 'error', 'retryable', 'state']) ||
        result.retryable !== false ||
        !result.state ||
        typeof result.state !== 'object' ||
        Array.isArray(result.state)
      ) {
        return false;
      }
      const state = result.state as Record<string, unknown>;
      const mode = parsePublicAccessMode(state.mode);
      const blocked = state.publicProjectionBlocked === true;
      return (
        exactKeys(state, [
          'mode',
          'policyVersion',
          'cutoffGeneration',
          'publicPath',
          ...(blocked ? ['publicProjectionBlocked'] : []),
        ]) &&
        mode !== null &&
        Number.isSafeInteger(state.policyVersion) &&
        Number(state.policyVersion) >= 1 &&
        Number.isSafeInteger(state.cutoffGeneration) &&
        Number(state.cutoffGeneration) >= 0 &&
        state.publicPath ===
          (mode === 'restricted' || blocked
            ? null
            : typeof state.publicPath === 'string' &&
                /^\/public\/doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u.test(state.publicPath)
              ? state.publicPath
              : undefined)
      );
    }
    return (
      exactKeys(result, ['ok', 'version', 'error', 'retryable']) &&
      typeof result.error === 'string' &&
      typeof result.retryable === 'boolean' &&
      (result.retryable
        ? result.error === 'readback-failed' || result.error === 'internal-error'
        : [
            'claim-not-found',
            'claim-conflict',
            'owner-mismatch',
            'not-shareable',
            'replay-detected',
          ].includes(result.error))
    );
  }
  const expected = [
    'ok',
    'version',
    'roomId',
    'ownerPrincipalId',
    'mode',
    'policyVersion',
    'cutoffGeneration',
    'publicPath',
    ...(result.publicProjectionBlocked === true ? ['publicProjectionBlocked'] : []),
    ...(action === 'update' ? ['changed'] : []),
  ];
  const mode = parsePublicAccessMode(result.mode);
  return (
    exactKeys(result, expected) &&
    typeof result.roomId === 'string' &&
    /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u.test(result.roomId) &&
    typeof result.ownerPrincipalId === 'string' &&
    /^account:v1:[A-Za-z0-9_-]{43}$/u.test(result.ownerPrincipalId) &&
    mode !== null &&
    Number.isSafeInteger(result.policyVersion) &&
    Number(result.policyVersion) >= 1 &&
    Number.isSafeInteger(result.cutoffGeneration) &&
    Number(result.cutoffGeneration) >= 0 &&
    result.publicPath ===
      (mode === 'restricted' || result.publicProjectionBlocked === true
        ? null
        : `/public/${String(result.roomId)}`) &&
    (action === 'read' || typeof result.changed === 'boolean')
  );
};

const isOwnerRoomSessionResult = (value: unknown): value is OwnerSessionResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.version !== 1 || typeof result.ok !== 'boolean') return false;
  if (!result.ok) {
    return (
      exactKeys(result, ['ok', 'version', 'error', 'retryable']) &&
      typeof result.error === 'string' &&
      typeof result.retryable === 'boolean' &&
      (result.retryable
        ? result.error === 'readback-failed' || result.error === 'internal-error'
        : ['claim-not-found', 'claim-conflict', 'owner-mismatch', 'not-shareable'].includes(
            result.error,
          ))
    );
  }
  if (
    !exactKeys(result, [
      'ok',
      'version',
      'roomId',
      'ownerPrincipalId',
      'promotionSnapshotSha256',
      'grant',
      'socket',
    ]) ||
    typeof result.roomId !== 'string' ||
    typeof result.ownerPrincipalId !== 'string' ||
    typeof result.promotionSnapshotSha256 !== 'string' ||
    !result.grant ||
    typeof result.grant !== 'object' ||
    Array.isArray(result.grant) ||
    !result.socket ||
    typeof result.socket !== 'object' ||
    Array.isArray(result.socket)
  ) {
    return false;
  }
  const grant = result.grant as Record<string, unknown>;
  const socket = result.socket as Record<string, unknown>;
  return (
    exactKeys(grant, ['source', 'capabilities', 'aclVersion', 'protocolVersion']) &&
    grant.source === 'owner' &&
    Array.isArray(grant.capabilities) &&
    grant.capabilities.length === 2 &&
    grant.capabilities[0] === 'doc.read' &&
    grant.capabilities[1] === 'doc.edit' &&
    Number.isSafeInteger(grant.aclVersion) &&
    Number(grant.aclVersion) > 0 &&
    grant.protocolVersion === OWNER_REALTIME_PROTOCOL_VERSION &&
    exactKeys(socket, ['path', 'ticket', 'expiresAt']) &&
    typeof socket.path === 'string' &&
    typeof socket.ticket === 'string' &&
    /^lash-ticket\.[A-Za-z0-9_-]{43}$/u.test(socket.ticket) &&
    isBoundedOwnerTicketExpiry(socket.expiresAt) &&
    OWNER_SOCKET_PROTOCOL === 'lash-realtime-v3'
  );
};

const isRoomPromotionResult = (value: unknown): value is ExecuteDocumentPromotionResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.version !== 1 || typeof result.ok !== 'boolean') return false;
  if (result.ok) {
    return (
      exactKeys(result, [
        'ok',
        'version',
        'roomId',
        'ownerPrincipalId',
        'aclVersion',
        'publicPolicy',
        'publicPolicyVersion',
        'snapshotSha256',
        'created',
      ]) &&
      typeof result.roomId === 'string' &&
      typeof result.ownerPrincipalId === 'string' &&
      result.aclVersion === 1 &&
      result.publicPolicy === 'restricted' &&
      result.publicPolicyVersion === 1 &&
      typeof result.snapshotSha256 === 'string' &&
      typeof result.created === 'boolean'
    );
  }
  return (
    exactKeys(result, ['ok', 'version', 'error', 'retryable']) &&
    typeof result.error === 'string' &&
    typeof result.retryable === 'boolean' &&
    (result.retryable
      ? result.error === 'readback-failed' || result.error === 'internal-error'
      : [
          'invalid-request',
          'promotion-not-found',
          'replay-detected',
          'owner-mismatch',
          'promotion-conflict',
        ].includes(result.error))
  );
};

class SqlDocumentClaimAliasStore implements DocumentClaimAliasStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  transaction<T>(callback: () => T): T {
    return this.storage.transactionSync(callback);
  }

  readAlias(): DocumentClaimAliasV1 | null {
    const row = this.storage.sql
      .exec<AliasRow>(
        `SELECT claim_id, owner_principal_id, canonical_local_document_id, room_id,
                promotion_snapshot_sha256, created_at
         FROM document_claim_alias_v1
         WHERE singleton = 1
         LIMIT 1`,
      )
      .toArray()[0];
    return row
      ? {
          claimId: row.claim_id,
          ownerPrincipalId: row.owner_principal_id,
          canonicalLocalDocumentId: row.canonical_local_document_id,
          roomId: row.room_id,
          promotionSnapshotSha256: row.promotion_snapshot_sha256,
          createdAt: row.created_at,
        }
      : null;
  }

  createAlias(alias: DocumentClaimAliasV1): void {
    this.storage.sql.exec(
      `INSERT INTO document_claim_alias_v1
         (singleton, claim_id, owner_principal_id, canonical_local_document_id,
          room_id, promotion_snapshot_sha256, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
      alias.claimId,
      alias.ownerPrincipalId,
      alias.canonicalLocalDocumentId,
      alias.roomId,
      alias.promotionSnapshotSha256,
      alias.createdAt,
    );
  }

  hasManagementRequest(requestId: string): boolean {
    const row = this.storage.sql
      .exec<{
        count: number;
      }>(
        'SELECT COUNT(*) AS count FROM document_claim_management_replay_v1 WHERE request_id = ?',
        requestId,
      )
      .toArray()[0];
    return (row?.count ?? 0) > 0;
  }

  recordSuccessfulRequest(requestId: string, bodySha256 = '', createdAt = ''): void {
    this.storage.sql.exec(
      `INSERT INTO document_claim_management_replay_v1
         (request_id, body_sha256, created_at)
       VALUES (?, ?, ?)`,
      requestId,
      bodySha256,
      createdAt,
    );
  }
}

export class LashDocumentClaim extends DurableObject<ClaimCoordinatorEnvironment> {
  constructor(ctx: DurableObjectState, env: ClaimCoordinatorEnvironment) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS document_claim_alias_v1 (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          claim_id TEXT NOT NULL,
          owner_principal_id TEXT NOT NULL,
          canonical_local_document_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          promotion_snapshot_sha256 TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TRIGGER IF NOT EXISTS document_claim_alias_v1_no_update
        BEFORE UPDATE ON document_claim_alias_v1
        BEGIN
          SELECT RAISE(ABORT, 'document claim alias is immutable');
        END
      `);
      this.ctx.storage.sql.exec(`
        CREATE TRIGGER IF NOT EXISTS document_claim_alias_v1_no_delete
        BEFORE DELETE ON document_claim_alias_v1
        BEGIN
          SELECT RAISE(ABORT, 'document claim alias is immutable');
        END
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS document_claim_management_replay_v1 (
          request_id TEXT PRIMARY KEY,
          body_sha256 TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/__lash-document-claim/promote') return this.promote(request);
      if (pathname === '/__lash-document-claim/owner-session') {
        return this.ownerSession(request);
      }
      if (
        pathname === '/__lash-document-claim/public-policy/read' ||
        pathname === '/__lash-document-claim/public-policy/update'
      ) {
        return this.publicPolicy(request, pathname.endsWith('/read') ? 'read' : 'update');
      }
      if (pathname === '/__lash-document-claim/public-comments/moderate') {
        return this.publicCommentModeration(request);
      }
      return json({ ok: false, version: 1, error: 'claim-not-found', retryable: false }, 404);
    });
  }

  private async promote(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== 'POST' ||
      url.pathname !== '/__lash-document-claim/promote' ||
      url.pathname !== '/__lash-document-claim/promote' ||
      url.search.length !== 0 ||
      request.headers.get('x-lash-internal-management') !== 'document-claim-v2'
    ) {
      return json({ ok: false, version: 2, error: 'unauthorized', retryable: false }, 404);
    }
    const body = await readPromotionBody(request);
    if (!body.ok || !body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
      return json({ ok: false, version: 2, error: 'invalid-request', retryable: false }, 400);
    }
    const command = body.value as Record<string, unknown>;
    if (
      Object.keys(command).sort().join(',') !== 'bodySha256,promotion,requestId,version' ||
      command.version !== 2 ||
      typeof command.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        command.requestId,
      ) ||
      typeof command.bodySha256 !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(command.bodySha256)
    ) {
      return json({ ok: false, version: 2, error: 'invalid-request', retryable: false }, 400);
    }
    const claimId =
      command.promotion &&
      typeof command.promotion === 'object' &&
      !Array.isArray(command.promotion) &&
      typeof (command.promotion as Record<string, unknown>).claimId === 'string'
        ? String((command.promotion as Record<string, unknown>).claimId)
        : '';
    const parsed = await parseDocumentClaimPromotionRequest(command.promotion, claimId);
    if (!parsed.ok) {
      return json({ ok: false, version: 2, error: 'invalid-request', retryable: false }, 400);
    }

    const promoteRoom = async (
      call: RoomPromotionCall,
    ): Promise<ExecuteDocumentPromotionResult> => {
      const stub = this.env.LASH_REALTIME_ROOM.getByName(call.roomId);
      const internalUrl = new URL(request.url);
      internalUrl.pathname = '/__lash-room/promote';
      internalUrl.search = '';
      const response = await stub.fetch(
        new Request(internalUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-encoding': 'identity',
            'x-lash-internal-management': 'promotion-v1',
          },
          body: JSON.stringify({
            version: 1,
            requestId: crypto.randomUUID(),
            bodySha256: command.bodySha256,
            promotion: call.promotion,
          }),
        }),
      );
      const result = await response.json().catch(() => null);
      if (!isRoomPromotionResult(result) || response.status !== roomStatusFor(result)) {
        return { ok: false, version: 1, error: 'internal-error', retryable: true };
      }
      return result;
    };

    const result = await coordinateDocumentClaimPromotion({
      store: new SqlDocumentClaimAliasStore(this.ctx.storage),
      request: parsed.request,
      requestId: command.requestId,
      bodySha256: command.bodySha256,
      createdAt: new Date().toISOString(),
      promoteRoom,
    });
    return json(result, statusFor(result));
  }

  private async ownerSession(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== 'POST' ||
      url.pathname !== '/__lash-document-claim/owner-session' ||
      url.search.length !== 0 ||
      request.headers.get('x-lash-internal-management') !== 'owner-session-v1'
    ) {
      return json({ ok: false, version: 1, error: 'claim-not-found', retryable: false }, 404);
    }
    const body = await readPromotionBody(request);
    if (
      !body.ok ||
      body.body.byteLength > 4096 ||
      !body.value ||
      typeof body.value !== 'object' ||
      Array.isArray(body.value)
    ) {
      return json({ ok: false, version: 1, error: 'claim-conflict', retryable: false }, 400);
    }
    const command = body.value as Record<string, unknown>;
    if (
      !exactKeys(command, ['version', 'requestId', 'bodySha256', 'ownerSession']) ||
      command.version !== 1 ||
      typeof command.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        command.requestId,
      ) ||
      typeof command.bodySha256 !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(command.bodySha256)
    ) {
      return json({ ok: false, version: 1, error: 'claim-conflict', retryable: false }, 400);
    }
    const claimId =
      command.ownerSession &&
      typeof command.ownerSession === 'object' &&
      !Array.isArray(command.ownerSession) &&
      typeof (command.ownerSession as Record<string, unknown>).claimId === 'string'
        ? String((command.ownerSession as Record<string, unknown>).claimId)
        : '';
    const parsed = await parseOwnerSessionManagementRequest(command.ownerSession, claimId);
    if (!parsed.ok) {
      return json({ ok: false, version: 1, error: 'claim-conflict', retryable: false }, 400);
    }

    const requestId = command.requestId;
    const bodySha256 = command.bodySha256;
    const store = new SqlDocumentClaimAliasStore(this.ctx.storage);
    if (store.hasManagementRequest(requestId)) {
      return json({ ok: false, version: 1, error: 'claim-conflict', retryable: false }, 409);
    }
    const alias = resolveOwnerSessionAlias(store.readAlias(), parsed.request);
    if (!alias.ok) return json(alias, ownerSessionStatusFor(alias));

    const internalUrl = new URL(request.url);
    internalUrl.pathname = '/__lash-room/owner-session';
    internalUrl.search = '';
    let response: Response;
    try {
      response = await this.env.LASH_REALTIME_ROOM.getByName(alias.roomId).fetch(
        new Request(internalUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-encoding': 'identity',
            'x-lash-internal-management': 'owner-session-v1',
          },
          body: JSON.stringify({
            version: 1,
            requestId,
            bodySha256,
            ownerSession: {
              ...parsed.request,
              roomId: alias.roomId,
              promotionSnapshotSha256: alias.promotionSnapshotSha256,
            },
          }),
        }),
      );
    } catch {
      return json({ ok: false, version: 1, error: 'internal-error', retryable: true }, 500);
    }
    const result = await response.json().catch(() => null);
    if (!isOwnerRoomSessionResult(result) || response.status !== ownerSessionStatusFor(result)) {
      return json({ ok: false, version: 1, error: 'internal-error', retryable: true }, 500);
    }
    if (
      result.ok &&
      (result.roomId !== alias.roomId ||
        result.ownerPrincipalId !== parsed.request.ownerPrincipalId ||
        result.promotionSnapshotSha256 !== alias.promotionSnapshotSha256 ||
        result.socket.path !==
          `/api/realtime/rooms/${alias.roomId}/socket?protocolVersion=3&actorId=${parsed.request.actorId}`)
    ) {
      return json({ ok: false, version: 1, error: 'internal-error', retryable: true }, 500);
    }
    if (result.ok) {
      try {
        store.transaction(() =>
          store.recordSuccessfulRequest(requestId, bodySha256, new Date().toISOString()),
        );
      } catch {
        return json({ ok: false, version: 1, error: 'internal-error', retryable: true }, 500);
      }
      return json({ ...result, claimId: parsed.request.claimId }, 200);
    }
    return json(result, ownerSessionStatusFor(result));
  }

  private async publicCommentModeration(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== 'POST' ||
      url.pathname !== '/__lash-document-claim/public-comments/moderate' ||
      url.search.length !== 0 ||
      request.headers.get('x-lash-internal-management') !== 'public-comment-moderation-v1'
    ) {
      return json({ ok: false, version: 1, error: 'claim-not-found', retryable: false }, 404);
    }
    const body = await readPromotionBody(request);
    if (
      !body.ok ||
      body.body.byteLength > 4_096 ||
      !body.value ||
      typeof body.value !== 'object' ||
      Array.isArray(body.value)
    ) {
      return json({ ok: false, version: 1, error: 'claim-conflict', retryable: false }, 400);
    }
    const command = body.value as Record<string, unknown>;
    if (
      !exactKeys(command, ['version', 'requestId', 'bodySha256', 'publicComment']) ||
      command.version !== 1 ||
      typeof command.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        command.requestId,
      ) ||
      typeof command.bodySha256 !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(command.bodySha256)
    ) {
      return json({ ok: false, version: 1, error: 'claim-conflict', retryable: false }, 400);
    }
    const publicComment =
      command.publicComment &&
      typeof command.publicComment === 'object' &&
      !Array.isArray(command.publicComment)
        ? (command.publicComment as Record<string, unknown>)
        : {};
    const parsed = await parsePublicCommentModerationRequest(
      publicComment,
      typeof publicComment.claimId === 'string' ? publicComment.claimId : '',
      typeof publicComment.ownerPrincipalId === 'string' ? publicComment.ownerPrincipalId : '',
    );
    if (!parsed.ok) {
      return json({ ok: false, version: 1, error: 'claim-conflict', retryable: false }, 400);
    }
    const alias = new SqlDocumentClaimAliasStore(this.ctx.storage).readAlias();
    if (!alias) {
      return json({ ok: false, version: 1, error: 'claim-not-found', retryable: false }, 404);
    }
    if (alias.ownerPrincipalId !== parsed.request.ownerPrincipalId) {
      return json({ ok: false, version: 1, error: 'owner-mismatch', retryable: false }, 409);
    }
    if (
      alias.claimId !== parsed.request.claimId ||
      alias.canonicalLocalDocumentId !== parsed.request.localDocumentId
    ) {
      return json({ ok: false, version: 1, error: 'claim-conflict', retryable: false }, 409);
    }
    const internalUrl = new URL(request.url);
    internalUrl.pathname = '/__lash-room/public-comments/moderate';
    internalUrl.search = '';
    let response: Response;
    try {
      response = await this.env.LASH_REALTIME_ROOM.getByName(alias.roomId).fetch(
        new Request(internalUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-encoding': 'identity',
            'x-lash-internal-management': 'public-comment-moderation-v1',
          },
          body: JSON.stringify({
            version: 1,
            requestId: command.requestId,
            bodySha256: command.bodySha256,
            publicComment: { ...parsed.request, roomId: alias.roomId },
          }),
        }),
      );
    } catch {
      return json({ ok: false, version: 1, error: 'internal-error', retryable: true }, 500);
    }
    const result = (await response
      .json()
      .catch(() => null)) as PublicCommentModerationResult | null;
    if (
      !result ||
      typeof result !== 'object' ||
      response.status !== publicCommentModerationStatusFor(result)
    ) {
      return json({ ok: false, version: 1, error: 'internal-error', retryable: true }, 500);
    }
    if (
      result.ok &&
      (result.claimId !== parsed.request.claimId ||
        result.roomId !== alias.roomId ||
        result.commentId !== parsed.request.commentId)
    ) {
      return json({ ok: false, version: 1, error: 'internal-error', retryable: true }, 500);
    }
    return json(result, publicCommentModerationStatusFor(result));
  }

  private async publicPolicy(request: Request, action: 'read' | 'update'): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== 'POST' ||
      url.pathname !== `/__lash-document-claim/public-policy/${action}` ||
      url.search.length !== 0 ||
      request.headers.get('x-lash-internal-management') !== 'public-policy-v1'
    ) {
      return json({ ok: false, version: 1, error: 'claim-not-found', retryable: false }, 404);
    }
    const body = await readPromotionBody(request);
    if (
      !body.ok ||
      body.body.byteLength > 4096 ||
      !body.value ||
      typeof body.value !== 'object' ||
      Array.isArray(body.value)
    ) {
      return json({ ok: false, version: 1, error: 'claim-conflict', retryable: false }, 400);
    }
    const command = body.value as Record<string, unknown>;
    if (
      !exactKeys(command, ['version', 'requestId', 'bodySha256', 'publicPolicy']) ||
      command.version !== 1 ||
      typeof command.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        command.requestId,
      ) ||
      typeof command.bodySha256 !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(command.bodySha256)
    ) {
      return json({ ok: false, version: 1, error: 'claim-conflict', retryable: false }, 400);
    }
    const claimId =
      command.publicPolicy &&
      typeof command.publicPolicy === 'object' &&
      !Array.isArray(command.publicPolicy) &&
      typeof (command.publicPolicy as Record<string, unknown>).claimId === 'string'
        ? String((command.publicPolicy as Record<string, unknown>).claimId)
        : '';
    const parsed =
      action === 'read'
        ? await parsePublicPolicyReadRequest(command.publicPolicy, claimId)
        : await parsePublicPolicyUpdateRequest(command.publicPolicy, claimId);
    if (!parsed.ok) {
      return json({ ok: false, version: 1, error: 'claim-conflict', retryable: false }, 400);
    }

    const alias = new SqlDocumentClaimAliasStore(this.ctx.storage).readAlias();
    if (!alias) {
      return json({ ok: false, version: 1, error: 'claim-not-found', retryable: false }, 404);
    }
    if (alias.ownerPrincipalId !== parsed.request.ownerPrincipalId) {
      return json({ ok: false, version: 1, error: 'owner-mismatch', retryable: false }, 409);
    }
    if (
      alias.claimId !== parsed.request.claimId ||
      alias.canonicalLocalDocumentId !== parsed.request.localDocumentId
    ) {
      return json({ ok: false, version: 1, error: 'claim-conflict', retryable: false }, 409);
    }

    const internalUrl = new URL(request.url);
    internalUrl.pathname = `/__lash-room/public-policy/${action}`;
    internalUrl.search = '';
    let response: Response;
    try {
      response = await this.env.LASH_REALTIME_ROOM.getByName(alias.roomId).fetch(
        new Request(internalUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-encoding': 'identity',
            'x-lash-internal-management': 'public-policy-v1',
          },
          body: JSON.stringify({
            version: 1,
            requestId: command.requestId,
            bodySha256: command.bodySha256,
            publicPolicy: {
              ...parsed.request,
              roomId: alias.roomId,
            },
          }),
        }),
      );
    } catch {
      return json({ ok: false, version: 1, error: 'internal-error', retryable: true }, 500);
    }
    const result = await response.json().catch(() => null);
    if (
      !isPublicPolicyRoomResult(result, action) ||
      response.status !== publicPolicyStatusFor(result)
    ) {
      return json({ ok: false, version: 1, error: 'internal-error', retryable: true }, 500);
    }
    if (
      result.ok &&
      (result.roomId !== alias.roomId ||
        result.ownerPrincipalId !== parsed.request.ownerPrincipalId)
    ) {
      return json({ ok: false, version: 1, error: 'internal-error', retryable: true }, 500);
    }
    if (
      !result.ok &&
      result.error === 'policy-conflict' &&
      result.state.publicPath !==
        (result.state.mode === 'restricted' || result.state.publicProjectionBlocked
          ? null
          : `/public/${alias.roomId}`)
    ) {
      return json({ ok: false, version: 1, error: 'internal-error', retryable: true }, 500);
    }
    return result.ok
      ? json({ ...result, claimId: parsed.request.claimId }, 200)
      : json(result, publicPolicyStatusFor(result));
  }
}
