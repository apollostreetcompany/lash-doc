import { parsePublicDocumentMode, parsePublicDocumentRoomId } from './index';
import type { PublicDocumentBrowserSession } from './provider';
import type {
  PublicDocumentBrowserSessionFailureV1,
  PublicDocumentBrowserSessionSuccessV1,
} from './types';

const ACTOR_ID = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/u;
const PUBLIC_TICKET = /^lash-public-ticket\.[A-Za-z0-9_-]{43}$/u;
const RESPONSE_BYTES_LIMIT = 16 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const TICKET_TTL_MS = 60_000;

export type PublicDocumentSessionBrowserResult =
  | Readonly<{ ok: true; session: PublicDocumentBrowserSession }>
  | Readonly<{
      ok: false;
      error: PublicDocumentBrowserSessionFailureV1['error'];
      retryable: boolean;
    }>;

type PublicDocumentSessionBrowserDependencies = Readonly<{
  fetcher: typeof fetch;
  now: () => Date;
  timeoutMs?: number;
}>;

const defaultDependencies: PublicDocumentSessionBrowserDependencies = {
  fetcher: fetch,
  now: () => new Date(),
};

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

const unavailable = (): PublicDocumentSessionBrowserResult => ({
  ok: false,
  error: 'document-unavailable',
  retryable: false,
});

const parseSocketUrl = (raw: unknown, roomId: string, actorId: string) => {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    const query = [...url.searchParams.entries()];
    return (url.protocol === 'wss:' ||
      (url.protocol === 'ws:' &&
        (url.hostname === 'localhost' ||
          url.hostname === '127.0.0.1' ||
          url.hostname === '[::1]'))) &&
      url.username === '' &&
      url.password === '' &&
      url.hash === '' &&
      url.pathname === `/api/realtime/rooms/${roomId}/socket` &&
      query.length === 2 &&
      query[0]?.[0] === 'protocolVersion' &&
      query[0]?.[1] === '4' &&
      query[1]?.[0] === 'actorId' &&
      query[1]?.[1] === actorId
      ? raw
      : null;
  } catch {
    return null;
  }
};

const parseCanonicalExpiry = (value: unknown, now: Date) => {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value &&
    milliseconds > now.getTime() &&
    milliseconds <= now.getTime() + TICKET_TTL_MS
    ? value
    : null;
};

const parseSuccess = (
  value: Record<string, unknown>,
  roomId: string,
  actorId: string,
  now: Date,
): PublicDocumentBrowserSessionSuccessV1 | null => {
  if (
    !hasExactKeys(value, ['ok', 'version', 'authorization', 'grant', 'socket']) ||
    value.ok !== true ||
    value.version !== 1 ||
    !isPlainObject(value.authorization) ||
    !hasExactKeys(value.authorization, ['roomId', 'mode', 'policyVersion', 'cutoffGeneration']) ||
    value.authorization.roomId !== roomId ||
    !parsePublicDocumentMode(value.authorization.mode) ||
    !Number.isSafeInteger(value.authorization.policyVersion) ||
    Number(value.authorization.policyVersion) <= 0 ||
    !Number.isSafeInteger(value.authorization.cutoffGeneration) ||
    Number(value.authorization.cutoffGeneration) < 0 ||
    !isPlainObject(value.grant) ||
    !hasExactKeys(value.grant, ['source', 'capabilities', 'protocolVersion']) ||
    value.grant.source !== 'public' ||
    !Array.isArray(value.grant.capabilities) ||
    value.grant.capabilities.length !== 1 ||
    value.grant.capabilities[0] !== 'doc.read' ||
    value.grant.protocolVersion !== 4 ||
    !isPlainObject(value.socket) ||
    !hasExactKeys(value.socket, ['url', 'protocol', 'ticketProtocol', 'expiresAt']) ||
    !parseSocketUrl(value.socket.url, roomId, actorId) ||
    value.socket.protocol !== 'lash-realtime-v4' ||
    typeof value.socket.ticketProtocol !== 'string' ||
    !PUBLIC_TICKET.test(value.socket.ticketProtocol) ||
    !parseCanonicalExpiry(value.socket.expiresAt, now)
  ) {
    return null;
  }
  return value as unknown as PublicDocumentBrowserSessionSuccessV1;
};

const parseFailure = (
  value: Record<string, unknown>,
  status: number,
): PublicDocumentSessionBrowserResult | null => {
  if (
    !hasExactKeys(value, ['ok', 'version', 'error', 'retryable']) ||
    value.ok !== false ||
    value.version !== 1 ||
    typeof value.error !== 'string' ||
    typeof value.retryable !== 'boolean'
  ) {
    return null;
  }
  const expected: Record<string, { status: number; retryable: boolean }> = {
    'invalid-request': { status: 400, retryable: false },
    'document-unavailable': { status: 404, retryable: false },
    'rate-limited': { status: 429, retryable: true },
    'temporarily-unavailable': { status: 503, retryable: true },
  };
  const pair = expected[value.error];
  return pair?.status === status && pair.retryable === value.retryable
    ? {
        ok: false,
        error: value.error as PublicDocumentBrowserSessionFailureV1['error'],
        retryable: value.retryable,
      }
    : null;
};

const readBoundedJson = async (response: Response) => {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RESPONSE_BYTES_LIMIT) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return null;
  }
};

export const requestPublicDocumentSession = async (
  input: Readonly<{ roomId: string; actorId: string; signal?: AbortSignal }>,
  dependencies: PublicDocumentSessionBrowserDependencies = defaultDependencies,
): Promise<PublicDocumentSessionBrowserResult> => {
  const roomId = parsePublicDocumentRoomId(input.roomId);
  if (!roomId || !ACTOR_ID.test(input.actorId) || input.signal?.aborted) return unavailable();

  const fetcher = dependencies.fetcher;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  input.signal?.addEventListener('abort', abortFromCaller, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error('public-browser-session-timeout'));
    }, dependencies.timeoutMs ?? REQUEST_TIMEOUT_MS);
  });
  const operation = async (): Promise<PublicDocumentSessionBrowserResult> => {
    const response = await fetcher(`/api/public/documents/${roomId}/session`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, actorId: input.actorId }),
      signal: controller.signal,
    });
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
        Number(declaredLength) > RESPONSE_BYTES_LIMIT)
    ) {
      return unavailable();
    }
    if (response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
      return unavailable();
    }
    const value = await readBoundedJson(response);
    if (!isPlainObject(value)) return unavailable();
    if (response.status === 200) {
      const success = parseSuccess(value, roomId, input.actorId, dependencies.now());
      return success
        ? {
            ok: true,
            session: {
              authorization: success.authorization,
              actorId: input.actorId,
              socketUrl: success.socket.url,
              socketProtocol: success.socket.protocol,
              ticketProtocol: success.socket.ticketProtocol,
            },
          }
        : unavailable();
    }
    return parseFailure(value, response.status) ?? unavailable();
  };

  try {
    return await Promise.race([operation(), deadline]);
  } catch {
    return timedOut || !input.signal?.aborted
      ? { ok: false, error: 'temporarily-unavailable', retryable: true }
      : unavailable();
  } finally {
    if (timeout) clearTimeout(timeout);
    input.signal?.removeEventListener('abort', abortFromCaller);
  }
};
