import { Buffer } from 'node:buffer';

export const PUBLIC_COMMENT_REQUEST_LIMITS = {
  authoringSession: 64,
  create: 8_192,
  hide: 512,
  list: 512,
} as const;

const ROOM_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const COMMENT_ID = /^pc-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type BrowserPostRequest = Readonly<{
  body: ReadableStream<Uint8Array> | null;
  headers: Headers;
  method: string;
  url: string;
}>;

type ParseDecision<Request> =
  | Readonly<{ ok: true; request: Request }>
  | Readonly<{ ok: false; error: 'invalid-request' }>;

const invalid = { ok: false, error: 'invalid-request' } as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};

const positiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const cutoffGeneration = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const parseJsonWithoutDuplicateKeys = (raw: string): unknown => {
  let offset = 0;
  const whitespace = () => {
    while (/[\t\n\r ]/u.test(raw[offset] ?? '')) offset += 1;
  };
  const parseString = () => {
    const start = offset;
    if (raw[offset] !== '"') throw new Error('string expected');
    offset += 1;
    while (offset < raw.length) {
      const character = raw[offset];
      if (character === '"') {
        offset += 1;
        return JSON.parse(raw.slice(start, offset)) as string;
      }
      offset += character === '\\' ? 2 : 1;
    }
    throw new Error('unterminated string');
  };
  const parseValue = (): void => {
    whitespace();
    const character = raw[offset];
    if (character === '{') {
      offset += 1;
      whitespace();
      const keys = new Set<string>();
      if (raw[offset] === '}') {
        offset += 1;
        return;
      }
      while (offset < raw.length) {
        whitespace();
        const key = parseString();
        if (keys.has(key)) throw new Error('duplicate key');
        keys.add(key);
        whitespace();
        if (raw[offset] !== ':') throw new Error('colon expected');
        offset += 1;
        parseValue();
        whitespace();
        if (raw[offset] === '}') {
          offset += 1;
          return;
        }
        if (raw[offset] !== ',') throw new Error('comma expected');
        offset += 1;
      }
      throw new Error('unterminated object');
    }
    if (character === '[') {
      offset += 1;
      whitespace();
      if (raw[offset] === ']') {
        offset += 1;
        return;
      }
      while (offset < raw.length) {
        parseValue();
        whitespace();
        if (raw[offset] === ']') {
          offset += 1;
          return;
        }
        if (raw[offset] !== ',') throw new Error('comma expected');
        offset += 1;
      }
      throw new Error('unterminated array');
    }
    if (character === '"') {
      parseString();
      return;
    }
    const token = raw
      .slice(offset)
      .match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u)?.[0];
    if (!token) throw new Error('value expected');
    offset += token.length;
  };

  parseValue();
  whitespace();
  if (offset !== raw.length) throw new Error('trailing input');
  return JSON.parse(raw) as unknown;
};

