import {
  collectReviewThreads,
  isReviewId,
  parseCommittedReviewOperation,
  parseReviewMutation,
  type ChatAnchor,
  type CommentReviewThread,
  type CommittedReviewOperation,
  type ReviewProposal,
} from '@lash/doc-chat';
import type { DocumentId } from '@lash/types';

const MAX_REVIEW_OPERATIONS_PER_ROOM = 256;

type ReviewOperationRow = {
  sequence: number;
  operation_id: string;
  actor_id: string;
  committed_at: string;
  operation_json: string;
  body_sequence: number | null;
};

type CommitResult =
  | { ok: true; operation: CommittedReviewOperation; duplicate: boolean }
  | {
      ok: false;
      code:
        | 'invalid_review_operation'
        | 'review_operation_conflict'
        | 'review_thread_missing'
        | 'review_thread_exists'
        | 'review_scope_mismatch'
        | 'review_anchor_stale'
        | 'review_suggestion_stale'
        | 'review_suggestion_decided'
        | 'review_capacity';
    };

export const initializeCollaboratorReviewStorage = (storage: DurableObjectStorage) => {
  storage.transactionSync(() => {
    const { sql } = storage;
    if (sql.exec('PRAGMA table_info(collaborator_review_operation_v2)').toArray().length) return;
    sql.exec(`
      CREATE TABLE collaborator_review_operation_v2 (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL UNIQUE,
        actor_id TEXT NOT NULL,
        committed_at TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        operation_type TEXT NOT NULL CHECK (operation_type IN ('create', 'reply', 'status', 'propose', 'decide')),
        operation_json TEXT NOT NULL,
        body_sequence INTEGER
      )
    `);
    const previousColumns = sql
      .exec<{ name: string }>('PRAGMA table_info(collaborator_review_operation_v1)')
      .toArray();
    if (previousColumns.length) {
      const bodySequence = previousColumns.some(({ name }) => name === 'body_sequence')
        ? 'body_sequence'
        : 'NULL';
      sql.exec(`
        INSERT INTO collaborator_review_operation_v2
          (sequence, operation_id, actor_id, committed_at, thread_id, operation_type, operation_json, body_sequence)
        SELECT sequence, operation_id, actor_id, committed_at, thread_id, operation_type, operation_json, ${bodySequence}
        FROM collaborator_review_operation_v1
      `);
    }
    sql.exec(`
      CREATE UNIQUE INDEX collaborator_review_thread_v2
      ON collaborator_review_operation_v2(thread_id)
      WHERE operation_type IN ('create', 'propose')
    `);
    sql.exec(`
      CREATE UNIQUE INDEX collaborator_review_decision_v2
      ON collaborator_review_operation_v2(thread_id)
      WHERE operation_type = 'decide'
    `);
  });
};

const decodeReviewOperation = (row: ReviewOperationRow): CommittedReviewOperation => {
  const operation = parseCommittedReviewOperation({
    operationId: row.operation_id,
    sequence: row.sequence,
    actorId: row.actor_id,
    committedAt: row.committed_at,
    operation: JSON.parse(row.operation_json) as unknown,
    bodySequence: row.body_sequence ?? undefined,
  });
  if (!operation) throw new Error('Stored review operation is invalid.');
  return operation;
};

export const readCollaboratorReviewSnapshot = (storage: DurableObjectStorage) =>
  storage.sql
    .exec<ReviewOperationRow>(
      'SELECT * FROM collaborator_review_operation_v2 ORDER BY sequence ASC',
    )
    .toArray()
    .map(decodeReviewOperation);

type ReadCommentAnchor = (anchor: ChatAnchor<null>) => ChatAnchor<null> | null;
type CommentAccess = {
  readAnchor: ReadCommentAnchor;
  validateProposal(proposal: ReviewProposal): boolean;
};

const projectCommentSeed = (
  operation: Extract<CommittedReviewOperation['operation'], { type: 'create' | 'propose' }>,
  access: CommentAccess,
) => {
  const anchor = access.readAnchor(operation.anchor);
  if (!anchor || (operation.type === 'propose' && !access.validateProposal(operation))) {
    return null;
  }
  return { ...operation, anchor };
};

export const projectNamedCommentReview = (
  docId: DocumentId,
  operations: CommittedReviewOperation[],
  access: CommentAccess,
) => {
  const visible = new Map<string, ChatAnchor<null>>();
  const participants = new Map<string, Set<string>>();
  for (const record of operations) {
    const { operation } = record;
    if (operation.type === 'create' || operation.type === 'propose' || operation.type === 'reply') {
      const actors = participants.get(operation.threadId) ?? new Set<string>();
      actors.add(record.actorId);
      participants.set(operation.threadId, actors);
    }
    if (operation.type === 'create' || operation.type === 'propose') {
      const projected = projectCommentSeed(operation, access);
      if (projected) visible.set(operation.threadId, projected.anchor);
    }
  }
  return {
    fingerprint: `${operations.at(-1)?.sequence ?? 0}:${[...visible.keys()].join(',')}`,
    threadsFor(actorId: string): CommentReviewThread[] {
      return collectReviewThreads(operations, docId).flatMap((thread) => {
        const anchor = visible.get(thread.id) ?? null;
        if (!anchor && !participants.get(thread.id)?.has(actorId)) return [];
        const { id, messages, status, resolvedAt, updatedAt, proposal } = thread;
        return [
          {
            id,
            anchor,
            messages,
            status,
            resolvedAt,
            updatedAt,
            ...(proposal ? { proposal } : {}),
          },
        ];
      });
    },
  };
};

