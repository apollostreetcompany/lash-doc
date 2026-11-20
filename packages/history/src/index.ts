/**
 * @lash/history — append-only edit log, deterministic diff engine, restore API.
 *
 * Determinism: history MUST NOT inject its own hash function. parentSha,
 * resultSha, EditPatch.baseVersion, and DiffJSON.from/to are all computed via
 * `hashCanonical` from `@lash/types`. (proconsult-m0/B P0 #5.)
 *
 * Append concurrency: every `append` carries `expectedParentSha` and is
 * rejected with `parent-mismatch` when the head has moved. Callers MUST
 * either rebase their ops onto the new head or surface a conflict UI.
 */

import {
  canonicalize,
  hashCanonical,
  type ActorRef,
  type DiffJSON,
  type DiffSpan,
  type AttrChangedSpan,
  type DeletedSpan,
  type DocumentId,
  type EditorOp,
  type HistoryAudit,
  type HistoryEntry,
  type InsertedSpan,
  type Intent,
  type UnchangedSpan,
} from '@lash/types';

import { mixedBodyFormattingChanged, textDiffEdges } from './bodyDiff';
import { applyBodyPatch, createBodyPatch } from './bodyPatch';
import {
  HISTORY_CANONICAL_VERSION,
  HISTORY_EDITOR_SCHEMA_VERSION,
  HISTORY_ENVELOPE_KIND,
  HISTORY_ENVELOPE_VERSION,
  HISTORY_MAX_ENTRIES,
  HISTORY_MAX_ENVELOPE_BYTES,
  HISTORY_MAX_TOTAL_OPS,
  HISTORY_SCHEMA_VERSION,
  type HistoryPersistenceAdapter,
  type PersistedHistoryEnvelopeV1,
  type PersistedHistoryPayloadV1,
} from './persistence';

export {
  HISTORY_CANONICAL_VERSION,
  HISTORY_DATABASE_NAME,
  HISTORY_DATABASE_VERSION,
  HISTORY_EDITOR_SCHEMA_VERSION,
  HISTORY_ENVELOPE_KIND,
  HISTORY_ENVELOPE_VERSION,
  HISTORY_MAX_ENTRIES,
  HISTORY_MAX_ENVELOPE_BYTES,
  HISTORY_MAX_TOTAL_OPS,
  HISTORY_SCHEMA_VERSION,
} from './persistence';
export type {
  HistoryPersistenceAdapter,
  HistoryPersistenceCommitInput,
  HistoryPersistenceCommitResult,
  HistoryPersistenceReadResult,
  PersistedHistoryEnvelopeV1,
  PersistedHistoryPayloadV1,
  PersistedHistorySnapshotV1,
} from './persistence';

export interface HistoryFilter {
  authorId?: string;
  authorType?: ActorRef['type'];
  /** ISO-8601 inclusive bounds */
  since?: string;
  until?: string;
  intent?: Intent;
}

/** Caller-provided fields for a new entry. The history layer fills in
 *  `id`, `seq`, `resultSha`, and `ts`. */
export interface AppendInput {
  docId: DocumentId;
  actor: ActorRef;
  /** sha256 the caller believes is the current head. Server enforces match. */
  expectedParentSha: string;
  /** Editor-schema version these ops were authored against. Required so
   *  PmStepOp consumers (history.replayOps, computeDiff, authorship) can
   *  call `Step.fromJSON(schema, step)` deterministically. */
  schemaVersion: string;
  ops: EditorOp[];
  intent: Intent;
  audit: HistoryAudit;
  /** When the entry restores a prior version. */
  restoredFromVersion?: string;
}

export interface HistoryCommitOptions {
  /**
   * Revalidates the caller's mutation authority at the synchronous commit
   * boundary. A false result or thrown error rejects the commit without
   * publishing an entry, snapshot, or head.
   */
  commitGuard: () => boolean;
}

export type AppendResult =
  | { ok: true; entry: HistoryEntry }
  | { ok: false; reason: 'parent-mismatch'; currentHead: string }
  | {
      ok: false;
      reason: 'commit-rejected';
      cause: 'guard-denied' | 'guard-threw';
    }
  | { ok: false; reason: 'schema-invalid'; details: string }
  | {
      ok: false;
      reason: 'persistence-unavailable' | 'commit-uncertain';
      details: string;
    }
  | { ok: false; reason: 'history-capacity' }
  | { ok: false; reason: 'rate-limited' };

export type HistoryHydrationResult =
  | Readonly<{
      state: 'ready';
      head: string;
      entryCount: number;
    }>
  | Readonly<{
      state: 'empty-baseline';
      head: string;
      entryCount: number;
      /** An empty baseline has an existing verified primary row. */
      durable?: true;
    }>
  | Readonly<{
      state: 'recovery-available';
      entryCount: number;
    }>
  | Readonly<{
      state: 'unavailable' | 'corrupt' | 'unsupported-version';
      reason: string;
    }>;

export interface HistoryStore {
  /**
   * Hydrate and verify the durable projection before mounting History.
   * Missing persistence starts from the supplied already-hydrated body
   * baseline without fabricating a prior version.
   */
  hydrate(docId: DocumentId, baseline?: HistoryDocumentState): Promise<HistoryHydrationResult>;
  /** Transactionally append; rejects when expectedParentSha != current head. */
  append(input: AppendInput, options: HistoryCommitOptions): Promise<AppendResult>;
  list(docId: DocumentId, filter?: HistoryFilter): Promise<HistoryEntry[]>;
  diff(docId: DocumentId, fromSha: string, toSha: string): Promise<DiffJSON>;
  /** Load doc state at a specific resultSha. Reconstructed from the nearest
   *  preceding snapshot by replaying ops forward when not snapshotted directly. */
  loadAt(docId: DocumentId, sha: string): Promise<unknown>;
  /** Restore creates a NEW head entry whose ops reproduce the target state.
   *  Never destructive — older history is preserved. */
  restore(
    docId: DocumentId,
    targetSha: string,
    actor: ActorRef,
    audit: HistoryAudit,
    options: HistoryCommitOptions,
  ): Promise<AppendResult>;
}

