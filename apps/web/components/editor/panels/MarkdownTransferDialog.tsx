'use client';

import { useEffect, useId, useRef } from 'react';

import type {
  MarkdownDownloadPlan,
  MarkdownImportPlan,
} from '../../../lib/markdownDocumentTransfer';

export type MarkdownTransferDialogState =
  | Readonly<{ kind: 'reading' }>
  | Readonly<{ kind: 'download'; plan: MarkdownDownloadPlan }>
  | Readonly<{
      kind: 'import-error';
      detail: string;
    }>
  | Readonly<{
      kind: 'import';
      phase:
        | 'preview'
        | 'committing'
        | 'commit-failed'
        | 'cleanup-unverified'
        | 'created-opening'
        | 'created-open-failed';
      plan: MarkdownImportPlan;
      sourceReady: boolean;
      detail?: string;
    }>;

export interface MarkdownTransferDialogProps {
  state: MarkdownTransferDialogState | null;
  returnFocusTo: HTMLElement | null;
  onClose(): void;
  onConfirm(): void;
  onRetryOpen(): void;
}

const formatLabel = (plan: MarkdownImportPlan) =>
  plan.format === 'lash-v1' ? 'Lash Markdown v1' : 'Other Markdown';

export function MarkdownTransferDialog({
  state,
  returnFocusTo,
  onClose,
  onConfirm,
  onRetryOpen,
}: MarkdownTransferDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const pending =
    state?.kind === 'import' && (state.phase === 'committing' || state.phase === 'created-opening');
  const importConfirmDisabled =
    state?.kind === 'import' && (state.phase !== 'preview' || !state.sourceReady);
  const downloadBlocked = state?.kind === 'download' && state.plan.status === 'blocked';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !state) return;
    if (!dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => {
      if (!importConfirmDisabled && !downloadBlocked && !pending) {
        primaryRef.current?.focus({ preventScroll: true });
      } else {
        cancelRef.current?.focus({ preventScroll: true });
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (dialog.open) dialog.close();
    };
  }, [downloadBlocked, importConfirmDisabled, pending, state]);

  if (!state) return null;

  const close = () => {
    if (pending) return;
    onClose();
    window.requestAnimationFrame(() => returnFocusTo?.focus({ preventScroll: true }));
  };

  const title =
    state.kind === 'download'
      ? 'Download Markdown'
      : state.kind === 'reading'
        ? 'Import Markdown'
        : 'Import Markdown as new document';

  return (
    <dialog
      ref={dialogRef}
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="lash-markdown-transfer-dialog"
      data-testid="markdown-transfer-dialog"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="lash-markdown-transfer-sheet">
        <header className="lash-markdown-transfer-header">
          <h2 id={titleId}>{title}</h2>
        </header>

        <div className="lash-markdown-transfer-body">
          {state.kind === 'reading' ? (
            <p id={descriptionId} role="status" aria-live="polite">
              Reading Markdown…
            </p>
          ) : state.kind === 'download' ? (
            <>
              <p id={descriptionId}>
                Markdown includes the document title and supported body formatting. Comments,
                suggestions, version history, authorship, chat, collaborators, and access details
                are not included. Your Lash document will not change.
              </p>
              {state.plan.warnings.length ? (
                <section aria-labelledby={`${titleId}-warnings`}>
                  <h3 id={`${titleId}-warnings`}>Some formatting will be simplified:</h3>
                  <ul>
                    {state.plan.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {state.plan.status === 'blocked' ? (
                <div className="lash-markdown-transfer-error" role="alert">
                  <strong>Markdown can’t preserve this document safely.</strong>
                  <ul>
                    {state.plan.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : state.kind === 'import-error' ? (
            <div id={descriptionId} className="lash-markdown-transfer-error" role="alert">
              {state.detail}
            </div>
          ) : (
            <>
              <p id={descriptionId}>
                A new local document will be created. Your current document, comments, suggestions,
                and version history will not change.
              </p>
              <dl className="lash-markdown-transfer-summary">
                <div>
                  <dt>Title</dt>
                  <dd>{state.plan.title}</dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>{formatLabel(state.plan)}</dd>
                </div>
              </dl>
              {state.plan.warnings.length ? (
                <section aria-labelledby={`${titleId}-warnings`}>
                  <h3 id={`${titleId}-warnings`}>Review these changes before importing:</h3>
                  <ul>
                    {state.plan.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {!state.sourceReady && state.phase === 'preview' ? (
                <p className="lash-markdown-transfer-warning" role="status">
                  Finish saving or recover your current document before opening the imported
                  document.
                </p>
              ) : null}
              {state.phase === 'committing' || state.phase === 'created-opening' ? (
                <p className="lash-markdown-transfer-status" role="status" aria-live="polite">
                  {state.phase === 'committing'
                    ? 'Creating document…'
                    : 'Document created. Opening it…'}
                </p>
              ) : null}
              {state.phase === 'commit-failed' || state.phase === 'cleanup-unverified' ? (
                <div className="lash-markdown-transfer-error" role="alert">
                  {state.detail}
                </div>
              ) : null}
              {state.phase === 'created-open-failed' ? (
                <div className="lash-markdown-transfer-error" role="alert">
                  The document was created but could not be opened. Open it from the document list.
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer className="lash-markdown-transfer-footer">
          {state.kind === 'import' && state.phase === 'created-open-failed' ? (
            <button
              ref={primaryRef}
              className="lash-markdown-transfer-primary"
              onClick={onRetryOpen}
              type="button"
            >
              Open created document
            </button>
          ) : state.kind === 'download' && state.plan.status === 'ready' ? (
            <button
              ref={primaryRef}
              className="lash-markdown-transfer-primary"
              onClick={onConfirm}
              type="button"
            >
              Download Markdown
            </button>
          ) : state.kind === 'import' &&
            (state.phase === 'preview' ||
              state.phase === 'committing' ||
              state.phase === 'created-opening') ? (
            <button
              ref={primaryRef}
              className="lash-markdown-transfer-primary"
              disabled={importConfirmDisabled || pending}
              onClick={onConfirm}
              type="button"
            >
              {state.phase === 'committing'
                ? 'Creating document…'
                : state.phase === 'created-opening'
                  ? 'Opening document…'
                  : 'Create new document'}
            </button>
          ) : null}
          {!pending ? (
            <button
              ref={cancelRef}
              className="lash-markdown-transfer-secondary"
              onClick={close}
              type="button"
            >
              {state.kind === 'import' && state.phase === 'created-open-failed' ? 'Done' : 'Cancel'}
            </button>
          ) : null}
        </footer>
      </div>
    </dialog>
  );
}
