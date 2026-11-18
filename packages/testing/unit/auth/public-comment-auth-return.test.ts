import { describe, expect, it, vi } from 'vitest';

import { completeEmailSignIn } from '../../../../apps/web/lib/auth/callback';
import {
  createAuthRequestState,
  validateAuthRequestState,
} from '../../../../apps/web/lib/auth/requestState';
import { authCallbackUrl, safeDocumentReturnPath } from '../../../../apps/web/lib/auth/returnUrl';

const ORIGIN = 'https://lash.example';
const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const PUBLIC_PATH = `/public/${ROOM_ID}`;
const PRINCIPAL_KEY = '0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-07-30T02:00:00.000Z');

describe('public comment authentication return contract', () => {
  it('accepts only the exact canonical public document path', () => {
    expect(safeDocumentReturnPath(PUBLIC_PATH, ORIGIN)).toBe(PUBLIC_PATH);
    expect(safeDocumentReturnPath(`${ORIGIN}${PUBLIC_PATH}`, ORIGIN)).toBe(PUBLIC_PATH);

    for (const candidate of [
      `${PUBLIC_PATH}?thread=latest`,
      `${PUBLIC_PATH}?`,
      `${PUBLIC_PATH}#comment`,
      `${PUBLIC_PATH}#`,
      `${PUBLIC_PATH}/comments`,
      `${PUBLIC_PATH}%2Fcomments`,
      `${PUBLIC_PATH}%5Ccomments`,
      `/public/doc-v01-${'a'.repeat(64)}`,
      `/public/doc-v1-${'A'.repeat(64)}`,
      `https://attacker.example${PUBLIC_PATH}`,
      `//attacker.example${PUBLIC_PATH}`,
      `https://person@lash.example${PUBLIC_PATH}`,
    ]) {
      expect(safeDocumentReturnPath(candidate, ORIGIN)).toBeNull();
    }
  });

  it('preserves the existing one-segment document return contract', () => {
    expect(safeDocumentReturnPath('/doc/weekly-plan?realtime=on', ORIGIN)).toBe(
      '/doc/weekly-plan?realtime=on',
    );
    expect(safeDocumentReturnPath('/doc/weekly%2Fplan', ORIGIN)).toBeNull();
    expect(safeDocumentReturnPath('/doc/weekly%5Cplan', ORIGIN)).toBeNull();
  });

  it('binds the exact public path into signed browser state and rejects tampering', () => {
    const requestState = createAuthRequestState(PUBLIC_PATH, ORIGIN, PRINCIPAL_KEY, {
      now: NOW,
      randomBytes: () => Buffer.alloc(32, 7),
    });

    expect(
      validateAuthRequestState({
        cookieValue: requestState.cookieValue,
        next: PUBLIC_PATH,
        now: NOW,
        principalKey: PRINCIPAL_KEY,
        siteOrigin: ORIGIN,
        state: requestState.state,
      }),
    ).toEqual({ status: 'valid', documentPath: PUBLIC_PATH });
    expect(
      validateAuthRequestState({
        cookieValue: requestState.cookieValue,
        next: `${PUBLIC_PATH}?thread=forged`,
        now: NOW,
        principalKey: PRINCIPAL_KEY,
        siteOrigin: ORIGIN,
        state: requestState.state,
      }),
    ).toEqual({ status: 'invalid', documentPath: null });

    const [version, encodedPayload, signature] = requestState.cookieValue.split('.');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      expiresAt: number;
      next: string;
      state: string;
      version: 1;
    };
    payload.next = `/public/doc-v1-${'b'.repeat(64)}`;
    const tamperedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    expect(
      validateAuthRequestState({
        cookieValue: `${version}.${tamperedPayload}.${signature}`,
        next: payload.next,
        now: NOW,
        principalKey: PRINCIPAL_KEY,
        siteOrigin: ORIGIN,
        state: requestState.state,
      }),
    ).toEqual({ status: 'invalid', documentPath: null });
  });

  it('builds and completes the magic-link callback for the exact same public path', async () => {
    const requestState = createAuthRequestState(PUBLIC_PATH, ORIGIN, PRINCIPAL_KEY, {
      now: NOW,
      randomBytes: () => Buffer.alloc(32, 9),
    });
    expect(authCallbackUrl(PUBLIC_PATH, ORIGIN, requestState.state).toString()).toBe(
      `${ORIGIN}/auth/confirm?next=${encodeURIComponent(PUBLIC_PATH)}&state=${requestState.state}`,
    );

    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: 'provider-subject',
          email: 'commenter@example.com',
          email_confirmed_at: '2026-07-30T01:00:00.000Z',
        },
      },
      error: null,
    });
    await expect(
      completeEmailSignIn(
        {
          authRequestCookie: requestState.cookieValue,
          next: PUBLIC_PATH,
          now: NOW,
          siteOrigin: ORIGIN,
          state: requestState.state,
          tokenHash: 'one-time-token-hash',
          type: 'email',
        },
        { auth: { verifyOtp, getUser } } as never,
        {
          issuer: 'https://project.supabase.co/auth/v1',
          principalKey: PRINCIPAL_KEY,
        },
      ),
    ).resolves.toEqual({
      status: 'authenticated',
      documentPath: PUBLIC_PATH,
    });
  });
});
