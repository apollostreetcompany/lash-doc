export const PUBLIC_DOCUMENT_SESSION_LIMITS = {
  requestBytes: 512,
} as const;

const PUBLIC_ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const PUBLIC_ACTOR_ID = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/u;
const JSON_WHITESPACE = '[\\t\\n\\r ]*';
const VERSION_FIRST = new RegExp(
  `^${JSON_WHITESPACE}\\{${JSON_WHITESPACE}"version"${JSON_WHITESPACE}:${JSON_WHITESPACE}1${JSON_WHITESPACE},${JSON_WHITESPACE}"actorId"${JSON_WHITESPACE}:${JSON_WHITESPACE}"([a-z0-9-]+)"${JSON_WHITESPACE}\\}${JSON_WHITESPACE}$`,
  'u',
);
const ACTOR_FIRST = new RegExp(
  `^${JSON_WHITESPACE}\\{${JSON_WHITESPACE}"actorId"${JSON_WHITESPACE}:${JSON_WHITESPACE}"([a-z0-9-]+)"${JSON_WHITESPACE},${JSON_WHITESPACE}"version"${JSON_WHITESPACE}:${JSON_WHITESPACE}1${JSON_WHITESPACE}\\}${JSON_WHITESPACE}$`,
  'u',
);

export type PublicDocumentMode = 'read' | 'comment';

export type BrowserPublicDocumentSessionRequestDecision =
  | {
      ok: true;
      request: Readonly<{
        version: 1;
        actorId: string;
      }>;
    }
  | {
      ok: false;
      error: 'invalid-request';
    };

export type PublicDocumentSessionRequestEnvelope = Readonly<{
  method: unknown;
  requestUrl: unknown;
  siteOrigin: unknown;
  roomId: unknown;
  rawBody: unknown;
  headers: Readonly<{
    origin: unknown;
    contentType: unknown;
    contentEncoding: unknown;
    contentLength: unknown;
    secFetchSite: unknown;
    secFetchMode: unknown;
    secFetchDest: unknown;
  }>;
}>;

export type PublicDocumentSessionRequestEnvelopeDecision =
  | Readonly<{
      ok: true;
      roomId: string;
      request: Readonly<{
        version: 1;
        actorId: string;
      }>;
    }>
  | Readonly<{
      ok: false;
      error: 'invalid-request';
    }>;

type PublicDocumentUnavailableState = Readonly<{
  phase: 'unavailable';
  roomId: string;
  canRevealContent: false;
}>;

type PublicDocumentAuthorizingState = Readonly<{
  phase: 'authorizing';
  roomId: string;
  canRevealContent: false;
}>;

type PublicDocumentHydratingState = Readonly<{
  phase: 'hydrating';
  roomId: string;
  mode: PublicDocumentMode;
  policyVersion: number;
  cutoffGeneration: number;
  canRevealContent: false;
}>;

type PublicDocumentReadyState = Readonly<{
  phase: 'ready';
  roomId: string;
  mode: PublicDocumentMode;
  policyVersion: number;
  cutoffGeneration: number;
  canRevealContent: true;
}>;

export type PublicDocumentOpeningState =
  | PublicDocumentUnavailableState
  | PublicDocumentAuthorizingState
  | PublicDocumentHydratingState
  | PublicDocumentReadyState;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const isPolicyCounter = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const unavailable = (roomId: string): PublicDocumentUnavailableState =>
  Object.freeze({
    phase: 'unavailable',
    roomId,
    canRevealContent: false,
  });

export const parsePublicDocumentRoomId = (value: unknown): string | null =>
  typeof value === 'string' && PUBLIC_ROOM_ID.test(value) ? value : null;

export const parsePublicDocumentMode = (value: unknown): PublicDocumentMode | null =>
  value === 'read' || value === 'comment' ? value : null;

export const parseBrowserPublicDocumentSessionRequest = (
  raw: string,
): BrowserPublicDocumentSessionRequestDecision => {
  if (
    typeof raw !== 'string' ||
    new TextEncoder().encode(raw).byteLength > PUBLIC_DOCUMENT_SESSION_LIMITS.requestBytes
  ) {
    return { ok: false, error: 'invalid-request' };
  }
  const actorId = VERSION_FIRST.exec(raw)?.[1] ?? ACTOR_FIRST.exec(raw)?.[1];
  if (!actorId || !PUBLIC_ACTOR_ID.test(actorId)) {
    return { ok: false, error: 'invalid-request' };
  }
  return {
    ok: true,
    request: Object.freeze({
      version: 1,
      actorId,
    }),
  };
};

const hasJsonMediaType = (value: unknown) => {
  if (typeof value !== 'string' || value.includes(',')) return false;
  const [mediaType, ...parameters] = value.split(';').map((part) => part.trim());
  return (
    mediaType?.toLowerCase() === 'application/json' &&
    parameters.length <= 1 &&
    parameters.every((parameter) => /^charset=utf-8$/iu.test(parameter.replace(/\s+/gu, '')))
  );
};

