import type { ChatAnchor, ChatMessage, StoredChatThread } from './index';
import { MAX_SUGGESTION_TEXT, type ReviewProposalView } from './suggestion';
import { normalizeChatAnchor } from './thread-payload';

export type CommentReviewThread = Omit<
  StoredChatThread,
  'docId' | 'historyText' | 'filters' | 'anchor'
> & {
  anchor: ChatAnchor<null> | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

function readMessage(value: unknown, threadId: string): ChatMessage | null {
  if (
    !isRecord(value) ||
    value.threadId !== threadId ||
    typeof value.id !== 'string' ||
    !isRecord(value.author) ||
    value.author.type !== 'user' ||
    typeof value.author.id !== 'string' ||
    !isTimestamp(value.ts) ||
    typeof value.body !== 'string'
  )
    return null;
  return {
    id: value.id,
    threadId,
    author: { type: 'user', id: value.author.id },
    body: value.body,
    ts: value.ts,
  };
}

function readProposal(value: unknown): ReviewProposalView | null {
  if (
    !isRecord(value) ||
    (value.status !== 'pending' && value.status !== 'accepted' && value.status !== 'rejected') ||
    typeof value.replacement !== 'string' ||
    value.replacement.length > MAX_SUGGESTION_TEXT ||
    typeof value.actorId !== 'string' ||
    !isTimestamp(value.createdAt) ||
    (value.decidedAt !== undefined && !isTimestamp(value.decidedAt)) ||
    (value.decidedBy !== undefined && typeof value.decidedBy !== 'string')
  )
    return null;
  return {
    replacement: value.replacement,
    status: value.status,
    actorId: value.actorId,
    createdAt: value.createdAt,
    ...(isTimestamp(value.decidedAt) ? { decidedAt: value.decidedAt } : {}),
    ...(typeof value.decidedBy === 'string' ? { decidedBy: value.decidedBy } : {}),
  };
}

export function parseCommentReviewThread(value: unknown): CommentReviewThread | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !Array.isArray(value.messages) ||
    value.messages.length > 256 ||
    (value.status !== 'open' && value.status !== 'resolved') ||
    (value.resolvedAt !== null && !isTimestamp(value.resolvedAt)) ||
    !isTimestamp(value.updatedAt)
  )
    return null;
  const anchor = normalizeChatAnchor(value.anchor);
  if (
    value.anchor !== null &&
    (!anchor ||
      anchor.baseVersion !== null ||
      !anchor.relativeRange ||
      anchor.token.before ||
      anchor.token.after)
  )
    return null;
  const threadId = value.id;
  const messages = value.messages.map((message) => readMessage(message, threadId));
  if (messages.some((message) => !message)) return null;
  const proposal = value.proposal === undefined ? undefined : readProposal(value.proposal);
  if (proposal === null) return null;
  return {
    id: threadId,
    anchor: anchor ? { ...anchor, baseVersion: null } : null,
    messages: messages.filter((message): message is ChatMessage => message !== null),
    status: value.status,
    resolvedAt: value.resolvedAt,
    updatedAt: value.updatedAt,
    ...(proposal ? { proposal } : {}),
  };
}
