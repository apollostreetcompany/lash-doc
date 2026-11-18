import {
  collectReviewThreads,
  createAnchor,
  isReviewId,
  parseChatThread,
  parseCommentReviewThread,
  parseCommittedReviewOperation,
  parseReviewMutation,
  type CommittedReviewOperation,
  type CommentReviewThread,
  type ReviewMutation,
  type StoredChatThread,
} from '@lash/doc-chat';
import type { DocumentId } from '@lash/types';
import type * as Y from 'yjs';

export type ReviewMutationResult = { ok: true } | { ok: false; message: string };
export type RealtimeChatThread = StoredChatThread & { projected?: true; detached?: true };

export interface ChatRealtimeStore {
  isReady(): boolean;
  readThreads(docId: DocumentId): RealtimeChatThread[];
  subscribe(listener: () => void): () => void;
  submit(mutation: ReviewMutation): Promise<ReviewMutationResult>;
}

export const withLegacyChatThreads = (store: ChatRealtimeStore, doc: Y.Doc): ChatRealtimeStore => {
  const legacy = doc.getMap<string>('lash:chat-threads');
  return {
    isReady: store.isReady,
    readThreads: (docId) => {
      const current = store.readThreads(docId);
      const currentIds = new Set(current.map((thread) => thread.id));
      const prefix = `${docId}:`;
      const older = [...legacy.entries()].flatMap(([key, value]) => {
        if (!key.startsWith(prefix)) return [];
        const thread = parseChatThread(value, docId);
        return thread && key === `${prefix}${thread.id}` && !currentIds.has(thread.id)
          ? [thread]
          : [];
      });
      return [
        ...older.sort(
          (left, right) =>
            left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
        ),
        ...current,
      ];
    },
    subscribe: (listener) => {
      const unsubscribe = store.subscribe(listener);
      legacy.observe(listener);
      return () => {
        unsubscribe();
        legacy.unobserve(listener);
      };
    },
    submit: store.submit,
  };
};

type ReviewFrame =
  | { type: 'review-snapshot'; roomId?: string; operations?: unknown[]; threads?: unknown[] }
  | { type: 'review-operation'; roomId?: string; operation?: unknown }
  | { type: 'review-ack'; roomId?: string; operationId?: unknown; sequence?: unknown }
  | { type: 'review-error'; roomId?: string; operationId?: unknown; code?: unknown };

export type { ReviewFrame };

type PendingReview = {
  operationId: string;
  mutation: ReviewMutation;
  resolve?: (result: ReviewMutationResult) => void;
  promise?: Promise<ReviewMutationResult>;
  timer?: ReturnType<typeof setTimeout>;
};

const WAIT_FOR_REVIEW_MS = 8_000;
const MAX_REVIEW_OPERATIONS = 256;

const errorMessage = (code: unknown) => {
  switch (code) {
    case 'invalid_review_operation':
      return 'This comment or selection is too long. Shorten it and try again.';
    case 'review_capacity':
      return 'This document has reached its discussion capacity.';
    case 'review_thread_missing':
      return 'This thread is no longer available.';
    case 'review_anchor_stale':
      return 'The selected text changed. Select the updated words and try again.';
    case 'review_scope_mismatch':
      return 'Your access cannot resolve threads or decide suggestions.';
    case 'review_suggestion_stale':
      return 'The selected text changed. Select it again to make a new suggestion.';
    case 'review_suggestion_decided':
      return 'A decision has already been recorded for this suggestion.';
    case 'review_thread_exists':
      return 'This comment has already been posted. Close the draft to view the thread.';
    default:
      return 'Lash could not save this discussion change. Try again.';
  }
};

export class RealtimeChatStore implements ChatRealtimeStore {
  private ready = false;
  private operations = new Map<string, CommittedReviewOperation>();
  private projectedThreads: CommentReviewThread[] | null = null;
  private pending = new Map<string, PendingReview>();
  private listeners = new Set<() => void>();

  constructor(private readonly send: (operationId: string, mutation: ReviewMutation) => boolean) {}

  isReady = () => this.ready;

