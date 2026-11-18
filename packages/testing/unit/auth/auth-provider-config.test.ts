import { describe, expect, it } from 'vitest';

import {
  loadSupabaseAuthConfig,
  requireAccountPrincipalHmacKey,
  SupabaseAuthConfigurationError,
} from '../../../../apps/web/lib/auth/config';

describe('Supabase Auth configuration boundary', () => {
  it('fails closed when the provider is absent, partial, or malformed', () => {
    expect(loadSupabaseAuthConfig({})).toEqual({ status: 'unavailable' });
    expect(
      loadSupabaseAuthConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      }),
    ).toEqual({ status: 'unavailable' });
    expect(() =>
      loadSupabaseAuthConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
        LASH_SITE_ORIGIN: 'https://lash.example',
      }),
    ).toThrow(SupabaseAuthConfigurationError);
  });

  it('derives the stable provider issuer from a complete configuration', () => {
    expect(
      loadSupabaseAuthConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co/',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
        LASH_SITE_ORIGIN: 'https://lash.example',
      }),
    ).toEqual({
      status: 'configured',
      config: {
        publishableKey: 'publishable-key',
        url: 'https://project.supabase.co',
        issuer: 'https://project.supabase.co/auth/v1',
        siteOrigin: 'https://lash.example',
      },
    });
  });

  it('allows HTTP only for the local Supabase loopback service', () => {
    expect(
      loadSupabaseAuthConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-publishable-key',
        LASH_SITE_ORIGIN: 'http://127.0.0.1:3000',
      }),
    ).toMatchObject({ status: 'configured' });

    expect(() =>
      loadSupabaseAuthConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'http://auth.example.com',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
        LASH_SITE_ORIGIN: 'https://lash.example',
      }),
    ).toThrow(SupabaseAuthConfigurationError);
  });

  it('rejects a missing or unsafe Lash site origin', () => {
    expect(
      loadSupabaseAuthConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      }),
    ).toEqual({ status: 'unavailable' });
    expect(() =>
      loadSupabaseAuthConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
        LASH_SITE_ORIGIN: 'http://lash.example',
      }),
    ).toThrow(SupabaseAuthConfigurationError);
  });

  it('requires an uncommitted server-only principal pseudonym key', () => {
    expect(() => requireAccountPrincipalHmacKey({})).toThrow(SupabaseAuthConfigurationError);
    expect(() =>
      requireAccountPrincipalHmacKey({
        LASH_ACCOUNT_PRINCIPAL_HMAC_KEY: 'too-short',
      }),
    ).toThrow(SupabaseAuthConfigurationError);
    expect(
      requireAccountPrincipalHmacKey({
        LASH_ACCOUNT_PRINCIPAL_HMAC_KEY: '0123456789abcdef0123456789abcdef',
      }),
    ).toBe('0123456789abcdef0123456789abcdef');
  });
});
