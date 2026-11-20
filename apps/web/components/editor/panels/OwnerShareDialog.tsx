'use client';

import { useEffect, useRef, useState } from 'react';

import { NamedEditInvites } from './NamedEditInvites';
import type { PublicAccessStateV1 } from '../../../lib/documentPublicAccess/types';

export type OwnerShareDialogPhase =
  | 'checking-account'
  | 'signed-out'
  | 'ready'
  | 'saving'
  | 'device-draft'
  | 'account-copy-available'
  | 'checking-copy'
  | 'opening-copy'
  | 'creating-device-draft'
  | 'device-copy-ready'
  | 'retryable'
  | 'blocked'
  | 'unavailable'
  | 'saved';

const ACCOUNT_COPY_PRESENTATION: Partial<
  Record<OwnerShareDialogPhase, { detail: string; action: string }>
> = {
  'device-draft': {
    detail:
      'Your edits are still in this device draft. You can check the earlier account-save attempt.',
    action: 'Check account copy',
  },
  'account-copy-available': {
    detail: 'Your edits are still in this device draft. You can open the verified account copy.',
    action: 'Open account copy',
  },
  'checking-copy': {
    detail: 'Checking the earlier account-save attempt…',
    action: 'Checking account copy…',
  },
  'opening-copy': {
    detail: 'Saving the device draft and opening the account copy…',
    action: 'Opening account copy…',
  },
  'creating-device-draft': {
    detail: 'Saving a separate device draft…',
    action: 'Creating separate draft…',
  },
  'device-copy-ready': {
    detail: 'The separate draft is saved on this device.',
    action: 'Open separate draft',
  },
};

export interface OwnerShareDialogProps {
  adjuncts: Readonly<{ comments: number; suggestions: number }>;
  detail?: string;
  documentTitle: string;
  onClose(): void;
  onPrimary(): void;
  onCreateDeviceDraft?(): void;
  onManagePublicAccess?(): void;
  open: boolean;
  phase: OwnerShareDialogPhase;
  namedEditRoomId?: string;
  publicAccess?: PublicAccessStateV1 | null;
  signInHref: string;
}

export const ownerShareAccessSummary = (publicAccess: PublicAccessStateV1 | null | undefined) => {
  if (publicAccess?.publicProjectionBlocked) {
    return 'Private references or metadata prevent public sharing. People you’ve invited still have access.';
  }
  switch (publicAccess?.mode) {
    case 'read':
      return 'Anyone with the link can read this document.';
    case 'comment':
      return 'Anyone with the link can read. Sign-in is required to comment.';
    case 'restricted':
      return 'Only people you invite have access.';
    default:
      return 'Checking public access…';
  }
};

function PublicLinkCopy({ url }: { url: string }) {
  const [phase, setPhase] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    setPhase('copying');
    try {
      await navigator.clipboard.writeText(url);
      setPhase('copied');
    } catch {
      setPhase('failed');
    }
  };
  return (
    <>
      <button
        className="lash-owner-share-copy"
        disabled={phase === 'copying'}
        onClick={() => void copy()}
        type="button"
      >
        {phase === 'copying'
          ? 'Copying…'
          : phase === 'copied'
            ? 'Copied'
            : phase === 'failed'
              ? 'Try copy again'
              : 'Copy link'}
      </button>
      <span className="sr-only" aria-live="polite">
        {phase === 'copied'
          ? 'Link copied.'
          : phase === 'failed'
            ? 'Couldn’t copy the link. Try again.'
            : ''}
      </span>
    </>
  );
}