const parseObject = (rawBody: string): Record<string, unknown> | null => {
  try {
    const value = parseJsonWithoutDuplicateKeys(rawBody);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
};

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

export const canonicalPublicCommentBody = (value: unknown): string | null => {
  if (typeof value !== 'string' || hasUnpairedSurrogate(value)) return null;
  const body = value.replace(/\r\n?/gu, '\n').normalize('NFC').trim();
  return body.length > 0 &&
    [...body].length <= 2_000 &&
    new TextEncoder().encode(body).byteLength <= 4_096 &&
    body.split('\n').length <= 20 &&
    !/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(body)
    ? body
    : null;
};

export const parsePublicCommentRoomId = (value: unknown): string | null =>
  typeof value === 'string' && ROOM_ID.test(value) ? value : null;

export const parsePublicCommentListBody = (
  rawBody: string,
): ParseDecision<{
  version: 1;
  expectedPolicyVersion: number;
  expectedCutoffGeneration: number;
  beforeSequence: number | null;
}> => {
  const value = parseObject(rawBody);
  if (
    !value ||
    !hasExactKeys(value, [
      'version',
      'expectedPolicyVersion',
      'expectedCutoffGeneration',
      'beforeSequence',
    ]) ||
    value.version !== 1 ||
    !positiveInteger(value.expectedPolicyVersion) ||
    !cutoffGeneration(value.expectedCutoffGeneration) ||
    !(value.beforeSequence === null || positiveInteger(value.beforeSequence))
  ) {
    return invalid;
  }
  return {
    ok: true,
    request: {
      version: 1,
      expectedPolicyVersion: value.expectedPolicyVersion,
      expectedCutoffGeneration: value.expectedCutoffGeneration,
      beforeSequence: value.beforeSequence,
    },
  };
};

export const parsePublicCommentAuthoringSessionBody = (
  rawBody: string,
): ParseDecision<{ version: 1 }> => {
  const value = parseObject(rawBody);
  return value && hasExactKeys(value, ['version']) && value.version === 1
    ? { ok: true, request: { version: 1 } }
    : invalid;
};

export const parsePublicCommentCreateBody = (
  rawBody: string,
): ParseDecision<{
  version: 1;
  mutationId: string;
  expectedPolicyVersion: number;
  expectedCutoffGeneration: number;
  body: string;
}> => {
  const value = parseObject(rawBody);
  if (
    !value ||
    !hasExactKeys(value, [
      'version',
      'mutationId',
      'expectedPolicyVersion',
      'expectedCutoffGeneration',
      'body',
    ]) ||
    value.version !== 1 ||
    typeof value.mutationId !== 'string' ||
    !LOWERCASE_UUID_V4.test(value.mutationId) ||
    !positiveInteger(value.expectedPolicyVersion) ||
    !cutoffGeneration(value.expectedCutoffGeneration)
  ) {
    return invalid;
  }
  const body = canonicalPublicCommentBody(value.body);
  if (body === null || body !== value.body) return invalid;
  return {
    ok: true,
    request: {
      version: 1,
      mutationId: value.mutationId,
      expectedPolicyVersion: value.expectedPolicyVersion,
      expectedCutoffGeneration: value.expectedCutoffGeneration,
      body,
    },
  };
};

export const parsePublicCommentHideBody = (
  rawBody: string,
  commentId: unknown,
): ParseDecision<{
  version: 1;
  mutationId: string;
  expectedPolicyVersion: number;
  expectedCutoffGeneration: number;
}> => {
  const value = parseObject(rawBody);
  if (
    typeof commentId !== 'string' ||
    !COMMENT_ID.test(commentId) ||
    !value ||
    !hasExactKeys(value, [
      'version',
      'mutationId',
      'expectedPolicyVersion',
      'expectedCutoffGeneration',
    ]) ||
    value.version !== 1 ||
    typeof value.mutationId !== 'string' ||
    !LOWERCASE_UUID_V4.test(value.mutationId) ||
    !positiveInteger(value.expectedPolicyVersion) ||
    !cutoffGeneration(value.expectedCutoffGeneration)
  ) {
    return invalid;
  }
  return {
    ok: true,
    request: {
      version: 1,
      mutationId: value.mutationId,
      expectedPolicyVersion: value.expectedPolicyVersion,
      expectedCutoffGeneration: value.expectedCutoffGeneration,
    },
  };
};

const parseConfiguredSiteOrigin = (raw: string) => {
  try {
    const url = new URL(raw);
    return url.origin === raw &&
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
      ? url
      : null;
  } catch {
    return null;
  }
};

const hasJsonMediaType = (value: string | null) => {
  if (value === null || value.includes(',')) return false;
  const [mediaType, ...parameters] = value.split(';').map((part) => part.trim());
  return (
    mediaType?.toLowerCase() === 'application/json' &&
    parameters.length <= 1 &&
    parameters.every((parameter) => /^charset=utf-8$/iu.test(parameter.replace(/\s+/gu, '')))
  );
};

export const readPublicCommentJsonPost = async (input: {
  request: BrowserPostRequest;
  siteOrigin: string;
  expectedPath: string;
  maxBytes: number;
}): Promise<
  Readonly<{ ok: true; rawBody: string }> | Readonly<{ ok: false; status: 400 | 403 | 413 }>
> => {
  const site = parseConfiguredSiteOrigin(input.siteOrigin);
  if (!site) return { ok: false, status: 403 };

  let transport: URL;
  try {
    transport = new URL(input.request.url);
  } catch {
    return { ok: false, status: 400 };
  }
  const forwardedProtocol = input.request.headers.get('x-forwarded-proto');
  const effectiveProtocol =
    forwardedProtocol === null
      ? transport.protocol
      : forwardedProtocol === 'http' || forwardedProtocol === 'https'
        ? `${forwardedProtocol}:`
        : null;
  if (
    input.request.headers.get('host') !== site.host ||
    effectiveProtocol !== site.protocol ||
    input.request.headers.get('origin') !== site.origin ||
    input.request.headers.get('sec-fetch-site') !== 'same-origin' ||
    input.request.headers.get('sec-fetch-mode') !== 'cors' ||
    input.request.headers.get('sec-fetch-dest') !== 'empty'
  ) {
    return { ok: false, status: 403 };
  }
  if (
    input.request.method !== 'POST' ||
    (transport.protocol !== 'https:' && transport.protocol !== 'http:') ||
    transport.username !== '' ||
    transport.password !== '' ||
    transport.pathname !== input.expectedPath ||
    transport.search !== '' ||
    transport.hash !== '' ||
    !hasJsonMediaType(input.request.headers.get('content-type')) ||
    input.request.headers.get('content-encoding') !== null ||
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes < 1
  ) {
    return { ok: false, status: 400 };
  }

  const declaredLength = input.request.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > input.maxBytes)
  ) {
    return {
      ok: false,
      status:
        /^(?:0|[1-9][0-9]*)$/u.test(declaredLength) && Number(declaredLength) > input.maxBytes
          ? 413
          : 400,
    };
  }
  if (!input.request.body) return { ok: false, status: 400 };
  const reader = input.request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > input.maxBytes) {
      await reader.cancel();
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }
  if (declaredLength !== null && Number(declaredLength) !== total) {
    return { ok: false, status: 400 };
  }
  try {
    return {
      ok: true,
      rawBody: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)),
    };
  } catch {
    return { ok: false, status: 400 };
  }
};
