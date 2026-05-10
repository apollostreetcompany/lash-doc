/**
 * @lash/types — load-bearing data contracts shared across all Lash apps & packages.
 *
 * These shapes are FROZEN once a milestone consumes them. Changes require
 * a coordinated PR that updates every consumer in one go.
 *
 * Mapping to milestones (see plan.md):
 *   M2 (Phase 1 collab/history): EditorOp, HistoryEntry, AuthorshipInterval, Anchor
 *   M3 (Phase 2 share/mentions/chat): ShareToken, RevocationRecord, MentionResolveResult
 *   M4 (Phase 3 AI):                  EditPatch, EditPatchCitation, ValidationConfirmations
 *   M2/M5 (diff + filtered diffs):    DiffJSON, DiffSpan
 */

// ---------- minimal exports (preserved across iterations) ----------

export type DocumentId = string & { readonly brand: unique symbol };

export interface LashUser {
  id: string;
  displayName: string;
  email?: string;
}

export interface FeatureFlag {
  name: string;
  enabled: boolean;
}

export interface LashEnvironment {
  buildSha: string;
  flags: FeatureFlag[];
}

export const createDocumentId = (value: string): DocumentId => value as DocumentId;

// ---------- Actor + intent (used by HistoryEntry, EditPatch, audit) ----------

export type ActorRef =
  | { type: 'user'; id: string }
  | { type: 'ai'; id: string; label?: string }
  | { type: 'system'; id: string };

export type Intent = 'edit' | 'suggest' | 'ai';

// ---------- M2: EditorOp ----------
//
// EditorOp is the canonical edit-pipeline operation. Both human and AI edits
// flow through the SAME variants (per agents.md determinism principle), but
// the pipeline is intentionally a strict superset:
//
//   - High-level "intent" ops (replace_text, set_attr, add/remove_mark, etc.)
//     are emitted by AI patches and most human commands. They are easy to
//     validate, audit, render in diffs, and reason about for authorship.
//
//   - `pm_step` is the escape hatch for arbitrary ProseMirror Step JSON
//     (split, join, replaceAround, AddNodeMark, etc.). It is used by
//     collab-service for raw CRDT-derived steps and by replay/restore paths.
//     pm_step is intentionally NOT typed in detail here — its payload is a
//     PM Step.toJSON() result and consumers must round-trip via PM's Step.fromJSON.
//
// Positions are interpreted relative to the containing context's baseVersion:
//   - When ops live in a HistoryEntry, baseVersion = HistoryEntry.parentSha.
//   - When ops live in an EditPatch, baseVersion = EditPatch.baseVersion.
//   - For positions that must survive across versions (chat anchors, blame
//     gutter, share-link-scoped diffs), use Anchor / AuthorshipInterval / DiffSpan,
//     all of which carry their own baseVersion + disambiguators.

export interface BaseEditorOp {
  /** Position-mapping bias when this op is rebased through later transforms.
   *  Defaults to -1 (left-biased) per ProseMirror's `Mapping.map` convention. */
  assoc?: -1 | 1;
}

export interface ReplaceTextOp extends BaseEditorOp {
  op: 'replace_text';
  from: number;
  to: number;
  text: string;
}

export interface InsertNodeOp extends BaseEditorOp {
  op: 'insert_node';
  pos: number;
  /** ProseMirror JSON node */
  node: unknown;
}

export interface DeleteRangeOp extends BaseEditorOp {
  op: 'delete_range';
  from: number;
  to: number;
}

export interface SetAttrOp extends BaseEditorOp {
  op: 'set_attr';
  nodeId: string;
  attrs: Record<string, unknown>;
}

export interface AddMarkOp extends BaseEditorOp {
  op: 'add_mark';
  from: number;
  to: number;
  mark: { type: string; attrs?: Record<string, unknown> };
}

export interface RemoveMarkOp extends BaseEditorOp {
  op: 'remove_mark';
  from: number;
  to: number;
  mark: { type: string };
}

