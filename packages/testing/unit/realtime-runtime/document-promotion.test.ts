import { createLashEditorExtensions } from '@lash/editor-core';
import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';

import {
  buildPromotedHydrationUpdates,
  buildRealtimeCheckpoint,
  isRealtimeUpdatePayload,
} from '../../../realtime-worker/src/persistence';
import {
  PROMOTION_LIMITS,
  canonicalizePromotionJson,
  decideDocumentPromotion,
  executeDocumentPromotion,
  parseDocumentPromotionRequest,
  readPromotionBody,
  sha256Base64Url,
  type DocumentPromotionStore,
  type ExistingDocumentPromotion,
  type StoredDocumentPromotionV1,
} from '../../../realtime-worker/src/promotion';
import { canonicalize } from '../../../types/src';

const PRINCIPAL = `account:v1:${'a'.repeat(43)}`;
const ROOM = 'room-alpha';
const HASH = 'h'.repeat(43);
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const PROMOTION_UPDATE =
  'AQTvjKbdDgAHAQdjb250ZW50AwlwYXJhZ3JhcGgHAO+Mpt0OAAYEAO+Mpt0OAQ1Qcm9tb3RlZCBib2R5KAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';
const HYDRATION_INITIAL_UPDATE = 'AQG+6oHmDgAEAQRsYXNoB2luaXRpYWwA';
const LATER_UPDATE = 'AgG+6oHmDgAEAQRsYXNoB2luaXRpYWwBn/PjLACEvuqB5g4GBiBsYXRlcgA=';
const UNKNOWN_NODE_UPDATE =
  'AQK32oXQCwAHAQdjb250ZW50AwRldmlsKAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';
const UNKNOWN_MARK_UPDATE =
  'AQbL9eBUAAcBB2NvbnRlbnQDCXBhcmFncmFwaAcAy/XgVAAGBgDL9eBUAQRldmlsAnt9hMv14FQCBk1hcmtlZIbL9eBUCARldmlsBG51bGwoARlsYXNoOmRvY3VtZW50LW1ldGFkYXRhOnYxBXRpdGxlAXcOUHJvbW90ZWQgdGl0bGUA';
const UNKNOWN_ATTR_UPDATE =
  'AQPMhfqNBAAHAQdjb250ZW50AwlwYXJhZ3JhcGgoAMyF+o0EAARldmlsAXcHcHJlc2VudCgBGWxhc2g6ZG9jdW1lbnQtbWV0YWRhdGE6djEFdGl0bGUBdw5Qcm9tb3RlZCB0aXRsZQA=';
const INVALID_NESTING_UPDATE =
  'AQPSgN6EBwAHAQdjb250ZW50AwlwYXJhZ3JhcGgHANKA3oQHAAMJcGFyYWdyYXBoKAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const makeSnapshot = async (
  overrides: {
    title?: string;
    body?: unknown;
    initialUpdate?: string;
  } = {},
) => {
  const body =
    overrides.body ??
    ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Promoted body' }] }],
    } as const);
  const initialUpdate = overrides.initialUpdate ?? PROMOTION_UPDATE;
  const update = Uint8Array.from(atob(initialUpdate), (character) => character.charCodeAt(0));
  const title = overrides.title ?? 'Promoted title';
  const bodySha256 = await sha256Base64Url(
    new TextEncoder().encode(canonicalizePromotionJson(body)),
  );
  const initialUpdateSha256 = await sha256Base64Url(update);
  const adjuncts = { comments: 0 as const, suggestions: 0 as const };
  const snapshotSha256 = await sha256Base64Url(
    new TextEncoder().encode(
      canonicalizePromotionJson({
        version: 1,
        title,
        bodySha256,
        initialUpdateSha256,
        adjuncts,
      }),
    ),
  );
  return {
    version: 1 as const,
    title,
    body,
    bodySha256,
    initialUpdate: bytesToBase64(update),
    initialUpdateSha256,
    adjuncts,
    snapshotSha256,
  };
};

const makeRequest = async (createIfMissing = true) => ({
  version: 1 as const,
  roomId: ROOM,
  ownerPrincipalId: PRINCIPAL,
  idempotencyHash: HASH,
  createIfMissing,
  snapshot: await makeSnapshot(),
});

const makeProjectionUpdate = (body: unknown, title = 'Promoted title') => {
  const document = prosemirrorJSONToYDoc(
    getSchema(createLashEditorExtensions()),
    body as Record<string, unknown>,
    'content',
  );
  document.getMap<unknown>('lash:document-metadata:v1').set('title', title);
  const update = Y.encodeStateAsUpdate(document);
  document.destroy();
  return bytesToBase64(update);
};