export interface CreateHistoryStoreConfig {
  /** Persist a full-state snapshot every N entries; bigger = slower restore,
   *  smaller = more storage. States that fall between snapshots are
   *  reconstructed on demand by replaying ops from the nearest preceding
   *  snapshot. Defaults to 1 (snapshot every entry). Must be >= 1. */
  snapshotInterval?: number;
  /** Test seam for deterministic entry timestamps. */
  now?: () => string;
  /** Durable authority. When absent, the store retains its legacy in-memory behavior. */
  persistence?: HistoryPersistenceAdapter;
}

export interface HistoryDocumentState {
  type: 'doc';
  text: string;
  /** Canonical editor JSON. Older text-only versions omit it. */
  body?: Record<string, unknown>;
  attrs?: Record<string, Record<string, unknown>>;
  marks?: Array<{
    from: number;
    to: number;
    mark: { type: string; attrs?: Record<string, unknown> };
  }>;
  nodes?: Array<{ pos: number; node: unknown }>;
}

export const EMPTY_HISTORY_DOC: HistoryDocumentState = { type: 'doc', text: '' };

type JsonObject = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneCanonicalJson = <T>(value: T): T => JSON.parse(canonicalize(cloneJson(value))) as T;

const toHistoryState = (doc: unknown, shareBody = false): HistoryDocumentState => {
  if (typeof doc === 'string') {
    return { type: 'doc', text: doc };
  }
  if (isRecord(doc) && typeof doc.text === 'string') {
    if ('body' in doc && (!isRecord(doc.body) || doc.body.type !== 'doc')) {
      throw new Error('history.replayOps: invalid editor body snapshot');
    }
    return shareBody ? { ...(doc as unknown as HistoryDocumentState), type: 'doc', text: doc.text } : cloneJson({
      type: 'doc',
      ...doc,
      text: doc.text,
    }) as HistoryDocumentState;
  }
  if (isRecord(doc) && doc.type === 'doc' && !('text' in doc)) {
    return { type: 'doc', text: '' };
  }
  throw new Error('history.replayOps: expected a text-backed document state');
};

export const historyBodySnapshotOp = (doc: HistoryDocumentState, previous?: HistoryDocumentState['body']): EditorOp => {
  if (previous && doc.body) {
    const changes = createBodyPatch(previous, doc.body);
    if (changes.length <= 1_000) return { op: 'pm_step', step: { type: 'lash_patch_body_v1', changes } };
  }
  return { op: 'pm_step', step: { type: 'lash_replace_doc', doc } };
};

export const entryHasHistoryBody = (entry: HistoryEntry) => entry.ops.some((op) =>
  op.op === 'pm_step' && isRecord(op.step) && (op.step.type === 'lash_patch_body_v1' ||
    (op.step.type === 'lash_replace_doc' && isRecord(op.step.doc) && isRecord(op.step.doc.body))),
);

const assertRange = (text: string, from: number, to: number): void => {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > text.length
  ) {
    throw new Error(
      `history.replayOps: invalid text range ${from}..${to} for length ${text.length}`,
    );
  }
};

const applyTextReplace = (text: string, from: number, to: number, replacement: string): string => {
  assertRange(text, from, to);
  return `${text.slice(0, from)}${replacement}${text.slice(to)}`;
};

const opDetails = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const entryIdFor = (key: string, seq: number, resultSha: string): string =>
  `history:${key}:${seq}:${resultSha.slice(0, 12)}`;

const docKey = (docId: DocumentId): string => String(docId);

type DocumentHistoryState = Readonly<{
  baseSha: string;
  head: string;
  entries: readonly HistoryEntry[];
  /** Sparse map of sha -> full doc state. */
  snapshots: ReadonlyMap<string, HistoryDocumentState>;
  persistence: Readonly<{
    revision: number;
    writeId: string | null;
    payloadSha: string | null;
    raw: string | null;
  }>;
}>;

const describeHistory = (history: DocumentHistoryState): HistoryHydrationResult => {
  if (history.entries.length) {
    return { state: 'ready', head: history.head, entryCount: history.entries.length };
  }
  return {
    state: 'empty-baseline',
    head: history.head,
    entryCount: 0,
    ...(history.persistence.raw !== null ? { durable: true } : {}),
  };
};

type PersistedHistoryValidation =
  | Readonly<{
      ok: true;
      state: DocumentHistoryState;
    }>
  | Readonly<{
      ok: false;
      kind: 'corrupt' | 'unsupported-version';
      reason: string;
    }>;

const encoder = new TextEncoder();
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
class HistoryCapacityError extends Error {}

