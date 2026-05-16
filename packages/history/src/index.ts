/**
 * @lash/history — append-only edit log, deterministic diff engine, restore API.
 * Status: SCAFFOLD — implement in M2/C2 (history log), M2/C3 (diff), M2/C4 (restore).
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

export type AppendResult =
  | { ok: true; entry: HistoryEntry }
  | { ok: false; reason: 'parent-mismatch'; currentHead: string }
  | { ok: false; reason: 'schema-invalid'; details: string }
  | { ok: false; reason: 'rate-limited' };

export interface HistoryStore {
  /** Transactionally append; rejects when expectedParentSha != current head. */
  append(input: AppendInput): Promise<AppendResult>;
  list(docId: DocumentId, filter?: HistoryFilter): Promise<HistoryEntry[]>;
  /** Load doc state at a specific resultSha (uses snapshot if available). */
  loadAt(docId: DocumentId, sha: string): Promise<unknown>;
  /** Restore creates a NEW head entry whose ops reproduce the target state.
   *  Never destructive — older history is preserved. */
  restore(
    docId: DocumentId,
    targetSha: string,
    actor: ActorRef,
    audit: HistoryAudit,
  ): Promise<AppendResult>;
}

export interface CreateHistoryStoreConfig {
  /** Snapshot every N entries; bigger = slower restore, smaller = more storage. */
  snapshotInterval?: number;
  /** Test seam for deterministic entry timestamps. */
  now?: () => string;
}

