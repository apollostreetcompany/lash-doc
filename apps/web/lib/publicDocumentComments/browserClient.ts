import type {
  PublicCommentCreateSuccessV1,
  PublicCommentDtoV1,
  PublicCommentListSuccessV1,
} from '@lash/types';

const ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMENT_ID = /^pc-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMENTER_ALIAS = /^Commenter [A-Za-z0-9_-]{6}$/u;
const CSRF_PROOF = /^v1\.[A-Za-z0-9_-]{43}\.[0-9]+\.[A-Za-z0-9_-]{43}$/u;
const LOCAL_DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const MAX_LIST_RESPONSE_BYTES = 256 * 1024;
const MAX_MUTATION_RESPONSE_BYTES = 16 * 1024;

export type PublicCommentBrowserFailureCode =
  | 'authentication-required'
  | 'comment-conflict'
  | 'document-unavailable'
  | 'invalid-request'
  | 'moderation-conflict'
  | 'public-access-changed'
  | 'rate-limited'
  | 'temporarily-unavailable';

export type PublicCommentBrowserFailure = Readonly<{
  ok: false;
  version: 1;
  error: PublicCommentBrowserFailureCode;
  retryable: boolean;
}>;

export type PublicCommentAuthoringSessionResult =
  | Readonly<{
      ok: true;
      version: 1;
      authenticated: false;
    }>
  | Readonly<{
      ok: true;
      version: 1;
      authenticated: true;
      csrfProof: string;
      expiresAt: string;
    }>
  | PublicCommentBrowserFailure;

export type PublicCommentListBrowserResult =
  | Readonly<PublicCommentListSuccessV1>
  | PublicCommentBrowserFailure;

export type PublicCommentCreateBrowserResult =
  | Readonly<PublicCommentCreateSuccessV1>
  | PublicCommentBrowserFailure;

export type PublicCommentHideBrowserResult =
  | Readonly<{
      ok: true;
      version: 1;
      commentId: string;
      state: 'hidden';
      changed: boolean;
      policyVersion: number;
      cutoffGeneration: number;
      moderatedAt: string;
    }>
  | PublicCommentBrowserFailure;

type FetchInput = Readonly<{
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const isNonnegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

const proofExpiresAt = (proof: string, expiresAt: unknown): string | null => {
  if (!isCanonicalTimestamp(expiresAt)) return null;
  const rawSeconds = proof.split('.')[2];
  if (!rawSeconds || !/^(?:0|[1-9][0-9]*)$/u.test(rawSeconds)) return null;
  const seconds = Number(rawSeconds);
  return Number.isSafeInteger(seconds) &&
    seconds > 0 &&
    new Date(seconds * 1_000).toISOString() === expiresAt
    ? expiresAt
    : null;
};

const hasUnpairedSurrogate = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
};

export const canonicalizePublicCommentBody = (raw: string): string | null => {
  const canonical = raw
    .replace(/\r\n?|\u000d/gu, '\n')
    .normalize('NFC')
    .trim();
  if (
    !canonical ||
    Array.from(canonical).length > 2_000 ||
    new TextEncoder().encode(canonical).byteLength > 4_096 ||
    canonical.split('\n').length > 20 ||
    /[\u0000-\u0009\u000b-\u001f\u007f]/u.test(canonical) ||
    hasUnpairedSurrogate(canonical)
  ) {
    return null;
  }
  return canonical;
};

const parseComment = (value: unknown): PublicCommentDtoV1 | null => {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['id', 'sequence', 'anchor', 'body', 'author', 'createdAt']) ||
    typeof value.id !== 'string' ||
    !COMMENT_ID.test(value.id) ||
    !isPositiveSafeInteger(value.sequence) ||
    !isPlainObject(value.anchor) ||
    !hasExactKeys(value.anchor, ['kind']) ||
    value.anchor.kind !== 'document' ||
    typeof value.body !== 'string' ||
    canonicalizePublicCommentBody(value.body) !== value.body ||
    !isPlainObject(value.author) ||
    !hasExactKeys(value.author, ['label']) ||
    typeof value.author.label !== 'string' ||
    !COMMENTER_ALIAS.test(value.author.label) ||
    !isCanonicalTimestamp(value.createdAt)
  ) {
    return null;
  }
  return value as unknown as PublicCommentDtoV1;
};

const parseAuthorization = (value: unknown, roomId: string) => {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['roomId', 'mode', 'policyVersion', 'cutoffGeneration']) ||
    value.roomId !== roomId ||
    value.mode !== 'comment' ||
    !isPositiveSafeInteger(value.policyVersion) ||
    !isNonnegativeSafeInteger(value.cutoffGeneration)
  ) {
    return null;
  }
  return {
    roomId,
    mode: 'comment' as const,
    policyVersion: value.policyVersion,
    cutoffGeneration: value.cutoffGeneration,
  };
};