const hasExactKeys = (value: JsonObject, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isHistoryEntryHeader = (
  entry: unknown,
  docId: string,
  seq: number,
  parentSha: string,
): entry is JsonObject & { ops: unknown[]; resultSha: string } =>
  isRecord(entry) &&
  entry.docId === docId &&
  entry.seq === seq &&
  entry.lamport === seq &&
  entry.parentSha === parentSha &&
  typeof entry.resultSha === 'string' &&
  SHA256_PATTERN.test(entry.resultSha) &&
  typeof entry.id === 'string' &&
  typeof entry.schemaVersion === 'string' &&
  entry.schemaVersion.length >= 1 &&
  typeof entry.ts === 'string' &&
  Number.isFinite(Date.parse(entry.ts)) &&
  Array.isArray(entry.ops);

const hasValidNewEntryAttribution = (entry: HistoryEntry) => {
  const actor: unknown = entry.actor;
  const audit: unknown = entry.audit;
  const { intent } = entry;
  return (
    isRecord(actor) &&
    (actor.type === 'user' || actor.type === 'ai' || actor.type === 'system') &&
    typeof actor.id === 'string' &&
    (actor.label === undefined || (actor.type === 'ai' && typeof actor.label === 'string')) &&
    isRecord(audit) &&
    (typeof audit.ipHash === 'string' || typeof audit.ua === 'string') &&
    (audit.ipHash === undefined || typeof audit.ipHash === 'string') &&
    (audit.ua === undefined || typeof audit.ua === 'string') &&
    (intent === 'edit' || intent === 'suggest' || intent === 'ai')
  );
};

const validatePersistedHistory = async (
  raw: string,
  expectedDocumentId: string,
): Promise<PersistedHistoryValidation> => {
  if (encoder.encode(raw).byteLength > HISTORY_MAX_ENVELOPE_BYTES) {
    return { ok: false, kind: 'corrupt', reason: 'History envelope exceeds 32 MiB.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, kind: 'corrupt', reason: 'History envelope is not valid JSON.' };
  }
  if (!isRecord(parsed) || !isRecord(parsed.payload) || !isRecord(parsed.integrity)) {
    return { ok: false, kind: 'corrupt', reason: 'History envelope shape is invalid.' };
  }
  if (parsed.payload.kind !== HISTORY_ENVELOPE_KIND) {
    return { ok: false, kind: 'corrupt', reason: 'History envelope kind is invalid.' };
  }
  if (parsed.payload.version !== HISTORY_ENVELOPE_VERSION) {
    return {
      ok: false,
      kind: 'unsupported-version',
      reason: 'History envelope version is unsupported.',
    };
  }
  if (
    !hasExactKeys(parsed, ['payload', 'integrity']) ||
    !hasExactKeys(parsed.integrity, ['algorithm', 'canonical', 'payloadSha']) ||
    !hasExactKeys(parsed.payload, [
      'kind',
      'version',
      'historySchema',
      'editorSchema',
      'documentId',
      'revision',
      'writeId',
      'savedAt',
      'previousPayloadSha',
      'snapshotInterval',
      'baseSha',
      'head',
      'entries',
      'snapshots',
    ])
  ) {
    return { ok: false, kind: 'corrupt', reason: 'History envelope has unknown fields.' };
  }
  if (canonicalize(parsed) !== raw) {
    return { ok: false, kind: 'corrupt', reason: 'History envelope is not canonical JSON.' };
  }

  const payload = parsed.payload;
  const integrity = parsed.integrity;
  if (
    payload.historySchema !== HISTORY_SCHEMA_VERSION ||
    payload.editorSchema !== HISTORY_EDITOR_SCHEMA_VERSION ||
    payload.documentId !== expectedDocumentId ||
    !Number.isInteger(payload.revision) ||
    Number(payload.revision) < 1 ||
    typeof payload.writeId !== 'string' ||
    payload.writeId.length < 1 ||
    payload.writeId.length > 128 ||
    typeof payload.savedAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.savedAt)) ||
    (payload.previousPayloadSha !== null &&
      (typeof payload.previousPayloadSha !== 'string' ||
        !SHA256_PATTERN.test(payload.previousPayloadSha))) ||
    !Number.isInteger(payload.snapshotInterval) ||
    Number(payload.snapshotInterval) < 1 ||
    typeof payload.baseSha !== 'string' ||
    !SHA256_PATTERN.test(payload.baseSha) ||
    typeof payload.head !== 'string' ||
    !SHA256_PATTERN.test(payload.head) ||
    !Array.isArray(payload.entries) ||
    !Array.isArray(payload.snapshots) ||
    payload.entries.length > HISTORY_MAX_ENTRIES ||
    integrity.algorithm !== 'SHA-256' ||
    integrity.canonical !== HISTORY_CANONICAL_VERSION ||
    typeof integrity.payloadSha !== 'string' ||
    !SHA256_PATTERN.test(integrity.payloadSha)
  ) {
    return { ok: false, kind: 'corrupt', reason: 'History envelope metadata is invalid.' };
  }

  const payloadSha = await hashCanonical(payload);
  if (payloadSha !== integrity.payloadSha) {
    return { ok: false, kind: 'corrupt', reason: 'History envelope checksum does not match.' };
  }
  const normalizedPayload = payload as unknown as PersistedHistoryPayloadV1;
  const normalizedIntegrity = integrity as unknown as PersistedHistoryEnvelopeV1['integrity'];

  const snapshots = new Map<string, HistoryDocumentState>();
  for (const item of normalizedPayload.snapshots) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ['sha', 'doc']) ||
      typeof item.sha !== 'string' ||
      !SHA256_PATTERN.test(item.sha)
    ) {
      return { ok: false, kind: 'corrupt', reason: 'History snapshot shape is invalid.' };
    }
    if (snapshots.has(item.sha)) {
      return { ok: false, kind: 'corrupt', reason: 'History snapshot SHA is duplicated.' };
    }
    let doc: HistoryDocumentState;
    try {
      doc = toHistoryState(item.doc);
    } catch {
      return { ok: false, kind: 'corrupt', reason: 'History snapshot document is invalid.' };
    }
    if ((await hashCanonical(doc)) !== item.sha) {
      return { ok: false, kind: 'corrupt', reason: 'History snapshot checksum does not match.' };
    }
    snapshots.set(item.sha, doc);
  }

  const baseDoc = snapshots.get(normalizedPayload.baseSha);
  if (!baseDoc) {
    return { ok: false, kind: 'corrupt', reason: 'History base snapshot is missing.' };
  }

  let currentDoc: unknown = baseDoc;
  let currentSha = normalizedPayload.baseSha;
  let totalOps = 0;
  const entries: HistoryEntry[] = [];
  for (let index = 0; index < normalizedPayload.entries.length; index += 1) {
    const entry = normalizedPayload.entries[index] as unknown;
    if (!isHistoryEntryHeader(entry, expectedDocumentId, index + 1, currentSha)) {
      return { ok: false, kind: 'corrupt', reason: 'History entry chain is invalid.' };
    }
    totalOps += entry.ops.length;
    if (totalOps > HISTORY_MAX_TOTAL_OPS) {
      return { ok: false, kind: 'corrupt', reason: 'History operation bound is exceeded.' };
    }
    try {
      currentDoc = replayHistoryOps(currentDoc, entry.ops as EditorOp[]);
    } catch {
      return { ok: false, kind: 'corrupt', reason: 'History entry replay failed.' };
    }
    if ((await hashCanonical(currentDoc)) !== entry.resultSha) {
      return { ok: false, kind: 'corrupt', reason: 'History entry result checksum is invalid.' };
    }
    const snapshot = snapshots.get(entry.resultSha);
    if (snapshot && canonicalize(snapshot) !== canonicalize(toHistoryState(currentDoc))) {
      return { ok: false, kind: 'corrupt', reason: 'History acceleration snapshot diverges.' };
    }
    currentSha = entry.resultSha;
    // The parsed envelope belongs exclusively to this store. Public readers
    // detach rows before returning them.
    entries.push(entry as unknown as HistoryEntry);
  }

  if (currentSha !== normalizedPayload.head) {
    return { ok: false, kind: 'corrupt', reason: 'History head does not match the entry chain.' };
  }
  const reachable = new Set([
    normalizedPayload.baseSha,
    ...entries.map((entry) => entry.resultSha),
  ]);
  if ([...snapshots.keys()].some((sha) => !reachable.has(sha))) {
    return { ok: false, kind: 'corrupt', reason: 'History snapshot is not reachable.' };
  }

  return {
    ok: true,
    state: {
      baseSha: normalizedPayload.baseSha,
      head: normalizedPayload.head,
      entries,
      snapshots,
      persistence: {
        revision: normalizedPayload.revision,
        writeId: normalizedPayload.writeId,
        payloadSha: normalizedIntegrity.payloadSha,
        raw,
      },
    },
  };
};

