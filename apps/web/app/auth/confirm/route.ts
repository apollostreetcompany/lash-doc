import { NextRequest, NextResponse } from 'next/server';

import { completeEmailSignIn } from '../../../lib/auth/callback';
import {
  requireAccountPrincipalHmacKey,
  requireSupabaseAuthConfig,
} from '../../../lib/auth/config';
import { isTrustedSiteRequest, preventAuthResponseCaching } from '../../../lib/auth/http';
import { AUTH_REQUEST_COOKIE_NAME, clearAuthRequestCookie } from '../../../lib/auth/requestState';
import { safeDocumentReturnPath } from '../../../lib/auth/returnUrl';
import { createRouteSupabaseClient } from '../../../lib/auth/serverClient';

export const dynamic = 'force-dynamic';

const failedRedirect = (siteOrigin: string, next: string | null, error: string) => {
  const target = new URL('/auth/sign-in', siteOrigin);
  if (next) target.searchParams.set('next', next);
  target.searchParams.set('error', error);
  return preventAuthResponseCaching(NextResponse.redirect(target, 303));
};

export async function GET(request: NextRequest) {
  let provider;
  try {
    provider = requireSupabaseAuthConfig();
  } catch {
    return preventAuthResponseCaching(
      NextResponse.json({ error: 'provider-unavailable' }, { status: 503 }),
    );
  }
  if (!isTrustedSiteRequest(request, provider.siteOrigin)) {
    return preventAuthResponseCaching(
      NextResponse.json({ error: 'invalid-origin' }, { status: 400 }),
    );
  }

  const next = safeDocumentReturnPath(
    request.nextUrl.searchParams.get('next'),
    provider.siteOrigin,
  );
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');
  const state = request.nextUrl.searchParams.get('state');
  const response = preventAuthResponseCaching(
    NextResponse.redirect(new URL(next ?? '/auth/sign-in', provider.siteOrigin), 303),
  );
  clearAuthRequestCookie(response.cookies, provider.siteOrigin);
  let principalKey;
  try {
    principalKey = requireAccountPrincipalHmacKey();
  } catch {
    response.headers.set(
      'location',
      failedRedirect(provider.siteOrigin, next, 'provider-unavailable').headers.get('location') ??
        '/auth/sign-in',
    );
    return response;
  }

  try {
    const supabase = createRouteSupabaseClient(request, response);
    const completion = await completeEmailSignIn(
      {
        authRequestCookie: request.cookies.get(AUTH_REQUEST_COOKIE_NAME)?.value ?? null,
        next,
        siteOrigin: provider.siteOrigin,
        state,
        tokenHash,
        type,
      },
      supabase,
      { issuer: provider.issuer, principalKey },
    );
    if (completion.status !== 'authenticated') {
      if (completion.status === 'unverified-account') {
        await supabase.auth.signOut({ scope: 'local' });
      }
      response.headers.set(
        'location',
        failedRedirect(provider.siteOrigin, next, completion.status).headers.get('location') ??
          '/auth/sign-in',
      );
    }
    return response;
  } catch {
    const failed = failedRedirect(provider.siteOrigin, next, 'provider-unavailable');
    clearAuthRequestCookie(failed.cookies, provider.siteOrigin);
    return failed;
  }
}
