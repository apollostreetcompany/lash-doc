/**
 * panels/AIPanel — AI Edit invocation + accept/reject flow + chat citations.
 * Status: SLOT — to be filled by M4/E2 (ai-patch-apply / ai-labeling /
 * ai-rationale / ai-scope-global-confirm) and M4/E3 (ai-chat-citation /
 * ai-citation-jump). Reads from `@lash/ai`.
 */
'use client';

import type { Editor } from '@tiptap/core';

export interface AIPanelProps {
  editor: Editor | null;
  open?: boolean;
}

export function AIPanel(_props: AIPanelProps) {
  return null;
}
