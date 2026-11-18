import { describe, expect, it, vi } from 'vitest';

import { completeEmailSignIn } from '../../../../apps/web/lib/auth/callback';
import { createAuthRequestState } from '../../../../apps/web/lib/auth/requestState';

const siteOrigin = 'http://127.0.0.1:3000';
const principalKey = '0123456789abcdef0123456789abcdef';
const provider = {
  issuer: 'https://project.supabase.co/auth/v1',
  principalKey,
};

const verifiedUser = {
  id: 'provider-subject',
  email: 'person@example.com',
  email_confirmed_at: '2026-07-30T01:00:00.000Z',
};

describe('email auth callback', () => {
  const callbackInput = (next = '/doc/weekly-plan?realtime=on') => {
    const requestState = createAuthRequestState(next, siteOrigin, principalKey);
    return {
      authRequestCookie: requestState.cookieValue,
      next,
      siteOrigin,
      state: requestState.state,
      tokenHash: 'one-time-token-hash',
      type: 'email',
    };
  };

  it('returns an authenticated browser to the exact same document', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    const getUser = vi.fn().mockResolvedValue({
      data: { user: verifiedUser },
      error: null,
    });

    await expect(
      completeEmailSignIn(callbackInput(), { auth: { verifyOtp, getUser } } as never, provider),
    ).resolves.toEqual({
      status: 'authenticated',
      documentPath: '/doc/weekly-plan?realtime=on',
    });
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: 'one-time-token-hash',
      type: 'email',
    });
  });

  it('rejects the callback before provider exchange when next is external', async () => {
    const verifyOtp = vi.fn();
    const requestState = createAuthRequestState('/doc/weekly-plan', siteOrigin, principalKey);

    await expect(
      completeEmailSignIn(
        {
          authRequestCookie: requestState.cookieValue,
          next: 'https://attacker.example/doc/weekly-plan',
          siteOrigin,
          state: requestState.state,
          tokenHash: 'one-time-token-hash',
          type: 'email',
        },
        { auth: { verifyOtp } } as never,
        provider,
      ),
    ).resolves.toEqual({ status: 'invalid-link', documentPath: null });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'missing browser cookie', cookie: null, state: 'request-state' },
    { label: 'wrong state', cookie: callbackInput().authRequestCookie, state: 'wrong-state' },
  ])('rejects $label before provider exchange', async ({ cookie, state }) => {
    const verifyOtp = vi.fn();
    await expect(
      completeEmailSignIn(
        {
          ...callbackInput(),
          authRequestCookie: cookie,
          state,
        },
        { auth: { verifyOtp } } as never,
        provider,
      ),
    ).resolves.toEqual({ status: 'invalid-link', documentPath: null });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('does not authenticate after an expired token or unverified user', async () => {
    await expect(
      completeEmailSignIn(
        {
          ...callbackInput('/doc/weekly-plan'),
          tokenHash: 'expired-token-hash',
        },
        {
          auth: {
            verifyOtp: vi.fn().mockResolvedValue({
              error: new Error('expired'),
            }),
          },
        } as never,
        provider,
      ),
    ).resolves.toEqual({
      status: 'provider-rejected',
      documentPath: '/doc/weekly-plan',
    });

    await expect(
      completeEmailSignIn(
        {
          ...callbackInput('/doc/weekly-plan'),
          tokenHash: 'valid-token-hash',
        },
        {
          auth: {
            verifyOtp: vi.fn().mockResolvedValue({ error: null }),
            getUser: vi.fn().mockResolvedValue({
              data: {
                user: {
                  ...verifiedUser,
                  email_confirmed_at: null,
                },
              },
              error: null,
            }),
          },
        } as never,
        provider,
      ),
    ).resolves.toEqual({
      status: 'unverified-account',
      documentPath: '/doc/weekly-plan',
    });
  });
});
