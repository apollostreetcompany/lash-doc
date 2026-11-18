import type {
  PublicCommentCreateResultV1,
  PublicCommentCreateRequestV1,
  PublicCommentDtoV1,
  PublicCommentFailureV1,
  PublicCommentListResultV1,
  PublicCommentListRequestV1,
  PublicCommentModerationFailureV1,
  PublicCommentModerationRequestV1,
  PublicCommentModerationResultV1,
  PublicCommentModerationSuccessV1,
} from '@lash/types';

import { deriveDocumentClaimId } from './documentClaim';

const ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const ACCOUNT_PRINCIPAL = /^account:v1:[A-Za-z0-9_-]{43}$/u;
const CLAIM_ID = /^claim-v1-[0-9a-f]{64}$/u;
const LOCAL_DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const COMMENT_ID = /^pc-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMENTER_ALIAS = /^Commenter [A-Za-z0-9_-]{6}$/u;
const RATE_KEY = /^rate-v1-[A-Za-z0-9_-]{43}$/u;
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/u;

const exactKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const positiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1;

const cutoff = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const hasUnpairedSurrogate = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
};

export const canonicalPublicCommentBody = (
  value: unknown,
): { ok: true; body: string } | { ok: false; error: 'invalid-request' } => {
  if (typeof value !== 'string' || hasUnpairedSurrogate(value)) {
    return { ok: false, error: 'invalid-request' };
  }
  const body = value.replace(/\r\n?/gu, '\n').normalize('NFC').trim();
  if (
    body.length === 0 ||
    [...body].length > 2_000 ||
    new TextEncoder().encode(body).byteLength > 4_096 ||
    body.split('\n').length > 20 ||
    /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(body)
  ) {
    return { ok: false, error: 'invalid-request' };
  }
  return { ok: true, body };
};

export const parsePublicCommentListRequest = (
  value: unknown,
  expectedRoomId: string,
): { ok: true; request: PublicCommentListRequestV1 } | { ok: false; error: 'invalid-request' } => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'version',
      'roomId',
      'expectedPolicyVersion',
      'expectedCutoffGeneration',
      'beforeSequence',
      'limit',
      'rateKey',
    ]) ||
    value.version !== 1 ||
    value.roomId !== expectedRoomId ||
    typeof value.roomId !== 'string' ||
    !ROOM_ID.test(value.roomId) ||
    !positiveSafeInteger(value.expectedPolicyVersion) ||
    !cutoff(value.expectedCutoffGeneration) ||
    !(value.beforeSequence === null || positiveSafeInteger(value.beforeSequence)) ||
    value.limit !== 50 ||
    typeof value.rateKey !== 'string' ||
    !RATE_KEY.test(value.rateKey)
  ) {
    return { ok: false, error: 'invalid-request' };
  }
  return { ok: true, request: value as unknown as PublicCommentListRequestV1 };
};

export const parsePublicCommentCreateRequest = (
  value: unknown,
  expectedRoomId: string,
  signedPrincipalId: string,
):
  | { ok: true; request: PublicCommentCreateRequestV1 }
  | { ok: false; error: 'invalid-request' } => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'version',
      'roomId',
      'commenterPrincipalId',
      'commenterAlias',
      'mutationId',
      'expectedPolicyVersion',
      'expectedCutoffGeneration',
      'body',
    ]) ||
    value.version !== 1 ||
    value.roomId !== expectedRoomId ||
    typeof value.roomId !== 'string' ||
    !ROOM_ID.test(value.roomId) ||
    value.commenterPrincipalId !== signedPrincipalId ||
    typeof value.commenterPrincipalId !== 'string' ||
    !ACCOUNT_PRINCIPAL.test(value.commenterPrincipalId) ||
    typeof value.commenterAlias !== 'string' ||
    !COMMENTER_ALIAS.test(value.commenterAlias) ||
    typeof value.mutationId !== 'string' ||
    !LOWERCASE_UUID_V4.test(value.mutationId) ||
    !positiveSafeInteger(value.expectedPolicyVersion) ||
    !cutoff(value.expectedCutoffGeneration)
  ) {
    return { ok: false, error: 'invalid-request' };
  }
  const canonical = canonicalPublicCommentBody(value.body);
  if (!canonical.ok || canonical.body !== value.body) {
    return { ok: false, error: 'invalid-request' };
  }
  return { ok: true, request: value as unknown as PublicCommentCreateRequestV1 };
};

