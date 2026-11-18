import type { Route } from 'next';
import Link from 'next/link';
import * as React from 'react';

import styles from '../../../components/account/account-auth.module.css';
import { EmailSignInForm } from '../../../components/account/EmailSignInForm';
import { loadSupabaseAuthConfig } from '../../../lib/auth/config';
import {
  isNamedMemberJoinReturnPath,
  isPublicCommentReturnPath,
  safeDocumentReturnPath,
} from '../../../lib/auth/returnUrl';

interface SignInPageProps {
  searchParams: Promise<{
    error?: string | string[];
    next?: string | string[];
  }>;
}

const firstValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const signInCopy = (next: string | null) => {
  if (isNamedMemberJoinReturnPath(next)) {
    return {
      heading: 'Sign in to accept the invitation',
      description:
        'Use the email address the invitation was sent to. We’ll send a one-time sign-in link that returns you to the invitation.',
      unavailable: 'Account sign-in is not available right now.',
      returnLabel: 'Return to invitation',
    };
  }
  if (isPublicCommentReturnPath(next)) {
    return {
      heading: 'Sign in to comment',
      description:
        'We’ll send a one-time link to verify your email. After you sign in, you’ll return to this public document to comment.',
      unavailable:
        'Account sign-in is not available right now. You can still return to the public document.',
      returnLabel: 'Return to document',
    };
  }
  return {
    heading: 'Sign in to share this document',
    description:
      'We’ll send a one-time link to verify your email. Your account owns shared documents; signing in does not move local drafts by itself.',
    unavailable:
      'Account sign-in is not available on this build. Your local document is still available.',
    returnLabel: 'Return to document',
  };
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;
  const rawNext = firstValue(query.next);
  const next = safeDocumentReturnPath(rawNext, 'https://lash.invalid');
  const provider = loadSupabaseAuthConfig();
  const error = firstValue(query.error);
  const copy = signInCopy(next);

  return (
    <main className={styles.shell}>
      <section aria-labelledby="account-sign-in-title" className={styles.card}>
        <p className={styles.eyebrow}>Lash account</p>
        <h1 className={styles.heading} id="account-sign-in-title">
          {copy.heading}
        </h1>
        <p className={styles.description}>{copy.description}</p>

        {!next ? (
          <p className={styles.status} role="alert">
            This sign-in link does not point to a valid Lash document.
          </p>
        ) : provider.status !== 'configured' ? (
          <p className={styles.status} role="status">
            {copy.unavailable}
          </p>
        ) : (
          <>
            {error ? (
              <p className={styles.status} role="alert">
                The sign-in link could not be verified. Request a new link and try again.
              </p>
            ) : null}
            <EmailSignInForm next={next} />
          </>
        )}

        {next ? (
          <p>
            <Link className={styles.secondaryAction} href={next as Route}>
              {copy.returnLabel}
            </Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