const persistableEnvelope = async (
  key: string,
  state: DocumentHistoryState,
  snapshotInterval: number,
  savedAt: string,
): Promise<DocumentHistoryState['persistence'] & { raw: string }> => {
  if (state.entries.length > HISTORY_MAX_ENTRIES ||
      state.entries.reduce((count, entry) => count + entry.ops.length, 0) > HISTORY_MAX_TOTAL_OPS) {
    throw new HistoryCapacityError('History operation limit reached.');
  }
  const revision = state.persistence.revision + 1;
  const writeId = `history-write:${key}:${revision}:${state.head.slice(0, 16)}`;
  if (!Number.isInteger(revision) || revision < 1 || writeId.length > 128) {
    throw new Error('History envelope metadata is invalid.');
  }
  const payload: PersistedHistoryPayloadV1 = {
    kind: HISTORY_ENVELOPE_KIND,
    version: HISTORY_ENVELOPE_VERSION,
    historySchema: HISTORY_SCHEMA_VERSION,
    editorSchema: HISTORY_EDITOR_SCHEMA_VERSION,
    documentId: key,
    revision,
    writeId,
    savedAt,
    previousPayloadSha: state.persistence.payloadSha,
    snapshotInterval,
    baseSha: state.baseSha,
    head: state.head,
    entries: cloneJson(state.entries) as HistoryEntry[],
    snapshots: [...state.snapshots.entries()]
      .map(([sha, doc]) => ({ sha, doc: cloneJson(doc) }))
      .sort((left, right) => left.sha.localeCompare(right.sha)),
  };
  const payloadSha = await hashCanonical(payload);
  const envelope: PersistedHistoryEnvelopeV1 = {
    payload,
    integrity: {
      algorithm: 'SHA-256',
      canonical: HISTORY_CANONICAL_VERSION,
      payloadSha,
    },
  };
  const raw = canonicalize(envelope);
  if (encoder.encode(raw).byteLength > HISTORY_MAX_ENVELOPE_BYTES) {
    throw new HistoryCapacityError('History envelope exceeds 32 MiB.');
  }
  return { revision, writeId, payloadSha, raw };
};

