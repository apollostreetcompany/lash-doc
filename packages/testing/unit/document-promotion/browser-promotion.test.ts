import { normalizeYProsemirrorProjectionJson } from '@lash/editor-core';
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';

import { createBrowserDocumentPromotionAttempt } from '../../../../apps/web/lib/documentPromotion/browserClient';
import { parseBrowserPromotionRequest } from '../../../../apps/web/lib/documentPromotion/validation';
import { readRealtimeDocumentTitle } from '../../../../apps/web/lib/realtimeCollaboration';

const TITLE = 'Café launch brief';
const BODY = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The launch brief is ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'ready' },
        { type: 'text', text: ' for a teammate to ' },
        {
          type: 'text',
          marks: [
            {
              type: 'link',
              attrs: {
                href: 'https://example.com/review',
                target: '_blank',
                rel: 'noopener noreferrer nofollow',
                class: null,
              },
            },
          ],
          text: 'review',
        },
        { type: 'text', text: ' and comment.' },
      ],
    },
  ],
};
const ROOM_ID = `doc-v1-${'c'.repeat(64)}`;

const deterministicCrypto = () => {
  let nextByte = 0;
  const getRandomValues = vi.fn(<ArrayType extends ArrayBufferView | null>(array: ArrayType) => {
    if (array === null) throw new TypeError('ArrayBufferView required');
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = nextByte;
      nextByte = (nextByte + 1) & 0xff;
    }
    return array;
  });
  return {
    cryptoImpl: {
      getRandomValues,
      subtle: webcrypto.subtle,
    } as Crypto,
    getRandomValues,
  };
};

const successResponse = (snapshotSha256: string, overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      ok: true,
      version: 2,
      roomId: ROOM_ID,
      aclVersion: 1,
      publicPolicy: 'restricted',
      publicPolicyVersion: 1,
      snapshotSha256,
      created: true,
      ...overrides,
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );

const call = (
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createBrowserDocumentPromotionAttempt>[0]> = {},
  signal?: AbortSignal,
) => {
  const { cryptoImpl } = deterministicCrypto();
  return createBrowserDocumentPromotionAttempt(
    {
      localDocumentId: 'weekly.plan~v1',
      title: TITLE,
      body: BODY,
      adjuncts: { comments: 0, suggestions: 0 },
      ...overrides,
    },
    cryptoImpl,
  ).submit({ fetcher: fetchImpl, signal });
};

