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

type InviteList =
  | { phase: 'loading' | 'retry' | 'unavailable' }
  | { phase: 'ready'; invites: NamedEditInvite[]; commentInvitesEnabled: boolean };
type InviteAction =
  | { phase: 'idle' | 'issuing' | 'revoking' }
  | { phase: 'done' | 'failed'; message: string };
type IssuedInvite = { invite: NamedEditInvite; url: string };

function InviteDelivery({ issued }: { issued: IssuedInvite }) {
  const [copyPhase, setCopyPhase] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    setCopyPhase('copying');
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopyPhase('copied');
    } catch {
      setCopyPhase('failed');
    }
  };
  return (
    <div className={styles.delivery}>
      <p>Send this link to {issued.invite.email}. They’ll sign in with this email.</p>
      <button disabled={copyPhase === 'copying'} type="button" onClick={() => void copy()}>
        {copyPhase === 'copied'
          ? 'Invite link copied'
          : copyPhase === 'copying'
            ? 'Copying invite link…'
            : 'Copy invite link'}
      </button>
      <span className="sr-only" role="status">
        {copyPhase === 'copied' ? 'Invite link copied.' : ''}
      </span>
      {copyPhase === 'failed' ? (
        <p role="alert">Couldn’t copy the invite link. Try again.</p>
      ) : null}
    </div>
  );
}

export function NamedEditInvites({ roomId }: { roomId: string }) {
  const [list, setList] = useState<InviteList>({ phase: 'loading' });
  const [listAttempt, retryList] = useState(0);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<NamedInviteRole>('edit');
  const [action, setAction] = useState<InviteAction>({ phase: 'idle' });
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const lifecycle = useRef<AbortController | null>(null);
  const issueAttempt = useRef<{ email: string; inviteId: string; role: NamedInviteRole } | null>(
    null,
  );
  const pendingMutation = useRef<AbortSignal | null>(null);
  const busy = action.phase === 'issuing' || action.phase === 'revoking';

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    setList({ phase: 'loading' });
    setAction({ phase: 'idle' });
    void requestNamedEditOwner(roomId, 'list', {}, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok && 'invites' in result) {
        setList({
          phase: 'ready',
          invites: result.invites,
          commentInvitesEnabled: result.commentInvitesEnabled === true,
        });
        if (!result.commentInvitesEnabled) setRole('edit');
      } else {
        setList({ phase: !result.ok && result.reason === 'unavailable' ? 'unavailable' : 'retry' });
      }
    });
    return () => controller.abort();
  }, [roomId, listAttempt]);

  const updateInvite = (invite: NamedEditInvite) => {
    setList((current) =>
      current.phase === 'ready'
        ? {
            ...current,
            invites: [
              invite,
              ...current.invites.filter((item) => item.inviteId !== invite.inviteId),
            ],
          }
        : current,
    );
  };

  const beginMutation = (phase: 'issuing' | 'revoking') => {
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted || pendingMutation.current === signal || list.phase !== 'ready')
      return null;
    pendingMutation.current = signal;
    setAction({ phase });
    return signal;
  };

  const endMutation = (signal: AbortSignal) => {
    if (pendingMutation.current === signal) pendingMutation.current = null;
    return !signal.aborted;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const recipient = email.trim();
    if (!recipient) return;
    const signal = beginMutation('issuing');
    if (!signal) return;
    if (issueAttempt.current?.email !== recipient || issueAttempt.current.role !== role) {
      issueAttempt.current = { email: recipient, inviteId: crypto.randomUUID(), role };
    }
    const { inviteId } = issueAttempt.current;
    const result = await requestNamedEditOwner(
      roomId,
      'issue',
      { email: recipient, inviteId, ...(role === 'comment' ? { role } : {}) },
      signal,
    );
    if (!endMutation(signal)) return;
    if (result.ok && 'invite' in result && result.token) {
      const url = new URL(`/join/${roomId}`, window.location.origin);
      url.hash = `invite=${result.token}`;
      setIssued({ invite: result.invite, url: url.href });
      updateInvite(result.invite);
      setEmail('');
      setRole('edit');
      issueAttempt.current = null;
      setAction({ phase: 'done', message: 'Invite link created.' });
    } else {
      setAction({ phase: 'failed', message: issueError[result.ok ? 'retry' : result.reason] });
    }
  };

  const revoke = async (invite: NamedEditInvite) => {
    const signal = beginMutation('revoking');
    if (!signal) return;
    const result = await requestNamedEditOwner(
      roomId,
      'revoke',
      { inviteId: invite.inviteId, ...(invite.role === 'comment' ? { role: invite.role } : {}) },
      signal,
    );
    if (!endMutation(signal)) return;
    if (result.ok && 'invite' in result) {
      updateInvite(result.invite);
      setIssued((current) =>
        current?.invite.inviteId === result.invite.inviteId ? null : current,
      );
      setAction({ phase: 'done', message: `Access revoked for ${result.invite.email}.` });
    } else {
      setAction({ phase: 'failed', message: 'Couldn’t revoke access. Try again.' });
    }
  };

  if (list.phase === 'unavailable') return null;

  return (
    <section className={styles.section} aria-labelledby="lash-share-people-title">
      <h3 id="lash-share-people-title">People with access</h3>
      {list.phase === 'loading' ? <p role="status">Checking access…</p> : null}
      {list.phase === 'retry' ? (
        <p>
          Couldn’t check access.{' '}
          <button type="button" onClick={() => retryList((attempt) => attempt + 1)}>
            Try again
          </button>
        </p>
      ) : null}
      {list.phase === 'ready' ? (
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
              {list.commentInvitesEnabled ? (
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
          {issued ? <InviteDelivery key={issued.invite.inviteId} issued={issued} /> : null}
          {list.invites.length ? (
            <ul className={styles.list} aria-label="Named access">
              {list.invites.map((invite) => (
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
      {action.phase === 'done' ? <p role="status">{action.message}</p> : null}
      {action.phase === 'failed' ? <p role="alert">{action.message}</p> : null}
    </section>
  );
}