export const parsePublicCommentModerationRequest = async (
  value: unknown,
  expectedClaimId: string,
  signedOwnerPrincipalId: string,
): Promise<
  { ok: true; request: PublicCommentModerationRequestV1 } | { ok: false; error: 'invalid-request' }
> => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'version',
      'claimId',
      'ownerPrincipalId',
      'localDocumentId',
      'commentId',
      'action',
      'mutationId',
      'expectedPolicyVersion',
      'expectedCutoffGeneration',
    ]) ||
    value.version !== 1 ||
    value.claimId !== expectedClaimId ||
    typeof value.claimId !== 'string' ||
    !CLAIM_ID.test(value.claimId) ||
    value.ownerPrincipalId !== signedOwnerPrincipalId ||
    typeof value.ownerPrincipalId !== 'string' ||
    !ACCOUNT_PRINCIPAL.test(value.ownerPrincipalId) ||
    typeof value.localDocumentId !== 'string' ||
    !LOCAL_DOCUMENT_ID.test(value.localDocumentId) ||
    typeof value.commentId !== 'string' ||
    !COMMENT_ID.test(value.commentId) ||
    value.action !== 'hide' ||
    typeof value.mutationId !== 'string' ||
    !LOWERCASE_UUID_V4.test(value.mutationId) ||
    !positiveSafeInteger(value.expectedPolicyVersion) ||
    !cutoff(value.expectedCutoffGeneration) ||
    (await deriveDocumentClaimId(value.ownerPrincipalId, value.localDocumentId)) !== value.claimId
  ) {
    return { ok: false, error: 'invalid-request' };
  }
  return { ok: true, request: value as unknown as PublicCommentModerationRequestV1 };
};

export interface PublicCommentAuthority {
  roomId: string;
  shareable: boolean;
  mode: 'restricted' | 'read' | 'comment';
  policyVersion: number;
  cutoffGeneration: number;
}

export interface StoredPublicCommentV1 {
  id: string;
  sequence: number;
  roomId: string;
  authorPrincipalId: string;
  authorAlias: string;
  mutationId: string;
  mutationBodySha256: string;
  body: string;
  policyVersion: number;
  cutoffGeneration: number;
  createdAt: string;
  visibility: 'visible' | 'hidden';
  hiddenAt: string | null;
  hiddenByPrincipalId: string | null;
}

export interface PublicCommentStore {
  transaction<T>(callback: () => T): T;
  hasTransportRequest(requestId: string): boolean;
  recordTransportRequest(requestId: string, bodySha256: string, createdAt: string): void;
  readAuthority(): PublicCommentAuthority | null;
  incrementListRate(
    rateKey: string,
    roomId: string,
    minuteStartMs: number,
    updatedAt: string,
  ): { rateKeyMinute: number; roomMinute: number };
  incrementCreateRate(
    principalId: string,
    roomId: string,
    minuteStartMs: number,
    dayStartMs: number,
    hourStartMs: number,
    updatedAt: string,
  ): { principalMinute: number; principalDay: number; roomHour: number };
  readCommentByMutation(mutationId: string): StoredPublicCommentV1 | null;
  readCommentById(commentId: string): StoredPublicCommentV1 | null;
  insertComment(comment: Omit<StoredPublicCommentV1, 'sequence'>): void;
  listVisibleComments(beforeSequence: number | null, limit: number): StoredPublicCommentV1[];
  recordCreateAudit(input: {
    commentId: string;
    mutationId: string;
    principalId: string;
    createdAt: string;
  }): void;
}

export interface PublicCommentModerationAuthority extends PublicCommentAuthority {
  ownerPrincipalId: string;
}

export interface PublicCommentModerationReceipt {
  mutationId: string;
  requestBodySha256: string;
  claimId: string;
  roomId: string;
  commentId: string;
  ownerPrincipalId: string;
  changed: boolean;
  policyVersion: number;
  cutoffGeneration: number;
  moderatedAt: string;
}

export interface PublicCommentModerationStore {
  transaction<T>(callback: () => T): T;
  readModerationAuthority(): PublicCommentModerationAuthority | null;
  readCommentById(commentId: string): StoredPublicCommentV1 | null;
  readModeration(mutationId: string): PublicCommentModerationReceipt | null;
  hideComment(commentId: string, ownerPrincipalId: string, hiddenAt: string): boolean;
  createModeration(receipt: PublicCommentModerationReceipt): void;
  recordHideAudit(input: {
    commentId: string;
    mutationId: string;
    principalId: string;
    createdAt: string;
  }): void;
}

