import { describe, expect, it } from 'vitest';

import {
  loadPublicDocumentCommentConfig,
  PublicDocumentCommentConfigurationError,
} from '../../../../apps/web/lib/publicDocumentComments/config';

const validEnvironment = {
  LASH_PUBLIC_COMMENT_ACCESS_ENABLED: 'true',
  LASH_SITE_ORIGIN: 'https://lash.example',
  LASH_REALTIME_WORKER_HTTP_URL: 'https://worker.example',
  LASH_WORKER_PUBLIC_COMMENT_SECRET_CURRENT: 'comment-control-secret-current-at-least-32-bytes',
  LASH_WORKER_PUBLIC_COMMENT_SECRET_PREVIOUS: 'must-never-load-on-next-even-if-present',
  LASH_ACCOUNT_PRINCIPAL_HMAC_KEY: 'account-principal-key-at-least-32-bytes',
  LASH_PUBLIC_RATE_KEY_SECRET: 'public-rate-key-secret-at-least-32-bytes',
  LASH_TRUSTED_CLIENT_ADDRESS_HEADER: 'cf-connecting-ip',
} as const;

describe('public comment web configuration', () => {
  it('loads only the exact current comment control and trusted rate configuration', () => {
    expect(loadPublicDocumentCommentConfig(validEnvironment)).toEqual({
      enabled: true,
      siteOrigin: 'https://lash.example',
      workerOrigin: 'https://worker.example',
      commentControlSecret: 'comment-control-secret-current-at-least-32-bytes',
      principalKey: 'account-principal-key-at-least-32-bytes',
      rateKey: {
        secret: 'public-rate-key-secret-at-least-32-bytes',
        headerName: 'cf-connecting-ip',
      },
    });
  });

  it.each([
    ['disabled', { LASH_PUBLIC_COMMENT_ACCESS_ENABLED: 'false' }],
    ['missing current secret', { LASH_WORKER_PUBLIC_COMMENT_SECRET_CURRENT: '' }],
    ['missing principal key', { LASH_ACCOUNT_PRINCIPAL_HMAC_KEY: '' }],
    ['padded site', { LASH_SITE_ORIGIN: ' https://lash.example' }],
    ['unsafe Worker origin', { LASH_REALTIME_WORKER_HTTP_URL: 'http://worker.example' }],
    ['untrusted rate header', { LASH_TRUSTED_CLIENT_ADDRESS_HEADER: 'x-real-ip' }],
  ])('fails closed for %s configuration', (_label, changes) => {
    expect(() => loadPublicDocumentCommentConfig({ ...validEnvironment, ...changes })).toThrow(
      PublicDocumentCommentConfigurationError,
    );
  });
});
