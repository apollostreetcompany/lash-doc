'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import styles from './namedEditInvites.module.css';
import { requestNamedEditOwner } from '../../../lib/namedEdit/browserClient';
import {
  isNamedInviteRole,
  type NamedEditInvite,
  type NamedInviteRole,
} from '../../../lib/namedEdit/contract';

const statusLabel = {
  pending: 'Invite pending',
  accepted: 'Access granted',
  revoked: 'Revoked',
  expired: 'Expired',
};

const roleLabel = { edit: 'Can edit', comment: 'Can comment' } as const;

const issueError = {
  invalid: 'Enter a valid email address.',
  conflict:
    'An active invite already exists for this email, or this document has reached its invite limit.',
  retry: 'Couldn’t create the invite link. Try again.',
  unavailable: 'Couldn’t create the invite link. Try again.',
  'named-comment-disabled': 'Can comment invitations aren’t available in this workspace.',
  'comment-projection-unavailable':
    'This document can’t be opened with comment-only access right now.',
};

export function NamedEditInvites({ roomId }: { roomId: string }) {
  const [invites, setInvites] = useState<NamedEditInvite[] | null>(null);
  const [listState, setListState] = useState<'loading' | 'ready' | 'retry' | 'unavailable'>(
    'loading',
  );
  const [listAttempt, retryList] = useState(0);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<NamedInviteRole>('edit');
  const [commentInvitesEnabled, setCommentInvitesEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<{ invite: NamedEditInvite; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const lifecycle = useRef<AbortController | null>(null);
  const issueAttempt = useRef<{ email: string; inviteId: string; role: NamedInviteRole } | null>(
    null,
  );
  const mutationInProgress = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    setListState('loading');
    void requestNamedEditOwner(roomId, 'list', {}, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok && 'invites' in result) {
        setInvites(result.invites);
        setCommentInvitesEnabled(result.commentInvitesEnabled === true);
        if (!result.commentInvitesEnabled) setRole('edit');
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
    if (issueAttempt.current?.email !== recipient || issueAttempt.current.role !== role) {
      issueAttempt.current = { email: recipient, inviteId: crypto.randomUUID(), role };
    }
    mutationInProgress.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const { inviteId } = issueAttempt.current;
    const result = await requestNamedEditOwner(
      roomId,
      'issue',
      { email: recipient, inviteId, ...(role === 'comment' ? { role } : {}) },
      signal,
    );
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
      setRole('edit');
      issueAttempt.current = null;
      setMessage('Invite link created.');
    } else if (!result.ok) {
      setError(issueError[result.reason]);
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
      { inviteId: invite.inviteId, ...(invite.role === 'comment' ? { role: invite.role } : {}) },
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
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                Email address
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
              </label>
              {commentInvitesEnabled ? (
                <label className={styles.field}>
                  Access level
                  <select
                    disabled={busy}
                    onChange={(event) => {
                      const selected = event.target.value;
                      if (isNamedInviteRole(selected)) setRole(selected);
                    }}
                    value={role}
                  >
                    <option value="edit">{roleLabel.edit}</option>
                    <option value="comment">{roleLabel.comment}</option>
                  </select>
                </label>
              ) : (
                <span className={styles.role}>{roleLabel.edit}</span>
              )}
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
                    <span className={styles.details}>
                      {roleLabel[invite.role]} · {statusLabel[invite.status]}
                    </span>
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