export type PublicCommentModerationResult = PublicCommentModerationResultV1;

export interface PublicCommentExecution<T> {
  result: T;
  status: number;
  retryAfterSeconds?: number;
}

const failure = (error: PublicCommentFailureV1['error']): PublicCommentFailureV1 =>
  ({
    ok: false,
    version: 1,
    error,
    retryable:
      error === 'rate-limited' || error === 'readback-failed' || error === 'internal-error',
  }) as PublicCommentFailureV1;

const dto = (row: StoredPublicCommentV1): PublicCommentDtoV1 => ({
  id: row.id,
  sequence: row.sequence,
  anchor: { kind: 'document' },
  body: row.body,
  author: { label: row.authorAlias },
  createdAt: row.createdAt,
});

const currentAuthority = (
  authority: PublicCommentAuthority | null,
  roomId: string,
  policyVersion: number,
  cutoffGeneration: number,
): authority is PublicCommentAuthority & { mode: 'comment' } =>
  authority !== null &&
  authority.roomId === roomId &&
  authority.shareable &&
  authority.mode === 'comment' &&
  authority.policyVersion === policyVersion &&
  authority.cutoffGeneration === cutoffGeneration;

const result = <T>(
  value: T,
  status: number,
  retryAfterSeconds?: number,
): PublicCommentExecution<T> => ({
  result: value,
  status,
  ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
});

class PublicCommentReadbackError extends Error {}

export const listPublicComments = (input: {
  store: PublicCommentStore;
  request: PublicCommentListRequestV1;
  requestId: string;
  bodySha256: string;
  nowMs: number;
}): PublicCommentExecution<PublicCommentListResultV1> => {
  if (
    !LOWERCASE_UUID_V4.test(input.requestId) ||
    !BASE64URL_SHA256.test(input.bodySha256) ||
    !Number.isSafeInteger(input.nowMs)
  ) {
    return result(failure('internal-error'), 500);
  }
  try {
    return input.store.transaction(() => {
      if (input.store.hasTransportRequest(input.requestId)) {
        return result(failure('replay-detected'), 409);
      }
      const now = new Date(input.nowMs).toISOString();
      input.store.recordTransportRequest(input.requestId, input.bodySha256, now);
      const minuteStart = Math.floor(input.nowMs / 60_000) * 60_000;
      const rates = input.store.incrementListRate(
        input.request.rateKey,
        input.request.roomId,
        minuteStart,
        now,
      );
      if (rates.rateKeyMinute > 30 || rates.roomMinute > 300) {
        return result(
          failure('rate-limited'),
          429,
          Math.max(1, Math.ceil((minuteStart + 60_000 - input.nowMs) / 1_000)),
        );
      }
      const authority = input.store.readAuthority();
      if (
        !currentAuthority(
          authority,
          input.request.roomId,
          input.request.expectedPolicyVersion,
          input.request.expectedCutoffGeneration,
        )
      ) {
        return result(failure('public-access-changed'), 409);
      }
      const rows = input.store.listVisibleComments(input.request.beforeSequence, 51);
      const hasMore = rows.length > 50;
      const page = rows.slice(0, 50).sort((left, right) => left.sequence - right.sequence);
      return result<PublicCommentListResultV1>(
        {
          ok: true,
          version: 1,
          authorization: {
            roomId: authority.roomId,
            mode: 'comment',
            policyVersion: authority.policyVersion,
            cutoffGeneration: authority.cutoffGeneration,
          },
          comments: page.map(dto),
          nextBeforeSequence: hasMore ? (page[0]?.sequence ?? null) : null,
        },
        200,
      );
    });
  } catch {
    return result(failure('internal-error'), 500);
  }
};

