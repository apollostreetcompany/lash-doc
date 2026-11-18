interface AuthRequest {
  headers: { get(name: string): string | null };
  nextUrl: { origin: string };
}

interface AuthResponse {
  headers: { set(name: string, value: string): void };
}

export function isTrustedSiteRequest(
  request: AuthRequest,
  siteOrigin: string,
  options: { requireOriginHeader?: boolean } = {},
): boolean {
  try {
    const configured = new URL(siteOrigin);
    if (request.headers.get('host') !== configured.host) {
      return false;
    }

    const forwardedProtocol = request.headers.get('x-forwarded-proto');
    let effectiveProtocol: string;
    if (forwardedProtocol !== null) {
      if (forwardedProtocol !== 'http' && forwardedProtocol !== 'https') {
        return false;
      }
      effectiveProtocol = `${forwardedProtocol}:`;
    } else {
      effectiveProtocol = new URL(request.nextUrl.origin).protocol;
    }
    if (effectiveProtocol !== configured.protocol) return false;

    const origin = request.headers.get('origin');
    if (!origin) return options.requireOriginHeader !== true;
    return origin === configured.origin;
  } catch {
    return false;
  }
}

export function preventAuthResponseCaching<Response extends AuthResponse>(
  response: Response,
): Response {
  response.headers.set('cache-control', 'private, no-cache, no-store, must-revalidate, max-age=0');
  response.headers.set('expires', '0');
  response.headers.set('pragma', 'no-cache');
  response.headers.set('referrer-policy', 'no-referrer');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}