export const createHistoryStore = (config: CreateHistoryStoreConfig = {}): HistoryStore => {
  const snapshotInterval = config.snapshotInterval ?? 1;
  if (!Number.isInteger(snapshotInterval) || snapshotInterval < 1) {
    throw new Error(
      `history.createHistoryStore: snapshotInterval must be an integer >= 1, got ${snapshotInterval}`,
    );
  }

  const stateByDoc = new Map<string, DocumentHistoryState>();
  let emptyShaPromise: Promise<string> | null = null;

  const getEmptySha = () => {
    emptyShaPromise = emptyShaPromise ?? hashCanonical(EMPTY_HISTORY_DOC);
    return emptyShaPromise;
  };

  const createBaselineState = async (
    baseline: HistoryDocumentState = EMPTY_HISTORY_DOC,
  ): Promise<DocumentHistoryState> => {
    const body = toHistoryState(baseline, true);
    const preparedBaseline = config.persistence ? cloneCanonicalJson(body) : cloneJson(body);
    const baseSha = await hashCanonical(preparedBaseline);
    return {
      baseSha,
      head: baseSha,
      entries: [],
      snapshots: new Map([[baseSha, preparedBaseline]]),
      persistence: {
        revision: 0,
        writeId: null,
        payloadSha: null,
        raw: null,
      },
    };
  };

  const ensureDocState = async (key: string): Promise<DocumentHistoryState> => {
    const existing = stateByDoc.get(key);
    if (existing) return existing;
    const emptySha = await getEmptySha();
    const concurrentlyInitialized = stateByDoc.get(key);
    if (concurrentlyInitialized) return concurrentlyInitialized;
    const initial: DocumentHistoryState = {
      baseSha: emptySha,
      head: emptySha,
      entries: [],
      snapshots: new Map([[emptySha, cloneJson(EMPTY_HISTORY_DOC)]]),
      persistence: {
        revision: 0,
        writeId: null,
        payloadSha: null,
        raw: null,
      },
    };
    stateByDoc.set(key, initial);
    return initial;
  };

  // Store-owned snapshots and patch subtrees may be shared inside one read.
  // loadAt detaches the result before exposing it to a caller.
  const materializeAt = (
    state: DocumentHistoryState,
    sha: string,
    preceding?: { sha: string; doc: unknown },
  ): unknown => {
    const known = (version: string) =>
      version === preceding?.sha ? preceding.doc : state.snapshots.get(version);
    const direct = known(sha);
    if (direct !== undefined) return direct;

    // Validated and newly appended entries are always in sequence order.
    const entries = state.entries;
    const targetIndex = entries.findIndex((entry) => entry.resultSha === sha);
    if (targetIndex === -1) {
      return undefined;
    }

    // Walk backwards from the target to find the nearest snapshotted base.
    let baseDoc: unknown;
    let replayStart = 0;
    for (let i = targetIndex; i >= 0; i -= 1) {
      const candidate = known(entries[i].parentSha);
      if (candidate !== undefined) {
        baseDoc = candidate;
        replayStart = i;
        break;
      }
    }
    if (baseDoc === undefined) {
      return undefined;
    }

    let reconstructed: unknown = baseDoc;
    for (let i = replayStart; i <= targetIndex; i += 1) {
      reconstructed = replayHistoryOps(reconstructed, entries[i].ops);
    }
    return reconstructed;
  };

  const append: HistoryStore['append'] = async (input, options) => {
    // Snapshot all caller-owned values before the first await. This prevents a
    // caller from changing the stored ops/audit while result hashing is in
    // flight and ensures no caller-owned property is read after commitGuard.
    const preparedDocId = input.docId;
    const preparedExpectedParentSha = input.expectedParentSha;
    const preparedSchemaVersion = input.schemaVersion;
    // Replay the same JSON values a cold store will see in the durable version.
    const copyInput = config.persistence ? cloneCanonicalJson : cloneJson;
    const preparedOps = copyInput(input.ops);
    const preparedActor = copyInput(input.actor);
    const preparedAudit = copyInput(input.audit);
    const preparedIntent = input.intent;
    const preparedRestoredFromVersion = input.restoredFromVersion;
    let preparedCommitGuard: () => boolean;
    try {
      preparedCommitGuard = options.commitGuard;
    } catch {
      return { ok: false, reason: 'commit-rejected', cause: 'guard-threw' };
    }
    if (typeof preparedCommitGuard !== 'function') {
      return { ok: false, reason: 'commit-rejected', cause: 'guard-denied' };
    }
    if (typeof preparedSchemaVersion !== 'string' || !preparedSchemaVersion.trim()) {
      return { ok: false, reason: 'schema-invalid', details: 'schemaVersion is required' };
    }
    if (!Array.isArray(preparedOps) || !preparedOps.length) {
      return { ok: false, reason: 'schema-invalid', details: 'at least one op is required' };
    }
    if (preparedRestoredFromVersion !== undefined && typeof preparedRestoredFromVersion !== 'string') {
      return { ok: false, reason: 'schema-invalid', details: 'restoredFromVersion must be a string' };
    }

    const key = docKey(preparedDocId);
    const preparedState = await ensureDocState(key);
    const preparedHead = preparedState.head;
    if (preparedExpectedParentSha !== preparedHead) {
      return { ok: false, reason: 'parent-mismatch', currentHead: preparedHead };
    }

    const baseDoc = materializeAt(preparedState, preparedHead);
    if (baseDoc === undefined) {
      return {
        ok: false,
        reason: 'schema-invalid',
        details: `missing state for head ${preparedHead}`,
      };
    }

    let resultDoc: unknown;
    try {
      resultDoc = replayHistoryOps(baseDoc, preparedOps);
    } catch (error) {
      return { ok: false, reason: 'schema-invalid', details: opDetails(error) };
    }
    if (!isRecord(resultDoc) || resultDoc.type !== 'doc') {
      return { ok: false, reason: 'schema-invalid', details: 'History result must be a document.' };
    }

    const resultSha = await hashCanonical(resultDoc);
    // Everything capable of throwing through caller data or a caller callback
    // is completed before commitGuard. Once the guard approves, the remaining
    // boundary is synchronous and cannot yield to a revocation.
    const preparedSnapshot = toHistoryState(resultDoc, true);
    const preparedTimestamp = config.now?.() ?? new Date().toISOString();
    const candidateState = stateByDoc.get(key);
    if (candidateState !== preparedState || candidateState.head !== preparedExpectedParentSha) {
      return {
        ok: false,
        reason: 'parent-mismatch',
        currentHead: candidateState?.head ?? preparedHead,
      };
    }
    const seq = candidateState.entries.length + 1;
    const entry: HistoryEntry = {
      id: entryIdFor(key, seq, resultSha),
      docId: preparedDocId,
      actor: preparedActor,
      ts: preparedTimestamp,
      parentSha: candidateState.head,
      resultSha,
      seq,
      lamport: seq,
      schemaVersion: preparedSchemaVersion,
      ops: preparedOps,
      intent: preparedIntent,
      audit: preparedAudit,
      ...(preparedRestoredFromVersion ? { restoredFromVersion: preparedRestoredFromVersion } : {}),
    };
    if (!isHistoryEntryHeader(entry, key, seq, candidateState.head) || !hasValidNewEntryAttribution(entry)) {
      return { ok: false, reason: 'schema-invalid', details: 'History entry metadata is invalid.' };
    }
    const nextEntries = [...candidateState.entries, entry];
    const nextSnapshots = new Map(candidateState.snapshots);
    if (seq % snapshotInterval === 0) {
      nextSnapshots.set(resultSha, copyInput(preparedSnapshot));
    }
    const nextState: DocumentHistoryState = {
      baseSha: candidateState.baseSha,
      head: resultSha,
      entries: nextEntries,
      snapshots: nextSnapshots,
      persistence: candidateState.persistence,
    };
    const success: AppendResult = { ok: true, entry: cloneJson(entry) };

    if (config.persistence) {
      let preparedPersistence: Awaited<ReturnType<typeof persistableEnvelope>>;
      try {
        preparedPersistence = await persistableEnvelope(
          key,
          nextState,
          snapshotInterval,
          preparedTimestamp,
        );
      } catch (error) {
        if (error instanceof HistoryCapacityError) return { ok: false, reason: 'history-capacity' };
        return {
          ok: false,
          reason: 'persistence-unavailable',
          details: opDetails(error),
        };
      }

      const durableState: DocumentHistoryState = { ...nextState, persistence: preparedPersistence };

      let durableResult;
      try {
        durableResult = await config.persistence.commit({
          documentId: key,
          expectedPrimaryRaw: candidateState.persistence.raw,
          nextPrimaryRaw: preparedPersistence.raw,
          commitGuard: preparedCommitGuard,
        });
      } catch (error) {
        return {
          ok: false,
          reason: 'commit-uncertain',
          details: opDetails(error),
        };
      }
      if (!durableResult.ok) {
        if (durableResult.reason === 'history-capacity') {
          return { ok: false, reason: 'history-capacity' };
        }
        if (durableResult.reason === 'guard-denied' || durableResult.reason === 'guard-threw') {
          return {
            ok: false,
            reason: 'commit-rejected',
            cause: durableResult.reason,
          };
        }
        if (durableResult.reason === 'cas-mismatch') {
          if (durableResult.currentRaw) {
            const current = await validatePersistedHistory(durableResult.currentRaw, key);
            if (current.ok) {
              return {
                ok: false,
                reason: 'parent-mismatch',
                currentHead: current.state.head,
              };
            }
          }
          return {
            ok: false,
            reason: 'commit-uncertain',
            details: 'Durable history changed and could not be verified.',
          };
        }
        if (durableResult.reason === 'unavailable') {
          return {
            ok: false,
            reason: 'persistence-unavailable',
            details: durableResult.details,
          };
        }
        if (durableResult.reason === 'commit-uncertain') {
          return {
            ok: false,
            reason: 'commit-uncertain',
            details: durableResult.details,
          };
        }
        return {
          ok: false,
          reason: 'commit-uncertain',
          details: 'Durable history commit failed closed.',
        };
      }

      // This exact candidate extends an already validated prefix. Hydration
      // and conflict handling still fully verify bytes from any other source.
      if (durableResult.primaryRaw !== preparedPersistence.raw) {
        return {
          ok: false,
          reason: 'commit-uncertain',
          details: 'Committed local version history did not match the prepared bytes.',
        };
      }
      const liveState = stateByDoc.get(key);
      if (liveState !== candidateState || liveState.head !== preparedExpectedParentSha) {
        return {
          ok: false,
          reason: 'commit-uncertain',
          details: 'Durable history committed while the in-memory projection changed.',
        };
      }
      stateByDoc.set(key, durableState);
      return success;
    }

    let guardResult: unknown;
    try {
      guardResult = preparedCommitGuard();
    } catch {
      return { ok: false, reason: 'commit-rejected', cause: 'guard-threw' };
    }
    if (guardResult !== true) {
      return { ok: false, reason: 'commit-rejected', cause: 'guard-denied' };
    }

    const liveState = stateByDoc.get(key);
    if (liveState !== candidateState || liveState.head !== preparedExpectedParentSha) {
      return {
        ok: false,
        reason: 'parent-mismatch',
        currentHead: liveState?.head ?? preparedHead,
      };
    }

    // The one linearization point publishes head, entries, and snapshots together.
    stateByDoc.set(key, nextState);
    return success;
  };

  return {
    async hydrate(docId, baseline = EMPTY_HISTORY_DOC) {
      const key = docKey(docId);
      const existing = stateByDoc.get(key);
      if (existing) return describeHistory(existing);

      if (!config.persistence) {
        const initial = await createBaselineState(baseline);
        stateByDoc.set(key, initial);
        return describeHistory(initial);
      }

      let durable;
      try {
        durable = await config.persistence.read(key);
      } catch (error) {
        return {
          state: 'unavailable',
          reason: opDetails(error),
        };
      }

      if (durable.primaryRaw !== null) {
        const primary = await validatePersistedHistory(durable.primaryRaw, key);
        if (primary.ok) {
          stateByDoc.set(key, primary.state);
          return describeHistory(primary.state);
        }
        if (primary.kind === 'unsupported-version') {
          return { state: 'unsupported-version', reason: primary.reason };
        }
        if (durable.backupRaw !== null) {
          const backup = await validatePersistedHistory(durable.backupRaw, key);
          if (backup.ok) {
            return {
              state: 'recovery-available',
              entryCount: backup.state.entries.length,
            };
          }
        }
        return { state: 'corrupt', reason: primary.reason };
      }

      if (durable.backupRaw !== null) {
        const backup = await validatePersistedHistory(durable.backupRaw, key);
        if (backup.ok) {
          return {
            state: 'recovery-available',
            entryCount: backup.state.entries.length,
          };
        }
        return { state: backup.kind, reason: backup.reason };
      }

      const initial = await createBaselineState(baseline);
      stateByDoc.set(key, initial);
      return describeHistory(initial);
    },
    append,
    async list(docId, filter = {}) {
      const entries = [...(stateByDoc.get(docKey(docId))?.entries ?? [])];
      return entries.filter((entry) => {
        if (filter.authorId && entry.actor.id !== filter.authorId) return false;
        if (filter.authorType && entry.actor.type !== filter.authorType) return false;
        if (filter.intent && entry.intent !== filter.intent) return false;
        if (filter.since && entry.ts < filter.since) return false;
        if (filter.until && entry.ts > filter.until) return false;
        return true;
      }).map((entry) => cloneJson(entry));
    },
    async loadAt(docId, sha) {
      const key = docKey(docId);
      const documentState = await ensureDocState(key);
      const materialized = materializeAt(documentState, sha);
      if (materialized === undefined) {
        throw new Error(`history.loadAt: unknown version ${sha}`);
      }
      return cloneJson(materialized);
    },
    async diff(docId, fromSha, toSha) {
      const state = await ensureDocState(docKey(docId));
      const from = materializeAt(state, fromSha);
      const to = materializeAt(
        state,
        toSha,
        from === undefined ? undefined : { sha: fromSha, doc: from },
      );
      return diffStates(fromSha, toSha, from, to, state.entries);
    },
    async restore(docId, targetSha, actor, audit, options) {
      const preparedDocId = docId;
      const preparedTargetSha = targetSha;
      const preparedActor = cloneJson(actor);
      const preparedAudit = cloneJson(audit);
      let preparedCommitGuard: () => boolean;
      try {
        preparedCommitGuard = options.commitGuard;
      } catch {
        return { ok: false, reason: 'commit-rejected', cause: 'guard-threw' };
      }
      if (typeof preparedCommitGuard !== 'function') {
        return { ok: false, reason: 'commit-rejected', cause: 'guard-denied' };
      }
      const preparedOptions: HistoryCommitOptions = { commitGuard: preparedCommitGuard };
      const key = docKey(preparedDocId);
      const documentState = await ensureDocState(key);
      const currentHead = documentState.head;
      const currentDoc = materializeAt(documentState, currentHead);
      const targetDoc = materializeAt(documentState, preparedTargetSha);
      if (targetDoc === undefined || currentDoc === undefined) {
        return {
          ok: false,
          reason: 'schema-invalid',
          details: `unknown restore target ${preparedTargetSha}`,
        };
      }

      const current = toHistoryState(currentDoc);
      const target = toHistoryState(targetDoc);
      return append(
        {
          docId: preparedDocId,
          actor: preparedActor,
          expectedParentSha: currentHead,
          schemaVersion: 'lash-schema-v1',
          ops: [
            { op: 'replace_text', from: 0, to: current.text.length, text: target.text },
            ...(target.body ? [historyBodySnapshotOp(target, current.body)] : []),
          ],
          intent: 'edit',
          audit: preparedAudit,
          restoredFromVersion: preparedTargetSha,
        },
        preparedOptions,
      );
    },
  };
};

