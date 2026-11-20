import 'server-only';

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest, NextResponse } from 'next/server';

import { requireSupabaseAuthConfig } from './config';
import { createSupabaseCookieAdapter, createSupabaseResponseMutationSink } from './cookies';
import type { AccountPrincipal } from './principal';
import { resolveServerAccountPrincipal } from './serverPrincipal';

export interface RouteSupabaseClientSession {
  client: SupabaseClient;
  applyTo: <Response extends NextResponse>(response: Response) => Response;
}

export function createRouteSupabaseClientSession(request: NextRequest): RouteSupabaseClientSession {
  const config = requireSupabaseAuthConfig();
  const mutations = createSupabaseResponseMutationSink({
    getAll: () => request.cookies.getAll(),
  });
  return {
    client: createServerClient(config.url, config.publishableKey, {
      cookies: mutations.adapter,
    }),
    applyTo: mutations.applyTo,
  };
}

type PassiveAccountResolution =
  | { status: 'authenticated'; principal: AccountPrincipal }
  | { status: 'anonymous' | 'refresh-required' | 'unavailable' };

export async function verifyPassiveRouteAccount(
  request: NextRequest,
): Promise<PassiveAccountResolution> {
  try {
    const config = requireSupabaseAuthConfig();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    const transport: { status: 'ready' | 'refresh-required' | 'unavailable' } = { status: 'ready' };
    const client = createServerClient(config.url, config.publishableKey, {
      cookies: { getAll: () => request.cookies.getAll(), setAll: () => undefined },
      global: {
        fetch: async (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
          if (method === 'POST' && url === `${config.issuer}/token?grant_type=refresh_token`) {
            // getUser may try to rotate the stored session before verifying it.
            transport.status = 'refresh-required';
            return Response.json({ message: 'Refresh required' }, { status: 401 });
          }
          if (method !== 'GET' || url !== `${config.issuer}/user`) {
            transport.status = 'unavailable';
            return Response.json({ message: 'Auth unavailable' }, { status: 503 });
          }
          try {
            const response = await fetch(input, {
              ...init,
              cache: 'no-store',
              credentials: 'omit',
              redirect: 'error',
              signal,
            });
            if (!response.ok && ![400, 401, 403].includes(response.status)) {
              transport.status = 'unavailable';
            }
            return response;
          } catch {
            transport.status = 'unavailable';
            return Response.json({ message: 'Auth unavailable' }, { status: 503 });
          }
        },
      },
    });
    const verified = await resolveServerAccountPrincipal(client);
    if (verified.status === 'authenticated') return verified;
    if (transport.status !== 'ready') return { status: transport.status };
    return { status: verified.status === 'unavailable' ? 'unavailable' : 'anonymous' };
  } catch {
    return { status: 'unavailable' };
  }
}

export function createRouteSupabaseClient(
  request: NextRequest,
  response: NextResponse,
): SupabaseClient {
  const config = requireSupabaseAuthConfig();
  return createServerClient(config.url, config.publishableKey, {
    cookies: createSupabaseCookieAdapter({
      getAll: () => request.cookies.getAll(),
      set: (name, value, options) => {
        response.cookies.set({ name, value, ...options });
      },
      setHeader: (name, value) => {
        response.headers.set(name, value);
      },
    }),
  });
}
