'use client';

import type { PublicCommentAuthorizationV1, PublicCommentDtoV1 } from '@lash/types';
import React, { useEffect, useId, useRef, useState } from 'react';

import {
  readPublicAccessState,
  updatePublicAccessState,
} from '../../../lib/documentPublicAccess/browserClient';
import type {
  PublicAccessMode,
  PublicAccessStateV1,
} from '../../../lib/documentPublicAccess/types';
import {
  hidePublicComment,
  listPublicComments,
} from '../../../lib/publicDocumentComments/browserClient';

const OPTIONS: ReadonlyArray<{
  mode: PublicAccessMode;
  label: string;
  helper: string;
}> = [
  {
    mode: 'restricted',
    label: 'Restricted',
    helper: 'Only people invited can open this document.',
  },
  {
    mode: 'read',
    label: 'Anyone with the link · Can read',
    helper:
      'Anyone can read the document without signing in. Public comments, history, and editing stay unavailable.',
  },
  {
    mode: 'comment',
    label: 'Anyone with the link · Can comment',
    helper:
      'Anyone can read public comments. Sign-in is required to post. Editing stays unavailable.',
  },
];

export interface DocumentSettingsDialogProps {
  localDocumentId: string;
  onClose(): void;
  onUpdated(state: PublicAccessStateV1): void;
  open: boolean;
  ownerBacked: boolean;
  returnFocusTo: HTMLElement | null;
  signInHref: string;
}

type Phase = 'local' | 'loading' | 'ready' | 'saving' | 'error' | 'access-changed';

type ModerationState =
  | Readonly<{ phase: 'idle' | 'loading' }>
  | Readonly<{
      phase: 'ready';
      authorization: PublicCommentAuthorizationV1;
      comments: readonly PublicCommentDtoV1[];
    }>
  | Readonly<{ phase: 'error' }>;

const selectedPublicMode = (state: PublicAccessStateV1) =>
  state.publicProjectionBlocked ? 'restricted' : state.mode;

const publicRoomIdFromUrl = (publicUrl: string | null): string | null => {
  if (!publicUrl) return null;
  try {
    const url = new URL(publicUrl);
    const match = url.pathname.match(/^\/public\/(doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64})$/u);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
};

