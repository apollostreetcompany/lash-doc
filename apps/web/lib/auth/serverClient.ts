import 'server-only';

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest, NextResponse } from 'next/server';

import { requireSupabaseAuthConfig } from './config';
import { createSupabaseCookieAdapter, createSupabaseResponseMutationSink } from './cookies';

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
