import { createLashEditorExtensions } from '@lash/editor-core';
import {
  canonicalize,
  type SharedHistoryChange,
  type SharedHistoryCommand,
  type SharedHistoryFrame,
  type SharedHistoryOutcome,
  type SharedHistoryRevision,
} from '@lash/types';
import { getSchema } from '@tiptap/core';
import { createHash } from 'node:crypto';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import * as Y from 'yjs';

import { loadRoomYjsProjection, readCanonicalRoomYjsBody } from './namedEditProjection';
import { bytesToBase64, type PersistedRealtimeUpdate } from './persistence';
import { PROMOTION_LIMITS } from './promotion';

const PAGE_SIZE = 40;
const MAX_TAIL = 40;
const MAX_REVISIONS = 50_000;
const MAX_DIFF_TEXT = 12_000;
const MAX_DIFF_BLOCKS = 60;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const schema = getSchema(createLashEditorExtensions());

type Storage = DurableObjectStorage;
type ActorRole = 'owner' | 'editor';
type RevisionKind = SharedHistoryRevision['kind'];
type RevisionRow = {
  sequence: number;
  parent_sequence: number | null;
  created_at: string;
  kind: RevisionKind;
  author: string;
  restored_from: number | null;
  body_sha: string;
};

type RestoreReceipt = { sequence: number; parent_sequence: number; restored_from: number };

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

const version = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const parseSharedHistoryCommand = (value: unknown): SharedHistoryCommand | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.requestId !== 'string' || !requestIdPattern.test(record.requestId)) return null;
  const { requestId } = record;
  const keys = Object.keys(record).sort().join(',');
  if (
    record.type === 'shared-history-list' &&
    keys === 'before,requestId,type' &&
    (record.before === null || version(record.before))
  ) {
    return { type: record.type, requestId, before: record.before };
  }
  if (
    record.type === 'shared-history-compare' &&
    keys === 'from,requestId,to,type' &&
    version(record.from) &&
    version(record.to)
  ) {
    return { type: record.type, requestId, from: record.from, to: record.to };
  }
  if (
    record.type === 'shared-history-restore' &&
    keys === 'expectedHead,requestId,target,type' &&
    version(record.expectedHead) &&
    version(record.target)
  ) {
    return {
      type: record.type,
      requestId,
      expectedHead: record.expectedHead,
      target: record.target,
    };
  }
  return null;
};

export const initializeSharedHistoryStorage = (storage: Storage) => {
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS shared_history_revisions_v1 (
    sequence INTEGER PRIMARY KEY,
    parent_sequence INTEGER,
    created_at TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('baseline', 'edit', 'suggestion-accept', 'restore')),
    author TEXT NOT NULL,
    body_sha TEXT NOT NULL,
    restored_from INTEGER,
    restore_request_id TEXT UNIQUE
  )`);
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS shared_history_state_v1 (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    total_revisions INTEGER NOT NULL,
    generation INTEGER NOT NULL
  )`);
};

export const sharedHistoryGeneration = (storage: Storage): number =>
  storage.sql
    .exec<{
      generation: number;
    }>('SELECT generation FROM shared_history_state_v1 WHERE singleton = 1')
    .toArray()[0]?.generation ?? 0;

export { readCanonicalRoomYjsBody as readSharedHistoryBody } from './namedEditProjection';

const columns = 'sequence, parent_sequence, created_at, kind, author, body_sha, restored_from';

const headOf = (storage: Storage) =>
  storage.sql
    .exec<RevisionRow>(
      `SELECT ${columns} FROM shared_history_revisions_v1 ORDER BY sequence DESC LIMIT 1`,
    )
    .toArray()[0];

const rowAt = (storage: Storage, sequence: number) =>
  storage.sql
    .exec<RevisionRow>(
      `SELECT ${columns} FROM shared_history_revisions_v1 WHERE sequence = ?`,
      sequence,
    )
    .toArray()[0];

const asRevision = (row: RevisionRow): SharedHistoryRevision => ({
  sequence: row.sequence,
  parentSequence: row.parent_sequence,
  createdAt: row.created_at,
  kind: row.kind,
  author: row.author,
  restoredFrom: row.restored_from,
});