/** Deterministic diff between two history-rooted states. Implementation
 *  MUST be byte-identical across CI, dev, and prod (D.4 diff-deterministic). */
type DiffSpanInput =
  | Omit<UnchangedSpan, 'id'>
  | Omit<InsertedSpan, 'id'>
  | Omit<DeletedSpan, 'id'>
  | Omit<AttrChangedSpan, 'id'>;

const spanId = (span: DiffSpanInput, index: number): string =>
  `span:${index}:${canonicalize(span)}`;

const materializeVersions = (entries: HistoryEntry[], baseline: HistoryDocumentState): Map<string, unknown> => {
  const states = new Map<string, unknown>();
  let state: unknown = cloneJson(baseline);
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  if (sorted[0]) {
    states.set(sorted[0].parentSha, cloneJson(state));
  }
  for (const entry of sorted) {
    state = replayHistoryOps(state, entry.ops);
    states.set(entry.resultSha, cloneJson(state));
  }
  return states;
};

export const computeDiff = (
  fromSha: string,
  toSha: string,
  entries: HistoryEntry[],
  baseline: HistoryDocumentState = EMPTY_HISTORY_DOC,
): DiffJSON => {
  const states = materializeVersions(entries, baseline);
  return diffStates(fromSha, toSha, states.get(fromSha), states.get(toSha), entries);
};

