'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import styles from './namedEditInvites.module.css';
import { requestNamedEditOwner } from '../../../lib/namedEdit/browserClient';
import type { NamedEditInvite } from '../../../lib/namedEdit/contract';

const statusLabel = {
  pending: 'Invite pending',
  accepted: 'Access granted',
  revoked: 'Revoked',
  expired: 'Expired',
};

export function NamedEditInvites({ roomId }: { roomId: string }) {
  const [invites, setInvites] = useState<NamedEditInvite[] | null>(null);
  const [listState, setListState] = useState<'loading' | 'ready' | 'retry' | 'unavailable'>(
    'loading',
  );
  const [listAttempt, retryList] = useState(0);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<{ invite: NamedEditInvite; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const lifecycle = useRef<AbortController | null>(null);
  const issueAttempt = useRef<{ email: string; inviteId: string } | null>(null);
  const mutationInProgress = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    setListState('loading');
    void requestNamedEditOwner(roomId, 'list', {}, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok && 'invites' in result) {
        setInvites(result.invites);
        setListState('ready');
      } else {
        setListState(!result.ok && result.reason === 'unavailable' ? 'unavailable' : 'retry');
      }
    });
    return () => controller.abort();
  }, [roomId, listAttempt]);

  const updateInvite = (invite: NamedEditInvite) => {
    setInvites((current) => [
      invite,
      ...(current ?? []).filter((item) => item.inviteId !== invite.inviteId),
    ]);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutationInProgress.current || !lifecycle.current) return;
    const signal = lifecycle.current.signal;
    const recipient = email.trim();
    if (!recipient) return;
    if (issueAttempt.current?.email !== recipient) {
      issueAttempt.current = { email: recipient, inviteId: crypto.randomUUID() };
    }
    mutationInProgress.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const result = await requestNamedEditOwner(roomId, 'issue', issueAttempt.current, signal);
    mutationInProgress.current = false;
    if (signal.aborted) return;
    setBusy(false);
    if (result.ok && 'invite' in result && result.token) {
      const url = new URL(`/join/${roomId}`, window.location.origin);
      url.hash = `invite=${result.token}`;
      setIssued({ invite: result.invite, url: url.href });
      updateInvite(result.invite);
      setCopied(false);
      setEmail('');
      issueAttempt.current = null;
      setMessage('Invite link created.');
    } else if (!result.ok) {
      setError(
        result.reason === 'invalid'
          ? 'Enter a valid email address.'
          : result.reason === 'conflict'
            ? 'An active invite already exists for this email, or this document has reached its invite limit.'
            : 'Couldn’t create the invite link. Try again.',
      );
    }
  };

  const revoke = async (invite: NamedEditInvite) => {
    if (mutationInProgress.current || !lifecycle.current) return;
    const signal = lifecycle.current.signal;
    mutationInProgress.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const result = await requestNamedEditOwner(
      roomId,
      'revoke',
      { inviteId: invite.inviteId },
      signal,
    );
    mutationInProgress.current = false;
    if (signal.aborted) return;
    setBusy(false);
    if (result.ok && 'invite' in result) {
      updateInvite(result.invite);
      setIssued((current) =>
        current?.invite.inviteId === result.invite.inviteId ? null : current,
      );
      setMessage(`Access revoked for ${result.invite.email}.`);
    } else {
      setError('Couldn’t revoke access. Try again.');
    }
  };

  if (listState === 'unavailable') return null;

  return (
    <section className={styles.section} aria-labelledby="lash-share-people-title">
      <h3 id="lash-share-people-title">People with access</h3>
      {listState === 'loading' ? <p role="status">Checking access…</p> : null}
      {listState === 'retry' ? (
        <p>
          Couldn’t check access.{' '}
          <button type="button" onClick={() => retryList((attempt) => attempt + 1)}>
            Try again
          </button>
        </p>
      ) : null}
      {listState === 'ready' ? (
        <>
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <label htmlFor="lash-named-edit-email">Email address</label>
            <div className={styles.fieldRow}>
              <input
                autoComplete="email"
                disabled={busy}
                id="lash-named-edit-email"
                inputMode="email"
                maxLength={254}
                onChange={(event) => setEmail(event.target.value)}
                required
                type="text"
                value={email}
              />
              <span>Can edit</span>
            </div>
            <button disabled={busy} type="submit">
              Create invite link
            </button>
          </form>
          {issued ? (
            <div className={styles.delivery}>
              <p>Send this link to {issued.invite.email}. They’ll sign in with this email.</p>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(issued.url);
                    setCopied(true);
                    setError('');
                    setMessage('Invite link copied.');
                  } catch {
                    setError('Couldn’t copy the invite link. Try again.');
                  }
                }}
              >
                {copied ? 'Invite link copied' : 'Copy invite link'}
              </button>
            </div>
          ) : null}
          {invites?.length ? (
            <ul className={styles.list} aria-label="Named access">
              {invites.map((invite) => (
                <li className={styles.invite} key={invite.inviteId}>
                  <div>
                    <span className={styles.email}>{invite.email}</span>
                    <span className={styles.details}>Can edit · {statusLabel[invite.status]}</span>
                  </div>
                  {invite.status === 'pending' || invite.status === 'accepted' ? (
                    <button disabled={busy} type="button" onClick={() => void revoke(invite)}>
                      Revoke access
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>No collaborators yet.</p>
          )}
        </>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
