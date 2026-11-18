import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPublicComment,
  hidePublicComment,
  listPublicComments,
  requestPublicCommentAuthoringSession,
} from '../../../../apps/web/lib/publicDocumentComments/browserClient';

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const COMMENT_ID = 'pc-v1-12345678-1234-4123-8123-123456789abc';
const COMMENT = {
  id: COMMENT_ID,
  sequence: 7,
  anchor: { kind: 'document' as const },
  body: 'Could we add the launch date?',
  author: { label: 'Commenter Ab3_xQ' },
  createdAt: '2026-07-30T12:34:56.789Z',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('public comment browser client', () => {
  it('lists public comments using only live policy counters and a receiver-safe fetch call', async () => {
    const receiverSensitive = function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ) {
      if (this !== undefined) throw new TypeError('Illegal invocation');
      expect(input).toBe(`/api/public/documents/${ROOM_ID}/comments/list`);
      expect(init).toMatchObject({
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        version: 1,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
        beforeSequence: null,
      });
      return Promise.resolve(
        jsonResponse({
          ok: true,
          version: 1,
          authorization: {
            roomId: ROOM_ID,
            mode: 'comment',
            policyVersion: 4,
            cutoffGeneration: 2,
          },
          comments: [COMMENT],
          nextBeforeSequence: null,
        }),
      );
    };

    await expect(
      listPublicComments({
        roomId: ROOM_ID,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
        beforeSequence: null,
        fetcher: receiverSensitive as typeof fetch,
      }),
    ).resolves.toEqual({
      ok: true,
      version: 1,
      authorization: {
        roomId: ROOM_ID,
        mode: 'comment',
        policyVersion: 4,
        cutoffGeneration: 2,
      },
      comments: [COMMENT],
      nextBeforeSequence: null,
    });
  });

  it('learns only authenticated state and keeps the CSRF proof in the returned value', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        version: 1,
        authenticated: true,
        csrfProof: `v1.${'a'.repeat(43)}.1780000000.${'b'.repeat(43)}`,
        expiresAt: '2026-05-28T20:26:40.000Z',
      }),
    );
    const result = await requestPublicCommentAuthoringSession({ roomId: ROOM_ID, fetcher });
    expect(result).toMatchObject({ ok: true, authenticated: true });
    expect(JSON.stringify(result)).not.toMatch(/principal|email|claim|owner/u);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/public/documents/${ROOM_ID}/comments/authoring-session`,
      expect.objectContaining({ body: '{"version":1}' }),
    );
  });

  it('keeps the native global fetch receiver for an anonymous authoring session', async () => {
    vi.stubGlobal('fetch', function (this: unknown, input: RequestInfo | URL) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      expect(input).toBe(`/api/public/documents/${ROOM_ID}/comments/authoring-session`);
      return Promise.resolve(
        jsonResponse({
          ok: true,
          version: 1,
          authenticated: false,
        }),
      );
    } as typeof fetch);

    await expect(requestPublicCommentAuthoringSession({ roomId: ROOM_ID })).resolves.toEqual({
      ok: true,
      version: 1,
      authenticated: false,
    });
  });

  it('creates one canonical comment with the in-memory proof and preserves exact success', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          ok: true,
          version: 1,
          created: true,
          authorization: {
            roomId: ROOM_ID,
            mode: 'comment',
            policyVersion: 4,
            cutoffGeneration: 2,
          },
          comment: COMMENT,
        },
        201,
      ),
    );
    const result = await createPublicComment({
      roomId: ROOM_ID,
      mutationId: '12345678-1234-4123-8123-123456789abc',
      expectedPolicyVersion: 4,
      expectedCutoffGeneration: 2,
      body: COMMENT.body,
      csrfProof: `v1.${'a'.repeat(43)}.1780000000.${'b'.repeat(43)}`,
      fetcher,
    });
    expect(result).toMatchObject({ ok: true, created: true, comment: COMMENT });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/public/documents/${ROOM_ID}/comments/create`,
      expect.objectContaining({
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-lash-csrf-proof': expect.any(String),
        }),
      }),
    );
  });

  it('maps exact browser failures and rejects malformed success payloads', async () => {
    await expect(
      createPublicComment({
        roomId: ROOM_ID,
        mutationId: '12345678-1234-4123-8123-123456789abc',
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
        body: COMMENT.body,
        csrfProof: `v1.${'a'.repeat(43)}.1780000000.${'b'.repeat(43)}`,
        fetcher: vi.fn().mockResolvedValue(
          jsonResponse(
            {
              ok: false,
              version: 1,
              error: 'authentication-required',
              retryable: false,
            },
            401,
          ),
        ),
      }),
    ).resolves.toEqual({
      ok: false,
      version: 1,
      error: 'authentication-required',
      retryable: false,
    });

    await expect(
      listPublicComments({
        roomId: ROOM_ID,
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
        beforeSequence: null,
        fetcher: vi.fn().mockResolvedValue(
          jsonResponse({
            ok: true,
            version: 1,
            authorization: {
              roomId: ROOM_ID,
              mode: 'comment',
              policyVersion: 4,
              cutoffGeneration: 2,
            },
            comments: [{ ...COMMENT, principalId: 'leak' }],
            nextBeforeSequence: null,
          }),
        ),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'temporarily-unavailable',
      retryable: true,
    });
  });

  it('hides a comment through the owner route without sending claim, room, or owner identity', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        version: 1,
        commentId: COMMENT_ID,
        state: 'hidden',
        changed: true,
        policyVersion: 4,
        cutoffGeneration: 2,
        moderatedAt: '2026-07-30T12:40:00.000Z',
      }),
    );
    const result = await hidePublicComment({
      localDocumentId: 'weekly-plan',
      commentId: COMMENT_ID,
      mutationId: '12345678-1234-4123-8123-123456789abc',
      expectedPolicyVersion: 4,
      expectedCutoffGeneration: 2,
      fetcher,
    });
    expect(result).toMatchObject({ ok: true, state: 'hidden', changed: true });
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).not.toMatch(/claim|room|owner|principal/u);
  });
});
