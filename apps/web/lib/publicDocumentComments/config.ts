import { Buffer } from 'node:buffer';

import { loadPublicRateKeyConfig, type PublicRateKeyConfig } from '../publicDocumentAccess/rateKey';

export type PublicDocumentCommentEnvironment = Readonly<Record<string, string | undefined>>;

export type PublicDocumentCommentConfig = Readonly<{
  enabled: true;
  siteOrigin: string;
  workerOrigin: string;
  commentControlSecret: string;
  principalKey: string;
  rateKey: PublicRateKeyConfig;
}>;

export class PublicDocumentCommentConfigurationError extends Error {
  readonly code = 'invalid-public-document-comment-configuration';

  constructor(message: string) {
    super(message);
    this.name = 'PublicDocumentCommentConfigurationError';
  }
}

const isLoopback = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

const parseOrigin = (value: string | undefined, label: string) => {
  if (!value || value.trim() !== value) {
    throw new PublicDocumentCommentConfigurationError(`${label} is missing or padded.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicDocumentCommentConfigurationError(`${label} is invalid.`);
  }
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new PublicDocumentCommentConfigurationError(
      `${label} must be an HTTPS origin, except for loopback HTTP.`,
    );
  }
  return url.origin;
};

export const loadPublicDocumentCommentConfig = (
  environment: PublicDocumentCommentEnvironment = process.env,
): PublicDocumentCommentConfig => {
  const commentControlSecret = environment.LASH_WORKER_PUBLIC_COMMENT_SECRET_CURRENT ?? '';
  const principalKey = environment.LASH_ACCOUNT_PRINCIPAL_HMAC_KEY ?? '';
  const rateKey = loadPublicRateKeyConfig(environment);
  if (
    environment.LASH_PUBLIC_COMMENT_ACCESS_ENABLED !== 'true' ||
    Buffer.byteLength(commentControlSecret, 'utf8') < 32 ||
    Buffer.byteLength(principalKey, 'utf8') < 32 ||
    !rateKey
  ) {
    throw new PublicDocumentCommentConfigurationError(
      'Dedicated public-comment, account, and trusted rate-key configuration is required.',
    );
  }
  return Object.freeze({
    enabled: true,
    siteOrigin: parseOrigin(environment.LASH_SITE_ORIGIN, 'Lash site origin'),
    workerOrigin: parseOrigin(environment.LASH_REALTIME_WORKER_HTTP_URL, 'Realtime Worker origin'),
    commentControlSecret,
    principalKey,
    rateKey,
  });
};