  readThreads = (docId: DocumentId): RealtimeChatThread[] =>
    this.projectedThreads?.map(({ anchor, ...thread }) => ({
      ...thread,
      docId,
      historyText: '',
      filters: {},
      projected: true,
      anchor: anchor ?? {
        ...createAnchor({ baseVersion: null, docText: '', from: 0, to: 0 }),
        orphaned: true,
      },
      ...(anchor === null ? { detached: true as const } : {}),
    })) ?? collectReviewThreads(this.operations.values(), docId);

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  submit = async (rawMutation: ReviewMutation): Promise<ReviewMutationResult> => {
    if (!this.ready) {
      return { ok: false, message: 'Reconnect to the document to send your discussion changes.' };
    }
    const mutation = parseReviewMutation(rawMutation);
    if (!mutation) return { ok: false, message: errorMessage('invalid_review_operation') };
    const key = JSON.stringify(mutation);
    const pending = this.pending.get(key) ?? { operationId: crypto.randomUUID(), mutation };
    if (pending.promise) return pending.promise;
    pending.promise = new Promise((resolve) => {
      pending.resolve = resolve;
      pending.timer = setTimeout(() => {
        this.finishPending(pending, {
          ok: false,
          message: 'Lash could not confirm the change. Try again to check it.',
        });
      }, WAIT_FOR_REVIEW_MS);
    });
    const result = pending.promise;
    this.pending.set(key, pending);
    if (!this.send(pending.operationId, pending.mutation)) {
      this.finishPending(pending, {
        ok: false,
        message: 'Reconnect to the document to confirm your discussion changes.',
      });
    }
    return result;
  };

  receive = (frame: ReviewFrame, projected = false) => {
    if (frame.type === 'review-snapshot') {
      if (projected) {
        if (
          frame.operations !== undefined ||
          !Array.isArray(frame.threads) ||
          frame.threads.length > MAX_REVIEW_OPERATIONS
        ) {
          this.disconnect();
          return;
        }
        const threads = frame.threads.map(parseCommentReviewThread);
        if (
          threads.some((thread) => thread === null) ||
          new Set(threads.map((thread) => thread?.id)).size !== threads.length
        ) {
          this.disconnect();
          return;
        }
        this.projectedThreads = threads.filter(
          (thread): thread is CommentReviewThread => thread !== null,
        );
        this.ready = true;
        this.emit();
        return;
      }
      if (!Array.isArray(frame.operations) || frame.operations.length > MAX_REVIEW_OPERATIONS) {
        return;
      }
      const operations = frame.operations.map(parseCommittedReviewOperation);
      if (operations.some((operation) => operation === null)) return;
      this.operations.clear();
      for (const operation of operations) {
        if (operation) this.record(operation);
      }
      this.ready = true;
      this.emit();
      for (const pending of this.pending.values()) {
        if (pending.promise) this.send(pending.operationId, pending.mutation);
      }
      return;
    }
    if (!this.ready) return;
    if (frame.type === 'review-operation') {
      if (projected) return;
      const operation = parseCommittedReviewOperation(frame.operation);
      if (operation) {
        this.record(operation);
        this.emit();
      }
      return;
    }
    if (!isReviewId(frame.operationId)) return;
    const key = [...this.pending].find(
      ([, pending]) => pending.operationId === frame.operationId,
    )?.[0];
    if (key === undefined) return;
    const pending = this.pending.get(key);
    if (!pending) return;
    if (frame.type === 'review-error') {
      this.pending.delete(key);
      this.finishPending(pending, { ok: false, message: errorMessage(frame.code) });
    } else if (
      projected
        ? typeof frame.sequence === 'number' &&
          Number.isSafeInteger(frame.sequence) &&
          frame.sequence > 0
        : this.operations.get(frame.operationId)?.sequence === frame.sequence
    ) {
      this.pending.delete(key);
      this.finishPending(pending, { ok: true });
    }
  };

  disconnect = () => {
    this.projectedThreads = null;
    if (!this.ready) return;
    this.ready = false;
    this.emit();
  };

  dispose = () => {
    this.disconnect();
    for (const pending of this.pending.values()) {
      this.finishPending(pending, { ok: false, message: 'Discussion access ended.' });
    }
    this.pending.clear();
    this.operations.clear();
    this.emit();
  };

  private record(operation: CommittedReviewOperation) {
    this.operations.set(operation.operationId, operation);
    const key = JSON.stringify(operation.operation);
    const pending = this.pending.get(key);
    if (pending?.operationId === operation.operationId) {
      if (pending.promise) {
        this.pending.delete(key);
        this.finishPending(pending, { ok: true });
      }
      // A retry after timeout will receive the same persisted operation and acknowledgement.
    }
  }

  private finishPending(pending: PendingReview, result: ReviewMutationResult) {
    clearTimeout(pending.timer);
    pending.timer = undefined;
    pending.promise = undefined;
    const resolve = pending.resolve;
    pending.resolve = undefined;
    resolve?.(result);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
