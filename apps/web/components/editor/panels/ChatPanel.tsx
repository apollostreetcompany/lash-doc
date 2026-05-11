/**
 * panels/ChatPanel — selection-anchored doc chat with diff-aware threads.
 * Status: SLOT — to be filled by M3/D4 (chat-anchor-map / chat-orphan /
 * chat-history-context / chat-current-context / chat-filter-author /
 * chat-filter-ai / chat-redact). Reads from `@lash/doc-chat`.
 */
'use client';

import type { Editor } from '@tiptap/core';

export interface ChatPanelProps {
  editor: Editor | null;
  open?: boolean;
}

export function ChatPanel(_props: ChatPanelProps) {
  return null;
}
