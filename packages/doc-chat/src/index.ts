/**
 * @lash/doc-chat — selection-anchored threads, history-aware context, filters.
 * Status: SCAFFOLD — implement in M3/D4 (threads/anchors), M4/E3 (AI citations).
 */

import type { DocumentId, Anchor, EditorOp, ActorRef } from '@lash/types';

export interface ChatMessage {
  id: string;
  threadId: string;
  author: ActorRef;
  /** ISO-8601 UTC */
  ts: string;
  body: string;
  /** For AI replies; doc citations are version-anchored so the citation-jump
   *  UX (I.4) survives subsequent edits. */
  citations?: Array<{ type: 'doc'; baseVersion: string; rangeFrom: number; rangeTo: number }>;
}

export interface ChatThread {
  id: string;
  docId: DocumentId;
  anchor: Anchor;
  messages: ChatMessage[];
  filters: { authorId?: string; ai?: boolean; nodeType?: string };
}

export interface ThreadStore {
  create(docId: DocumentId, anchor: Anchor): Promise<ChatThread>;
  reply(threadId: string, message: Omit<ChatMessage, 'id' | 'threadId'>): Promise<ChatMessage>;
  list(docId: DocumentId, filter?: ChatThread['filters']): Promise<ChatThread[]>;
}

/** Inputs needed for deterministic anchor recovery.
 *
 *  Just `anchor + ops` is insufficient: when `anchor.token.text` repeats in
 *  the doc, deciding which occurrence survives an edit requires knowing the
 *  doc state and the producing history entries' step maps. Implementations
 *  walk the ops via PM Step semantics (see `PmStepOp` rule in @lash/types)
 *  to maintain occurrence counts. */
export interface MapAnchorInput {
  anchor: Anchor;
  /** Doc JSON at `anchor.baseVersion`. */
  baseDoc: unknown;
  /** Ops applied since `anchor.baseVersion`, in order. */
  ops: EditorOp[];
  /** Doc JSON after `ops` are applied. Used to resolve the "current"
   *  occurrence index when text disambiguation is needed. */
  currentDoc: unknown;
  /** sha256 of `currentDoc` (typically the most recent HistoryEntry.resultSha
   *  at the time of the call). The returned `Anchor.baseVersion` is set to
   *  this so downstream consumers can deterministically diff/render. */
  targetVersion: string;
}

/** Map an anchor through a sequence of ops, marking it orphaned if its range
 *  is destroyed. Uses the anchor's `token` (text + occurrence + nodeId/
 *  nodePath + assoc) for recovery. The result's `baseVersion` advances to
 *  whatever the caller treats as the post-ops version (typically the latest
 *  HistoryEntry.resultSha). */
export const mapAnchor = (_input: MapAnchorInput): Anchor => {
  throw new Error('mapAnchor: not implemented (M3/D4)');
};

export const createThreadStore = (_config: { adapter: 'memory' | 'postgres' }): ThreadStore => {
  throw new Error('createThreadStore: not implemented (M3/D4)');
};