/** Escape hatch for arbitrary ProseMirror Step JSON.
 *
 *  RULE FOR DIFF / AUTHORSHIP / FILTERED-DIFF CONSUMERS (locked to keep
 *  the determinism invariant intact across pm_step ops):
 *
 *    1. `Step.fromJSON(schema, step)` is the canonical interpretation. The
 *       schema is resolved via the producing context's `schemaVersion`
 *       (HistoryEntry.schemaVersion or EditPatch.schemaVersion) → an editor
 *       schema registry exposed by @lash/editor-core.
 *    2. Position mapping uses `step.getMap()` — the same map used by PM's
 *       internal Mapping. Consumers MUST iterate the StepMap and translate
 *       their own data structures (anchors, intervals, diff spans) through it.
 *    3. Span attribution: when a `pm_step` produces inserted/deleted ranges,
 *       authorship and DiffSpan use the producing HistoryEntry's `actor` and
 *       `intent` exactly as for high-level ops — pm_step is NEVER opaque to
 *       attribution.
 *    4. Authorship intervals over pm_step-produced text use
 *       `sourceOpIndex` pointing at the pm_step entry; downstream consumers
 *       resolve metadata via the producing entry, not via the step payload.
 *    5. Unknown PM step types (custom plugins): consumers fall back to the
 *       net-position delta from `step.getMap()`. They never silently drop
 *       attribution.
 *  This rule is invariant; changing it requires a coordinated PR across
 *  packages/history, packages/authorship, and packages/doc-chat. */
export interface PmStepOp extends BaseEditorOp {
  op: 'pm_step';
  /** Output of `Step.toJSON()`. Consumers round-trip via `Step.fromJSON(schema, step)`. */
  step: unknown;
}

export type EditorOp =
  | ReplaceTextOp
  | InsertNodeOp
  | DeleteRangeOp
  | SetAttrOp
  | AddMarkOp
  | RemoveMarkOp
  | PmStepOp;

// ---------- M2: HistoryEntry + audit ----------

/** Audit metadata required by agents.md security gate — the audit log MUST be
 *  able to identify a write source. The type is a union enforcing "at least
 *  one of ipHash | ua" at compile time so `audit: {}` cannot typecheck. When
 *  no IP is genuinely available (e.g., system-actor migrations), set `ua` to
 *  a stable migration tag and use the `system:` actor type. */
export type HistoryAudit =
  | { ipHash: string; ua?: string }
  | { ipHash?: string; ua: string };

export interface HistoryEntry {
  /** uuid */
  id: string;
  docId: DocumentId;
  actor: ActorRef;
  /** ISO-8601 UTC */
  ts: string;
  /** REQUIRED: sha256 of doc state immediately before these ops applied.
   *  Append MUST reject when this does not match the current head — this is
   *  the concurrency-control invariant that prevents forked writes. */
  parentSha: string;
  /** sha256 of doc state after these ops applied */
  resultSha: string;
  /** Monotonically-increasing per-doc sequence; assigned by the history layer
   *  on `append`, never by the emitter. (EditPatch / EditorOp do not carry seq.) */
  seq: number;
  /** Lamport clock for distributed-determinism; optional in single-region. */
  lamport?: number;
  /** Editor-schema version these ops were authored against. Required by
   *  PmStepOp consumers to call `Step.fromJSON(schema, step)` deterministically
   *  across schema evolution. Format is a stable identifier owned by
   *  @lash/editor-core (e.g., `"lash-schema-v1"`). */
  schemaVersion: string;
  ops: EditorOp[];
  intent: Intent;
  /** Present when this entry restores a prior version (never destructive). */
  restoredFromVersion?: string;
  /** Required audit metadata per agents.md security acceptance. */
  audit: HistoryAudit;
}

// ---------- M2: Anchor (for chat threads, comments, decorations) ----------

export interface AnchorToken {
  /** N characters before the anchor, in `baseVersion`'s doc */
  before: string;
  /** N characters after the anchor */
  after: string;
  /** the anchored text itself */
  text: string;
  /** 0-indexed occurrence within the containing block when `text` repeats;
   *  required to disambiguate when the same string appears multiple times. */
  occurrence: number;
  /** Stable id of the containing block node when available. */
  nodeId?: string;
  /** Path from doc root to the containing block; used for CRDT-stable mapping
   *  when block contents shift but the block itself survives. */
  nodePath?: number[];
  /** Optional confidence score (0-1) used by recovery heuristics. */
  confidence?: number;
}