const parseSiteOrigin = (value: unknown): string | null => {
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

export const parsePublicDocumentSessionRequestEnvelope = (
  input: PublicDocumentSessionRequestEnvelope,
): PublicDocumentSessionRequestEnvelopeDecision => {
  const roomId = parsePublicDocumentRoomId(input.roomId);
  const siteOrigin = parseSiteOrigin(input.siteOrigin);
  const body =
    typeof input.rawBody === 'string'
      ? parseBrowserPublicDocumentSessionRequest(input.rawBody)
      : ({ ok: false, error: 'invalid-request' } as const);
  if (
    input.method !== 'POST' ||
    !roomId ||
    !siteOrigin ||
    !body.ok ||
    !isPlainObject(input.headers) ||
    input.headers.origin !== siteOrigin ||
    !hasJsonMediaType(input.headers.contentType) ||
    input.headers.contentEncoding !== null ||
    input.headers.secFetchSite !== 'same-origin' ||
    input.headers.secFetchMode !== 'cors' ||
    input.headers.secFetchDest !== 'empty'
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  const rawBytes = new TextEncoder().encode(input.rawBody as string).byteLength;
  if (
    input.headers.contentLength !== null &&
    (typeof input.headers.contentLength !== 'string' ||
      !/^(?:0|[1-9][0-9]*)$/u.test(input.headers.contentLength) ||
      Number(input.headers.contentLength) !== rawBytes ||
      rawBytes > PUBLIC_DOCUMENT_SESSION_LIMITS.requestBytes)
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  try {
    if (typeof input.requestUrl !== 'string') {
      return { ok: false, error: 'invalid-request' };
    }
    const requestUrl = new URL(input.requestUrl);
    if (
      (requestUrl.protocol !== 'https:' && requestUrl.protocol !== 'http:') ||
      requestUrl.pathname !== `/api/public/documents/${roomId}/session` ||
      requestUrl.search !== '' ||
      requestUrl.hash !== '' ||
      requestUrl.username !== '' ||
      requestUrl.password !== ''
    ) {
      return { ok: false, error: 'invalid-request' };
    }
  } catch {
    return { ok: false, error: 'invalid-request' };
  }

  return Object.freeze({
    ok: true,
    roomId,
    request: body.request,
  });
};

export const createPublicDocumentOpeningState = (roomId: unknown): PublicDocumentOpeningState => {
  const canonicalRoomId = parsePublicDocumentRoomId(roomId);
  return canonicalRoomId
    ? Object.freeze({
        phase: 'authorizing',
        roomId: canonicalRoomId,
        canRevealContent: false,
      })
    : unavailable('');
};

export const markPublicDocumentSessionAuthorized = (
  current: PublicDocumentOpeningState,
  authorization: unknown,
): PublicDocumentOpeningState => {
  if (
    current.phase !== 'authorizing' ||
    !isPlainObject(authorization) ||
    !hasExactKeys(authorization, ['roomId', 'mode', 'policyVersion', 'cutoffGeneration'])
  ) {
    return unavailable(current.roomId);
  }
  const roomId = parsePublicDocumentRoomId(authorization.roomId);
  const mode = parsePublicDocumentMode(authorization.mode);
  if (
    roomId !== current.roomId ||
    !mode ||
    !isPolicyCounter(authorization.policyVersion) ||
    !isPolicyCounter(authorization.cutoffGeneration)
  ) {
    return unavailable(current.roomId);
  }
  return Object.freeze({
    phase: 'hydrating',
    roomId,
    mode,
    policyVersion: authorization.policyVersion,
    cutoffGeneration: authorization.cutoffGeneration,
    canRevealContent: false,
  });
};

export const completePublicDocumentHydration = (
  current: PublicDocumentOpeningState,
  receipt: unknown,
): PublicDocumentOpeningState => {
  if (
    current.phase !== 'hydrating' ||
    !isPlainObject(receipt) ||
    !hasExactKeys(receipt, [
      'roomId',
      'mode',
      'policyVersion',
      'cutoffGeneration',
      'hydrationComplete',
    ])
  ) {
    return unavailable(current.roomId);
  }
  const roomId = parsePublicDocumentRoomId(receipt.roomId);
  const mode = parsePublicDocumentMode(receipt.mode);
  if (
    receipt.hydrationComplete !== true ||
    roomId !== current.roomId ||
    mode !== current.mode ||
    receipt.policyVersion !== current.policyVersion ||
    receipt.cutoffGeneration !== current.cutoffGeneration
  ) {
    return unavailable(current.roomId);
  }
  return Object.freeze({
    phase: 'ready',
    roomId,
    mode,
    policyVersion: current.policyVersion,
    cutoffGeneration: current.cutoffGeneration,
    canRevealContent: true,
  });
};
