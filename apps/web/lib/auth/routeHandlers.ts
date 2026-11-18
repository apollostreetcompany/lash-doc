import { NextRequest, NextResponse } from 'next/server';

import { requireSupabaseAuthConfig } from './config';
import { isTrustedSiteRequest, preventAuthResponseCaching } from './http';
import { safeDocumentReturnPath } from './returnUrl';
import { createRouteSupabaseClientSession, type RouteSupabaseClientSession } from './serverClient';
import {
  resolveServerAccountPrincipal,
  type ServerAccountPrincipalResolution,
} from './serverPrincipal';

export interface AccountSessionRouteDependencies {
  createSession: (request: NextRequest) => RouteSupabaseClientSession;
  requireConfig: typeof requireSupabaseAuthConfig;
  resolvePrincipal: (
    client: RouteSupabaseClientSession['client'],
  ) => Promise<ServerAccountPrincipalResolution>;
}

const accountSessionDependencies: AccountSessionRouteDependencies = {
  createSession: createRouteSupabaseClientSession,
  requireConfig: requireSupabaseAuthConfig,
  resolvePrincipal: resolveServerAccountPrincipal,
};

export async function handleAccountSession(
  request: NextRequest,
  dependencies: AccountSessionRouteDependencies = accountSessionDependencies,
) {
  let provider;
  try {
    provider = dependencies.requireConfig();
  } catch {
    return preventAuthResponseCaching(
      NextResponse.json({ authenticated: false, status: 'unavailable' }, { status: 503 }),
    );
  }
  if (!isTrustedSiteRequest(request, provider.siteOrigin)) {
    return preventAuthResponseCaching(
      NextResponse.json({ authenticated: false, status: 'invalid-origin' }, { status: 400 }),
    );
  }

  let session: RouteSupabaseClientSession;
  try {
    session = dependencies.createSession(request);
  } catch {
    return preventAuthResponseCaching(
      NextResponse.json({ authenticated: false, status: 'invalid' }, { status: 401 }),
    );
  }

  const finalize = <Response extends NextResponse>(response: Response) =>
    preventAuthResponseCaching(session.applyTo(response));

  try {
    const resolution = await dependencies.resolvePrincipal(session.client);
    if (resolution.status !== 'authenticated') {
      return finalize(
        NextResponse.json({ authenticated: false, status: resolution.status }, { status: 401 }),
      );
    }
    const authenticated = new NextResponse(null, { status: 204 });
    authenticated.headers.set('x-lash-account-status', 'authenticated');
    authenticated.headers.set('x-lash-principal-id', resolution.principal.id);
    return finalize(authenticated);
  } catch {
    return finalize(
      NextResponse.json({ authenticated: false, status: 'invalid' }, { status: 401 }),
    );
  }
}

export interface SignOutRouteDependencies {
  createSession: (request: NextRequest) => RouteSupabaseClientSession;
  requireConfig: typeof requireSupabaseAuthConfig;
}

const signOutDependencies: SignOutRouteDependencies = {
  createSession: createRouteSupabaseClientSession,
  requireConfig: requireSupabaseAuthConfig,
};

export async function handleSignOut(
  request: NextRequest,
  dependencies: SignOutRouteDependencies = signOutDependencies,
) {
  let provider;
  try {
    provider = dependencies.requireConfig();
  } catch {
    return preventAuthResponseCaching(
      NextResponse.json({ error: 'auth-provider-unavailable' }, { status: 503 }),
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
  if (!next) {
    return preventAuthResponseCaching(
      NextResponse.json({ error: 'invalid-return' }, { status: 400 }),
    );
  }

  let session: RouteSupabaseClientSession;
  try {
    session = dependencies.createSession(request);
  } catch {
    return preventAuthResponseCaching(
      NextResponse.json({ error: 'auth-provider-unavailable' }, { status: 503 }),
    );
  }
  const finalize = <Response extends NextResponse>(response: Response) =>
    preventAuthResponseCaching(session.applyTo(response));

  try {
    const { error } = await session.client.auth.signOut({ scope: 'local' });
    if (error) {
      return finalize(NextResponse.json({ error: 'sign-out-failed' }, { status: 503 }));
    }
    return finalize(NextResponse.redirect(new URL(next, provider.siteOrigin), 303));
  } catch {
    return finalize(NextResponse.json({ error: 'auth-provider-unavailable' }, { status: 503 }));
  }
}
