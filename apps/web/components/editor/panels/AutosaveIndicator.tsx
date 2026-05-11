/**
 * panels/AutosaveIndicator — "All changes saved" indicator + last-saved hover.
 * Status: SLOT — to be filled by M1/B3 (autosave-indicator + autosave-latency).
 *
 * B3 owns:
 *   - 500ms-after-idle flush triggered by editor `transaction` events
 *   - Debounce + cancel-on-fast-typing semantics
 *   - "Saving…" / "All changes saved" copy with accessible live-region
 *   - hover surfacing the last-saved timestamp
 *
 * Currently renders nothing so the editor shell stays uncluttered.
 */
'use client';

import type { Editor } from '@tiptap/core';

export interface AutosaveIndicatorProps {
  editor: Editor | null;
}

export function AutosaveIndicator(_props: AutosaveIndicatorProps) {
  return null;
}
