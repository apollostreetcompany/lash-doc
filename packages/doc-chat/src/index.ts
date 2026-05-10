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

/** Map an anchor through a sequence of ops, marking it orphaned if its range is destroyed.
 *  Uses the anchor's `token` (text + occurrence + nodeId/nodePath + assoc) for recovery. */
export const mapAnchor = (_anchor: Anchor, _ops: EditorOp[]): Anchor => {
  throw new Error('mapAnchor: not implemented (M3/D4)');
};

export const createThreadStore = (_config: { adapter: 'memory' | 'postgres' }): ThreadStore => {
  throw new Error('createThreadStore: not implemented (M3/D4)');
};
