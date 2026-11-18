import { describe, expect, it } from 'vitest';

import {
  PUBLIC_COMMENT_REQUEST_LIMITS,
  parsePublicCommentAuthoringSessionBody,
  parsePublicCommentCreateBody,
  parsePublicCommentHideBody,
  parsePublicCommentListBody,
  readPublicCommentJsonPost,
} from '../../../../apps/web/lib/publicDocumentComments/boundary';

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const COMMENT_ID = 'pc-v1-123e4567-e89b-42d3-a456-426614174000';
const MUTATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const SITE_ORIGIN = 'https://lash.example';
const LIST_PATH = `/api/public/documents/${ROOM_ID}/comments/list`;

const request = (
  body: string | Uint8Array,
  changes: {
    headers?: Record<string, string | null>;
    method?: string;
    url?: string;
  } = {},
) => {
  const headers = new Headers({
    host: 'lash.example',
    origin: SITE_ORIGIN,
    'x-forwarded-proto': 'https',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'content-type': 'application/json; charset=utf-8',
  });
  for (const [name, value] of Object.entries(changes.headers ?? {})) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  const transportUrl = `http://127.0.0.1:3001${LIST_PATH}`;
  const result = new Request(
    changes.url?.includes('@') ? transportUrl : (changes.url ?? transportUrl),
    {
      method: changes.method ?? 'POST',
      headers,
      body,
    },
  );
  if (changes.url?.includes('@')) {
    Object.defineProperty(result, 'url', { value: changes.url });
  }
  return result;
};

describe('public comment browser POST boundary', () => {
  it('accepts the Next internal transport URL only with exact external browser authority', async () => {
    const rawBody = JSON.stringify({
      version: 1,
      expectedPolicyVersion: 4,
      expectedCutoffGeneration: 2,
      beforeSequence: null,
    });
    await expect(
      readPublicCommentJsonPost({
        request: request(rawBody),
        siteOrigin: SITE_ORIGIN,
        expectedPath: LIST_PATH,
        maxBytes: PUBLIC_COMMENT_REQUEST_LIMITS.list,
      }),
    ).resolves.toEqual({ ok: true, rawBody });
  });

  it.each([
    ['host', { headers: { host: 'attacker.example' } }],
    ['origin', { headers: { origin: 'https://attacker.example' } }],
    ['forwarded protocol', { headers: { 'x-forwarded-proto': 'https,http' } }],
    ['fetch site', { headers: { 'sec-fetch-site': 'cross-site' } }],
    ['fetch mode', { headers: { 'sec-fetch-mode': 'navigate' } }],
    ['fetch destination', { headers: { 'sec-fetch-dest': 'document' } }],
  ])('rejects forged %s authority before parsing a body', async (_label, changes) => {
    await expect(
      readPublicCommentJsonPost({
        request: request('{"version":1}', changes),
        siteOrigin: SITE_ORIGIN,
        expectedPath: LIST_PATH,
        maxBytes: PUBLIC_COMMENT_REQUEST_LIMITS.list,
      }),
    ).resolves.toEqual({ ok: false, status: 403 });
  });

  it.each([
    ['query', { url: `https://lash.example${LIST_PATH}?probe=true` }],
    ['trailing slash', { url: `https://lash.example${LIST_PATH}/` }],
    ['wrong path', { url: `https://lash.example${LIST_PATH}/../create` }],
    ['userinfo', { url: `https://person:secret@lash.example${LIST_PATH}` }],
    ['non-http', { url: `ftp://lash.example${LIST_PATH}` }],
    ['method', { method: 'PUT' }],
    ['media type', { headers: { 'content-type': 'text/plain' } }],
    ['content encoding', { headers: { 'content-encoding': 'gzip' } }],
    ['noncanonical length', { headers: { 'content-length': '01' } }],
    ['wrong length', { headers: { 'content-length': '9' } }],
  ])('rejects malformed %s transport metadata', async (_label, changes) => {
    await expect(
      readPublicCommentJsonPost({
        request: request('{"version":1}', changes),
        siteOrigin: SITE_ORIGIN,
        expectedPath: LIST_PATH,
        maxBytes: PUBLIC_COMMENT_REQUEST_LIMITS.list,
      }),
    ).resolves.toEqual({ ok: false, status: 400 });
  });

  it('distinguishes oversized and invalid UTF-8 bodies', async () => {
    await expect(
      readPublicCommentJsonPost({
        request: request('x'.repeat(PUBLIC_COMMENT_REQUEST_LIMITS.list + 1)),
        siteOrigin: SITE_ORIGIN,
        expectedPath: LIST_PATH,
        maxBytes: PUBLIC_COMMENT_REQUEST_LIMITS.list,
      }),
    ).resolves.toEqual({ ok: false, status: 413 });

    await expect(
      readPublicCommentJsonPost({
        request: request(Uint8Array.from([0xc3, 0x28])),
        siteOrigin: SITE_ORIGIN,
        expectedPath: LIST_PATH,
        maxBytes: PUBLIC_COMMENT_REQUEST_LIMITS.list,
      }),
    ).resolves.toEqual({ ok: false, status: 400 });
  });
});

