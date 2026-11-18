import type { DocumentId } from '@lash/types';

import type { ChatAnchor, ChatMessage, ChatThreadStatus, StoredChatThread } from './index';
import {
  hasSuggestionEdges,
  readSuggestionContent,
  type ReviewProposal,
  type SuggestionDecision,
} from './suggestion';
import { normalizeChatAnchor } from './thread-payload';

export type ReviewMutation =
  | { type: 'create'; threadId: string; anchor: ChatAnchor<null>; body: string }
  | ({ type: 'propose'; threadId: string; body: string } & ReviewProposal)
  | { type: 'decide'; threadId: string; decision: SuggestionDecision }
  | { type: 'reply'; threadId: string; body: string }
  | { type: 'status'; threadId: string; status: ChatThreadStatus };

export type CommittedReviewOperation = {
  operationId: string;
  sequence: number;
  actorId: string;
  committedAt: string;
  operation: ReviewMutation;
  bodySequence?: number;
};

const MAX_REVIEW_PAYLOAD_BYTES = 3_000;
const MAX_REVIEW_BODY_LENGTH = 2_000;
const MAX_REVIEW_QUOTE_LENGTH = 1_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isReviewId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);

const normalizeReviewAnchor = (value: unknown): ChatAnchor<null> | null => {
  const anchor = normalizeChatAnchor(value);
  if (
    !anchor ||
    anchor.baseVersion !== null ||
    !anchor.relativeRange ||
    anchor.orphaned ||
    !anchor.token.text.trim() ||
    anchor.token.text.length > MAX_REVIEW_QUOTE_LENGTH ||
    anchor.token.before.length > 40 ||
    anchor.token.after.length > 40 ||
    anchor.to - anchor.from !== anchor.token.text.length ||
    [anchor.relativeRange.start, anchor.relativeRange.end].some(
      (position) => position.tname !== undefined && position.tname !== 'content',
    )
  ) {
    return null;
  }
  const { from, to, relativeRange } = anchor;
  const { before, after, text, occurrence } = anchor.token;
  return { baseVersion: null, from, to, relativeRange, token: { before, after, text, occurrence } };
};

export const parseReviewMutation = (value: unknown): ReviewMutation | null => {
  if (!isRecord(value) || !isReviewId(value.threadId)) return null;
  const { type, threadId } = value;
  if (type === 'status' && (value.status === 'open' || value.status === 'resolved')) {
    return { type, threadId, status: value.status };
  }
  if (type === 'decide' && (value.decision === 'accepted' || value.decision === 'rejected')) {
    return { type, threadId, decision: value.decision };
  }
  if (type !== 'create' && type !== 'reply' && type !== 'propose') return null;
  if (typeof value.body !== 'string' || value.body.length > MAX_REVIEW_BODY_LENGTH) return null;
  const body = value.body.trim();
  if (type === 'propose') {
    const anchor = normalizeReviewAnchor(value.anchor);
    const content = readSuggestionContent(value);
    if (!anchor || !hasSuggestionEdges(anchor.relativeRange) || !content) return null;
    const proposal = { type, threadId, anchor, ...content, body } as const;
    return new TextEncoder().encode(JSON.stringify(proposal)).length <= 8_000 ? proposal : null;
  }
  if (!body) return null;
  const anchor = type === 'create' ? normalizeReviewAnchor(value.anchor) : null;
  const mutation: ReviewMutation | null = anchor
    ? { type: 'create' as const, threadId, anchor, body }
    : type === 'reply'
      ? { type, threadId, body }
      : null;
  if (
    !mutation ||
    new TextEncoder().encode(JSON.stringify(mutation)).length > MAX_REVIEW_PAYLOAD_BYTES
  ) {
    return null;
  }
  return mutation;
};

export const parseCommittedReviewOperation = (value: unknown): CommittedReviewOperation | null => {
  if (
    !isRecord(value) ||
    !isReviewId(value.operationId) ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.actorId !== 'string' ||
    !value.actorId ||
    value.actorId.length > 256 ||
    typeof value.committedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.committedAt) ||
    !Number.isFinite(Date.parse(value.committedAt))
  ) {
    return null;
  }
  const operation = parseReviewMutation(value.operation);
  const { bodySequence } = value;
  const accepts = operation?.type === 'decide' && operation.decision === 'accepted';
  if (
    accepts
      ? typeof bodySequence !== 'number' || !Number.isSafeInteger(bodySequence) || bodySequence < 1
      : bodySequence !== undefined
  )
    return null;
  return operation
    ? {
        operationId: value.operationId,
        actorId: value.actorId,
        sequence: value.sequence,
        committedAt: value.committedAt,
        operation,
        ...(typeof bodySequence === 'number' ? { bodySequence } : {}),
      }
    : null;
};

export const collectReviewThreads = (
  operations: Iterable<CommittedReviewOperation>,
  docId: DocumentId,
): StoredChatThread[] => {
  const threads = new Map<string, StoredChatThread>();
  const applied = new Set<string>();
  for (const { operationId, sequence: _sequence, actorId, committedAt, operation } of [
    ...operations,
  ].sort((left, right) => left.sequence - right.sequence)) {
    if (applied.has(operationId)) continue;
    applied.add(operationId);
    if (operation.type === 'status') {
      const thread = threads.get(operation.threadId);
      if (thread) {
        thread.status = operation.status;
        thread.resolvedAt = operation.status === 'resolved' ? committedAt : null;
        thread.updatedAt = committedAt;
      }
      continue;
    }
    if (operation.type === 'decide') {
      const thread = threads.get(operation.threadId);
      if (thread?.proposal?.status === 'pending') {
        thread.proposal = {
          ...thread.proposal,
          status: operation.decision,
          decidedAt: committedAt,
          decidedBy: actorId,
        };
        thread.updatedAt = committedAt;
      }
      continue;
    }
    const message: ChatMessage = {
      id: operationId,
      threadId: operation.threadId,
      author: { type: 'user', id: actorId },
      body: operation.body,
      ts: committedAt,
    };
    const thread = threads.get(operation.threadId);
    if ((operation.type === 'create' || operation.type === 'propose') && !thread) {
      threads.set(operation.threadId, {
        id: operation.threadId,
        docId,
        anchor: operation.anchor,
        messages: operation.body ? [message] : [],
        filters: {},
        historyText: '',
        status: 'open',
        resolvedAt: null,
        updatedAt: committedAt,
        ...(operation.type === 'propose'
          ? {
              proposal: {
                replacement: operation.replacement,
                status: 'pending',
                actorId,
                createdAt: committedAt,
              },
            }
          : {}),
      });
    }
    if (operation.type === 'reply' && thread) {
      thread.messages.push(message);
      thread.updatedAt = committedAt;
    }
  }
  return [...threads.values()];
};