export function OwnerShareDialog({
  adjuncts,
  detail,
  documentTitle,
  onClose,
  onPrimary,
  onCreateDeviceDraft,
  onManagePublicAccess,
  open,
  phase,
  namedEditRoomId,
  publicAccess,
  signInHref,
}: OwnerShareDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const primaryLinkRef = useRef<HTMLAnchorElement | null>(null);
  const pending =
    phase === 'saving' ||
    phase === 'checking-copy' ||
    phase === 'opening-copy' ||
    phase === 'creating-device-draft';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    if (!dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => {
      (primaryLinkRef.current ?? primaryButtonRef.current)?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!open) return null;

  const accountCopy = ACCOUNT_COPY_PRESENTATION[phase];
  const summary = accountCopy
    ? detail || accountCopy.detail
    : phase === 'saved'
      ? ownerShareAccessSummary(publicAccess)
      : phase === 'blocked'
        ? `This document has ${adjuncts.comments} ${
            adjuncts.comments === 1 ? 'comment' : 'comments'
          } and ${adjuncts.suggestions} ${
            adjuncts.suggestions === 1 ? 'suggestion' : 'suggestions'
          }. Account saving for those items isn’t ready yet, so nothing was moved.`
        : phase === 'retryable'
          ? detail || 'Couldn’t save to your account. Your document is still on this device.'
          : phase === 'unavailable'
            ? detail ||
              'Account saving is unavailable right now. Your document is still on this device.'
            : phase === 'signed-out'
              ? 'Sign in to save this document to your account. Signing in does not move it by itself.'
              : phase === 'checking-account'
                ? detail || 'Checking account…'
                : 'This document is only on this device. Save it to your account before sharing.';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="lash-owner-share-title"
      aria-modal="true"
      className="lash-owner-share-dialog"
      data-phase={phase}
      data-testid="owner-share-dialog"
      id="lash-owner-share-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <div className="lash-owner-share-sheet">
        <header className="lash-owner-share-header">
          <div>
            <p className="lash-owner-share-eyebrow">Account ownership</p>
            <h2 id="lash-owner-share-title">Share “{documentTitle}”</h2>
          </div>
          <button
            aria-label="Close sharing"
            className="lash-owner-share-close"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="lash-owner-share-body">
          {phase === 'saved' ? <h3>Saved to your account</h3> : null}
          <p role={phase === 'blocked' || phase === 'unavailable' ? 'alert' : 'status'}>
            {summary}
          </p>
          {phase === 'saved' && namedEditRoomId ? (
            <NamedEditInvites key={namedEditRoomId} roomId={namedEditRoomId} />
          ) : null}
          {phase === 'saved' && onManagePublicAccess ? (
            <section className="lash-owner-share-public" aria-labelledby="lash-share-public-title">
              <div>
                <h3 id="lash-share-public-title">Public access</h3>
                <p>
                  {publicAccess?.publicProjectionBlocked
                    ? 'Public links unavailable'
                    : publicAccess?.mode === 'read'
                      ? 'Anyone with the link · Can read'
                      : publicAccess?.mode === 'comment'
                        ? 'Anyone with the link · Can comment'
                        : publicAccess?.mode === 'restricted'
                          ? 'Restricted'
                          : 'Checking public access…'}
                </p>
              </div>
              <button
                className="lash-owner-share-manage"
                onClick={onManagePublicAccess}
                type="button"
              >
                Manage in document settings
              </button>
              {publicAccess?.publicUrl && !publicAccess.publicProjectionBlocked ? (
                <PublicLinkCopy key={publicAccess.publicUrl} url={publicAccess.publicUrl} />
              ) : null}
            </section>
          ) : null}
          {phase === 'device-draft' && onCreateDeviceDraft ? (
            <div>
              <p>
                A separate draft copies the title and formatted document. Discussion, suggestions,
                and version history stay with the original draft.
              </p>
              <button
                className="lash-owner-share-manage"
                onClick={onCreateDeviceDraft}
                type="button"
              >
                Create separate device draft
              </button>
            </div>
          ) : null}
        </div>

        <footer className="lash-owner-share-footer">
          {phase === 'device-draft' ? (
            <a className="lash-owner-share-manage" href={signInHref}>
              Sign in to check
            </a>
          ) : null}
          {phase === 'signed-out' ? (
            <a ref={primaryLinkRef} className="lash-owner-share-primary" href={signInHref}>
              Sign in to continue
            </a>
          ) : phase === 'saved' || phase === 'blocked' || phase === 'unavailable' ? (
            <button
              ref={primaryButtonRef}
              className="lash-owner-share-primary"
              onClick={onClose}
              type="button"
            >
              Done
            </button>
          ) : (
            <button
              ref={primaryButtonRef}
              className="lash-owner-share-primary"
              disabled={phase === 'checking-account' || pending}
              onClick={onPrimary}
              type="button"
            >
              {accountCopy?.action ??
                (phase === 'saving'
                  ? 'Saving to your account…'
                  : phase === 'retryable'
                    ? 'Try again'
                    : 'Save to my account')}
            </button>
          )}
        </footer>
      </div>
    </dialog>
  );
}