describe('public comment browser body parsers', () => {
  it('accepts only exact list and authoring-session bodies', () => {
    expect(
      parsePublicCommentListBody(
        JSON.stringify({
          version: 1,
          expectedPolicyVersion: 4,
          expectedCutoffGeneration: 2,
          beforeSequence: 8,
        }),
      ),
    ).toEqual({
      ok: true,
      request: {
        version: 1,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
        beforeSequence: 8,
      },
    });
    expect(parsePublicCommentAuthoringSessionBody('{"version":1}')).toEqual({
      ok: true,
      request: { version: 1 },
    });
    expect(parsePublicCommentAuthoringSessionBody('{"version":1,"roomId":"probe"}')).toEqual({
      ok: false,
      error: 'invalid-request',
    });
    expect(parsePublicCommentAuthoringSessionBody('{"version":1,"version":1}')).toEqual({
      ok: false,
      error: 'invalid-request',
    });
  });

  it('accepts create only when the browser body is already canonical', () => {
    expect(
      parsePublicCommentCreateBody(
        JSON.stringify({
          version: 1,
          mutationId: MUTATION_ID,
          expectedPolicyVersion: 4,
          expectedCutoffGeneration: 2,
          body: 'One calm comment.',
        }),
      ),
    ).toEqual({
      ok: true,
      request: {
        version: 1,
        mutationId: MUTATION_ID,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
        body: 'One calm comment.',
      },
    });
    for (const body of [' padded ', 'line\r\nbreak', '', 'x'.repeat(4_097)]) {
      expect(
        parsePublicCommentCreateBody(
          JSON.stringify({
            version: 1,
            mutationId: MUTATION_ID,
            expectedPolicyVersion: 4,
            expectedCutoffGeneration: 2,
            body,
          }),
        ),
      ).toEqual({ ok: false, error: 'invalid-request' });
    }
    expect(
      parsePublicCommentCreateBody(
        `{"version":1,"mutationId":"${MUTATION_ID}","expectedPolicyVersion":4,"expectedCutoffGeneration":2,"body":"first","body":"second"}`,
      ),
    ).toEqual({ ok: false, error: 'invalid-request' });
  });

  it('accepts hide only with exact optimistic counters and mutation id', () => {
    expect(
      parsePublicCommentHideBody(
        JSON.stringify({
          version: 1,
          mutationId: MUTATION_ID,
          expectedPolicyVersion: 4,
          expectedCutoffGeneration: 2,
        }),
        COMMENT_ID,
      ),
    ).toEqual({
      ok: true,
      request: {
        version: 1,
        mutationId: MUTATION_ID,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
      },
    });
    expect(
      parsePublicCommentHideBody(
        JSON.stringify({
          version: 1,
          mutationId: MUTATION_ID,
          expectedPolicyVersion: 0,
          expectedCutoffGeneration: 2,
        }),
        COMMENT_ID,
      ),
    ).toEqual({ ok: false, error: 'invalid-request' });
  });
});
