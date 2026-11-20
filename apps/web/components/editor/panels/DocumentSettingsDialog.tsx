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
  signInHref?: string;
}

type AccessSettings =
  | { phase: 'local' | 'loading' | 'load-error' | 'access-changed' }
  | {
      phase: 'ready' | 'saving' | 'save-unconfirmed';
      authoritative: PublicAccessStateV1;
      selected: PublicAccessMode;
    };

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

export function DocumentSettingsDialog({ open, ...props }: DocumentSettingsDialogProps) {
  if (!open) return null;
  return (
    <OpenDocumentSettingsDialog key={`${props.localDocumentId}:${props.ownerBacked}`} {...props} />
  );
}

function OpenDocumentSettingsDialog({
  localDocumentId,
  onClose,
  onUpdated,
  ownerBacked,
  returnFocusTo,
  signInHref,
}: Omit<DocumentSettingsDialogProps, 'open'>) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const selectedRadioRef = useRef<HTMLInputElement | null>(null);
  const [access, setAccess] = useState<AccessSettings>({
    phase: ownerBacked ? 'loading' : 'local',
  });
  const [loadAttempt, retryLoad] = useState(0);
  const [moderation, setModeration] = useState<ModerationState>({ phase: 'idle' });
  const [moderationAction, setModerationAction] = useState<
    | { phase: 'idle' }
    | { phase: 'removing'; commentId: string }
    | { phase: 'reported'; message: string }
  >({ phase: 'idle' });
  const scope = useRef<{ controller: AbortController; busy: boolean } | null>(null);
  const groupId = useId();
  const { phase } = access;
  const authoritative = 'authoritative' in access ? access.authoritative : null;
  const selected = 'selected' in access ? access.selected : 'restricted';
  const pending = phase === 'saving';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const controller = new AbortController();
    scope.current = { controller, busy: false };
    if (!dialog.open) dialog.showModal();
    return () => {
      controller.abort();
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    if (!ownerBacked) return;
    const abort = new AbortController();
    setAccess({ phase: 'loading' });
    void readPublicAccessState({
      localDocumentId,
      expectedOrigin: window.location.origin,
      signal: abort.signal,
    }).then((result) => {
      if (abort.signal.aborted) return;
      if (result.ok) {
        setAccess({
          phase: 'ready',
          authoritative: result.state,
          selected: selectedPublicMode(result.state),
        });
      } else {
        setAccess({ phase: result.error === 'unauthenticated' ? 'access-changed' : 'load-error' });
      }
    });
    return () => abort.abort();
  }, [loadAttempt, localDocumentId, ownerBacked]);

  useEffect(() => {
    const roomId =
      phase === 'ready' && authoritative?.mode === 'comment'
        ? publicRoomIdFromUrl(authoritative.publicUrl)
        : null;
    if (!roomId || !authoritative) {
      setModeration({ phase: 'idle' });
      setModerationAction({ phase: 'idle' });
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
  }, [authoritative, phase]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const frame = window.requestAnimationFrame(() =>
      selectedRadioRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  const close = () => {
    if (pending) return;
    onClose();
    window.requestAnimationFrame(() => returnFocusTo?.focus({ preventScroll: true }));
  };

  const save = async () => {
    const owner = scope.current;
    if (
      !owner ||
      owner.busy ||
      owner.controller.signal.aborted ||
      !authoritative ||
      selected === authoritative.mode ||
      pending ||
      (authoritative.publicProjectionBlocked && selected !== 'restricted')
    )
      return;
    owner.busy = true;
    const { signal } = owner.controller;
    setAccess({ phase: 'saving', authoritative, selected });
    const result = await updatePublicAccessState({
      localDocumentId,
      mode: selected,
      expectedPolicyVersion: authoritative.policyVersion,
      mutationId: window.crypto.randomUUID(),
      expectedOrigin: window.location.origin,
      signal,
    });
    if (signal.aborted) return;
    if (result.ok) {
      owner.busy = false;
      setAccess({
        phase: 'ready',
        authoritative: result.state,
        selected: selectedPublicMode(result.state),
      });
      onUpdated(result.state);
      onClose();
      window.requestAnimationFrame(() => returnFocusTo?.focus({ preventScroll: true }));
      return;
    }
    if (result.error === 'unauthenticated') {
      owner.busy = false;
      setAccess({ phase: 'access-changed' });
      return;
    }
    let current = result.state;
    if (!current) {
      const refreshed = await readPublicAccessState({
        localDocumentId,
        expectedOrigin: window.location.origin,
        signal,
      });
      if (signal.aborted) return;
      if (refreshed.ok) current = refreshed.state;
    }
    owner.busy = false;
    setAccess(
      current
        ? {
            phase: result.error === 'public-projection-blocked' ? 'ready' : 'save-unconfirmed',
            authoritative: current,
            selected: selectedPublicMode(current),
          }
        : { phase: 'load-error' },
    );
  };

  const removePublicComment = async (commentId: string) => {
    const owner = scope.current;
    if (!owner || owner.busy || owner.controller.signal.aborted || moderation.phase !== 'ready')
      return;
    owner.busy = true;
    const { signal } = owner.controller;
    setModerationAction({ phase: 'removing', commentId });
    const result = await hidePublicComment({
      localDocumentId,
      commentId,
      mutationId: window.crypto.randomUUID(),
      expectedPolicyVersion: moderation.authorization.policyVersion,
      expectedCutoffGeneration: moderation.authorization.cutoffGeneration,
      signal,
    });
    if (signal.aborted) return;
    owner.busy = false;
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
      setModerationAction({ phase: 'reported', message: 'Comment removed.' });
    } else {
      setModerationAction({
        phase: 'reported',
        message:
          result.error === 'moderation-conflict'
            ? 'This comment already changed. Reopen settings to refresh.'
            : 'Couldn’t remove this comment. Try again.',
      });
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
              {signInHref
                ? 'Choose what anyone with this link can do. Public links aren’t listed or searchable.'
                : 'Public links aren’t available in this preview.'}
            </p>

            {phase === 'local' ? (
              <div className="lash-document-settings-local">
                <p>This document is only on this device.</p>
                {signInHref ? (
                  <a className="lash-document-settings-primary" href={signInHref}>
                    Sign in to publish
                  </a>
                ) : null}
              </div>
            ) : phase === 'loading' ? (
              <p role="status">Loading public access…</p>
            ) : phase === 'access-changed' ? (
              <p role="alert">Your access changed. Sign in again to manage this document.</p>
            ) : phase === 'load-error' ? (
              <div>
                <p role="alert">Couldn’t verify public access.</p>
                <button
                  className="lash-document-settings-secondary"
                  type="button"
                  onClick={() => retryLoad((attempt) => attempt + 1)}
                >
                  Try again
                </button>
              </div>
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
                      onChange={() =>
                        setAccess((current) =>
                          'selected' in current && current.phase !== 'saving'
                            ? { ...current, selected: option.mode }
                            : current,
                        )
                      }
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

            {phase === 'save-unconfirmed' ? (
              <p className="lash-document-settings-error" role="alert">
                Couldn&apos;t confirm the requested change. Check the current setting and try again.
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
                        disabled={moderationAction.phase === 'removing'}
                        onClick={() => void removePublicComment(comment.id)}
                        type="button"
                      >
                        {moderationAction.phase === 'removing' &&
                        moderationAction.commentId === comment.id
                          ? 'Removing…'
                          : 'Remove'}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {moderationAction.phase === 'reported' ? (
                <p aria-live="polite" className="lash-document-settings-helper" role="status">
                  {moderationAction.message}
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
                  moderationAction.phase === 'removing' ||
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
