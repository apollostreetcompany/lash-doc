import * as React from 'react';

import styles from './account-auth.module.css';

export interface EmailSignInFormProps {
  next: string;
}

export function EmailSignInForm({ next }: EmailSignInFormProps) {
  return (
    <form action="/api/auth/email" className={styles.form} method="post">
      <input name="next" type="hidden" value={next} />
      <label className={styles.label} htmlFor="lash-account-email">
        Email address
      </label>
      <input
        autoComplete="email"
        autoFocus
        className={styles.input}
        id="lash-account-email"
        inputMode="email"
        maxLength={320}
        name="email"
        placeholder="you@example.com"
        required
        type="email"
      />
      <button className={styles.primaryAction} type="submit">
        Email me a sign-in link
      </button>
    </form>
  );
}