export interface HistoryDocumentState {
  type: 'doc';
  text: string;
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

const toHistoryState = (doc: unknown): HistoryDocumentState => {
  if (typeof doc === 'string') {
    return { type: 'doc', text: doc };
  }
  if (isRecord(doc) && typeof doc.text === 'string') {
    return cloneJson({
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

const entryIdFor = (docId: DocumentId, seq: number, resultSha: string): string =>
  `history:${String(docId)}:${seq}:${resultSha.slice(0, 12)}`;

const docKey = (docId: DocumentId): string => String(docId);

export const createHistoryStore = (config: CreateHistoryStoreConfig = {}): HistoryStore => {
  const entriesByDoc = new Map<string, HistoryEntry[]>();
  const stateByDoc = new Map<string, Map<string, unknown>>();
  const headByDoc = new Map<string, string>();
  let emptyShaPromise: Promise<string> | null = null;

  const getEmptySha = () => {
    emptyShaPromise = emptyShaPromise ?? hashCanonical(EMPTY_HISTORY_DOC);
    return emptyShaPromise;
  };

  const ensureDocStates = async (key: string): Promise<Map<string, unknown>> => {
    let states = stateByDoc.get(key);
    if (!states) {
      states = new Map<string, unknown>();
      states.set(await getEmptySha(), cloneJson(EMPTY_HISTORY_DOC));
      stateByDoc.set(key, states);
    }
    return states;
  };

  const append: HistoryStore['append'] = async (input) => {
    if (!input.schemaVersion.trim()) {
      return { ok: false, reason: 'schema-invalid', details: 'schemaVersion is required' };
    }
    if (!input.ops.length) {
      return { ok: false, reason: 'schema-invalid', details: 'at least one op is required' };
    }

    const key = docKey(input.docId);
    const states = await ensureDocStates(key);
    const currentHead = headByDoc.get(key) ?? (await getEmptySha());
    if (input.expectedParentSha !== currentHead) {
      return { ok: false, reason: 'parent-mismatch', currentHead };
    }

    const baseDoc = states.get(currentHead);
    if (baseDoc === undefined) {
      return {
        ok: false,
        reason: 'schema-invalid',
        details: `missing state for head ${currentHead}`,
      };
    }

    let resultDoc: unknown;
    try {
      resultDoc = replayOps(baseDoc, input.ops);
    } catch (error) {
      return { ok: false, reason: 'schema-invalid', details: opDetails(error) };
    }

    const resultSha = await hashCanonical(resultDoc);
    const entries = entriesByDoc.get(key) ?? [];
    const seq = entries.length + 1;
    const entry: HistoryEntry = {
      id: entryIdFor(input.docId, seq, resultSha),
      docId: input.docId,
      actor: input.actor,
      ts: config.now?.() ?? new Date().toISOString(),
      parentSha: currentHead,
      resultSha,
      seq,
      lamport: seq,
      schemaVersion: input.schemaVersion,
      ops: cloneJson(input.ops),
      intent: input.intent,
      audit: cloneJson(input.audit),
      ...(input.restoredFromVersion ? { restoredFromVersion: input.restoredFromVersion } : {}),
    };

    entries.push(entry);
    entriesByDoc.set(key, entries);
    states.set(resultSha, cloneJson(resultDoc));
    headByDoc.set(key, resultSha);
    return { ok: true, entry };
  };

  return {
    append,
    async list(docId, filter = {}) {
      const entries = [...(entriesByDoc.get(docKey(docId)) ?? [])];
      return entries.filter((entry) => {
        if (filter.authorId && entry.actor.id !== filter.authorId) return false;
        if (filter.authorType && entry.actor.type !== filter.authorType) return false;
        if (filter.intent && entry.intent !== filter.intent) return false;
        if (filter.since && entry.ts < filter.since) return false;
        if (filter.until && entry.ts > filter.until) return false;
        return true;
      });
    },
    async loadAt(docId, sha) {
      const states = await ensureDocStates(docKey(docId));
      if (!states.has(sha)) {
        throw new Error(`history.loadAt: unknown version ${sha}`);
      }
      return cloneJson(states.get(sha));
    },
    async restore(docId, targetSha, actor, audit) {
      const key = docKey(docId);
      const states = await ensureDocStates(key);
      const currentHead = headByDoc.get(key) ?? (await getEmptySha());
      const currentDoc = states.get(currentHead);
      const targetDoc = states.get(targetSha);
      if (targetDoc === undefined || currentDoc === undefined) {
        return {
          ok: false,
          reason: 'schema-invalid',
          details: `unknown restore target ${targetSha}`,
        };
      }

      const current = toHistoryState(currentDoc);
      const target = toHistoryState(targetDoc);
      return append({
        docId,
        actor,
        expectedParentSha: currentHead,
        schemaVersion: 'lash-schema-v1',
        ops: [{ op: 'replace_text', from: 0, to: current.text.length, text: target.text }],
        intent: 'edit',
        audit,
        restoredFromVersion: targetSha,
      });
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

const textOf = (doc: unknown): string => toHistoryState(doc).text;

const materializeVersions = (entries: HistoryEntry[]): Map<string, unknown> => {
  const states = new Map<string, unknown>();
  let state: unknown = cloneJson(EMPTY_HISTORY_DOC);
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  if (sorted[0]) {
    states.set(sorted[0].parentSha, cloneJson(state));
  }
  for (const entry of sorted) {
    state = replayOps(state, entry.ops);
    states.set(entry.resultSha, cloneJson(state));
  }
  return states;
};

export const computeDiff = (fromSha: string, toSha: string, entries: HistoryEntry[]): DiffJSON => {
  const states = materializeVersions(entries);
  const fromDoc = states.get(fromSha);
  const toDoc = states.get(toSha);
  if (fromDoc === undefined || toDoc === undefined) {
    throw new Error('computeDiff: unknown from/to version');
  }

  const before = textOf(fromDoc);
  const after = textOf(toDoc);
  const toEntry = entries.find((entry) => entry.resultSha === toSha);
  const fromEntry = entries.find((entry) => entry.resultSha === fromSha);
  const spans: DiffSpan[] = [];

  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

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
      entryId: fromEntry?.id,
      authorId: fromEntry?.actor.id,
      actorType: fromEntry?.actor.type,
      intent: fromEntry?.intent,
      ts: fromEntry?.ts,
    });
  }

  const inserted = after.slice(prefix, after.length - suffix);
  if (inserted) {
    addSpan({
      kind: 'inserted',
      from: prefix,
      to: prefix + inserted.length,
      text: inserted,
      entryId: toEntry?.id,
      opIndex: 0,
      authorId: toEntry?.actor.id,
      actorType: toEntry?.actor.type,
      intent: toEntry?.intent,
      ts: toEntry?.ts,
    });
  }

  if (suffix > 0) {
    addSpan({ kind: 'unchanged', from: after.length - suffix, to: after.length });
  }

  if (!spans.length) {
    addSpan({ kind: 'unchanged', from: 0, to: after.length });
  }

  return { from: fromSha, to: toSha, spans };
};

/** Replay a sequence of ops against a base doc to reproduce a later state. */
export const replayOps = (baseDoc: unknown, ops: EditorOp[]): unknown => {
  const returnString = typeof baseDoc === 'string';
  let state = toHistoryState(baseDoc);

  for (const op of ops) {
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
        continue;
      }
      throw new Error('history.replayOps: unsupported pm_step without editor schema registry');
    }
  }

  return returnString ? state.text : state;
};
