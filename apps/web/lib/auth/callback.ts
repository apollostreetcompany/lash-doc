import type { SupabaseClient } from '@supabase/supabase-js';

import type { SupabaseAuthConfig } from './config';
import { resolveAccountPrincipal } from './principal';
import { validateAuthRequestState } from './requestState';

export interface CompleteEmailSignInInput {
  authRequestCookie: string | null;
  next: string | null;
  now?: Date;
  siteOrigin: string;
  state: string | null;
  tokenHash: string | null;
  type: string | null;
}

export type EmailSignInCompletion =
  | { status: 'authenticated'; documentPath: string }
  | {
      status: 'invalid-link' | 'provider-rejected' | 'unverified-account';
      documentPath: string | null;
    };

export async function completeEmailSignIn(
  input: CompleteEmailSignInInput,
  client: Pick<SupabaseClient, 'auth'>,
  provider: Pick<SupabaseAuthConfig, 'issuer'> & { principalKey: string },
): Promise<EmailSignInCompletion> {
  const requestState = validateAuthRequestState({
    cookieValue: input.authRequestCookie,
    next: input.next,
    now: input.now,
    principalKey: provider.principalKey,
    siteOrigin: input.siteOrigin,
    state: input.state,
  });
  if (requestState.status !== 'valid' || !input.tokenHash || input.type !== 'email') {
    return { status: 'invalid-link', documentPath: null };
  }
  const documentPath = requestState.documentPath;

  const verification = await client.auth.verifyOtp({
    token_hash: input.tokenHash,
    type: 'email',
  });
  if (verification.error) {
    return { status: 'provider-rejected', documentPath };
  }

  const principal = await resolveAccountPrincipal({
    issuer: provider.issuer,
    principalKey: provider.principalKey,
    getUser: () => client.auth.getUser(),
  });
  if (principal.status !== 'authenticated') {
    return { status: 'unverified-account', documentPath };
  }

  return { status: 'authenticated', documentPath };
}