export const commitCollaboratorReviewOperation = ({
  storage,
  actorId,
  operationId,
  operation: rawOperation,
  suggestions,
  commentAccess,
}: {
  storage: DurableObjectStorage;
  actorId: string;
  operationId: unknown;
  operation: unknown;
  suggestions?: {
    validateProposal(proposal: ReviewProposal): boolean;
    applyProposal(proposal: ReviewProposal): number | null;
  };
  commentAccess?: CommentAccess;
}): CommitResult => {
  const operation = parseReviewMutation(rawOperation);
  if (!isReviewId(operationId) || !operation || !actorId || actorId.length > 256) {
    return { ok: false, code: 'invalid_review_operation' };
  }
  if (commentAccess && (operation.type === 'status' || operation.type === 'decide')) {
    return { ok: false, code: 'review_scope_mismatch' };
  }
  const operationJson = JSON.stringify(operation);
  const { sql } = storage;
  return storage.transactionSync(() => {
    const previous = sql
      .exec<ReviewOperationRow>(
        'SELECT * FROM collaborator_review_operation_v2 WHERE operation_id = ?',
        operationId,
      )
      .toArray()[0];
    if (previous) {
      return previous.actor_id === actorId && previous.operation_json === operationJson
        ? { ok: true, operation: decodeReviewOperation(previous), duplicate: true }
        : { ok: false, code: 'review_operation_conflict' };
    }
    const thread = sql
      .exec<ReviewOperationRow>(
        `SELECT * FROM collaborator_review_operation_v2
         WHERE thread_id = ? AND operation_type IN ('create', 'propose')`,
        operation.threadId,
      )
      .toArray()[0];
    if (commentAccess) {
      if (operation.type === 'create' || operation.type === 'propose') {
        if (!commentAccess.readAnchor(operation.anchor)) {
          return { ok: false, code: 'review_anchor_stale' };
        }
      } else if (operation.type === 'reply') {
        const seed = thread && decodeReviewOperation(thread).operation;
        if (
          (seed?.type !== 'create' && seed?.type !== 'propose') ||
          !projectCommentSeed(seed, commentAccess)
        ) {
          return { ok: false, code: 'review_thread_missing' };
        }
      }
    }
    const createsThread = operation.type === 'create' || operation.type === 'propose';
    if (createsThread && thread) return { ok: false, code: 'review_thread_exists' };
    if (!createsThread && !thread) return { ok: false, code: 'review_thread_missing' };

    const capacity = sql
      .exec<{ count: number }>('SELECT count(*) AS count FROM collaborator_review_operation_v2')
      .one();
    if (capacity.count >= MAX_REVIEW_OPERATIONS_PER_ROOM) {
      return { ok: false, code: 'review_capacity' };
    }

    let bodySequence: number | null = null;
    if (operation.type === 'propose' && !suggestions?.validateProposal(operation)) {
      return { ok: false, code: 'review_suggestion_stale' };
    }
    if (operation.type === 'decide') {
      const proposal = thread && decodeReviewOperation(thread).operation;
      if (proposal?.type !== 'propose') return { ok: false, code: 'review_thread_missing' };
      const existingDecision = sql
        .exec<{
          sequence: number;
        }>(
          "SELECT sequence FROM collaborator_review_operation_v2 WHERE thread_id = ? AND operation_type = 'decide'",
          operation.threadId,
        )
        .toArray()[0];
      if (existingDecision) return { ok: false, code: 'review_suggestion_decided' };
      if (operation.decision === 'accepted') {
        bodySequence = suggestions?.applyProposal(proposal) ?? null;
        if (!bodySequence) return { ok: false, code: 'review_suggestion_stale' };
      }
    }

    const row = sql
      .exec<ReviewOperationRow>(
        `INSERT INTO collaborator_review_operation_v2
         (operation_id, actor_id, committed_at, thread_id, operation_type, operation_json, body_sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING sequence, operation_id, actor_id, committed_at, operation_json, body_sequence`,
        operationId,
        actorId,
        new Date().toISOString(),
        operation.threadId,
        operation.type,
        operationJson,
        bodySequence,
      )
      .one();
    return { ok: true, operation: decodeReviewOperation(row), duplicate: false };
  });
};