describe('browser document promotion client', () => {
  it('posts one server-valid canonical snapshot whose Yjs update round-trips exact Lash title/body', async () => {
    let rawRequest = '';
    let parsedRequest: Awaited<ReturnType<typeof parseBrowserPromotionRequest>> | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/documents/weekly.plan~v1/promote');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('same-origin');
      expect(init?.headers).toEqual({ 'content-type': 'application/json' });
      rawRequest = String(init?.body);
      parsedRequest = await parseBrowserPromotionRequest(rawRequest);
      const request = JSON.parse(rawRequest) as {
        snapshot: { snapshotSha256: string };
      };
      return successResponse(request.snapshot.snapshotSha256);
    });

    const result = await call(fetchImpl as typeof fetch);

    expect(result.ok).toBe(true);
    expect(parsedRequest).toMatchObject({ ok: true });
    const request = JSON.parse(rawRequest) as {
      version: number;
      idempotencyKey: string;
      snapshot: {
        title: string;
        body: unknown;
        initialUpdate: string;
        snapshotSha256: string;
      };
    };
    expect(Object.keys(request).sort()).toEqual(['idempotencyKey', 'snapshot', 'version']);
    expect(request.version).toBe(1);
    expect(Buffer.from(request.idempotencyKey, 'base64url')).toHaveLength(32);
    expect(Buffer.from(request.idempotencyKey, 'base64url').toString('base64url')).toBe(
      request.idempotencyKey,
    );
    expect(request.snapshot.title).toBe(TITLE);
    expect(request.snapshot.body).toEqual(BODY);
    expect(request.snapshot.initialUpdate).toMatch(
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u,
    );
    expect(Buffer.from(request.snapshot.initialUpdate, 'base64').toString('base64')).toBe(
      request.snapshot.initialUpdate,
    );

    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, Buffer.from(request.snapshot.initialUpdate, 'base64'));
    expect(
      normalizeYProsemirrorProjectionJson(
        yXmlFragmentToProsemirrorJSON(decoded.getXmlFragment('content')),
      ),
    ).toEqual(BODY);
    expect(readRealtimeDocumentTitle(decoded)).toBe(TITLE);

    if (!result.ok) throw new Error('expected promotion success');
    expect(result.receipt).toEqual({
      version: 1,
      title: TITLE,
      body: BODY,
      snapshotSha256: request.snapshot.snapshotSha256,
      room: {
        roomId: ROOM_ID,
        aclVersion: 1,
        publicPolicy: 'restricted',
        publicPolicyVersion: 1,
        created: true,
      },
    });
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.receipt.body)).toBe(true);
    expect(Object.isFrozen(result.receipt.room)).toBe(true);
  });

  it('invokes browser fetch without binding the submit options as its receiver', async () => {
    const receivers: unknown[] = [];
    const fetchImpl = async function (
      this: unknown,
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) {
      receivers.push(this);
      const request = JSON.parse(String(init?.body)) as {
        snapshot: { snapshotSha256: string };
      };
      return successResponse(request.snapshot.snapshotSha256);
    };

    await expect(call(fetchImpl as typeof fetch)).resolves.toMatchObject({ ok: true });
    expect(receivers).toEqual([undefined]);
  });

  it.each([
    [{ comments: 2, suggestions: 0 }, 'comments'],
    [{ comments: 0, suggestions: 3 }, 'suggestions'],
  ] as const)('visibly refuses nonzero %s before fetch', async (adjuncts, _label) => {
    const fetchImpl = vi.fn();
    const { cryptoImpl, getRandomValues } = deterministicCrypto();

    const result = await createBrowserDocumentPromotionAttempt(
      {
        localDocumentId: 'weekly-plan',
        title: TITLE,
        body: BODY,
        adjuncts,
      },
      cryptoImpl,
    ).submit({ fetcher: fetchImpl as typeof fetch });

    expect(result).toEqual({
      ok: false,
      reason: 'adjuncts-present',
      retryable: false,
      adjuncts,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('uses only the canonical route id and rejects a noncanonical id before fetch', async () => {
    const validFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { snapshot: { snapshotSha256: string } };
      return successResponse(body.snapshot.snapshotSha256);
    });
    await expect(call(validFetch as typeof fetch)).resolves.toMatchObject({ ok: true });
    expect(validFetch.mock.calls[0]?.[0]).toBe('/api/documents/weekly.plan~v1/promote');

    const invalidFetch = vi.fn();
    await expect(
      call(invalidFetch as typeof fetch, { localDocumentId: 'two words' }),
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid-input',
      retryable: false,
    });
    expect(invalidFetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      'unknown node',
      {
        type: 'doc',
        content: [{ type: 'unknown-node' }],
      },
    ],
    [
      'unknown mark',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'unknown-mark', attrs: {} }],
              },
            ],
          },
        ],
      },
    ],
    [
      'nonempty attributes on an attribute-free mark',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'bold', attrs: { unexpected: true } }],
              },
            ],
          },
        ],
      },
    ],
    [
      'unknown node attributes',
      {
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { unexpected: true } }],
      },
    ],
  ])('rejects a schema-invalid body with %s before fetch', async (_label, body) => {
    const fetchImpl = vi.fn();

    await expect(call(fetchImpl as typeof fetch, { body })).resolves.toEqual({
      ok: false,
      reason: 'invalid-input',
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends no principal, email, provider token, capability, or remote hint', async () => {
    let rawRequest = '';
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      rawRequest = String(init?.body);
      const body = JSON.parse(rawRequest) as { snapshot: { snapshotSha256: string } };
      return successResponse(body.snapshot.snapshotSha256);
    });

    await expect(call(fetchImpl as typeof fetch)).resolves.toMatchObject({ ok: true });

    const request = JSON.parse(rawRequest) as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual(['idempotencyKey', 'snapshot', 'version']);
    expect(rawRequest).not.toMatch(
      /principal|email|provider|access.?token|refresh.?token|capabilit|remote.?hint/iu,
    );
  });

  it.each([
    [
      'unknown success field',
      (hash: string) => successResponse(hash, { ownerPrincipalId: `account:v1:${'a'.repeat(43)}` }),
      'invalid-response',
    ],
    [
      'valid-looking snapshot hash mismatch',
      () => successResponse('A'.repeat(43)),
      'snapshot-mismatch',
    ],
    [
      'malformed JSON',
      () =>
        new Response('{"ok":true', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      'invalid-response',
    ],
    [
      'duplicate response field',
      (hash: string) =>
        new Response(
          JSON.stringify({
            ok: true,
            version: 2,
            roomId: ROOM_ID,
            aclVersion: 1,
            publicPolicy: 'restricted',
            publicPolicyVersion: 1,
            snapshotSha256: hash,
            created: true,
          }).replace('"version":2', '"version":2,"version":2'),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      'invalid-response',
    ],
  ] as const)('fails closed on %s', async (_label, response, reason) => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        snapshot: { snapshotSha256: string };
      };
      return response(request.snapshot.snapshotSha256);
    });

    await expect(call(fetchImpl as typeof fetch)).resolves.toEqual({
      ok: false,
      reason,
      retryable: false,
    });
  });

  it('strictly preserves a verified route failure without accepting extra fields', async () => {
    const verifiedFailure = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          version: 2,
          error: 'readback-failed',
          retryable: true,
        }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(call(verifiedFailure as typeof fetch)).resolves.toEqual({
      ok: false,
      reason: 'server-rejected',
      error: 'readback-failed',
      status: 503,
      retryable: true,
    });

    const extraFieldFailure = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          version: 2,
          error: 'unauthorized',
          retryable: false,
          email: 'private@example.com',
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(call(extraFieldFailure as typeof fetch)).resolves.toEqual({
      ok: false,
      reason: 'invalid-response',
      retryable: false,
    });

    const wrongStatusFailure = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          version: 2,
          error: 'unauthorized',
          retryable: false,
        }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(call(wrongStatusFailure as typeof fetch)).resolves.toEqual({
      ok: false,
      reason: 'invalid-response',
      retryable: false,
    });
  });

  it.each([
    ['invalid-request', 400],
    ['claim-conflict', 409],
  ] as const)('keeps terminal %s responses non-retryable', async (error, status) => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          version: 2,
          error,
          retryable: false,
        }),
        { status, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(call(fetcher as typeof fetch)).resolves.toEqual({
      ok: false,
      reason: 'server-rejected',
      error,
      status,
      retryable: false,
    });
  });

  it('classifies caller abort separately from a retryable network failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortedFetch = vi.fn();
    await expect(call(abortedFetch as typeof fetch, {}, controller.signal)).resolves.toEqual({
      ok: false,
      reason: 'aborted',
      retryable: false,
    });
    expect(abortedFetch).not.toHaveBeenCalled();

    const networkFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(call(networkFetch as typeof fetch)).resolves.toEqual({
      ok: false,
      reason: 'network-error',
      retryable: true,
    });
  });

  it('passes the caller signal to fetch and classifies an in-flight AbortError locally', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          expect(init?.signal).toBe(controller.signal);
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Promotion aborted.', 'AbortError')),
            { once: true },
          );
          controller.abort();
        }),
    );

    await expect(call(fetchImpl as typeof fetch, {}, controller.signal)).resolves.toEqual({
      ok: false,
      reason: 'aborted',
      retryable: false,
    });
  });

  it('reuses one opaque byte-identical attempt after a committed response is lost', async () => {
    const { cryptoImpl, getRandomValues } = deterministicCrypto();
    const attempt = createBrowserDocumentPromotionAttempt(
      {
        localDocumentId: 'weekly-plan',
        title: TITLE,
        body: BODY,
        adjuncts: { comments: 0, suggestions: 0 },
      },
      cryptoImpl,
    );
    const bodies: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body);
      bodies.push(body);
      if (bodies.length === 1) {
        throw new TypeError('response lost after commit');
      }
      const request = JSON.parse(body) as { snapshot: { snapshotSha256: string } };
      return successResponse(request.snapshot.snapshotSha256, { created: false });
    });

    await expect(attempt.submit({ fetcher: fetcher as typeof fetch })).resolves.toEqual({
      ok: false,
      reason: 'network-error',
      retryable: true,
    });
    await expect(attempt.submit({ fetcher: fetcher as typeof fetch })).resolves.toMatchObject({
      ok: true,
      receipt: { room: { created: false } },
    });

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(Object.keys(attempt)).toEqual(['submit']);
    expect(JSON.stringify(attempt)).not.toMatch(/idempotency|snapshot|body|title/iu);

    const nextAttempt = createBrowserDocumentPromotionAttempt(
      {
        localDocumentId: 'weekly-plan',
        title: `${TITLE} v2`,
        body: BODY,
        adjuncts: { comments: 0, suggestions: 0 },
      },
      cryptoImpl,
    );
    let nextBody = '';
    await nextAttempt.submit({
      fetcher: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        nextBody = String(init?.body);
        const request = JSON.parse(nextBody) as { snapshot: { snapshotSha256: string } };
        return successResponse(request.snapshot.snapshotSha256);
      }) as typeof fetch,
    });
    expect(getRandomValues).toHaveBeenCalledTimes(2);
    expect((JSON.parse(nextBody) as { idempotencyKey: string }).idempotencyKey).not.toBe(
      (JSON.parse(bodies[0]!) as { idempotencyKey: string }).idempotencyKey,
    );
  });

  it('freezes caller-owned title/body values before any asynchronous digest completes', async () => {
    const { cryptoImpl } = deterministicCrypto();
    const mutableInput = {
      localDocumentId: 'weekly-plan',
      title: TITLE,
      body: structuredClone(BODY),
      adjuncts: { comments: 0, suggestions: 0 },
    };
    const attempt = createBrowserDocumentPromotionAttempt(mutableInput, cryptoImpl);

    mutableInput.title = 'Mutated too late';
    const firstText = mutableInput.body.content[0]?.content[0];
    if (firstText) firstText.text = 'Mutated too late';
    mutableInput.adjuncts.comments = 4;

    let requestBody = '';
    const result = await attempt.submit({
      fetcher: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = String(init?.body);
        const request = JSON.parse(requestBody) as { snapshot: { snapshotSha256: string } };
        return successResponse(request.snapshot.snapshotSha256);
      }) as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      receipt: { title: TITLE, body: BODY },
    });
    expect(JSON.parse(requestBody)).toMatchObject({
      snapshot: {
        title: TITLE,
        body: BODY,
        adjuncts: { comments: 0, suggestions: 0 },
      },
    });
  });
});
