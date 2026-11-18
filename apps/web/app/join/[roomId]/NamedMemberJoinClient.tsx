'use client';

import type { Route } from 'next';
import Link from 'next/link';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import styles from '../../../components/account/account-auth.module.css';
import {
  hasKeys,
  isObject,
  NAMED_EDIT_TOKEN,
  namedEditPath,
} from '../../../lib/namedEdit/contract';

type Acceptance = 'accepted' | 'sign-in-required' | 'unavailable' | 'retry';
type Invitation =
  | { status: 'ready'; token: string | null }
  | { status: 'unavailable' }
  | { status: 'retry' };

export type NamedMemberJoinDependencies = Readonly<{
  accept(roomId: string, token: string | null, signal: AbortSignal): Promise<Acceptance>;
  openDocument(path: string): void;
}>;

const inviteFragmentPrefix = '#invite=';

function captureInvitation(joinPath: string | null): Invitation {
  const url = new URL(window.location.href);
  const value = url.hash.startsWith(inviteFragmentPrefix)
    ? url.hash.slice(inviteFragmentPrefix.length)
    : null;
  const token = value && NAMED_EDIT_TOKEN.exec(value)?.[0] === value ? value : null;
  const hasFragment = url.href.includes('#');

  if (hasFragment) {
    url.hash = '';
    try {
      window.history.replaceState(window.history.state, '', url.href);
      if (window.location.href !== url.href) return { status: 'retry' };
    } catch {
      return { status: 'retry' };
    }
  }

  if (!joinPath || url.href !== `${url.origin}${joinPath}` || (hasFragment && !token)) {
    return { status: 'unavailable' };
  }
  return { status: 'ready', token };
}

async function acceptInvitation(
  roomId: string,
  token: string | null,
  signal: AbortSignal,
): Promise<Acceptance> {
  const response = await fetch(namedEditPath(roomId, 'session'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, token, accept: true }),
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'origin',
    signal,
  });
  if (response.status === 429 || response.status === 503) return 'retry';
  if (response.status !== 200 && response.status !== 401) return 'unavailable';

  const body = (await response.json()) as unknown;
  if (!isObject(body)) return 'unavailable';
  if (
    response.status === 401 &&
    hasKeys(body, ['ok', 'version', 'error']) &&
    body.ok === false &&
    body.version === 1 &&
    body.error === 'sign-in-required'
  ) {
    return 'sign-in-required';
  }
  if (
    response.status === 200 &&
    hasKeys(body, ['ok', 'version']) &&
    body.ok === true &&
    body.version === 1
  ) {
    return 'accepted';
  }
  return 'unavailable';
}

const defaultDependencies: NamedMemberJoinDependencies = {
  accept: acceptInvitation,
  openDocument: (path) => window.location.replace(path),
};

export function NamedMemberJoinClient({
  roomId,
  dependencies = defaultDependencies,
}: Readonly<{ roomId: string | null; dependencies?: NamedMemberJoinDependencies }>) {
  const joinPath = roomId ? `/join/${roomId}` : null;
  const [phase, setPhase] = useState<Acceptance | 'opening'>(roomId ? 'opening' : 'unavailable');
  const [attempt, setAttempt] = useState(0);
  const invitation = useRef<Exclude<Invitation, { status: 'retry' }> | null>(null);

  useEffect(() => {
    if (!joinPath) return;
    const handleNewLink = () => {
      invitation.current = null;
      setPhase('opening');
      setAttempt((count) => count + 1);
    };
    window.addEventListener('hashchange', handleNewLink);
    return () => window.removeEventListener('hashchange', handleNewLink);
  }, [joinPath]);

  useEffect(() => {
    const captured = invitation.current ?? captureInvitation(joinPath);
    if (captured.status !== 'retry') invitation.current = captured;
    if (captured.status !== 'ready') {
      setPhase(captured.status);
      return;
    }
    if (!roomId) return;

    const controller = new AbortController();
    // React may mount effects twice in development. Give cleanup a chance to
    // cancel before a one-time invitation request reaches the server.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      void dependencies
        .accept(roomId, captured.token, controller.signal)
        .then((next) => {
          if (controller.signal.aborted) return;
          if (next !== 'retry') invitation.current = { status: 'ready', token: null };
          setPhase(next);
          if (next === 'accepted') dependencies.openDocument(`/doc/${roomId}`);
        })
        .catch(() => {
          if (!controller.signal.aborted) setPhase('retry');
        });
    });
    return () => controller.abort();
  }, [attempt, dependencies, joinPath, roomId]);

  return (
    <main className={styles.shell}>
      <section aria-labelledby="named-invitation-heading" className={styles.card}>
        <h1 className={styles.heading} id="named-invitation-heading">
          Document invitation
        </h1>
        {phase === 'opening' || phase === 'accepted' ? (
          <p className={styles.status} role="status">
            {phase === 'opening' ? 'Opening invitation…' : 'Opening document…'}
          </p>
        ) : null}
        {phase === 'sign-in-required' && joinPath ? (
          <>
            <p className={styles.description}>
              Sign in with the email address the invitation was sent to.
            </p>
            <Link
              className={styles.primaryAction}
              href={`/auth/sign-in?next=${encodeURIComponent(joinPath)}` as Route}
              prefetch={false}
            >
              Sign in to accept
            </Link>
          </>
        ) : null}
        {phase === 'unavailable' ? (
          <p className={styles.status} role="status">
            This invitation isn’t available. Check the link or ask the owner for a new invitation.
          </p>
        ) : null}
        {phase === 'retry' ? (
          <>
            <p className={styles.status} role="status">
              The invitation couldn’t be opened right now.
            </p>
            <button
              className={styles.secondaryAction}
              onClick={() => {
                setPhase('opening');
                setAttempt((count) => count + 1);
              }}
              type="button"
            >
              Try again
            </button>
          </>
        ) : null}
      </section>
    </main>
  );
}
