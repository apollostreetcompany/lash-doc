import type { Route } from 'next';
import Link from 'next/link';
import * as React from 'react';

import styles from '../../../components/account/account-auth.module.css';
import { isNamedMemberJoinReturnPath, safeDocumentReturnPath } from '../../../lib/auth/returnUrl';

interface CheckEmailPageProps {
  searchParams: Promise<{ next?: string | string[] }>;
}

export default async function CheckEmailPage({ searchParams }: CheckEmailPageProps) {
  const { next: requestedNext } = await searchParams;
  const rawNext = Array.isArray(requestedNext) ? requestedNext[0] : requestedNext;
  const next = safeDocumentReturnPath(rawNext, 'https://lash.invalid');
  const joining = isNamedMemberJoinReturnPath(next);

  return (
    <main className={styles.shell}>
      <section aria-labelledby="check-email-title" className={styles.card}>
        <p className={styles.eyebrow}>Check your email</p>
        <h1 className={styles.heading} id="check-email-title">
          Your sign-in link is on its way
        </h1>
        <p className={styles.description}>
          {joining
            ? 'Open the newest email from Lash in this browser. The sign-in link can be used once and returns you to the invitation.'
            : 'Open the newest email from Lash. The link can be used once and returns you to this document.'}
        </p>
        {next ? (
          <Link className={styles.secondaryAction} href={next as Route}>
            {joining ? 'Return to invitation' : 'Return to document'}
          </Link>
        ) : null}
      </section>
    </main>
  );
}