export interface Anchor {
  /** sha256 at which this anchor was minted */
  baseVersion: string;
  /** Numeric range in `baseVersion`'s doc */
  from: number;
  to: number;
  /** Position-mapping bias for stability under concurrent edits. */
  assoc?: -1 | 1;
  /** Recovery token used when `from`/`to` no longer map cleanly. */
  token: AnchorToken;
  /** When the original range was destroyed, the anchor is pinned to the
   *  nearest surviving token and marked `orphaned: true`. */
  orphaned?: boolean;
}

// ---------- M2: AuthorshipInterval ----------

export interface AuthorshipInterval {
  /** Numeric range in the doc at `sourceEntryId`'s resultSha. */
  from: number;
  to: number;
  authorId: string;
  /** ISO-8601 ts of the op that produced this interval. */
  ts: string;
  /** Stable id of the containing text node, when available — used to
   *  recover blame after CRDT-driven structural rearrangements. */
  nodeId?: string;
  /** Backref to the HistoryEntry that produced this interval. */
  sourceEntryId: string;
  /** Index of the producing op within `HistoryEntry.ops`. */
  sourceOpIndex: number;
  /** Authorship intervals are kept non-overlapping by the interval-tree
   *  implementation in `@lash/authorship`; consumers MAY rely on this. */
}

// ---------- M3: ShareToken + RevocationRecord ----------

export type ShareScope = 'view' | 'comment' | 'suggest' | 'edit';

export interface ShareToken {
  /** Unique token id (JWT `jti`). Used for revocation lookups. */
  jti: string;
  /** Signed token (JWT or similar); opaque to clients. */
  token: string;
  docId: DocumentId;
  scope: ShareScope;
  /** ISO-8601 UTC; null = no expiry. */
  expiresAt: string | null;
  /** Issuer user id. */
  issuedBy: string;
  /** sha256 of the redaction policy in effect. The full policy JSON is
   *  resolved server-side via `redactionPolicyVersion`. */
  redactionPolicy: string;
  /** Schema version of the redaction policy (e.g. 1, 2). Bumps require
   *  a coordinated server rollout. */
  redactionPolicyVersion: number;
}

export interface RevocationRecord {
  jti: string;
  /** ISO-8601 UTC */
  revokedAt: string;
  revokedBy: string;
  reason?: string;
}

// ---------- M3: MentionResolveResult (discriminated union for RBAC safety) ----------

export type MentionKind = 'user' | 'group' | 'date';

/** Visible mention — caller may see real id and display. */
export interface VisibleMentionResult {
  visible: true;
  kind: MentionKind;
  refId: string;
  display: string;
  /** ISO-8601 in caller's timezone, present for date mentions. */
  iso?: string;
}

/** Hidden mention — caller may NOT see real id/display.
 *  Render as anonymized token; never includes the real ref or display. */
export interface AnonymizedMentionResult {
  visible: false;
  /** Stable opaque token suitable for screen-reader rendering, e.g. `@hidden-user`. */
  anonymizedDisplay: string;
}

export type MentionResolveResult = VisibleMentionResult | AnonymizedMentionResult;

// ---------- M4: EditPatch (the AI-and-programmatic patch envelope) ----------

/** Discriminated union — citations are either doc ranges or external URLs.
 *  Doc citations carry baseVersion so the citation jump UX (I.4) can navigate
 *  to the exact slice even after the doc has changed. */
export type EditPatchCitation =
  | { type: 'doc'; baseVersion: string; rangeFrom: number; rangeTo: number }
  | { type: 'url'; href: string };

