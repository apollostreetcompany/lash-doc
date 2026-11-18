/**
 * panels/AutosaveIndicator — "All changes saved" indicator + last-saved hover.
 *
 * Owned by M1/B3 (agents.md H.1): autosave-indicator + autosave-latency.
 *
 *   - 350 ms-after-idle flush triggered by editor `transaction` events
 *   - Debounce + cancel-on-fast-typing semantics
 *   - "Saving…" / "All changes saved" copy with accessible live-region
 *   - hover surfacing the last-saved timestamp (via `title` attribute)
 *
 * Renders nothing in the `idle` state so the editor shell stays uncluttered
 * until the first transaction.
 */
'use client';

import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'react';

import {
  formatRelativeSavedAt,
  useAutosave,
  type AutosaveFlushController,
  type AutosaveSaveContext,
  type AutosaveSaveResult,
} from '../../../lib/autosave';

export interface AutosaveIndicatorProps {
  editor: Editor | null;
  onSave: (context: AutosaveSaveContext) => AutosaveSaveResult;
  onControllerChange?: (controller: AutosaveFlushController | null) => void;
}

const RELATIVE_REFRESH_MS = 5_000;

export function AutosaveIndicator({ editor, onSave, onControllerChange }: AutosaveIndicatorProps) {
  const { status, lastSavedAt, flushVerified } = useAutosave(editor, { onSave });
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!onControllerChange) return;
    onControllerChange({
      getStatus: () => status,
      flushVerified,
    });
    return () => onControllerChange(null);
  }, [flushVerified, onControllerChange, status]);

  // Tick the relative timestamp every 5s so "12s ago" stays roughly accurate
  // while the user pauses on the indicator. Only runs once a save has landed.
  useEffect(() => {
    if (!lastSavedAt) return;
    const id = setInterval(() => setNowMs(Date.now()), RELATIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [lastSavedAt]);

  let visibleLabel = '';
  let announcement = '';
  if (status === 'saving') {
    visibleLabel = 'Saving…';
    announcement = visibleLabel;
  } else if (status === 'error') {
    visibleLabel = 'Save failed';
    announcement = visibleLabel;
  } else if (status === 'pending') {
    visibleLabel = 'Unsaved changes';
    announcement = visibleLabel;
  } else if (status === 'saved') {
    const rel = formatRelativeSavedAt(lastSavedAt, nowMs);
    visibleLabel = rel ? `All changes saved · ${rel}` : 'All changes saved';
    announcement = 'All changes saved';
  }

  return (
    <>
      {/*
       * Always-mounted, visually-hidden live region. Keeping the
       * role="status"/aria-live="polite" element in the DOM (including the
       * `idle` state, where it is empty) means assistive tech is already
       * monitoring it before the first status change, so the initial
       * 'Unsaved changes'/'Saving…' announcement is not dropped. A live region
       * inserted together with its first content is frequently not announced.
       */}
      <span data-testid="autosave-live-region" className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      {status === 'idle' ? null : (
        <span
          data-testid="autosave-indicator"
          data-status={status}
          className="lash-autosave-indicator lash-document-status-item"
          title={lastSavedAt ?? undefined}
        >
          {visibleLabel}
        </span>
      )}
    </>
  );
}
