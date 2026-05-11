/**
 * panels/AutosaveIndicator — "All changes saved" indicator + last-saved hover.
 *
 * Owned by M1/B3 (agents.md H.1): autosave-indicator + autosave-latency.
 *
 *   - 500 ms-after-idle flush triggered by editor `transaction` events
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

import { formatRelativeSavedAt, useAutosave } from '../../../lib/autosave';

export interface AutosaveIndicatorProps {
  editor: Editor | null;
}

const RELATIVE_REFRESH_MS = 5_000;

export function AutosaveIndicator({ editor }: AutosaveIndicatorProps) {
  const { status, lastSavedAt } = useAutosave(editor);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Tick the relative timestamp every 5s so "12s ago" stays roughly accurate
  // while the user pauses on the indicator. Only runs once a save has landed.
  useEffect(() => {
    if (!lastSavedAt) return;
    const id = setInterval(() => setNowMs(Date.now()), RELATIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [lastSavedAt]);

  if (status === 'idle') {
    return null;
  }

  let label: string;
  if (status === 'saving') {
    label = 'Saving…';
  } else if (status === 'error') {
    label = 'Save failed';
  } else if (status === 'pending') {
    label = 'Unsaved changes';
  } else {
    // status === 'saved'
    const rel = formatRelativeSavedAt(lastSavedAt, nowMs);
    label = rel ? `All changes saved · ${rel}` : 'All changes saved';
  }

  return (
    <span
      data-testid="autosave-indicator"
      data-status={status}
      className="lash-autosave-indicator"
      role="status"
      aria-live="polite"
      title={lastSavedAt ?? undefined}
    >
      {label}
    </span>
  );
}
