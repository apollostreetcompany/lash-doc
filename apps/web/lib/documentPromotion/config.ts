import { Buffer } from 'node:buffer';

export interface DocumentDerivationKey {
  version: string;
  key: Buffer;
}

export interface DocumentPromotionConfig {
  workerOrigin: string;
  controlSecret: string;
  derivationKeys: DocumentDerivationKey[];
}

export type DocumentPromotionEnvironment = Record<string, string | undefined>;

export class DocumentPromotionConfigurationError extends Error {
  readonly code = 'invalid-document-promotion-configuration';

  constructor(message: string) {
    super(message);
    this.name = 'DocumentPromotionConfigurationError';
  }
}

const isLoopbackHostname = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

const parseWorkerOrigin = (raw: string) => {
  if (!raw || raw.trim() !== raw) {
    throw new DocumentPromotionConfigurationError('Worker URL is missing or padded.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DocumentPromotionConfigurationError('Worker URL is invalid.');
  }

  const loopbackHttp = url.protocol === 'http:' && isLoopbackHostname(url.hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new DocumentPromotionConfigurationError('Worker URL must use HTTPS except for loopback.');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new DocumentPromotionConfigurationError(
      'Worker URL must be an origin without credentials, path, query, or fragment.',
    );
  }
  return url.origin;
};

const decodeBase64UrlKey = (raw: string) => {
  if (!/^[A-Za-z0-9_-]+$/u.test(raw)) {
    throw new DocumentPromotionConfigurationError('A derivation key is not base64url.');
  }
  const decoded = Buffer.from(raw, 'base64url');
  if (decoded.toString('base64url') !== raw || decoded.byteLength < 32) {
    throw new DocumentPromotionConfigurationError(
      'Every derivation key must decode canonically to at least 32 bytes.',
    );
  }
  return decoded;
};

const parseDerivationKeys = (raw: string): DocumentDerivationKey[] => {
  if (!raw || raw.trim() !== raw || raw.includes(' ') || raw.includes('\t')) {
    throw new DocumentPromotionConfigurationError('Derivation key ring is missing or padded.');
  }

  const entries = raw.split(',');
  if (entries.length < 1 || entries.length > 4 || entries.some((entry) => !entry)) {
    throw new DocumentPromotionConfigurationError(
      'Derivation key ring must contain one to four entries.',
    );
  }

  const versions = new Set<string>();
  return entries.map((entry) => {
    const match = entry.match(/^(v(?:0|[1-9][0-9]{0,7})):([A-Za-z0-9_-]+)$/u);
    if (!match) {
      throw new DocumentPromotionConfigurationError('A derivation key entry is invalid.');
    }
    const [, version, rawKey] = match;
    if (!version || !rawKey || versions.has(version)) {
      throw new DocumentPromotionConfigurationError(
        'Derivation key versions must be present and unique.',
      );
    }
    versions.add(version);
    return { version, key: decodeBase64UrlKey(rawKey) };
  });
};

export function loadDocumentPromotionConfig(
  environment: DocumentPromotionEnvironment = process.env,
): DocumentPromotionConfig {
  const workerOrigin = parseWorkerOrigin(environment.LASH_REALTIME_WORKER_HTTP_URL ?? '');
  const controlSecret = environment.LASH_WORKER_CONTROL_SECRET_CURRENT ?? '';
  if (Buffer.byteLength(controlSecret, 'utf8') < 32) {
    throw new DocumentPromotionConfigurationError(
      'Worker control secret must contain at least 32 UTF-8 bytes.',
    );
  }

  return {
    workerOrigin,
    controlSecret,
    derivationKeys: parseDerivationKeys(environment.LASH_DOCUMENT_ID_DERIVATION_KEYS ?? ''),
  };
}