const currentSequence = (storage: Storage, beforeSequence?: number) =>
  (beforeSequence === undefined
    ? storage.sql.exec<{ sequence: number | null }>(
        'SELECT MAX(sequence) AS sequence FROM yjs_updates',
      )
    : storage.sql.exec<{ sequence: number | null }>(
        'SELECT MAX(sequence) AS sequence FROM yjs_updates WHERE sequence < ?',
        beforeSequence,
      )
  ).toArray()[0]?.sequence ?? 0;

const seedHistory = (storage: Storage, body: string, sequence: number, createdAt: string) => {
  storage.sql.exec(
    `INSERT INTO shared_history_revisions_v1 (sequence, created_at, kind, author, body_sha)
     VALUES (?, ?, 'baseline', 'Shared document', ?)`,
    sequence,
    createdAt,
    digest(body),
  );
  storage.sql.exec(`INSERT INTO shared_history_state_v1 VALUES (1, 1, 0)`);
  const head = headOf(storage);
  if (!head) throw new Error('Missing shared history baseline');
  return head;
};

const appendRevision = (
  storage: Storage,
  input: {
    parent: RevisionRow;
    update: PersistedRealtimeUpdate;
    afterBody: string;
    kind: Exclude<RevisionKind, 'baseline'>;
    author: string;
    restoredFrom?: number;
    requestId?: string;
  },
) => {
  const { afterBody, author, kind, parent, requestId, restoredFrom, update } = input;
  const changed = storage.sql
    .exec<{ total_revisions: number }>(
      `UPDATE shared_history_state_v1
       SET total_revisions = total_revisions + 1, generation = generation + ?
       WHERE singleton = 1 AND total_revisions < ? RETURNING total_revisions`,
      kind === 'restore' ? 1 : 0,
      MAX_REVISIONS,
    )
    .toArray();
  if (changed.length !== 1) throw new Error('Shared history capacity reached');
  storage.sql.exec(
    `INSERT INTO shared_history_revisions_v1
     (sequence, parent_sequence, created_at, kind, author, body_sha, restored_from, restore_request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    update.sequence,
    parent.sequence,
    update.createdAt,
    kind,
    author,
    digest(afterBody),
    restoredFrom ?? null,
    requestId ?? null,
  );
};

/** Runs inside the transaction that inserted the authoritative room update. */
export const appendSharedHistoryEdit = (input: {
  storage: Storage;
  roomId: string;
  actorRole: ActorRole;
  beforeBody: string;
  afterBody: string;
  update: PersistedRealtimeUpdate;
  source?: 'edit' | 'suggestion-accept';
}) => {
  const { storage, roomId, actorRole, beforeBody, afterBody, update, source = 'edit' } = input;
  if (beforeBody === afterBody) return;
  const head =
    headOf(storage) ??
    seedHistory(storage, beforeBody, currentSequence(storage, update.sequence), update.createdAt);
  if (head.body_sha !== digest(beforeBody) || head.sequence >= update.sequence) {
    throw new Error('Shared history projection diverged');
  }
  const author =
    actorRole === 'owner'
      ? 'Owner'
      : `Collaborator ${digest(`${roomId}:${update.actorId}`).slice(0, 8)}`;
  appendRevision(storage, { parent: head, update, afterBody, kind: source, author });
};

/** A retained room checkpoint plus a short journal tail reconstructs each indexed revision. */
const bodyAt = (storage: Storage, target: RevisionRow, initialUpdate: () => string | null) => {
  const snapshot = storage.sql
    .exec<{
      sequence: number;
      update_b64: string;
    }>(
      `SELECT sequence, update_b64 FROM yjs_snapshots WHERE sequence <= ? ORDER BY sequence DESC LIMIT 1`,
      target.sequence,
    )
    .toArray()[0];
  const baseUpdate = snapshot?.update_b64 ?? initialUpdate();
  if (!baseUpdate) return null;
  const tail = storage.sql
    .exec<{ sequence: number; update_b64: string }>(
      `SELECT sequence, update_b64 FROM yjs_updates WHERE sequence > ? AND sequence <= ?
       ORDER BY sequence LIMIT ?`,
      snapshot?.sequence ?? 0,
      target.sequence,
      MAX_TAIL + 1,
    )
    .toArray();
  if (
    tail.length > MAX_TAIL ||
    (tail.at(-1)?.sequence ?? snapshot?.sequence ?? 0) !== target.sequence
  ) {
    return null;
  }
  const doc = loadRoomYjsProjection([baseUpdate, ...tail.map((row) => row.update_b64)]);
  if (!doc) return null;
  try {
    const body = readCanonicalRoomYjsBody(doc);
    return body !== null && digest(body) === target.body_sha ? body : null;
  } finally {
    doc.destroy();
  }
};

type BodyNode = { type: string; text?: string; content?: BodyNode[] };

const blockText = (node: BodyNode): string => {
  if (node.type === 'mention') return '@Mention';
  return node.text ?? node.content?.map(blockText).join('') ?? '';
};

const blockShape = (node: BodyNode): unknown => {
  const { text: _text, content, ...shape } = node;
  return { ...shape, ...(content ? { content: content.map(blockShape) } : {}) };
};

const trimDiffContext = (
  before: string,
  after: string,
  structureChanged: boolean,
): SharedHistoryChange => {
  const previous = Array.from(before);
  const next = Array.from(after);
  let start = 0;
  let end = 0;
  while (start < previous.length && previous[start] === next[start]) start += 1;
  while (
    end < previous.length - start &&
    end < next.length - start &&
    previous[previous.length - 1 - end] === next[next.length - 1 - end]
  )
    end += 1;
  return {
    before: previous.slice(start, previous.length - end).join(''),
    after: next.slice(start, next.length - end).join(''),
    prefix: previous.slice(Math.max(0, start - 48), start).join(''),
    suffix: end ? previous.slice(previous.length - end, previous.length - end + 48).join('') : '',
    structureChanged,
  };
};

export const compareSharedHistoryBodies = (from: string, to: string) => {
  const before = (JSON.parse(from) as BodyNode).content ?? [];
  const after = (JSON.parse(to) as BodyNode).content ?? [];
  let left = 0;
  let right = 0;
  while (
    left < before.length &&
    after[left] &&
    canonicalize(before[left]) === canonicalize(after[left])
  )
    left += 1;
  while (
    right < before.length - left &&
    right < after.length - left &&
    canonicalize(before[before.length - 1 - right]) ===
      canonicalize(after[after.length - 1 - right])
  )
    right += 1;
  const changes: SharedHistoryChange[] = [];
  let remainingText = MAX_DIFF_TEXT;
  const size = Math.max(before.length, after.length) - left - right;
  let truncated = size > MAX_DIFF_BLOCKS;
  for (let offset = 0; offset < Math.min(size, MAX_DIFF_BLOCKS) && remainingText > 0; offset += 1) {
    const index = left + offset;
    const previous = index < before.length - right ? before[index] : undefined;
    const next = index < after.length - right ? after[index] : undefined;
    if (previous && next && canonicalize(previous) === canonicalize(next)) continue;
    const change = trimDiffContext(
      previous ? blockText(previous) : '',
      next ? blockText(next) : '',
      !previous || !next || canonicalize(blockShape(previous)) !== canonicalize(blockShape(next)),
    );
    for (const key of ['before', 'after', 'prefix', 'suffix'] as const) {
      const points = Array.from(change[key]);
      if (points.length > remainingText) {
        change[key] = points.slice(0, remainingText).join('');
        truncated = true;
      }
      remainingText -= Math.min(remainingText, points.length);
    }
    changes.push(change);
    if (remainingText === 0 && offset < size - 1) truncated = true;
  }
  return { changes, truncated };
};

const makeRestoreUpdate = (live: Y.Doc, targetBody: string) => {
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(live));
    const vector = Y.encodeStateVector(candidate);
    prosemirrorToYXmlFragment(
      schema.nodeFromJSON(JSON.parse(targetBody) as unknown),
      candidate.getXmlFragment('content'),
    );
    if (readCanonicalRoomYjsBody(candidate) !== targetBody) return null;
    const bytes = Y.encodeStateAsUpdate(candidate, vector);
    return bytes.length <= PROMOTION_LIMITS.initialUpdateBytes ? bytesToBase64(bytes) : null;
  } finally {
    candidate.destroy();
  }
};

export const resolveSharedHistoryRequest = (input: {
  storage: Storage;
  roomId: string;
  actorId: string;
  actorRole: ActorRole;
  command: SharedHistoryCommand;
  getCurrentProjection: () => Y.Doc | null;
  initialUpdate: () => string | null;
  prepareReplay?: (sequence: number) => boolean;
  insertRestoreUpdate: (update: string) => PersistedRealtimeUpdate;
  isCurrent: () => boolean;
}): { frame: SharedHistoryFrame; restored?: PersistedRealtimeUpdate } => {
  const {
    storage,
    roomId,
    actorRole,
    command,
    getCurrentProjection,
    initialUpdate,
    prepareReplay,
    isCurrent,
  } = input;
  const response = (outcome: SharedHistoryOutcome, restored?: PersistedRealtimeUpdate) => ({
    frame: {
      type: 'shared-history-result' as const,
      roomId,
      requestId: command.requestId,
      outcome,
    },
    ...(restored ? { restored } : {}),
  });
  const forbidden = () => response({ kind: 'error', code: 'forbidden' });
  const unavailable = () => response({ kind: 'error', code: 'unavailable' });
  const invalid = () => response({ kind: 'error', code: 'invalid-version' });
  try {
    if (!isCurrent() || (command.type === 'shared-history-restore' && actorRole !== 'owner'))
      return forbidden();
    let head = headOf(storage);
    if (!head) {
      if (command.type !== 'shared-history-list' || command.before !== null) return invalid();
      const projection = getCurrentProjection();
      const body = projection && readCanonicalRoomYjsBody(projection);
      if (body === null) return unavailable();
      head = storage.transactionSync(
        () =>
          headOf(storage) ??
          seedHistory(storage, body, currentSequence(storage), new Date().toISOString()),
      );
    }
    if (command.type === 'shared-history-list') {
      const rows = storage.sql
        .exec<RevisionRow>(
          `SELECT ${columns} FROM shared_history_revisions_v1
           WHERE sequence < ? ORDER BY sequence DESC LIMIT ?`,
          command.before ?? Number.MAX_SAFE_INTEGER,
          PAGE_SIZE + 1,
        )
        .toArray();
      const revisions = rows.slice(0, PAGE_SIZE).map(asRevision);
      return isCurrent()
        ? response({
            kind: 'list',
            head: head.sequence,
            revisions,
            nextBefore: rows.length > PAGE_SIZE ? (revisions.at(-1)?.sequence ?? null) : null,
            canRestore: actorRole === 'owner',
          })
        : forbidden();
    }
    if (command.type === 'shared-history-compare') {
      const fromRow = rowAt(storage, command.from);
      const toRow = rowAt(storage, command.to);
      if (!fromRow || !toRow) return invalid();
      if (prepareReplay?.(command.from) === false || prepareReplay?.(command.to) === false) {
        return unavailable();
      }
      const from = bodyAt(storage, fromRow, initialUpdate);
      const to = bodyAt(storage, toRow, initialUpdate);
      if (from === null || to === null) return unavailable();
      const diff = compareSharedHistoryBodies(from, to);
      return isCurrent() ? response({ kind: 'compare', ...diff }) : forbidden();
    }

    const prior = storage.sql
      .exec<RestoreReceipt>(
        'SELECT sequence, parent_sequence, restored_from FROM shared_history_revisions_v1 WHERE restore_request_id = ?',
        command.requestId,
      )
      .toArray()[0];
    if (prior) {
      return prior.parent_sequence === command.expectedHead &&
        prior.restored_from === command.target
        ? response({ kind: 'restored', sequence: prior.sequence })
        : invalid();
    }
    if (head.sequence !== command.expectedHead)
      return response({ kind: 'error', code: 'stale-head' });
    const target = rowAt(storage, command.target);
    if (!target || target.sequence >= head.sequence) return invalid();
    if (prepareReplay?.(target.sequence) === false) return unavailable();
    const projection = getCurrentProjection();
    const body = projection && readCanonicalRoomYjsBody(projection);
    const targetBody = bodyAt(storage, target, initialUpdate);
    if (!projection || body === null || digest(body) !== head.body_sha || targetBody === null)
      return unavailable();
    const candidate = makeRestoreUpdate(projection, targetBody);
    if (candidate === null) return unavailable();

    return storage.transactionSync(() => {
      if (!isCurrent()) return forbidden();
      if (headOf(storage)?.sequence !== command.expectedHead) {
        return response({ kind: 'error', code: 'stale-head' });
      }
      const persisted = input.insertRestoreUpdate(candidate);
      appendRevision(storage, {
        parent: head,
        update: persisted,
        afterBody: targetBody,
        kind: 'restore',
        author: 'Owner',
        restoredFrom: command.target,
        requestId: command.requestId,
      });
      return response({ kind: 'restored', sequence: persisted.sequence }, persisted);
    });
  } catch {
    return unavailable();
  }
};
