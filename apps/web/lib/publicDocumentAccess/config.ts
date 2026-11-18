import { Buffer } from 'node:buffer';

import { loadPublicRateKeyConfig, type PublicRateKeyConfig } from './rateKey';

export type PublicDocumentSessionEnvironment = Readonly<Record<string, string | undefined>>;

export type PublicDocumentSessionConfig = Readonly<{
  enabled: true;
  siteOrigin: string;
  workerOrigin: string;
  publicControlSecret: string;
  rateKey: PublicRateKeyConfig;
}>;

export class PublicDocumentSessionConfigurationError extends Error {
  readonly code = 'invalid-public-document-session-configuration';

  constructor(message: string) {
    super(message);
    this.name = 'PublicDocumentSessionConfigurationError';
  }
}

const isLoopback = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

const parseOrigin = (value: string | undefined, label: string) => {
  if (!value || value.trim() !== value) {
    throw new PublicDocumentSessionConfigurationError(`${label} is missing or padded.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicDocumentSessionConfigurationError(`${label} is invalid.`);
  }
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new PublicDocumentSessionConfigurationError(
      `${label} must be an HTTPS origin, except for loopback HTTP.`,
    );
  }
  return url.origin;
};

export const loadPublicDocumentSessionConfig = (
  environment: PublicDocumentSessionEnvironment = process.env,
): PublicDocumentSessionConfig => {
  const publicControlSecret = environment.LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT ?? '';
  const rateKey = loadPublicRateKeyConfig(environment);
  if (
    environment.LASH_PUBLIC_DOCUMENT_ACCESS_ENABLED !== 'true' ||
    Buffer.byteLength(publicControlSecret, 'utf8') < 32 ||
    !rateKey
  ) {
    throw new PublicDocumentSessionConfigurationError(
      'Dedicated public-control and trusted rate-key configuration is required.',
    );
  }
  return Object.freeze({
    enabled: true,
    siteOrigin: parseOrigin(environment.LASH_SITE_ORIGIN, 'Lash site origin'),
    workerOrigin: parseOrigin(environment.LASH_REALTIME_WORKER_HTTP_URL, 'Realtime Worker origin'),
    publicControlSecret,
    rateKey,
  });
};