export function DocumentSettingsDialog({
  localDocumentId,
  onClose,
  onUpdated,
  open,
  ownerBacked,
  returnFocusTo,
  signInHref,
}: DocumentSettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const selectedRadioRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<Phase>(ownerBacked ? 'loading' : 'local');
  const [authoritative, setAuthoritative] = useState<PublicAccessStateV1 | null>(null);
  const [selected, setSelected] = useState<PublicAccessMode>('restricted');
  const [moderation, setModeration] = useState<ModerationState>({ phase: 'idle' });
  const [moderatingCommentId, setModeratingCommentId] = useState<string | null>(null);
  const [moderationStatus, setModerationStatus] = useState('');
  const groupId = useId();
  const pending = phase === 'saving';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!ownerBacked) {
      setPhase('local');
      setAuthoritative(null);
      setSelected('restricted');
      return;
    }
    const abort = new AbortController();
    setPhase('loading');
    setAuthoritative(null);
    void readPublicAccessState({
      localDocumentId,
      expectedOrigin: window.location.origin,
      signal: abort.signal,
    }).then((result) => {
      if (abort.signal.aborted) return;
      if (result.ok) {
        setAuthoritative(result.state);
        setSelected(selectedPublicMode(result.state));
        setPhase('ready');
        return;
      }
      if (result.error === 'unauthenticated') {
        setPhase('access-changed');
        return;
      }
      setPhase('error');
    });
    return () => abort.abort();
  }, [localDocumentId, open, ownerBacked]);

  useEffect(() => {
    const roomId =
      phase === 'ready' && authoritative?.mode === 'comment'
        ? publicRoomIdFromUrl(authoritative.publicUrl)
        : null;
    if (!open || !roomId || !authoritative) {
      setModeration({ phase: 'idle' });
      setModerationStatus('');
      return;
    }
    const abort = new AbortController();
    setModeration({ phase: 'loading' });
    void listPublicComments({
      roomId,
      expectedPolicyVersion: authoritative.policyVersion,
      expectedCutoffGeneration: authoritative.cutoffGeneration,
      beforeSequence: null,
      signal: abort.signal,
    }).then((result) => {
      if (abort.signal.aborted) return;
      if (result.ok) {
        setModeration({
          phase: 'ready',
          authorization: result.authorization,
          comments: result.comments,
        });
      } else {
        setModeration({ phase: 'error' });
      }
    });
    return () => abort.abort();
  }, [authoritative, open, phase]);

  useEffect(() => {
    if (!open || phase !== 'ready') return;
    const frame = window.requestAnimationFrame(() =>
      selectedRadioRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [open, phase]);

  if (!open) return null;

  const close = () => {
    if (pending) return;
    onClose();
    window.requestAnimationFrame(() => returnFocusTo?.focus({ preventScroll: true }));
  };

  const save = async () => {
    if (
      !authoritative ||
      selected === authoritative.mode ||
      pending ||
      (authoritative.publicProjectionBlocked && selected !== 'restricted')
    )
      return;
    setPhase('saving');
    const result = await updatePublicAccessState({
      localDocumentId,
      mode: selected,
      expectedPolicyVersion: authoritative.policyVersion,
      mutationId: window.crypto.randomUUID(),
      expectedOrigin: window.location.origin,
    });
    if (result.ok) {
      setAuthoritative(result.state);
      setSelected(selectedPublicMode(result.state));
      onUpdated(result.state);
      onClose();
      window.requestAnimationFrame(() => returnFocusTo?.focus({ preventScroll: true }));
      return;
    }
    if (result.state) {
      setAuthoritative(result.state);
      setSelected(selectedPublicMode(result.state));
    } else {
      const refreshed = await readPublicAccessState({
        localDocumentId,
        expectedOrigin: window.location.origin,
      });
      if (refreshed.ok) {
        setAuthoritative(refreshed.state);
        setSelected(selectedPublicMode(refreshed.state));
      }
    }
    if (result.error === 'public-projection-blocked') {
      setPhase('ready');
      return;
    }
    setPhase(result.error === 'unauthenticated' ? 'access-changed' : 'error');
  };

  const removePublicComment = async (commentId: string) => {
    if (moderation.phase !== 'ready' || moderatingCommentId) return;
    setModeratingCommentId(commentId);
    setModerationStatus('');
    const result = await hidePublicComment({
      localDocumentId,
      commentId,
      mutationId: window.crypto.randomUUID(),
      expectedPolicyVersion: moderation.authorization.policyVersion,
      expectedCutoffGeneration: moderation.authorization.cutoffGeneration,
    });
    setModeratingCommentId(null);
    if (result.ok) {
      setModeration((current) =>
        current.phase === 'ready'
          ? {
              phase: 'ready',
              authorization: {
                ...current.authorization,
                policyVersion: result.policyVersion,
                cutoffGeneration: result.cutoffGeneration,
              },
              comments: current.comments.filter((comment) => comment.id !== commentId),
            }
          : current,
      );
      setModerationStatus('Comment removed.');
    } else {
      setModerationStatus(
        result.error === 'moderation-conflict'
          ? 'This comment already changed. Reopen settings to refresh.'
          : 'Couldn’t remove this comment. Try again.',
      );
    }
  };

  return (
    <dialog
      aria-labelledby={`${groupId}-title`}
      aria-modal="true"
      className="lash-document-settings-dialog"
      data-phase={phase}
      data-testid="document-settings-dialog"
      id="lash-document-settings-dialog"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      ref={dialogRef}
    >
      <div className="lash-document-settings-sheet">
        <header className="lash-document-settings-header">
          <h2 id={`${groupId}-title`}>Document settings</h2>
          <button
            aria-label="Close document settings"
            className="lash-document-settings-close"
            disabled={pending}
            onClick={close}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="lash-document-settings-body">
          <section aria-labelledby={`${groupId}-public-title`}>
            <h3 id={`${groupId}-public-title`}>Public access</h3>
            <p className="lash-document-settings-helper">
              Choose what anyone with this link can do. Public links aren&apos;t listed or
              searchable.
            </p>

            {phase === 'local' ? (
              <div className="lash-document-settings-local">
                <p>This document is only on this device.</p>
                <a className="lash-document-settings-primary" href={signInHref}>
                  Sign in to publish
                </a>
              </div>
            ) : phase === 'loading' ? (
              <p role="status">Loading public access…</p>
            ) : phase === 'access-changed' ? (
              <p role="alert">Your access changed. Sign in again to manage this document.</p>
            ) : (
              <fieldset
                aria-describedby={`${groupId}-public-helper`}
                className="lash-public-access-options"
                disabled={pending}
              >
                <legend className="sr-only">Public access</legend>
                <span className="sr-only" id={`${groupId}-public-helper`}>
                  Choose one public access level.
                </span>
                {OPTIONS.map((option) => (
                  <label className="lash-public-access-option" key={option.mode}>
                    <input
                      checked={selected === option.mode}
                      disabled={
                        authoritative?.publicProjectionBlocked && option.mode !== 'restricted'
                      }
                      name={`${groupId}-public-access`}
                      onChange={() => setSelected(option.mode)}
                      ref={selected === option.mode ? selectedRadioRef : undefined}
                      type="radio"
                      value={option.mode}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.helper}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {authoritative?.publicProjectionBlocked ? (
              <p className="lash-document-settings-warning" role="status">
                This document contains private references or metadata, so public links are
                unavailable. People you&apos;ve invited still have access.
              </p>
            ) : null}

            {authoritative &&
            !authoritative.publicProjectionBlocked &&
            selected === 'comment' &&
            authoritative.mode !== 'comment' &&
            phase !== 'loading' ? (
              <p className="lash-document-settings-warning" role="note">
                Any previously posted public comments will be visible again.
              </p>
            ) : null}

            {phase === 'error' ? (
              <p className="lash-document-settings-error" role="alert">
                Couldn&apos;t update public access. Nothing changed. Try again.
              </p>
            ) : null}
          </section>

          {phase === 'ready' &&
          authoritative?.mode === 'comment' &&
          !authoritative.publicProjectionBlocked ? (
            <section
              aria-labelledby={`${groupId}-comments-title`}
              className="lash-public-comment-moderation"
            >
              <h3 id={`${groupId}-comments-title`}>Manage public comments</h3>
              <p className="lash-document-settings-helper">
                Remove comments that should no longer appear on the public document.
              </p>
              {moderation.phase === 'loading' ? <p role="status">Loading comments…</p> : null}
              {moderation.phase === 'error' ? (
                <p className="lash-document-settings-error" role="status">
                  Couldn&apos;t load public comments.
                </p>
              ) : null}
              {moderation.phase === 'ready' && moderation.comments.length === 0 ? (
                <p className="lash-document-settings-helper">No public comments to manage.</p>
              ) : null}
              {moderation.phase === 'ready' && moderation.comments.length > 0 ? (
                <ul className="lash-public-comment-moderation-list">
                  {moderation.comments.map((comment) => (
                    <li key={comment.id}>
                      <div>
                        <strong>{comment.author.label}</strong>
                        <p>{comment.body}</p>
                      </div>
                      <button
                        className="lash-document-settings-secondary"
                        disabled={moderatingCommentId !== null}
                        onClick={() => void removePublicComment(comment.id)}
                        type="button"
                      >
                        {moderatingCommentId === comment.id ? 'Removing…' : 'Remove'}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {moderationStatus ? (
                <p aria-live="polite" className="lash-document-settings-helper" role="status">
                  {moderationStatus}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <footer className="lash-document-settings-footer">
          {phase === 'local' || phase === 'access-changed' ? (
            <button className="lash-document-settings-secondary" onClick={close} type="button">
              Done
            </button>
          ) : (
            <>
              <button
                className="lash-document-settings-secondary"
                disabled={pending}
                onClick={close}
                type="button"
              >
                Cancel
              </button>
              <button
                className="lash-document-settings-primary"
                disabled={
                  pending ||
                  phase === 'loading' ||
                  !authoritative ||
                  selected === authoritative.mode ||
                  (authoritative.publicProjectionBlocked === true && selected !== 'restricted')
                }
                onClick={() => void save()}
                type="button"
              >
                {pending ? 'Saving…' : 'Save settings'}
              </button>
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}
