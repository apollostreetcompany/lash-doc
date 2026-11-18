import { describe, expect, it } from 'vitest';

import {
  isTrustedSiteRequest,
  preventAuthResponseCaching,
} from '../../../../apps/web/lib/auth/http';

describe('auth HTTP boundary', () => {
  it('accepts the exact loopback Host when Next exposes a different internal hostname', () => {
    expect(
      isTrustedSiteRequest(
        {
          headers: new Headers({ host: '127.0.0.1:3000' }),
          nextUrl: { origin: 'http://localhost:3000' },
        },
        'http://127.0.0.1:3000',
      ),
    ).toBe(true);
  });

  it('rejects a direct request whose effective protocol does not match configuration', () => {
    expect(
      isTrustedSiteRequest(
        {
          headers: new Headers({ host: 'lash.example' }),
          nextUrl: { origin: 'http://internal-render:10000' },
        },
        'https://lash.example',
      ),
    ).toBe(false);
  });

  it('accepts an exact production Host behind a TLS proxy only with exact forwarded https', () => {
    expect(
      isTrustedSiteRequest(
        {
          headers: new Headers({
            host: 'lash.example',
            'x-forwarded-proto': 'https',
          }),
          nextUrl: { origin: 'http://internal-render:10000' },
        },
        'https://lash.example',
      ),
    ).toBe(true);
    expect(
      isTrustedSiteRequest(
        {
          headers: new Headers({
            host: 'lash.example',
            'x-forwarded-proto': 'http',
          }),
          nextUrl: { origin: 'http://internal-render:10000' },
        },
        'https://lash.example',
      ),
    ).toBe(false);
  });

  it.each(['HTTPS', ' https', 'https ', 'https,http', 'https, http', 'https://'])(
    'rejects malformed or chained x-forwarded-proto: %s',
    (forwardedProto) => {
      expect(
        isTrustedSiteRequest(
          {
            headers: {
              get: (name) =>
                ({ host: 'lash.example', 'x-forwarded-proto': forwardedProto })[
                  name.toLowerCase() as 'host' | 'x-forwarded-proto'
                ] ?? null,
            },
            nextUrl: { origin: 'http://internal-render:10000' },
          },
          'https://lash.example',
        ),
      ).toBe(false);
    },
  );

  it('rejects Host and Origin spoofing while retaining exact POST Origin checks', () => {
    expect(
      isTrustedSiteRequest(
        {
          headers: new Headers({
            host: 'attacker.example',
            origin: 'https://lash.example',
            'x-forwarded-proto': 'https',
          }),
          nextUrl: { origin: 'http://internal-render:10000' },
        },
        'https://lash.example',
        { requireOriginHeader: true },
      ),
    ).toBe(false);
    expect(
      isTrustedSiteRequest(
        {
          headers: new Headers({
            host: 'lash.example',
            origin: 'https://attacker.example',
            'x-forwarded-proto': 'https',
          }),
          nextUrl: { origin: 'http://internal-render:10000' },
        },
        'https://lash.example',
        { requireOriginHeader: true },
      ),
    ).toBe(false);
    expect(
      isTrustedSiteRequest(
        {
          headers: new Headers({
            host: 'lash.example',
            origin: 'https://lash.example',
            'x-forwarded-proto': 'https',
          }),
          nextUrl: { origin: 'http://internal-render:10000' },
        },
        'https://lash.example',
        { requireOriginHeader: true },
      ),
    ).toBe(true);
  });

  it('prevents session and token-hash responses from being cached or referred', () => {
    const response = preventAuthResponseCaching({ headers: new Headers() });

    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