describe('document promotion contract', () => {
  it('uses the shared canonicalizer and one fixed cross-lane promotion vector', async () => {
    const projection = {
      version: 1,
      title: 'Café',
      bodySha256: 'b'.repeat(43),
      initialUpdateSha256: 'i'.repeat(43),
      adjuncts: { comments: 0, suggestions: 0 },
    };
    const expectedCanonical =
      '{"adjuncts":{"comments":0,"suggestions":0},"bodySha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","initialUpdateSha256":"iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii","title":"Café","version":1}';

    expect(canonicalizePromotionJson(projection)).toBe(canonicalize(projection));
    expect(canonicalizePromotionJson(projection)).toBe(expectedCanonical);
    await expect(sha256Base64Url(new TextEncoder().encode(expectedCanonical))).resolves.toBe(
      'NZCvFZq11Y5n45JuLLzk3mA-Joo7PyvQ-YEeKx3dDvM',
    );
  });

  it('accepts only the exact bounded canonical v1 request with verified hashes and update', async () => {
    const request = await makeRequest();
    await expect(parseDocumentPromotionRequest(request, ROOM)).resolves.toEqual({
      ok: true,
      request,
    });

    for (const invalid of [
      { ...request, extra: true },
      { ...request, roomId: 'Room Alpha' },
      { ...request, ownerPrincipalId: 'email@example.com' },
      { ...request, idempotencyHash: 'short' },
      { ...request, createIfMissing: 'true' },
      { ...request, snapshot: { ...request.snapshot, title: 'e\u0301' } },
      { ...request, snapshot: { ...request.snapshot, bodySha256: 'x'.repeat(43) } },
      {
        ...request,
        snapshot: {
          ...request.snapshot,
          initialUpdate: 'not-base64',
        },
      },
      {
        ...request,
        snapshot: {
          ...request.snapshot,
          adjuncts: { comments: 1, suggestions: 0 },
        },
      },
    ]) {
      await expect(parseDocumentPromotionRequest(invalid, ROOM)).resolves.toEqual({
        ok: false,
        error: 'invalid-request',
      });
    }
  });

  it('rejects a valid Yjs update whose decoded body or metadata title differs', async () => {
    const request = await makeRequest();
    const differentBody = {
      ...request,
      snapshot: await makeSnapshot({
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Different body' }] }],
        },
      }),
    };
    const differentTitle = {
      ...request,
      snapshot: await makeSnapshot({ title: 'Different title' }),
    };
    for (const invalid of [differentBody, differentTitle]) {
      await expect(parseDocumentPromotionRequest(invalid, ROOM)).resolves.toEqual({
        ok: false,
        error: 'invalid-request',
      });
    }
  });

  it('accepts attribute-free marks after exact Yjs projection normalization', async () => {
    const body = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Promoted body' }],
        },
      ],
    };
    const request = {
      ...(await makeRequest()),
      snapshot: await makeSnapshot({
        body,
        initialUpdate: makeProjectionUpdate(body),
      }),
    };

    await expect(parseDocumentPromotionRequest(request, ROOM)).resolves.toEqual({
      ok: true,
      request,
    });
  });

  it('does not normalize meaningful mark attributes or unknown node attributes', async () => {
    const declaredLinkBody = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com/declared',
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: null,
                  },
                },
              ],
              text: 'Promoted body',
            },
          ],
        },
      ],
    };
    const differentLinkBody = {
      ...declaredLinkBody,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com/different',
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: null,
                  },
                },
              ],
              text: 'Promoted body',
            },
          ],
        },
      ],
    };
    const unknownNodeAttrBody = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { evil: 'present' } }],
    };
    const requests = [
      {
        ...(await makeRequest()),
        snapshot: await makeSnapshot({
          body: declaredLinkBody,
          initialUpdate: makeProjectionUpdate(differentLinkBody),
        }),
      },
      {
        ...(await makeRequest()),
        snapshot: await makeSnapshot({
          body: unknownNodeAttrBody,
          initialUpdate: UNKNOWN_ATTR_UPDATE,
        }),
      },
    ];

    for (const request of requests) {
      await expect(parseDocumentPromotionRequest(request, ROOM)).resolves.toEqual({
        ok: false,
        error: 'invalid-request',
      });
    }
  });

  it('rejects matching Yjs projections that violate the active Lash editor schema', async () => {
    const unknownNodeBody = {
      type: 'doc',
      content: [{ type: 'evil' }],
    };
    const unknownMarkBody = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Marked', marks: [{ type: 'evil', attrs: {} }] }],
        },
      ],
    };
    const unknownAttrBody = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { evil: 'present' } }],
    };
    const invalidNestingBody = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'paragraph' }] }],
    };
    const attacks = [
      {
        body: unknownNodeBody,
        update: UNKNOWN_NODE_UPDATE,
      },
      {
        body: unknownMarkBody,
        update: UNKNOWN_MARK_UPDATE,
      },
      {
        body: unknownAttrBody,
        update: UNKNOWN_ATTR_UPDATE,
      },
      {
        body: invalidNestingBody,
        update: INVALID_NESTING_UPDATE,
      },
    ];

    for (const attack of attacks) {
      const request = {
        ...(await makeRequest()),
        snapshot: await makeSnapshot({
          body: attack.body,
          initialUpdate: attack.update,
        }),
      };
      await expect(parseDocumentPromotionRequest(request, ROOM)).resolves.toEqual({
        ok: false,
        error: 'invalid-request',
      });
    }
  });

  it('enforces title, body, decoded update, and full request byte limits', () => {
    expect(PROMOTION_LIMITS).toEqual({
      requestBytes: 2 * 1024 * 1024,
      titleBytes: 4 * 1024,
      bodyCanonicalBytes: 1024 * 1024,
      initialUpdateBytes: 1024 * 1024,
      roomCharacters: 128,
    });
  });

  it('reads only bounded identity-encoded UTF-8 JSON request bytes', async () => {
    const body = JSON.stringify(await makeRequest());
    const accepted = await readPromotionBody(
      new Request('https://worker.test/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body,
      }),
    );
    expect(accepted).toEqual({
      ok: true,
      body: new TextEncoder().encode(body),
      value: JSON.parse(body),
    });

    for (const request of [
      new Request('https://worker.test/promote', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body,
      }),
      new Request('https://worker.test/promote', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
        },
        body,
      }),
      new Request('https://worker.test/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new Uint8Array([0xff]),
      }),
      new Request('https://worker.test/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
      }),
    ]) {
      await expect(readPromotionBody(request)).resolves.toEqual({
        ok: false,
        status: expect.any(Number),
      });
    }
  });

  it('rejects duplicate JSON object keys before constructing a management value', async () => {
    for (const body of [
      '{"version":1,"version":1}',
      '{"version":1,"snapshot":{"title":"first","title":"second"}}',
    ]) {
      await expect(
        readPromotionBody(
          new Request('https://worker.test/promote', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          }),
        ),
      ).resolves.toEqual({ ok: false, status: 400 });
    }
  });

  it('selects create, lookup, idempotent, replay, and mismatch outcomes without mutation', () => {
    const missing = null;
    const exact: ExistingDocumentPromotion = {
      ownerPrincipalId: PRINCIPAL,
      idempotencyHash: HASH,
      snapshotSha256: 's'.repeat(43),
    };
    const input = {
      ownerPrincipalId: PRINCIPAL,
      idempotencyHash: HASH,
      snapshotSha256: 's'.repeat(43),
      requestId: '123e4567-e89b-42d3-a456-426614174000',
    };

    expect(decideDocumentPromotion({ ...input, createIfMissing: false }, missing, false)).toEqual({
      kind: 'error',
      error: 'promotion-not-found',
    });
    expect(decideDocumentPromotion({ ...input, createIfMissing: true }, missing, false)).toEqual({
      kind: 'create',
    });
    expect(decideDocumentPromotion({ ...input, createIfMissing: false }, exact, false)).toEqual({
      kind: 'existing',
    });
    expect(decideDocumentPromotion({ ...input, createIfMissing: true }, exact, true)).toEqual({
      kind: 'error',
      error: 'replay-detected',
    });
    expect(
      decideDocumentPromotion(
        { ...input, createIfMissing: true, ownerPrincipalId: `account:v1:${'b'.repeat(43)}` },
        exact,
        false,
      ),
    ).toEqual({ kind: 'error', error: 'owner-mismatch' });
    expect(
      decideDocumentPromotion(
        { ...input, createIfMissing: true, snapshotSha256: 'x'.repeat(43) },
        exact,
        false,
      ),
    ).toEqual({ kind: 'error', error: 'promotion-conflict' });
  });

  it('publishes atomically, retries idempotently, rejects replay, and rolls back bad readback', async () => {
    class MemoryStore implements DocumentPromotionStore {
      promotion: StoredDocumentPromotionV1 | null = null;
      requests = new Set<string>();
      writes = 0;
      corruptReadback = false;
      legacyOccupied = false;

      transaction<T>(callback: () => T): T {
        const before = {
          promotion: this.promotion ? structuredClone(this.promotion) : null,
          requests: new Set(this.requests),
          writes: this.writes,
        };
        try {
          return callback();
        } catch (error) {
          this.promotion = before.promotion;
          this.requests = before.requests;
          this.writes = before.writes;
          throw error;
        }
      }

      readPromotion() {
        if (!this.promotion) return null;
        return this.corruptReadback
          ? { ...this.promotion, title: `${this.promotion.title} corrupt` }
          : structuredClone(this.promotion);
      }

      hasManagementRequest(requestId: string) {
        return this.requests.has(requestId);
      }

      hasPromotionState() {
        return this.promotion !== null || this.legacyOccupied;
      }

      createPromotion(record: StoredDocumentPromotionV1) {
        this.promotion = { ...structuredClone(record), shareable: false };
        this.writes += 1;
      }

      markPromotionShareable() {
        if (!this.promotion) throw new Error('missing promotion');
        this.promotion.shareable = true;
        this.writes += 1;
      }

      recordSuccessfulRequest(input: { requestId: string }) {
        this.requests.add(input.requestId);
        this.writes += 1;
      }
    }

    const parsed = await parseDocumentPromotionRequest(await makeRequest(true), ROOM);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const store = new MemoryStore();
    const execute = (requestId: string, request = parsed.request) =>
      executeDocumentPromotion(store, {
        request,
        requestId,
        bodySha256: 'b'.repeat(43),
        createdAt: '2026-07-30T00:00:00.000Z',
      });

    const lookup = structuredClone(parsed.request);
    lookup.createIfMissing = false;
    expect(execute('123e4567-e89b-42d3-a456-426614174001', lookup)).toMatchObject({
      ok: false,
      error: 'promotion-not-found',
    });
    expect(store.writes).toBe(0);

    expect(execute(REQUEST_ID)).toMatchObject({ ok: true, created: true });
    expect(store.writes).toBe(3);
    expect(execute(REQUEST_ID)).toMatchObject({ ok: false, error: 'replay-detected' });
    expect(store.writes).toBe(3);
    expect(execute('123e4567-e89b-42d3-a456-426614174002')).toMatchObject({
      ok: true,
      created: false,
    });
    expect(store.writes).toBe(4);

    const badStore = new MemoryStore();
    badStore.corruptReadback = true;
    expect(
      executeDocumentPromotion(badStore, {
        request: parsed.request,
        requestId: '123e4567-e89b-42d3-a456-426614174003',
        bodySha256: 'b'.repeat(43),
        createdAt: '2026-07-30T00:00:00.000Z',
      }),
    ).toEqual({ ok: false, version: 1, error: 'readback-failed', retryable: true });
    expect(badStore.promotion).toBeNull();
    expect(badStore.requests.size).toBe(0);
    expect(badStore.writes).toBe(0);
  });

  it('rejects creation over occupied legacy room state without any write', async () => {
    class LegacyOccupiedStore implements DocumentPromotionStore {
      writes = 0;

      transaction<T>(callback: () => T): T {
        return callback();
      }

      readPromotion() {
        return null;
      }

      hasPromotionState() {
        return true;
      }

      hasManagementRequest() {
        return false;
      }

      createPromotion() {
        this.writes += 1;
      }

      markPromotionShareable() {
        this.writes += 1;
      }

      recordSuccessfulRequest() {
        this.writes += 1;
      }
    }

    const parsed = await parseDocumentPromotionRequest(await makeRequest(true), ROOM);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const store = new LegacyOccupiedStore();

    expect(
      executeDocumentPromotion(store, {
        request: parsed.request,
        requestId: REQUEST_ID,
        bodySha256: 'b'.repeat(43),
        createdAt: '2026-07-30T00:00:00.000Z',
      }),
    ).toEqual({
      ok: false,
      version: 1,
      error: 'promotion-conflict',
      retryable: false,
    });
    expect(store.writes).toBe(0);
  });

  it('prepends promoted state to hydration and includes it in the first compaction', async () => {
    const initial = HYDRATION_INITIAL_UPDATE;
    const later = LATER_UPDATE;

    expect(buildPromotedHydrationUpdates(initial, null, [])).toEqual([initial]);
    expect(
      buildPromotedHydrationUpdates(initial, null, [
        { sequence: 1, actorId: 'owner', source: 'client', update: later, createdAt: 'now' },
      ]),
    ).toEqual([initial, later]);

    const checkpoint = buildRealtimeCheckpoint([initial, later]);
    expect(checkpoint).not.toBeNull();
    expect(isRealtimeUpdatePayload(checkpoint!)).toBe(true);
  });
});
