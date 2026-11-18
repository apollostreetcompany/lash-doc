export interface SupabaseAuthConfig {
  url: string;
  publishableKey: string;
  issuer: string;
  siteOrigin: string;
}

export type SupabaseAuthConfigResult =
  | { status: 'configured'; config: SupabaseAuthConfig }
  | { status: 'unavailable' };

export type AuthEnvironment = Record<string, string | undefined>;

export class SupabaseAuthConfigurationError extends Error {
  readonly code = 'invalid-supabase-auth-configuration';

  constructor(message: string) {
    super(message);
    this.name = 'SupabaseAuthConfigurationError';
  }
}

export const isLoopbackHostname = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

const normalizeOrigin = (value: string, label: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SupabaseAuthConfigurationError(`${label} is not a valid URL.`);
  }

  const localHttp = parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname);
  if (parsed.protocol !== 'https:' && !localHttp) {
    throw new SupabaseAuthConfigurationError(
      `${label} must use HTTPS except for a loopback local service.`,
    );
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    throw new SupabaseAuthConfigurationError(
      `${label} must be an origin without credentials, path, query, or fragment.`,
    );
  }

  return parsed.origin;
};

export function loadSupabaseAuthConfig(
  environment: AuthEnvironment = process.env,
): SupabaseAuthConfigResult {
  const rawUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  const rawSiteOrigin = environment.LASH_SITE_ORIGIN?.trim() ?? '';

  if (!rawUrl || !publishableKey || !rawSiteOrigin) {
    return { status: 'unavailable' };
  }

  const url = normalizeOrigin(rawUrl, 'Supabase Auth URL');
  const siteOrigin = normalizeOrigin(rawSiteOrigin, 'Lash site origin');
  return {
    status: 'configured',
    config: {
      url,
      publishableKey,
      issuer: `${url}/auth/v1`,
      siteOrigin,
    },
  };
}

export function requireAccountPrincipalHmacKey(environment: AuthEnvironment = process.env): string {
  const key = environment.LASH_ACCOUNT_PRINCIPAL_HMAC_KEY ?? '';
  if (Buffer.byteLength(key, 'utf8') < 32) {
    throw new SupabaseAuthConfigurationError(
      'Lash account principal HMAC key must contain at least 32 bytes.',
    );
  }
  return key;
}

export function requireSupabaseAuthConfig(
  environment: AuthEnvironment = process.env,
): SupabaseAuthConfig {
  const result = loadSupabaseAuthConfig(environment);
  if (result.status !== 'configured') {
    throw new SupabaseAuthConfigurationError('Supabase Auth is not configured.');
  }
  return result.config;
}
