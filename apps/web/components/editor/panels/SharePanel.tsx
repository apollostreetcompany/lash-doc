/**
 * panels/SharePanel — share-link dialog (scope, expiry, audit).
 * Status: SLOT — to be filled by M3/D3 (share-comment-scope /
 * share-suggest-scope / share-edit-scope / share-expiry / share-audit /
 * history-redact). Reads from `@lash/share`.
 */
'use client';

import type { Editor } from '@tiptap/core';

export interface SharePanelProps {
  editor: Editor | null;
  open?: boolean;
}

export function SharePanel(_props: SharePanelProps) {
  return null;
}
