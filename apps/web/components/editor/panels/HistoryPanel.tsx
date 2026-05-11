/**
 * panels/HistoryPanel — version timeline + diff renderer + restore.
 * Status: SLOT — to be filled by M2/C3 (history-open / history-diff)
 * and M2/C4 (history-restore). Reads from `@lash/history`.
 */
'use client';

import type { Editor } from '@tiptap/core';

export interface HistoryPanelProps {
  editor: Editor | null;
  /** When false, the panel renders nothing (collapsed/disabled). */
  open?: boolean;
}

export function HistoryPanel(_props: HistoryPanelProps) {
  return null;
}