const failureStatus: Record<PublicCommentBrowserFailureCode, readonly number[]> = {
  'authentication-required': [401],
  'comment-conflict': [409],
  'document-unavailable': [404],
  'invalid-request': [400, 403, 413],
  'moderation-conflict': [409],
  'public-access-changed': [409],
  'rate-limited': [429],
  'temporarily-unavailable': [503],
};

const parseFailure = (value: unknown, status: number): PublicCommentBrowserFailure | null => {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['ok', 'version', 'error', 'retryable']) ||
    value.ok !== false ||
    value.version !== 1 ||
    typeof value.error !== 'string' ||
    !Object.prototype.hasOwnProperty.call(failureStatus, value.error) ||
    !failureStatus[value.error as PublicCommentBrowserFailureCode].includes(status) ||
    typeof value.retryable !== 'boolean'
  ) {
    return null;
  }
  return value as unknown as PublicCommentBrowserFailure;
};

const readBoundedJson = async (response: Response, maxBytes: number) => {
  if (response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
    return null;
  }
  try {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const unavailable = (): PublicCommentBrowserFailure => ({
  ok: false,
  version: 1,
  error: 'temporarily-unavailable',
  retryable: true,
});

const postJson = async (
  path: string,
  body: string,
  input: FetchInput,
  extraHeaders: Record<string, string> = {},
) => {
  const init: RequestInit = {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...extraHeaders,
    },
    body,
    signal: input.signal,
  };
  if (input.fetcher) {
    const { fetcher } = input;
    return fetcher(path, init);
  }
  return globalThis.fetch(path, init);
};

export const listPublicComments = async (
  input: FetchInput &
    Readonly<{
      roomId: string;
      expectedPolicyVersion: number;
      expectedCutoffGeneration: number;
      beforeSequence: number | null;
    }>,
): Promise<PublicCommentListBrowserResult> => {
  if (
    !ROOM_ID.test(input.roomId) ||
    !isPositiveSafeInteger(input.expectedPolicyVersion) ||
    !isNonnegativeSafeInteger(input.expectedCutoffGeneration) ||
    (input.beforeSequence !== null && !isPositiveSafeInteger(input.beforeSequence))
  ) {
    return { ok: false, version: 1, error: 'invalid-request', retryable: false };
  }
  try {
    const response = await postJson(
      `/api/public/documents/${input.roomId}/comments/list`,
      JSON.stringify({
        version: 1,
        expectedPolicyVersion: input.expectedPolicyVersion,
        expectedCutoffGeneration: input.expectedCutoffGeneration,
        beforeSequence: input.beforeSequence,
      }),
      input,
    );
    const value = await readBoundedJson(response, MAX_LIST_RESPONSE_BYTES);
    const parsedFailure = parseFailure(value, response.status);
    if (parsedFailure) return parsedFailure;
    if (
      response.status !== 200 ||
      !isPlainObject(value) ||
      !hasExactKeys(value, ['ok', 'version', 'authorization', 'comments', 'nextBeforeSequence']) ||
      value.ok !== true ||
      value.version !== 1 ||
      !Array.isArray(value.comments) ||
      value.comments.length > 50 ||
      (value.nextBeforeSequence !== null && !isPositiveSafeInteger(value.nextBeforeSequence))
    ) {
      return unavailable();
    }
    const authorization = parseAuthorization(value.authorization, input.roomId);
    const comments = value.comments.map(parseComment);
    if (
      !authorization ||
      comments.some((comment) => comment === null) ||
      comments.some(
        (comment, index) => index > 0 && comment!.sequence <= comments[index - 1]!.sequence,
      )
    ) {
      return unavailable();
    }
    return {
      ok: true,
      version: 1,
      authorization,
      comments: comments as PublicCommentDtoV1[],
      nextBeforeSequence: value.nextBeforeSequence as number | null,
    };
  } catch {
    return unavailable();
  }
};

export const requestPublicCommentAuthoringSession = async (
  input: FetchInput & Readonly<{ roomId: string }>,
): Promise<PublicCommentAuthoringSessionResult> => {
  if (!ROOM_ID.test(input.roomId)) {
    return { ok: false, version: 1, error: 'invalid-request', retryable: false };
  }
  try {
    const response = await postJson(
      `/api/public/documents/${input.roomId}/comments/authoring-session`,
      '{"version":1}',
      input,
    );
    const value = await readBoundedJson(response, MAX_MUTATION_RESPONSE_BYTES);
    const parsedFailure = parseFailure(value, response.status);
    if (parsedFailure) return parsedFailure;
    if (
      response.status !== 200 ||
      !isPlainObject(value) ||
      value.ok !== true ||
      value.version !== 1 ||
      typeof value.authenticated !== 'boolean'
    ) {
      return unavailable();
    }
    if (value.authenticated === false && hasExactKeys(value, ['ok', 'version', 'authenticated'])) {
      return { ok: true, version: 1, authenticated: false };
    }
    if (
      value.authenticated === true &&
      hasExactKeys(value, ['ok', 'version', 'authenticated', 'csrfProof', 'expiresAt']) &&
      typeof value.csrfProof === 'string' &&
      CSRF_PROOF.test(value.csrfProof) &&
      proofExpiresAt(value.csrfProof, value.expiresAt)
    ) {
      return {
        ok: true,
        version: 1,
        authenticated: true,
        csrfProof: value.csrfProof,
        expiresAt: value.expiresAt as string,
      };
    }
    return unavailable();
  } catch {
    return unavailable();
  }
};

export const createPublicComment = async (
  input: FetchInput &
    Readonly<{
      roomId: string;
      mutationId: string;
      expectedPolicyVersion: number;
      expectedCutoffGeneration: number;
      body: string;
      csrfProof: string;
    }>,
): Promise<PublicCommentCreateBrowserResult> => {
  if (
    !ROOM_ID.test(input.roomId) ||
    !UUID_V4.test(input.mutationId) ||
    !isPositiveSafeInteger(input.expectedPolicyVersion) ||
    !isNonnegativeSafeInteger(input.expectedCutoffGeneration) ||
    canonicalizePublicCommentBody(input.body) !== input.body ||
    !CSRF_PROOF.test(input.csrfProof)
  ) {
    return { ok: false, version: 1, error: 'invalid-request', retryable: false };
  }
  try {
    const response = await postJson(
      `/api/public/documents/${input.roomId}/comments/create`,
      JSON.stringify({
        version: 1,
        mutationId: input.mutationId,
        expectedPolicyVersion: input.expectedPolicyVersion,
        expectedCutoffGeneration: input.expectedCutoffGeneration,
        body: input.body,
      }),
      input,
      { 'x-lash-csrf-proof': input.csrfProof },
    );
    const value = await readBoundedJson(response, MAX_MUTATION_RESPONSE_BYTES);
    const parsedFailure = parseFailure(value, response.status);
    if (parsedFailure) return parsedFailure;
    if (
      (response.status !== 200 && response.status !== 201) ||
      !isPlainObject(value) ||
      !hasExactKeys(value, ['ok', 'version', 'created', 'authorization', 'comment']) ||
      value.ok !== true ||
      value.version !== 1 ||
      typeof value.created !== 'boolean'
    ) {
      return unavailable();
    }
    const authorization = parseAuthorization(value.authorization, input.roomId);
    const comment = parseComment(value.comment);
    if (!authorization || !comment) return unavailable();
    return {
      ok: true,
      version: 1,
      created: value.created,
      authorization,
      comment,
    };
  } catch {
    return unavailable();
  }
};

export const hidePublicComment = async (
  input: FetchInput &
    Readonly<{
      localDocumentId: string;
      commentId: string;
      mutationId: string;
      expectedPolicyVersion: number;
      expectedCutoffGeneration: number;
    }>,
): Promise<PublicCommentHideBrowserResult> => {
  if (
    !LOCAL_DOCUMENT_ID.test(input.localDocumentId) ||
    !COMMENT_ID.test(input.commentId) ||
    !UUID_V4.test(input.mutationId) ||
    !isPositiveSafeInteger(input.expectedPolicyVersion) ||
    !isNonnegativeSafeInteger(input.expectedCutoffGeneration)
  ) {
    return { ok: false, version: 1, error: 'invalid-request', retryable: false };
  }
  try {
    const response = await postJson(
      `/api/documents/${encodeURIComponent(input.localDocumentId)}/public-comments/${input.commentId}/hide`,
      JSON.stringify({
        version: 1,
        mutationId: input.mutationId,
        expectedPolicyVersion: input.expectedPolicyVersion,
        expectedCutoffGeneration: input.expectedCutoffGeneration,
      }),
      input,
    );
    const value = await readBoundedJson(response, MAX_MUTATION_RESPONSE_BYTES);
    const parsedFailure = parseFailure(value, response.status);
    if (parsedFailure) return parsedFailure;
    if (
      response.status !== 200 ||
      !isPlainObject(value) ||
      !hasExactKeys(value, [
        'ok',
        'version',
        'commentId',
        'state',
        'changed',
        'policyVersion',
        'cutoffGeneration',
        'moderatedAt',
      ]) ||
      value.ok !== true ||
      value.version !== 1 ||
      value.commentId !== input.commentId ||
      value.state !== 'hidden' ||
      typeof value.changed !== 'boolean' ||
      !isPositiveSafeInteger(value.policyVersion) ||
      !isNonnegativeSafeInteger(value.cutoffGeneration) ||
      !isCanonicalTimestamp(value.moderatedAt)
    ) {
      return unavailable();
    }
    return value as unknown as Extract<PublicCommentHideBrowserResult, { ok: true }>;
  } catch {
    return unavailable();
  }
};