const diffStates = (
  fromSha: string,
  toSha: string,
  fromDoc: unknown,
  toDoc: unknown,
  entries: readonly HistoryEntry[],
): DiffJSON => {
  if (fromDoc === undefined || toDoc === undefined) {
    throw new Error('computeDiff: unknown from/to version');
  }

  const { text: before, body: beforeBody } = toHistoryState(fromDoc, true);
  const { text: after, body: afterBody } = toHistoryState(toDoc, true);
  const toEntry = entries.find((entry) => entry.resultSha === toSha);
  // Restores can reuse a content hash. An unqualified hash cannot identify the actor.
  const adjacent =
    toEntry?.parentSha === fromSha &&
    !entries.some((entry) => entry !== toEntry && entry.resultSha === toSha);
  const fromEntry = adjacent
    ? entries.find((entry) => entry.seq === toEntry.seq - 1 && entry.resultSha === fromSha)
    : undefined;
  const spans: DiffSpan[] = [];
  const { prefix, suffix } = textDiffEdges(before, after);

  const addSpan = (span: DiffSpanInput) => {
    spans.push({ ...span, id: spanId(span, spans.length) } as DiffSpan);
  };

  if (prefix > 0) {
    addSpan({ kind: 'unchanged', from: 0, to: prefix });
  }

  const deleted = before.slice(prefix, before.length - suffix);
  if (deleted) {
    addSpan({
      kind: 'deleted',
      from: prefix,
      to: prefix,
      text: deleted,
      ...(adjacent
        ? {
            entryId: fromEntry?.id,
            authorId: fromEntry?.actor.id,
            actorType: fromEntry?.actor.type,
            intent: fromEntry?.intent,
            ts: fromEntry?.ts,
          }
        : {}),
    });
  }

  const inserted = after.slice(prefix, after.length - suffix);
  if (inserted) {
    addSpan({
      kind: 'inserted',
      from: prefix,
      to: prefix + inserted.length,
      text: inserted,
      ...(adjacent
        ? {
            entryId: toEntry.id,
            opIndex: 0,
            authorId: toEntry.actor.id,
            actorType: toEntry.actor.type,
            intent: toEntry.intent,
            ts: toEntry.ts,
          }
        : {}),
    });
  }

  if (suffix > 0) {
    addSpan({ kind: 'unchanged', from: after.length - suffix, to: after.length });
  }

  if (
    beforeBody &&
    afterBody &&
    beforeBody !== afterBody &&
    (before === after
      ? canonicalize(beforeBody) !== canonicalize(afterBody)
      : mixedBodyFormattingChanged(beforeBody, afterBody))
  ) {
    addSpan({
      kind: 'attrChanged',
      from: 0,
      to: after.length,
      nodeId: 'document',
      before: {},
      after: {},
    });
  }

  if (!spans.length) {
    addSpan({ kind: 'unchanged', from: 0, to: after.length });
  }

  return { from: fromSha, to: toSha, spans };
};

