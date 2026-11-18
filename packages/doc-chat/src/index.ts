/**
 * @lash/doc-chat — selection-anchored threads, history-aware context, filters.
 */

import type { ActorRef, Anchor, DocumentId, EditorOp } from '@lash/types';

import type { ReviewProposalView } from './suggestion';

export type ChatRelativePosition = {
  type?: { client: number; clock: number };
  item?: { client: number; clock: number };
  tname?: string;
  assoc?: number;
};

export type ChatRelativeRange = { start: ChatRelativePosition; end: ChatRelativePosition };

export type ChatAnchor<Version extends string | null = string | null> = Omit<
  Anchor,
  'baseVersion'
> & {
  /** Null for a thread anchored to the live document without a recorded revision. */
  baseVersion: Version;
  relativeRange?: ChatRelativeRange;
};

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
  anchor: ChatAnchor;
  messages: ChatMessage[];
  filters: { authorId?: string; ai?: boolean; nodeType?: string };
  status?: 'open' | 'resolved';
  /** ISO-8601 UTC */
  resolvedAt?: string | null;
  /** ISO-8601 UTC */
  updatedAt?: string;
  proposal?: ReviewProposalView;
}

export type ChatThreadStatus = 'open' | 'resolved';

export type StoredChatThread = ChatThread & {
  historyText: string;
  status: ChatThreadStatus;
  resolvedAt: string | null;
  updatedAt: string;
};

export { parseChatThread, parseChatThreads } from './thread-payload';
export {
  hasSuggestionEdges,
  MAX_SUGGESTION_TEXT,
  readSuggestionContent,
  type ReviewProposal,
  type ReviewProposalView,
  type SuggestionContent,
  type SuggestionDecision,
} from './suggestion';
export {
  collectReviewThreads,
  isReviewId,
  parseCommittedReviewOperation,
  parseReviewMutation,
  type CommittedReviewOperation,
  type ReviewMutation,
} from './review';

export interface ThreadStore {
  create(docId: DocumentId, anchor: Anchor): Promise<ChatThread>;
  reply(threadId: string, message: Omit<ChatMessage, 'id' | 'threadId'>): Promise<ChatMessage>;
  list(docId: DocumentId, filter?: ChatThread['filters']): Promise<ChatThread[]>;
}

export interface MapAnchorInput<Version extends string | null = string> {
  anchor: ChatAnchor;
  /** Doc JSON at `anchor.baseVersion`. */
  baseDoc: unknown;
  /** Ops applied since `anchor.baseVersion`, in order. */
  ops: EditorOp[];
  /** Doc JSON after `ops` are applied. */
  currentDoc: unknown;
  /** Recorded revision of `currentDoc`, if available. */
  targetVersion: Version;
}

const textOf = (doc: unknown): string => {
  if (typeof doc === 'string') return doc;
  if (doc && typeof doc === 'object' && 'text' in doc) {
    return String((doc as { text: unknown }).text ?? '');
  }
  return '';
};

const occurrenceIndex = (text: string, needle: string, from: number): number => {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1 && index < from) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
};

const findOccurrence = (text: string, needle: string, occurrence: number): number => {
  if (!needle) return -1;
  let index = text.indexOf(needle);
  let count = 0;
  while (index !== -1) {
    if (count === occurrence) return index;
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return -1;
};

export const createAnchor = <Version extends string | null>(input: {
  baseVersion: Version;
  docText: string;
  from: number;
  to: number;
}): ChatAnchor<Version> => {
  const from = Math.max(0, Math.min(input.from, input.docText.length));
  const to = Math.max(from, Math.min(input.to, input.docText.length));
  const selectedText = input.docText.slice(from, to);
  return {
    baseVersion: input.baseVersion,
    from,
    to,
    token: {
      before: input.docText.slice(Math.max(0, from - 40), from),
      after: input.docText.slice(to, Math.min(input.docText.length, to + 40)),
      text: selectedText,
      occurrence: occurrenceIndex(input.docText, selectedText, from),
      confidence: selectedText ? 1 : 0,
    },
  };
};

export const mapAnchor = <Version extends string | null>(
  input: MapAnchorInput<Version>,
): ChatAnchor<Version> => {
  const currentText = textOf(input.currentDoc);
  const selectedText = input.anchor.token.text;
  const nextFrom = findOccurrence(currentText, selectedText, input.anchor.token.occurrence);
  if (nextFrom >= 0) {
    return {
      ...input.anchor,
      baseVersion: input.targetVersion,
      from: nextFrom,
      to: nextFrom + selectedText.length,
      orphaned: false,
      token: {
        ...input.anchor.token,
        before: currentText.slice(Math.max(0, nextFrom - 40), nextFrom),
        after: currentText.slice(
          nextFrom + selectedText.length,
          Math.min(currentText.length, nextFrom + selectedText.length + 40),
        ),
        confidence: 1,
      },
    };
  }

  const pinned = Math.max(0, Math.min(input.anchor.from, currentText.length));
  return {
    ...input.anchor,
    baseVersion: input.targetVersion,
    from: pinned,
    to: pinned,
    orphaned: true,
    token: {
      ...input.anchor.token,
      confidence: 0,
    },
  };
};

export const createThreadStore = (_config: { adapter: 'memory' | 'postgres' }): ThreadStore => {
  const threads = new Map<string, ChatThread>();
  let threadSeq = 0;
  let messageSeq = 0;

  return {
    async create(docId, anchor) {
      threadSeq += 1;
      const thread: ChatThread = {
        id: `thread:${threadSeq}`,
        docId,
        anchor: { ...anchor, token: { ...anchor.token } },
        messages: [],
        filters: {},
        status: 'open',
        resolvedAt: null,
        updatedAt: new Date().toISOString(),
      };
      threads.set(thread.id, thread);
      return {
        ...thread,
        messages: [],
        anchor: { ...thread.anchor, token: { ...thread.anchor.token } },
      };
    },
    async reply(threadId, message) {
      const thread = threads.get(threadId);
      if (!thread) {
        throw new Error(`doc-chat.reply: unknown thread ${threadId}`);
      }
      messageSeq += 1;
      const saved: ChatMessage = {
        ...message,
        id: `message:${messageSeq}`,
        threadId,
      };
      thread.messages.push(saved);
      return { ...saved };
    },
    async list(docId, filter = {}) {
      return Array.from(threads.values())
        .filter((thread) => thread.docId === docId)
        .filter((thread) => {
          if (filter.authorId) {
            return thread.messages.some((message) => message.author.id === filter.authorId);
          }
          if (filter.ai !== undefined) {
            return filter.ai
              ? thread.messages.some((message) => message.author.type === 'ai')
              : thread.messages.every((message) => message.author.type !== 'ai');
          }
          return true;
        })
        .map((thread) => ({
          ...thread,
          anchor: { ...thread.anchor, token: { ...thread.anchor.token } },
          messages: thread.messages.map((message) => ({ ...message })),
        }));
    },
  };
};
