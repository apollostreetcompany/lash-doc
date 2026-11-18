import { createHmac } from 'node:crypto';

export interface AccountPrincipal {
  kind: 'account';
  id: string;
  email: string;
  emailVerifiedAt: string;
}

export interface SupabaseProviderUser {
  id?: string | null;
  email?: string | null;
  email_confirmed_at?: string | null;
}

export interface SupabaseUserLookup {
  issuer: string;
  principalKey: string;
  getUser: () => Promise<{
    data: { user: SupabaseProviderUser | null };
    error: unknown | null;
  }>;
}

export type AccountPrincipalResolution =
  | { status: 'authenticated'; principal: AccountPrincipal }
  | {
      status: 'anonymous' | 'invalid' | 'unverified';
      principal: null;
    };

const canonicalIssuer = (value: string) => {
  const issuer = new URL(value);
  if (
    (issuer.protocol !== 'https:' &&
      !(
        issuer.protocol === 'http:' &&
        (issuer.hostname === 'localhost' ||
          issuer.hostname === '127.0.0.1' ||
          issuer.hostname === '[::1]')
      )) ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  ) {
    throw new TypeError('Account principal issuer is invalid.');
  }
  return issuer.toString().replace(/\/$/u, '');
};

const canonicalSubject = (subject: string) => {
  if (
    !subject ||
    subject !== subject.trim() ||
    subject !== subject.normalize('NFC') ||
    subject.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(subject)
  ) {
    throw new TypeError('Account principal subject is not canonical.');
  }
  return subject;
};

const requirePrincipalKey = (key: string) => {
  if (Buffer.byteLength(key, 'utf8') < 32) {
    throw new TypeError('Account principal HMAC key must contain at least 32 bytes.');
  }
  return key;
};

export function stableAccountPrincipalId(
  issuer: string,
  subject: string,
  principalKey: string,
): string {
  const canonical = canonicalIssuer(issuer);
  const exactSubject = canonicalSubject(subject);
  const digest = createHmac('sha256', requirePrincipalKey(principalKey))
    .update('lash-account-principal:v1\u0000', 'utf8')
    .update(canonical, 'utf8')
    .update('\u0000', 'utf8')
    .update(exactSubject, 'utf8')
    .digest('base64url');
  return `account:v1:${digest}`;
}

export function deriveAccountPrincipal(
  identity: {
    email: string;
    emailVerifiedAt: string;
    issuer: string;
    subject: string;
  },
  principalKey: string,
): AccountPrincipal {
  return {
    kind: 'account',
    id: stableAccountPrincipalId(identity.issuer, identity.subject, principalKey),
    email: identity.email,
    emailVerifiedAt: identity.emailVerifiedAt,
  };
}

export async function resolveAccountPrincipal({
  issuer,
  principalKey,
  getUser,
}: SupabaseUserLookup): Promise<AccountPrincipalResolution> {
  let result: Awaited<ReturnType<SupabaseUserLookup['getUser']>>;
  try {
    result = await getUser();
  } catch {
    return { status: 'invalid', principal: null };
  }

  if (result.error) {
    return { status: 'invalid', principal: null };
  }
  if (!result.data.user) {
    return { status: 'anonymous', principal: null };
  }

  const subject = result.data.user.id ?? '';
  const email = result.data.user.email?.trim() ?? '';
  const emailVerifiedAt = result.data.user.email_confirmed_at?.trim() ?? '';
  if (!subject || !email || !emailVerifiedAt) {
    return { status: 'unverified', principal: null };
  }
  const verifiedTimestamp = Date.parse(emailVerifiedAt);
  if (!Number.isFinite(verifiedTimestamp)) {
    return { status: 'unverified', principal: null };
  }

  const normalizedIssuer = canonicalIssuer(issuer);
  try {
    canonicalSubject(subject);
    requirePrincipalKey(principalKey);
  } catch {
    return { status: 'invalid', principal: null };
  }
  return {
    status: 'authenticated',
    principal: deriveAccountPrincipal(
      {
        issuer: normalizedIssuer,
        subject,
        email,
        emailVerifiedAt: new Date(verifiedTimestamp).toISOString(),
      },
      principalKey,
    ),
  };
}
