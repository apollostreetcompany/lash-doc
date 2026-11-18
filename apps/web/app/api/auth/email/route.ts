import { NextRequest, NextResponse } from 'next/server';

import {
  requireAccountPrincipalHmacKey,
  requireSupabaseAuthConfig,
} from '../../../../lib/auth/config';
import { preventAuthResponseCaching, isTrustedSiteRequest } from '../../../../lib/auth/http';
import {
  clearAuthRequestCookie,
  createAuthRequestState,
  setAuthRequestCookie,
} from '../../../../lib/auth/requestState';
import { authCallbackUrl, safeDocumentReturnPath } from '../../../../lib/auth/returnUrl';
import { createRouteSupabaseClient } from '../../../../lib/auth/serverClient';

export const dynamic = 'force-dynamic';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const signInRedirect = (siteOrigin: string, next: string | null, error?: string) => {
  const url = new URL('/auth/sign-in', siteOrigin);
  if (next) url.searchParams.set('next', next);
  if (error) url.searchParams.set('error', error);
  return preventAuthResponseCaching(NextResponse.redirect(url, 303));
};

export async function POST(request: NextRequest) {
  let provider;
  let principalKey;
  try {
    provider = requireSupabaseAuthConfig();
    principalKey = requireAccountPrincipalHmacKey();
  } catch {
    return preventAuthResponseCaching(
      NextResponse.json({ error: 'provider-unavailable' }, { status: 503 }),
    );
  }
  if (
    !isTrustedSiteRequest(request, provider.siteOrigin, {
      requireOriginHeader: true,
    })
  ) {
    return preventAuthResponseCaching(
      NextResponse.json({ error: 'invalid-origin' }, { status: 403 }),
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return preventAuthResponseCaching(
      NextResponse.json({ error: 'invalid-request' }, { status: 400 }),
    );
  }

  const next = safeDocumentReturnPath(
    typeof form.get('next') === 'string' ? String(form.get('next')) : null,
    provider.siteOrigin,
  );
  const email = typeof form.get('email') === 'string' ? String(form.get('email')).trim() : '';
  if (!next || !EMAIL_PATTERN.test(email) || email.length > 320) {
    return preventAuthResponseCaching(
      NextResponse.json({ error: 'invalid-request' }, { status: 400 }),
    );
  }

  const response = preventAuthResponseCaching(
    NextResponse.redirect(
      new URL(`/auth/check-email?next=${encodeURIComponent(next)}`, provider.siteOrigin),
      303,
    ),
  );
  const requestState = createAuthRequestState(next, provider.siteOrigin, principalKey);
  setAuthRequestCookie(response.cookies, requestState.cookieValue, provider.siteOrigin);

  try {
    const supabase = createRouteSupabaseClient(request, response);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: authCallbackUrl(next, provider.siteOrigin, requestState.state).toString(),
        shouldCreateUser: true,
      },
    });
    if (error) {
      const failed = signInRedirect(provider.siteOrigin, next, 'request-failed');
      clearAuthRequestCookie(failed.cookies, provider.siteOrigin);
      return failed;
    }
    return response;
  } catch {
    const failed = signInRedirect(provider.siteOrigin, next, 'provider-unavailable');
    clearAuthRequestCookie(failed.cookies, provider.siteOrigin);
    return failed;
  }
}
