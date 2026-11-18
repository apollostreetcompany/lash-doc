import { describe, expect, it } from 'vitest';

import {
  derivePublicRateKey,
  loadPublicRateKeyConfig,
} from '../../../../apps/web/lib/publicDocumentAccess/rateKey';

const SECRET = '0123456789abcdef0123456789abcdef';

describe('public document trusted rate key', () => {
  it('loads only an explicit dedicated secret and allowlisted exact lowercase header', () => {
    expect(
      loadPublicRateKeyConfig({
        LASH_PUBLIC_RATE_KEY_SECRET: SECRET,
        LASH_TRUSTED_CLIENT_ADDRESS_HEADER: 'x-forwarded-for',
      }),
    ).toEqual({
      secret: SECRET,
      headerName: 'x-forwarded-for',
    });
    expect(
      loadPublicRateKeyConfig({
        LASH_PUBLIC_RATE_KEY_SECRET: SECRET,
        LASH_TRUSTED_CLIENT_ADDRESS_HEADER: 'cf-connecting-ip',
      }),
    ).toEqual({
      secret: SECRET,
      headerName: 'cf-connecting-ip',
    });

    for (const env of [
      {},
      { LASH_PUBLIC_RATE_KEY_SECRET: SECRET },
      { LASH_TRUSTED_CLIENT_ADDRESS_HEADER: 'x-forwarded-for' },
      {
        LASH_PUBLIC_RATE_KEY_SECRET: 'too-short',
        LASH_TRUSTED_CLIENT_ADDRESS_HEADER: 'x-forwarded-for',
      },
      {
        LASH_PUBLIC_RATE_KEY_SECRET: SECRET,
        LASH_TRUSTED_CLIENT_ADDRESS_HEADER: 'X-Forwarded-For',
      },
      {
        LASH_PUBLIC_RATE_KEY_SECRET: SECRET,
        LASH_TRUSTED_CLIENT_ADDRESS_HEADER: 'x-real-ip',
      },
      {
        LASH_PUBLIC_RATE_KEY_SECRET: SECRET,
        LASH_TRUSTED_CLIENT_ADDRESS_HEADER: ' x-forwarded-for',
      },
    ]) {
      expect(loadPublicRateKeyConfig(env)).toBeNull();
    }
  });

  it('derives the exact domain-separated pseudonym without returning the address', () => {
    const result = derivePublicRateKey(
      {
        secret: SECRET,
        headerName: 'x-forwarded-for',
      },
      '203.0.113.42',
    );

    expect(result).toBe('rate-v1-4zRWHNarx6FoRJklMoE9lea5IFs2T2nMhv46O37E6bU');
    expect(result).not.toContain('203.0.113.42');
  });

  it('accepts only one canonical bare IPv4 or IPv6 address', () => {
    const config = {
      secret: SECRET,
      headerName: 'cf-connecting-ip' as const,
    };
    expect(derivePublicRateKey(config, '198.51.100.7')).toMatch(/^rate-v1-[A-Za-z0-9_-]{43}$/u);
    expect(derivePublicRateKey(config, '2001:db8::1')).toMatch(/^rate-v1-[A-Za-z0-9_-]{43}$/u);

    for (const address of [
      '',
      ' 198.51.100.7',
      '198.51.100.7 ',
      '198.51.100.7, 203.0.113.1',
      '198.51.100.7:443',
      '198.051.100.007',
      '2001:0db8::1',
      '2001:DB8::1',
      '[2001:db8::1]',
      '[2001:db8::1]:443',
      '2001:db8::1%eth0',
      'not-an-address',
      '198.51.100.7\n203.0.113.1',
    ]) {
      expect(derivePublicRateKey(config, address)).toBeNull();
    }
  });
});
