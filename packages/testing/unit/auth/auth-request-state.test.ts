import { describe, expect, it } from 'vitest';

import {
  AUTH_REQUEST_COOKIE_NAME,
  AUTH_REQUEST_MAX_AGE_SECONDS,
  authRequestCookieOptions,
  clearAuthRequestCookie,
  createAuthRequestState,
  validateAuthRequestState,
} from '../../../../apps/web/lib/auth/requestState';

const siteOrigin = 'https://lash.example';
const next = '/doc/weekly-plan?realtime=on';
const now = new Date('2026-07-30T02:00:00.000Z');
const randomBytes = () => Buffer.alloc(32, 7);
const principalKey = '0123456789abcdef0123456789abcdef';

const createFixture = () =>
  createAuthRequestState(next, siteOrigin, principalKey, { now, randomBytes });

const tamperPayload = (
  cookieValue: string,
  mutate: (payload: { expiresAt: number; next: string; state: string; version: 1 }) => void,
) => {
  const [version, encodedPayload, signature] = cookieValue.split('.');
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
    expiresAt: number;
    next: string;
    state: string;
    version: 1;
  };
  mutate(payload);
  return `${version}.${Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  )}.${signature}`;
};

describe('browser-bound email auth request state', () => {
  it('accepts the exact initiating browser state and document only before expiry', () => {
    const requestState = createFixture();

    expect(
      validateAuthRequestState({
        cookieValue: requestState.cookieValue,
        next,
        now,
        principalKey,
        siteOrigin,
        state: requestState.state,
      }),
    ).toEqual({ status: 'valid', documentPath: next });
  });

  it.each([
    { label: 'a clean second browser', cookieValue: null, state: 'anything', candidateNext: next },
    {
      label: 'the wrong state',
      cookieValue: createFixture().cookieValue,
      state: 'wrong-state',
      candidateNext: next,
    },
    {
      label: 'the wrong document',
      cookieValue: createFixture().cookieValue,
      state: createFixture().state,
      candidateNext: '/doc/another-document',
    },
  ])('rejects $label before provider exchange', ({ cookieValue, state, candidateNext }) => {
    expect(
      validateAuthRequestState({
        cookieValue,
        next: candidateNext,
        now,
        principalKey,
        siteOrigin,
        state,
      }),
    ).toEqual({ status: 'invalid', documentPath: null });
  });

  it('rejects expired state and models one-time consumption by clearing the cookie', () => {
    const requestState = createFixture();
    const cookieJar = new Map([[AUTH_REQUEST_COOKIE_NAME, requestState.cookieValue]]);
    const responseCookies = {
      set: (options: { maxAge?: number; name: string; value: string }) => {
        if (options.maxAge === 0) cookieJar.delete(options.name);
        else cookieJar.set(options.name, options.value);
      },
    };

    clearAuthRequestCookie(responseCookies, siteOrigin);
    expect(cookieJar.has(AUTH_REQUEST_COOKIE_NAME)).toBe(false);
    expect(
      validateAuthRequestState({
        cookieValue: cookieJar.get(AUTH_REQUEST_COOKIE_NAME) ?? null,
        next,
        now,
        principalKey,
        siteOrigin,
        state: requestState.state,
      }),
    ).toEqual({ status: 'invalid', documentPath: null });

    expect(
      validateAuthRequestState({
        cookieValue: requestState.cookieValue,
        next,
        now: new Date(now.getTime() + (AUTH_REQUEST_MAX_AGE_SECONDS + 1) * 1_000),
        principalKey,
        siteOrigin,
        state: requestState.state,
      }),
    ).toEqual({ status: 'invalid', documentPath: null });
  });

  it.each([
    {
      label: 'state',
      cookie: () =>
        tamperPayload(createFixture().cookieValue, (payload) => {
          payload.state = 'forged-state';
        }),
      state: 'forged-state',
      candidateNext: next,
    },
    {
      label: 'next',
      cookie: () =>
        tamperPayload(createFixture().cookieValue, (payload) => {
          payload.next = '/doc/forged-document';
        }),
      state: createFixture().state,
      candidateNext: '/doc/forged-document',
    },
    {
      label: 'expiry',
      cookie: () =>
        tamperPayload(createFixture().cookieValue, (payload) => {
          payload.expiresAt = now.getTime() + 5 * 60 * 1_000;
        }),
      state: createFixture().state,
      candidateNext: next,
    },
    {
      label: 'signature',
      cookie: () => {
        const cookieValue = createFixture().cookieValue;
        const [version, payload, signature] = cookieValue.split('.');
        return `${version}.${payload}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
      },
      state: createFixture().state,
      candidateNext: next,
    },
  ])('rejects a cookie with tampered $label', ({ cookie, state, candidateNext }) => {
    expect(
      validateAuthRequestState({
        cookieValue: cookie(),
        next: candidateNext,
        now: new Date(now.getTime() - 1),
        principalKey,
        siteOrigin,
        state,
      }),
    ).toEqual({ status: 'invalid', documentPath: null });
  });

  it('rejects malformed cookies and a clean-browser synthesis from public callback values', () => {
    const requestState = createFixture();
    const forgedPayload = {
      expiresAt: now.getTime() + AUTH_REQUEST_MAX_AGE_SECONDS * 1_000,
      next,
      state: requestState.state,
      version: 1,
    };
    const synthesized = Buffer.from(JSON.stringify(forgedPayload), 'utf8').toString('base64url');

    for (const cookieValue of [
      '',
      'v1',
      'v1.payload',
      'v1.%%%!.signature',
      `v1.${synthesized}.attacker-signature`,
      synthesized,
    ]) {
      expect(
        validateAuthRequestState({
          cookieValue,
          next,
          now,
          principalKey,
          siteOrigin,
          state: requestState.state,
        }),
      ).toEqual({ status: 'invalid', documentPath: null });
    }
  });

  it('uses a narrowly scoped hardened cookie while preserving loopback HTTP', () => {
    expect(authRequestCookieOptions(siteOrigin)).toMatchObject({
      httpOnly: true,
      maxAge: AUTH_REQUEST_MAX_AGE_SECONDS,
      path: '/auth/confirm',
      sameSite: 'lax',
      secure: true,
    });
    expect(authRequestCookieOptions('http://127.0.0.1:3000')).toMatchObject({
      httpOnly: true,
      path: '/auth/confirm',
      sameSite: 'lax',
      secure: false,
    });
  });
});
