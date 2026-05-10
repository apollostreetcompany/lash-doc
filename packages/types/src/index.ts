/**
 * @lash/types — load-bearing data contracts shared across all Lash apps & packages.
 *
 * These shapes are FROZEN once a milestone consumes them. Changes require
 * a coordinated PR that updates every consumer in one go.
 *
 * Mapping to milestones (see plan.md):
 *   M2 (Phase 1 collab/history): EditorOp, HistoryEntry, AuthorshipInterval, Anchor
 *   M3 (Phase 2 share/mentions/chat): ShareToken, MentionResolveResult
 *   M4 (Phase 3 AI):                  EditPatch
 *   M2/M5 (diff + filtered diffs):    DiffJSON
 */

// ---------- existing minimal exports (preserved) ----------

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

// ---------- M2: EditorOp (the canonical edit-pipeline op) ----------

export type ActorRef =
  | { type: 'user'; id: string }
  | { type: 'ai'; id: string; label?: string }
  | { type: 'system'; id: string };

export type Intent = 'edit' | 'suggest' | 'ai';

export interface BaseEditorOp {
  /** monotonically-increasing client sequence within a session */
  seq: number;
  /** logical clock from collab layer; deterministic across replays */
  lamport?: number;
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
  /** ProseMirror JSON */
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

export type EditorOp =
  | ReplaceTextOp
  | InsertNodeOp
  | DeleteRangeOp
  | SetAttrOp
  | AddMarkOp
  | RemoveMarkOp;

// ---------- M2: HistoryEntry ----------

export interface HistoryEntry {
  /** uuid */
  id: string;
  docId: DocumentId;
  actor: ActorRef;
  /** ISO-8601 UTC */
  ts: string;
  /** sha256 of doc state immediately before these ops applied */
  parentSha?: string;
  /** sha256 of doc state after these ops applied */
  resultSha: string;
  ops: EditorOp[];
  intent: Intent;
  /** present when this entry restores a prior version */
  restoredFromVersion?: string;
}

// ---------- M2: Anchor (used by chat threads, decorations, comments) ----------

export interface Anchor {
  /** snapshot version at which the anchor was minted */
  baseVersion: string;
  from: number;
  to: number;
  /** stable token identity used to recover after edits */
  token: {
    before: string;
    after: string;
    text: string;
  };
  /** if true, the anchor's range was destroyed and is now pinned to nearest survivor */
  orphaned?: boolean;
}

// ---------- M2: AuthorshipInterval ----------

export interface AuthorshipInterval {
  from: number;
  to: number;
  authorId: string;
  /** ts of the op that produced this interval */
  ts: string;
}

// ---------- M3: ShareToken ----------

export type ShareScope = 'view' | 'comment' | 'suggest' | 'edit';

export interface ShareToken {
  /** signed token (JWT-ish) */
  token: string;
  docId: DocumentId;
  scope: ShareScope;
  /** ISO-8601 UTC; null = no expiry */
  expiresAt: string | null;
  /** issuer user id */
  issuedBy: string;
  /** sha256 of allowed redaction policy */
  redactionPolicy: string;
}

// ---------- M3: MentionResolveResult ----------

export type MentionKind = 'user' | 'group' | 'date';

export interface MentionResolveResult {
  kind: MentionKind;
  /** stable id (user/group id, or ISO date) */
  refId: string;
  display: string;
  /** present for date mentions; ISO-8601 in user's timezone */
  iso?: string;
  /** RBAC: false means caller cannot see this entity (anonymized rendering) */
  visible: boolean;
}

// ---------- M4: EditPatch (the AI-and-programmatic patch envelope) ----------

export interface EditPatchCitation {
  type: 'doc' | 'url';
  /** for type=doc */
  rangeFrom?: number;
  rangeTo?: number;
  /** for type=url */
  href?: string;
}

export interface EditPatch {
  /** uuid */
  patchId: string;
  docId: DocumentId;
  /** sha256 of last applied state — used to verify clean apply */
  baseVersion: string;
  author: ActorRef;
  /** ISO-8601 UTC */
  createdAt: string;
  operations: EditorOp[];
  rationale: string;
  citations?: EditPatchCitation[];
  /** when true, requires explicit user confirmation (doc-wide ops) */
  allowGlobal?: boolean;
}

// ---------- M2/M5: DiffJSON (deterministic diff output) ----------

export type DiffSpanKind = 'unchanged' | 'inserted' | 'deleted' | 'attrChanged';

export interface DiffSpan {
  kind: DiffSpanKind;
  /** position in the LATER version (target of diff render) */
  from: number;
  to: number;
  /** present for inserted/deleted spans */
  text?: string;
  /** present for attrChanged spans */
  attrChanges?: { nodeId: string; before: Record<string, unknown>; after: Record<string, unknown> };
  /** authorship for filtered diffs */
  authorId?: string;
  /** ISO-8601 ts of the op that produced this span */
  ts?: string;
}

export interface DiffJSON {
  /** sha256 of "from" version */
  from: string;
  /** sha256 of "to" version */
  to: string;
  spans: DiffSpan[];
}
