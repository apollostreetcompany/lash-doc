import { describe, expect, it } from 'vitest';

import { loadPublicDocumentSessionConfig } from '../../../../apps/web/lib/publicDocumentAccess/config';

const PUBLIC_CONTROL_SECRET = 'public-control-secret-32-bytes!!';
const RATE_KEY_SECRET = 'public-rate-key-secret-32-bytes!!!';

const configuredEnvironment = {
  LASH_SITE_ORIGIN: 'https://lash.example',
  LASH_REALTIME_WORKER_HTTP_URL: 'https://worker.example',
  LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: PUBLIC_CONTROL_SECRET,
  LASH_PUBLIC_RATE_KEY_SECRET: RATE_KEY_SECRET,
  LASH_TRUSTED_CLIENT_ADDRESS_HEADER: 'x-forwarded-for',
  LASH_PUBLIC_DOCUMENT_ACCESS_ENABLED: 'true',
};

describe('public document web configuration', () => {
  it('loads independently of Supabase/account configuration', () => {
    expect(loadPublicDocumentSessionConfig(configuredEnvironment)).toEqual({
      siteOrigin: 'https://lash.example',
      workerOrigin: 'https://worker.example',
      publicControlSecret: PUBLIC_CONTROL_SECRET,
      enabled: true,
      rateKey: {
        secret: RATE_KEY_SECRET,
        headerName: 'x-forwarded-for',
      },
    });
  });

  it('allows plain HTTP only for exact loopback origins', () => {
    expect(
      loadPublicDocumentSessionConfig({
        ...configuredEnvironment,
        LASH_SITE_ORIGIN: 'http://127.0.0.1:3000',
        LASH_REALTIME_WORKER_HTTP_URL: 'http://localhost:8787',
      }),
    ).toMatchObject({
      siteOrigin: 'http://127.0.0.1:3000',
      workerOrigin: 'http://localhost:8787',
    });
  });

  it('fails closed for missing secrets, trusted attribution, or unsafe origins', () => {
    for (const changed of [
      { LASH_SITE_ORIGIN: '' },
      { LASH_SITE_ORIGIN: 'http://lash.example' },
      { LASH_SITE_ORIGIN: 'https://lash.example/path' },
      { LASH_SITE_ORIGIN: 'https://user:password@lash.example' },
      { LASH_REALTIME_WORKER_HTTP_URL: '' },
      { LASH_REALTIME_WORKER_HTTP_URL: 'http://worker.example' },
      { LASH_REALTIME_WORKER_HTTP_URL: 'https://worker.example/?ticket=secret' },
      { LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT: 'too-short' },
      { LASH_PUBLIC_RATE_KEY_SECRET: 'too-short' },
      { LASH_TRUSTED_CLIENT_ADDRESS_HEADER: 'x-real-ip' },
      { LASH_TRUSTED_CLIENT_ADDRESS_HEADER: 'X-Forwarded-For' },
      { LASH_PUBLIC_DOCUMENT_ACCESS_ENABLED: '' },
      { LASH_PUBLIC_DOCUMENT_ACCESS_ENABLED: 'false' },
      { LASH_PUBLIC_DOCUMENT_ACCESS_ENABLED: 'TRUE' },
    ]) {
      expect(() =>
        loadPublicDocumentSessionConfig({ ...configuredEnvironment, ...changed }),
      ).toThrow();
    }
  });
});