export interface EditPatch {
  /** uuid */
  patchId: string;
  docId: DocumentId;
  /** sha256 of the doc state the patch was generated atop. Validator MUST
   *  refuse to apply when `baseVersion` does not equal the current head, OR
   *  rebase by re-running the validator with the new baseVersion. */
  baseVersion: string;
  /** Editor-schema version these ops were authored against. Required by
   *  PmStepOp consumers and by the validator (the patch's pm_step ops must
   *  be Step.fromJSON-able under this schema version). */
  schemaVersion: string;
  author: ActorRef;
  /** ISO-8601 UTC */
  createdAt: string;
  operations: EditorOp[];
  rationale: string;
  citations?: EditPatchCitation[];
  /** Marks a patch that intends to mutate beyond the user's selection.
   *  An AI-emitted patch may set this to `true`, but the validator MUST
   *  also receive `globalEditConfirmed: true` in `ValidationConfirmations`
   *  before applying. (See I.3 ai-scope-global-confirm.) */
  allowGlobal?: boolean;
}

/** Out-of-band confirmations the validator requires for sensitive operations. */
export interface ValidationConfirmations {
  /** True iff the user confirmed via the doc-wide modal (I.3). */
  globalEditConfirmed?: boolean;
}

// ---------- M2/M5: DiffJSON (deterministic, filterable diff output) ----------

export type DiffSpanKind = 'unchanged' | 'inserted' | 'deleted' | 'attrChanged';

export interface DiffSpanBase {
  /** Stable, deterministic id for this span (consumed by share-link filters,
   *  copy-link state, and SR announcements). Computed from {kind,from,to,...}. */
  id: string;
  /** Position in the LATER version (target of diff render). */
  from: number;
  to: number;
  /** Backref to the producing HistoryEntry; required for filtered diffs (D.3). */
  entryId?: string;
  /** Index of the producing op within `HistoryEntry.ops`. */
  opIndex?: number;
  /** Author for filtered-by-author diffs. */
  authorId?: string;
  /** Actor type for filtered-by-AI diffs. */
  actorType?: ActorRef['type'];
  intent?: Intent;
  /** ISO-8601 ts of the producing op (filter by time-range). */
  ts?: string;
  /** True iff this span is hidden under the current redaction policy.
   *  The consumer SHOULD render a redacted placeholder; counts MUST remain accurate. */
  redacted?: boolean;
}

export interface UnchangedSpan extends DiffSpanBase {
  kind: 'unchanged';
}

export interface InsertedSpan extends DiffSpanBase {
  kind: 'inserted';
  text: string;
}

export interface DeletedSpan extends DiffSpanBase {
  kind: 'deleted';
  text: string;
}

