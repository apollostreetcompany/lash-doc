import { describe, expect, it, vi } from 'vitest';

import {
  deriveAccountPrincipal,
  resolveAccountPrincipal,
  stableAccountPrincipalId,
} from '../../../../apps/web/lib/auth/principal';

const issuer = 'https://project.supabase.co/auth/v1';
const confirmedAt = '2026-07-30T01:00:00.000Z';
const principalKey = '0123456789abcdef0123456789abcdef';

describe('server-derived account principal', () => {
  it('does not yield an owner-capable principal without a valid provider user', async () => {
    await expect(
      resolveAccountPrincipal({
        issuer,
        principalKey,
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      }),
    ).resolves.toEqual({ status: 'anonymous', principal: null });

    await expect(
      resolveAccountPrincipal({
        issuer,
        principalKey,
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('expired session'),
        }),
      }),
    ).resolves.toEqual({ status: 'invalid', principal: null });
  });

  it('rejects a provider user whose email is not verified', async () => {
    await expect(
      resolveAccountPrincipal({
        issuer,
        principalKey,
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'provider-subject',
              email: 'person@example.com',
              email_confirmed_at: null,
            },
          },
          error: null,
        }),
      }),
    ).resolves.toEqual({ status: 'unverified', principal: null });
  });

  it('uses issuer and subject, never mutable email, as ownership identity', async () => {
    const first = await resolveAccountPrincipal({
      issuer,
      principalKey,
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: 'provider-subject',
            email: 'first@example.com',
            email_confirmed_at: confirmedAt,
          },
        },
        error: null,
      }),
    });
    const renamed = await resolveAccountPrincipal({
      issuer,
      principalKey,
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: 'provider-subject',
            email: 'changed@example.com',
            email_confirmed_at: confirmedAt,
          },
        },
        error: null,
      }),
    });

    expect(first.status).toBe('authenticated');
    expect(renamed.status).toBe('authenticated');
    if (first.status !== 'authenticated' || renamed.status !== 'authenticated') {
      throw new Error('expected authenticated principals');
    }
    expect(first.principal.id).toBe(renamed.principal.id);
    expect(first.principal.id).toBe(
      stableAccountPrincipalId(issuer, 'provider-subject', principalKey),
    );
    expect(first.principal.email).not.toBe(renamed.principal.email);
  });

  it('uses a deterministic versioned HMAC without exposing issuer or subject', () => {
    expect(stableAccountPrincipalId(issuer, 'provider-subject', principalKey)).toBe(
      'account:v1:xBjwbhFnt2JuzX4XYC7XPdvQpYG9Jn4QVS6kyD_KGCs',
    );
    expect(stableAccountPrincipalId(issuer, 'provider-subject', principalKey)).not.toContain(
      'provider-subject',
    );
    expect(
      stableAccountPrincipalId(issuer, 'provider-subject', 'fedcba9876543210fedcba9876543210'),
    ).not.toBe(stableAccountPrincipalId(issuer, 'provider-subject', principalKey));
  });

  it('rejects subject aliases instead of silently trimming them', () => {
    expect(() => stableAccountPrincipalId(issuer, ' provider-subject', principalKey)).toThrow(
      TypeError,
    );
    expect(() => stableAccountPrincipalId(issuer, 'provider-subject ', principalKey)).toThrow(
      TypeError,
    );
    expect(() =>
      deriveAccountPrincipal(
        {
          issuer,
          subject: 'provider-subject\u0000alias',
          email: 'person@example.com',
          emailVerifiedAt: confirmedAt,
        },
        principalKey,
      ),
    ).toThrow(TypeError);
  });

  it('fails closed when the server-only HMAC key is absent or weak', () => {
    expect(() => stableAccountPrincipalId(issuer, 'provider-subject', '')).toThrow(TypeError);
    expect(() => stableAccountPrincipalId(issuer, 'provider-subject', 'too-short')).toThrow(
      TypeError,
    );
  });
});
