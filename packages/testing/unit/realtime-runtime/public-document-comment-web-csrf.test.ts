import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_COMMENT_CSRF_COOKIE_NAME,
  clearPublicCommentCsrfCookie,
  createPublicCommentCsrfSession,
  derivePublicCommentAlias,
  publicCommentCsrfCookieOptions,
  verifyPublicCommentCsrf,
} from '../../../../apps/web/lib/publicDocumentComments/csrf';

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const OTHER_ROOM_ID = `doc-v1-${'b'.repeat(64)}`;
const PRINCIPAL_ID = `account:v1:${'p'.repeat(43)}`;
const OTHER_PRINCIPAL_ID = `account:v1:${'q'.repeat(43)}`;
const PRINCIPAL_KEY = '0123456789abcdef0123456789abcdef';
const NOW_SECONDS = 1_785_369_600;
const SESSION_NONCE = Buffer.alloc(32, 5);
const PROOF_NONCE = Buffer.alloc(32, 7);

const hmac = (key: Uint8Array | string, value: string) =>
  createHmac('sha256', key).update(value, 'utf8').digest('base64url');

describe('public comment CSRF and pseudonym boundary', () => {
  it('creates the exact independently random cookie/proof grammar and verifies it repeatedly', () => {
    const nonces = [SESSION_NONCE, PROOF_NONCE];
    const session = createPublicCommentCsrfSession({
      principalId: PRINCIPAL_ID,
      roomId: ROOM_ID,
      principalKey: PRINCIPAL_KEY,
      nowSeconds: NOW_SECONDS,
      randomBytes: (size) => {
        expect(size).toBe(32);
        return nonces.shift() ?? Buffer.alloc(0);
      },
    });
    const expiresAt = NOW_SECONDS + 600;
    const sessionNonce = SESSION_NONCE.toString('base64url');
    const proofNonce = PROOF_NONCE.toString('base64url');
    const csrfKey = createHmac('sha256', PRINCIPAL_KEY)
      .update('lash-public-comment-csrf-key:v1', 'utf8')
      .digest();
    expect(session).toEqual({
      cookieValue: `v1.${sessionNonce}.${expiresAt}.${hmac(
        csrfKey,
        `lash-public-comment-csrf-session:v1\n${PRINCIPAL_ID}\n${sessionNonce}\n${expiresAt}`,
      )}`,
      csrfProof: `v1.${proofNonce}.${expiresAt}.${hmac(
        csrfKey,
        `lash-public-comment-csrf-proof:v1\npublic-comment-create-v1\n${ROOM_ID}\n${PRINCIPAL_ID}\n${sessionNonce}\n${proofNonce}\n${expiresAt}`,
      )}`,
      expiresAt: new Date(expiresAt * 1_000).toISOString(),
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        verifyPublicCommentCsrf({
          cookieValue: session.cookieValue,
          csrfProof: session.csrfProof,
          principalId: PRINCIPAL_ID,
          roomId: ROOM_ID,
          principalKey: PRINCIPAL_KEY,
          nowSeconds: NOW_SECONDS,
        }),
      ).toBe(true);
    }
  });

  it.each([
    ['principal', { principalId: OTHER_PRINCIPAL_ID }],
    ['room', { roomId: OTHER_ROOM_ID }],
    ['scope', { scope: 'owner-comment-create-v1' }],
    ['expired', { nowSeconds: NOW_SECONDS + 601 }],
    ['future expiry', { nowSeconds: NOW_SECONDS - 1 }],
    ['cookie grammar', { cookieValue: 'v1.short.123.bad' }],
    ['proof grammar', { csrfProof: 'v1.short.123.bad' }],
  ])('rejects a mismatched or malformed %s binding', (_label, changes) => {
    const session = createPublicCommentCsrfSession({
      principalId: PRINCIPAL_ID,
      roomId: ROOM_ID,
      principalKey: PRINCIPAL_KEY,
      nowSeconds: NOW_SECONDS,
      randomBytes: (() => {
        const nonces = [SESSION_NONCE, PROOF_NONCE];
        return () => nonces.shift() ?? Buffer.alloc(0);
      })(),
    });
    expect(
      verifyPublicCommentCsrf({
        cookieValue: session.cookieValue,
        csrfProof: session.csrfProof,
        principalId: PRINCIPAL_ID,
        roomId: ROOM_ID,
        principalKey: PRINCIPAL_KEY,
        nowSeconds: NOW_SECONDS,
        ...changes,
      }),
    ).toBe(false);
  });

  it('rotates both values and derives only the per-room public alias', () => {
    const first = createPublicCommentCsrfSession({
      principalId: PRINCIPAL_ID,
      roomId: ROOM_ID,
      principalKey: PRINCIPAL_KEY,
      nowSeconds: NOW_SECONDS,
      randomBytes: (() => {
        const nonces = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)];
        return () => nonces.shift() ?? Buffer.alloc(0);
      })(),
    });
    const second = createPublicCommentCsrfSession({
      principalId: PRINCIPAL_ID,
      roomId: ROOM_ID,
      principalKey: PRINCIPAL_KEY,
      nowSeconds: NOW_SECONDS,
      randomBytes: (() => {
        const nonces = [Buffer.alloc(32, 3), Buffer.alloc(32, 4)];
        return () => nonces.shift() ?? Buffer.alloc(0);
      })(),
    });
    expect(second.cookieValue).not.toBe(first.cookieValue);
    expect(second.csrfProof).not.toBe(first.csrfProof);

    const aliasKey = createHmac('sha256', PRINCIPAL_KEY)
      .update('lash-public-comment-alias-key:v1', 'utf8')
      .digest();
    const digest = hmac(aliasKey, `lash-public-comment-alias:v1\n${ROOM_ID}\n${PRINCIPAL_ID}`);
    expect(derivePublicCommentAlias(PRINCIPAL_KEY, ROOM_ID, PRINCIPAL_ID)).toBe(
      `Commenter ${digest.slice(0, 6)}`,
    );
    expect(derivePublicCommentAlias(PRINCIPAL_KEY, OTHER_ROOM_ID, PRINCIPAL_ID)).not.toBe(
      `Commenter ${digest.slice(0, 6)}`,
    );
  });

  it('uses the exact hardened cookie scope and clears stale state', () => {
    expect(publicCommentCsrfCookieOptions('https://lash.example')).toEqual({
      httpOnly: true,
      maxAge: 600,
      path: '/api/public/documents',
      sameSite: 'strict',
      secure: true,
    });
    expect(publicCommentCsrfCookieOptions('http://127.0.0.1:3000').secure).toBe(false);
    const writes: unknown[] = [];
    clearPublicCommentCsrfCookie(
      {
        set: (value) => writes.push(value),
      },
      'https://lash.example',
    );
    expect(writes).toEqual([
      {
        expires: new Date(0),
        httpOnly: true,
        maxAge: 0,
        name: PUBLIC_COMMENT_CSRF_COOKIE_NAME,
        path: '/api/public/documents',
        sameSite: 'strict',
        secure: true,
        value: '',
      },
    ]);
  });
});