export const createPublicComment = (input: {
  store: PublicCommentStore;
  request: PublicCommentCreateRequestV1;
  requestId: string;
  bodySha256: string;
  nowMs: number;
  randomUUID: () => string;
}): PublicCommentExecution<PublicCommentCreateResultV1> => {
  if (
    !LOWERCASE_UUID_V4.test(input.requestId) ||
    !BASE64URL_SHA256.test(input.bodySha256) ||
    !Number.isSafeInteger(input.nowMs)
  ) {
    return result(failure('internal-error'), 500);
  }
  try {
    return input.store.transaction(() => {
      if (input.store.hasTransportRequest(input.requestId)) {
        return result(failure('replay-detected'), 409);
      }
      const now = new Date(input.nowMs).toISOString();
      input.store.recordTransportRequest(input.requestId, input.bodySha256, now);
      const existing = input.store.readCommentByMutation(input.request.mutationId);
      if (existing) {
        if (
          existing.mutationBodySha256 !== input.bodySha256 ||
          existing.authorPrincipalId !== input.request.commenterPrincipalId ||
          existing.roomId !== input.request.roomId
        ) {
          return result(failure('idempotency-conflict'), 409);
        }
        const authority = input.store.readAuthority();
        if (
          !currentAuthority(
            authority,
            input.request.roomId,
            input.request.expectedPolicyVersion,
            input.request.expectedCutoffGeneration,
          )
        ) {
          return result(failure('public-access-changed'), 409);
        }
        return result<PublicCommentCreateResultV1>(
          {
            ok: true,
            version: 1,
            created: false,
            authorization: {
              roomId: authority.roomId,
              mode: 'comment',
              policyVersion: authority.policyVersion,
              cutoffGeneration: authority.cutoffGeneration,
            },
            comment: dto(existing),
          },
          200,
        );
      }
      const authority = input.store.readAuthority();
      if (
        !currentAuthority(
          authority,
          input.request.roomId,
          input.request.expectedPolicyVersion,
          input.request.expectedCutoffGeneration,
        )
      ) {
        return result(failure('public-access-changed'), 409);
      }
      const minuteStart = Math.floor(input.nowMs / 60_000) * 60_000;
      const hourStart = Math.floor(input.nowMs / 3_600_000) * 3_600_000;
      const date = new Date(input.nowMs);
      const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
      const rates = input.store.incrementCreateRate(
        input.request.commenterPrincipalId,
        input.request.roomId,
        minuteStart,
        dayStart,
        hourStart,
        now,
      );
      if (rates.principalMinute > 5 || rates.principalDay > 100 || rates.roomHour > 300) {
        const waits = [
          ...(rates.principalMinute > 5 ? [minuteStart + 60_000 - input.nowMs] : []),
          ...(rates.principalDay > 100 ? [dayStart + 86_400_000 - input.nowMs] : []),
          ...(rates.roomHour > 300 ? [hourStart + 3_600_000 - input.nowMs] : []),
        ];
        return result(
          failure('rate-limited'),
          429,
          Math.min(86_400, Math.max(1, Math.ceil(Math.max(...waits) / 1_000))),
        );
      }
      const uuid = input.randomUUID();
      if (!LOWERCASE_UUID_V4.test(uuid)) return result(failure('internal-error'), 500);
      input.store.insertComment({
        id: `pc-v1-${uuid}`,
        roomId: input.request.roomId,
        authorPrincipalId: input.request.commenterPrincipalId,
        authorAlias: input.request.commenterAlias,
        mutationId: input.request.mutationId,
        mutationBodySha256: input.bodySha256,
        body: input.request.body,
        policyVersion: authority.policyVersion,
        cutoffGeneration: authority.cutoffGeneration,
        createdAt: now,
        visibility: 'visible',
        hiddenAt: null,
        hiddenByPrincipalId: null,
      });
      const readback = input.store.readCommentByMutation(input.request.mutationId);
      if (
        !readback ||
        readback.id !== `pc-v1-${uuid}` ||
        !Number.isSafeInteger(readback.sequence) ||
        readback.sequence < 1 ||
        readback.roomId !== input.request.roomId ||
        readback.body !== input.request.body ||
        readback.authorPrincipalId !== input.request.commenterPrincipalId ||
        readback.authorAlias !== input.request.commenterAlias ||
        readback.mutationId !== input.request.mutationId ||
        readback.mutationBodySha256 !== input.bodySha256 ||
        readback.policyVersion !== authority.policyVersion ||
        readback.cutoffGeneration !== authority.cutoffGeneration ||
        readback.createdAt !== now ||
        readback.visibility !== 'visible' ||
        readback.hiddenAt !== null ||
        readback.hiddenByPrincipalId !== null
      ) {
        throw new PublicCommentReadbackError('public comment readback mismatch');
      }
      input.store.recordCreateAudit({
        commentId: readback.id,
        mutationId: readback.mutationId,
        principalId: readback.authorPrincipalId,
        createdAt: now,
      });
      return result<PublicCommentCreateResultV1>(
        {
          ok: true,
          version: 1,
          created: true,
          authorization: {
            roomId: authority.roomId,
            mode: 'comment',
            policyVersion: authority.policyVersion,
            cutoffGeneration: authority.cutoffGeneration,
          },
          comment: dto(readback),
        },
        201,
      );
    });
  } catch (error) {
    return result(
      failure(error instanceof PublicCommentReadbackError ? 'readback-failed' : 'internal-error'),
      500,
    );
  }
};

