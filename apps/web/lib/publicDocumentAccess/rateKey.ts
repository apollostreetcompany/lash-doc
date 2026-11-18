import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export type PublicRateKeyHeaderName = 'x-forwarded-for' | 'cf-connecting-ip';

export type PublicRateKeyConfig = Readonly<{
  secret: string;
  headerName: PublicRateKeyHeaderName;
}>;

type PublicRateKeyEnvironment = Readonly<Record<string, string | undefined>>;

const MINIMUM_SECRET_BYTES = 32;
const RATE_KEY_DOMAIN = 'lash-public-rate-key:v1';

const isAllowedHeaderName = (value: unknown): value is PublicRateKeyHeaderName =>
  value === 'x-forwarded-for' || value === 'cf-connecting-ip';

export const loadPublicRateKeyConfig = (
  environment: PublicRateKeyEnvironment,
): PublicRateKeyConfig | null => {
  const secret = environment.LASH_PUBLIC_RATE_KEY_SECRET;
  const headerName = environment.LASH_TRUSTED_CLIENT_ADDRESS_HEADER;
  if (
    typeof secret !== 'string' ||
    new TextEncoder().encode(secret).byteLength < MINIMUM_SECRET_BYTES ||
    !isAllowedHeaderName(headerName)
  ) {
    return null;
  }
  return Object.freeze({ secret, headerName });
};

const canonicalClientAddress = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u0020\u007f,]/u.test(value)) {
    return null;
  }
  const version = isIP(value);
  if (version === 4) {
    const canonical = value
      .split('.')
      .map((part) => String(Number(part)))
      .join('.');
    return canonical === value ? value : null;
  }
  if (version !== 6) return null;
  try {
    const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    return canonical === value ? value : null;
  } catch {
    return null;
  }
};

export const derivePublicRateKey = (
  config: PublicRateKeyConfig,
  clientAddress: unknown,
): string | null => {
  const canonicalAddress = canonicalClientAddress(clientAddress);
  if (!canonicalAddress) return null;
  const material = `${RATE_KEY_DOMAIN}\n${config.headerName}\n${canonicalAddress}`;
  return `rate-v1-${createHmac('sha256', config.secret).update(material, 'utf8').digest('base64url')}`;
};