export interface AttrChangedSpan extends DiffSpanBase {
  kind: 'attrChanged';
  nodeId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export type DiffSpan = UnchangedSpan | InsertedSpan | DeletedSpan | AttrChangedSpan;

export interface DiffJSON {
  /** sha256 of the "from" version */
  from: string;
  /** sha256 of the "to" version */
  to: string;
  spans: DiffSpan[];
}

// ---------- Canonical serialization + deterministic hash ----------
//
// `canonicalize` is the SINGLE source of truth for byte-identical JSON
// serialization across CI, dev, and prod. All hashing (parentSha, resultSha,
// diff fingerprints, EditPatch.baseVersion, redactionPolicy) MUST go through
// `canonicalize` → `hashCanonical`. History/diff/share/AI implementations
// MUST NOT inject their own hash function (proconsult-m0/B P0 #5).
//
// **Cross-the-wire validation.** These types are TypeScript-checked at
// compile time but not runtime-validated. Before apps/api / apps/realtime-
// gateway / apps/ai-orchestrator accept any of these shapes off the wire,
// the receiving boundary MUST run them through a generated zod/valibot
// validator (see plan.md M3 prerequisite). Without it, malformed payloads
// from a misbehaving client could bypass the discriminated-union invariants.

/** Strict JSON-only canonicalization. Rejects every non-plain-JSON input —
 *  no Date, RegExp, Map, Set, BigInt, Symbol, Function, NaN, ±Infinity, or
 *  class instances — so equivalents like `new Date()` cannot silently
 *  collapse to `{}` and produce a divergent hash on a future round-trip.
 *
 *  Rules:
 *    - Allowed: string, finite number (incl. -0 normalized to 0), boolean,
 *      null, plain object (Object.prototype only), array.
 *    - Object keys: own enumerable string keys only, sorted lexicographically.
 *      Symbol keys ignored. `undefined`-valued entries omitted.
 *    - Numbers: NaN/±Infinity rejected. -0 emitted as `0` for stability
 *      (JSON.stringify already does this; documented here as a guarantee).
 *    - Top-level `undefined`/function/symbol rejected (would otherwise
 *      produce JSON.stringify === undefined and a TypeError downstream).
 *
 *  Output is byte-identical across Node + browsers for equivalent inputs. */
export const canonicalize = (value: unknown): string => {
  const isPlainObject = (v: unknown): v is Record<string, unknown> => {
    if (v === null || typeof v !== 'object') return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  };

  const normalize = (v: unknown, path: string): unknown => {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'string' || t === 'boolean') return v;
    if (t === 'number') {
      if (!Number.isFinite(v as number)) {
        throw new Error(`canonicalize: non-finite number at ${path || '<root>'}`);
      }
      // Normalize -0 to 0. JSON.stringify already does this, but be explicit.
      return Object.is(v, -0) ? 0 : v;
    }
    if (t === 'bigint') {
      throw new Error(`canonicalize: bigint not supported at ${path || '<root>'}`);
    }
    if (t === 'symbol' || t === 'function' || t === 'undefined') {
      throw new Error(`canonicalize: ${t} not allowed at ${path || '<root>'}`);
    }
    // typeof === 'object' (including arrays)
    if (Array.isArray(v)) {
      return v.map((child, i) => normalize(child, `${path}[${i}]`));
    }
    if (!isPlainObject(v)) {
      const ctor = (v as { constructor?: { name?: string } })?.constructor?.name ?? 'object';
      throw new Error(`canonicalize: non-plain ${ctor} not allowed at ${path || '<root>'}`);
    }
    const sorted: Record<string, unknown> = {};
    const obj = v;
    for (const k of Object.keys(obj).sort()) {
      const child = obj[k];
      if (child === undefined) continue;
      sorted[k] = normalize(child, path ? `${path}.${k}` : k);
    }
    return sorted;
  };
  return JSON.stringify(normalize(value, ''));
};

/** Resolve a Web-Crypto-compatible subtle implementation across runtimes:
 *    - Browsers + Node 20+: `globalThis.crypto.subtle` is present.
 *    - jsdom (Vitest default for editor tests): `crypto` is present but
 *      `crypto.subtle` is NOT polyfilled — fall back to Node's webcrypto.
 *    - Older Node: also fall back to Node's webcrypto.
 *
 *  The Node fallback is gated behind a Node-runtime check so browser bundlers
 *  (esbuild/rollup/webpack) can statically eliminate the `node:crypto`
 *  dynamic import via dead-code elimination when `process` is undefined.
 *  Cached after first resolution. */
let _subtleCache: SubtleCrypto | null = null;
const resolveSubtle = async (): Promise<SubtleCrypto> => {
  if (_subtleCache) return _subtleCache;
  const native = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (native && typeof native.digest === 'function') {
    _subtleCache = native;
    return native;
  }
  // Node-only fallback. The runtime guard lets browser bundlers tree-shake
  // the dynamic import (when `process` is undefined the branch is provably
  // unreachable, and esbuild/rollup elide the `node:crypto` chunk).
  const isNode =
    typeof process !== 'undefined' &&
    typeof (process as { versions?: { node?: string } }).versions?.node === 'string';
  if (!isNode) {
    throw new Error('hashCanonical: SubtleCrypto.digest unavailable and not running on Node');
  }
  const mod = (await import('node:crypto')) as { webcrypto?: { subtle?: SubtleCrypto } };
  const subtle = mod.webcrypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new Error('hashCanonical: no SubtleCrypto.digest available in this runtime');
  }
  _subtleCache = subtle;
  return subtle;
};

/** SHA-256 hex digest of `canonicalize(value)`. Single source of truth for
 *  parentSha, resultSha, EditPatch.baseVersion, and redactionPolicy hashes.
 *  Works in Node 20+, modern browsers, and jsdom (via node:crypto fallback). */
export const hashCanonical = async (value: unknown): Promise<string> => {
  const text = canonicalize(value);
  const data = new TextEncoder().encode(text);
  const subtle = await resolveSubtle();
  const buf = await subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
};