const moderationSuccess = (
  receipt: PublicCommentModerationReceipt,
): PublicCommentModerationSuccessV1 => ({
  ok: true,
  version: 1,
  claimId: receipt.claimId,
  roomId: receipt.roomId,
  commentId: receipt.commentId,
  state: 'hidden',
  changed: receipt.changed,
  policyVersion: receipt.policyVersion,
  cutoffGeneration: receipt.cutoffGeneration,
  moderatedAt: receipt.moderatedAt,
});

export const moderatePublicComment = (input: {
  store: PublicCommentModerationStore;
  request: PublicCommentModerationRequestV1 & { roomId: string };
  bodySha256: string;
  moderatedAt: string;
}): PublicCommentModerationResult => {
  try {
    return input.store.transaction(() => {
      const previous = input.store.readModeration(input.request.mutationId);
      if (previous) {
        return previous.requestBodySha256 === input.bodySha256
          ? moderationSuccess(previous)
          : {
              ok: false,
              version: 1,
              error: 'replay-detected',
              retryable: false,
            };
      }
      const authority = input.store.readModerationAuthority();
      if (!authority) {
        return { ok: false, version: 1, error: 'claim-not-found', retryable: false };
      }
      if (authority.ownerPrincipalId !== input.request.ownerPrincipalId) {
        return { ok: false, version: 1, error: 'owner-mismatch', retryable: false };
      }
      if (authority.roomId !== input.request.roomId) {
        return { ok: false, version: 1, error: 'claim-conflict', retryable: false };
      }
      if (!authority.shareable) {
        return { ok: false, version: 1, error: 'not-shareable', retryable: false };
      }
      if (
        authority.policyVersion !== input.request.expectedPolicyVersion ||
        authority.cutoffGeneration !== input.request.expectedCutoffGeneration
      ) {
        return {
          ok: false,
          version: 1,
          error: 'policy-conflict',
          retryable: false,
          state: {
            mode: authority.mode,
            policyVersion: authority.policyVersion,
            cutoffGeneration: authority.cutoffGeneration,
            publicPath: authority.mode === 'restricted' ? null : `/public/${authority.roomId}`,
          },
        } satisfies PublicCommentModerationFailureV1;
      }
      const comment = input.store.readCommentById(input.request.commentId);
      if (!comment) {
        return { ok: false, version: 1, error: 'comment-not-found', retryable: false };
      }
      const changed =
        comment.visibility === 'visible' &&
        input.store.hideComment(
          input.request.commentId,
          input.request.ownerPrincipalId,
          input.moderatedAt,
        );
      const moderatedAt = changed ? input.moderatedAt : (comment.hiddenAt ?? input.moderatedAt);
      const receipt: PublicCommentModerationReceipt = {
        mutationId: input.request.mutationId,
        requestBodySha256: input.bodySha256,
        claimId: input.request.claimId,
        roomId: input.request.roomId,
        commentId: input.request.commentId,
        ownerPrincipalId: input.request.ownerPrincipalId,
        changed,
        policyVersion: authority.policyVersion,
        cutoffGeneration: authority.cutoffGeneration,
        moderatedAt,
      };
      input.store.createModeration(receipt);
      if (changed) {
        input.store.recordHideAudit({
          commentId: receipt.commentId,
          mutationId: receipt.mutationId,
          principalId: receipt.ownerPrincipalId,
          createdAt: receipt.moderatedAt,
        });
      }
      const readback = input.store.readModeration(receipt.mutationId);
      if (!readback || JSON.stringify(readback) !== JSON.stringify(receipt)) {
        throw new PublicCommentReadbackError('public moderation readback mismatch');
      }
      return moderationSuccess(receipt);
    });
  } catch (error) {
    return {
      ok: false,
      version: 1,
      error: error instanceof PublicCommentReadbackError ? 'readback-failed' : 'internal-error',
      retryable: true,
    };
  }
};
