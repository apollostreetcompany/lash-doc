import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { loadSupabaseAuthConfig, requireAccountPrincipalHmacKey } from './config';
import {
  resolveAccountPrincipal,
  type AccountPrincipal,
  type AccountPrincipalResolution,
} from './principal';

export type ServerAccountPrincipalResolution =
  | AccountPrincipalResolution
  | { status: 'unavailable'; principal: null };

export async function resolveServerAccountPrincipal(
  client: Pick<SupabaseClient, 'auth'>,
): Promise<ServerAccountPrincipalResolution> {
  const provider = loadSupabaseAuthConfig();
  if (provider.status !== 'configured') {
    return { status: 'unavailable', principal: null };
  }

  return resolveAccountPrincipal({
    issuer: provider.config.issuer,
    principalKey: requireAccountPrincipalHmacKey(),
    getUser: () => client.auth.getUser(),
  });
}

export class VerifiedAccountRequiredError extends Error {
  readonly code:
    | 'auth-provider-unavailable'
    | 'account-session-invalid'
    | 'verified-account-required';

  constructor(
    code: 'auth-provider-unavailable' | 'account-session-invalid' | 'verified-account-required',
  ) {
    super(code);
    this.name = 'VerifiedAccountRequiredError';
    this.code = code;
  }
}

export async function requireServerAccountPrincipal(
  client: Pick<SupabaseClient, 'auth'>,
): Promise<AccountPrincipal> {
  const resolution = await resolveServerAccountPrincipal(client);
  if (resolution.status === 'authenticated') {
    return resolution.principal;
  }
  if (resolution.status === 'unavailable') {
    throw new VerifiedAccountRequiredError('auth-provider-unavailable');
  }
  if (resolution.status === 'invalid') {
    throw new VerifiedAccountRequiredError('account-session-invalid');
  }
  throw new VerifiedAccountRequiredError('verified-account-required');
}