const replayHistoryOps = (baseDoc: unknown, ops: EditorOp[]): unknown => {
  const returnString = typeof baseDoc === 'string';
  let state = toHistoryState(baseDoc, true);
  let verifiedBody = Boolean(state.body);

  for (const op of ops) {
    // A legacy operation has no schema-aware body projection. Only a complete
    // snapshot operation can establish a new restorable ProseMirror state.
    if (op.op !== 'pm_step') verifiedBody = false;
    if (op.op === 'replace_text') {
      state = { ...state, text: applyTextReplace(state.text, op.from, op.to, op.text) };
      continue;
    }
    if (op.op === 'delete_range') {
      state = { ...state, text: applyTextReplace(state.text, op.from, op.to, '') };
      continue;
    }
    if (op.op === 'insert_node') {
      state = {
        ...state,
        nodes: [...(state.nodes ?? []), { pos: op.pos, node: cloneJson(op.node) }].sort(
          (a, b) => a.pos - b.pos,
        ),
      };
      continue;
    }
    if (op.op === 'set_attr') {
      state = {
        ...state,
        attrs: {
          ...(state.attrs ?? {}),
          [op.nodeId]: {
            ...(state.attrs?.[op.nodeId] ?? {}),
            ...cloneJson(op.attrs),
          },
        },
      };
      continue;
    }
    if (op.op === 'add_mark') {
      assertRange(state.text, op.from, op.to);
      state = {
        ...state,
        marks: [...(state.marks ?? []), { from: op.from, to: op.to, mark: cloneJson(op.mark) }],
      };
      continue;
    }
    if (op.op === 'remove_mark') {
      assertRange(state.text, op.from, op.to);
      state = {
        ...state,
        marks: (state.marks ?? []).filter(
          (mark) =>
            !(mark.mark.type === op.mark.type && mark.from === op.from && mark.to === op.to),
        ),
      };
      continue;
    }
    if (op.op === 'pm_step') {
      if (isRecord(op.step) && op.step.type === 'lash_replace_doc' && 'doc' in op.step) {
        state = toHistoryState(op.step.doc);
        verifiedBody = Boolean(state.body);
        continue;
      }
      if (isRecord(op.step) && op.step.type === 'lash_patch_body_v1' && state.body) {
        state.body = applyBodyPatch(state.body, op.step.changes);
        verifiedBody = true;
        continue;
      }
      throw new Error('history.replayOps: unsupported pm_step without editor schema registry');
    }
  }

  if (!verifiedBody) delete state.body;
  return returnString ? state.text : state;
};

/** Replay a sequence of ops against a base doc to reproduce a later state. */
export const replayOps = (baseDoc: unknown, ops: EditorOp[]): unknown =>
  cloneJson(replayHistoryOps(baseDoc, ops));
