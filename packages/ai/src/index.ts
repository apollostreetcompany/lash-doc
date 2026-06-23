/**
 * @lash/ai — EditPatch validator, selection-scope guardrails, citation formatting.
 * Status: SCAFFOLD — implement in M4/E1 (validator), M4/E3 (citations).
 *
 * Guardrails (per agents.md I.3 ai-scope-global-confirm):
 *   - Validator refuses doc-wide patches unless EditPatch.allowGlobal === true
 *     AND ValidationConfirmations.globalEditConfirmed === true.
 *   - The patch payload alone CAN'T satisfy global edits — the user must
 *     confirm out-of-band via the doc-wide modal. (proconsult-m0/B P1 #11.)
 */

import type { EditPatch, ValidationConfirmations, EditorOp } from '@lash/types';

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'schema-invalid'
        | 'base-version-stale'
        | 'out-of-scope'
        | 'doc-wide-without-confirm'
        | 'unsafe-op'
        | 'too-many-ops';
      details?: string;
    };

export interface ValidatorOptions {
  /** The doc state JSON the patch should apply atop. Must be the doc whose
   *  sha256 (via `hashCanonical`) equals `EditPatch.baseVersion`. */
  baseDoc: unknown;
  /** Optional precomputed sha256 of `baseDoc` (via `hashCanonical` from
   *  `@lash/types`). When supplied, the validator compares it against
   *  `EditPatch.baseVersion` and rejects with `'base-version-stale'` on
   *  mismatch. Hashing is async and `validateEditPatch` is a pure synchronous
   *  function, so the caller hashes `baseDoc` out-of-band and passes the digest
   *  here. When omitted, staleness is enforced solely at the host apply
   *  boundary (see EditorWorkspace.handleApplyAiPatch). */
  baseVersionHash?: string;
  /** The user's selection at request time; ops must lie within unless
   *  `allowGlobal: true` AND `confirmations.globalEditConfirmed: true`. */
  selection: { from: number; to: number } | null;
  /** Schema definition for invariant checks. */
  schemaSummary: { nodeTypes: string[]; markTypes: string[] };
  /** Out-of-band confirmations gathered by the host UI. */
  confirmations: ValidationConfirmations;
}

const MAX_PATCH_OPS = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const rangeIsValid = (from: number, to: number) =>
  Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from;

const opRange = (op: EditorOp): { from: number; to: number } | null => {
  switch (op.op) {
    case 'replace_text':
    case 'delete_range':
    case 'add_mark':
    case 'remove_mark':
      return { from: op.from, to: op.to };
    case 'insert_node':
      return { from: op.pos, to: op.pos };
    default:
      return null;
  }
};

const opIsSchemaSafe = (
  op: EditorOp,
  schemaSummary: ValidatorOptions['schemaSummary'],
): ValidationResult => {
  switch (op.op) {
    case 'replace_text':
      return rangeIsValid(op.from, op.to) && typeof op.text === 'string'
        ? { ok: true }
        : { ok: false, reason: 'schema-invalid', details: 'replace_text range is invalid' };
    case 'delete_range':
      return rangeIsValid(op.from, op.to)
        ? { ok: true }
        : { ok: false, reason: 'schema-invalid', details: 'delete_range range is invalid' };
    case 'insert_node': {
      if (!Number.isInteger(op.pos) || op.pos < 0) {
        return { ok: false, reason: 'schema-invalid', details: 'insert_node position is invalid' };
      }
      if (!isRecord(op.node) || typeof op.node.type !== 'string') {
        return { ok: false, reason: 'schema-invalid', details: 'insert_node requires a node type' };
      }
      return schemaSummary.nodeTypes.includes(op.node.type)
        ? { ok: true }
        : {
            ok: false,
            reason: 'schema-invalid',
            details: `Unsupported node type: ${op.node.type}`,
          };
    }
    case 'set_attr':
      return op.nodeId && isRecord(op.attrs)
        ? { ok: true }
        : { ok: false, reason: 'schema-invalid', details: 'set_attr requires nodeId and attrs' };
    case 'add_mark':
      if (!rangeIsValid(op.from, op.to)) {
        return { ok: false, reason: 'schema-invalid', details: 'add_mark range is invalid' };
      }
      return schemaSummary.markTypes.includes(op.mark.type)
        ? { ok: true }
        : { ok: false, reason: 'schema-invalid', details: `Unsupported mark: ${op.mark.type}` };
    case 'remove_mark':
      if (!rangeIsValid(op.from, op.to)) {
        return { ok: false, reason: 'schema-invalid', details: 'remove_mark range is invalid' };
      }
      return schemaSummary.markTypes.includes(op.mark.type)
        ? { ok: true }
        : { ok: false, reason: 'schema-invalid', details: `Unsupported mark: ${op.mark.type}` };
    case 'pm_step':
      return {
        ok: false,
        reason: 'unsafe-op',
        details: 'pm_step replay requires the editor schema registry and is blocked locally',
      };
    default:
      return { ok: false, reason: 'unsafe-op', details: 'Unknown operation' };
  }
};

/** A safe fallback patch suggestion when validation fails. */
export const suggestFallback = (patch: EditPatch, reason: ValidationResult): EditPatch | null => {
  if (reason.ok) return null;
  if (reason.reason !== 'out-of-scope' && reason.reason !== 'doc-wide-without-confirm') {
    return null;
  }
  return {
    ...patch,
    patchId: `${patch.patchId}:fallback`,
    operations: [{ op: 'replace_text', from: 0, to: 0, text: '' }],
    rationale: `Fallback: ${reason.details ?? reason.reason}. No mutation was applied.`,
    allowGlobal: false,
  };
};

/** Helper — check whether a list of ops only touches positions inside `selection`. */
export const isWithinSelection = (
  ops: EditorOp[],
  selection: { from: number; to: number },
): boolean => {
  return ops.every((op) => {
    const range = opRange(op);
    if (!range) return false;
    return range.from >= selection.from && range.to <= selection.to;
  });
};

/** Pure function — same input always returns same result. */
export const validateEditPatch = (
  patch: EditPatch,
  options: ValidatorOptions,
): ValidationResult => {
  if (patch.author.type !== 'ai') {
    return { ok: false, reason: 'unsafe-op', details: 'EditPatch author must be an AI actor' };
  }
  if (!patch.schemaVersion || patch.schemaVersion.trim().length === 0) {
    return { ok: false, reason: 'schema-invalid', details: 'schemaVersion is required' };
  }
  if (!Array.isArray(patch.operations) || patch.operations.length === 0) {
    return { ok: false, reason: 'schema-invalid', details: 'at least one operation is required' };
  }
  if (patch.operations.length > MAX_PATCH_OPS) {
    return { ok: false, reason: 'too-many-ops', details: `maximum is ${MAX_PATCH_OPS}` };
  }

  if (options.baseVersionHash !== undefined && options.baseVersionHash !== patch.baseVersion) {
    return {
      ok: false,
      reason: 'base-version-stale',
      details: `Patch baseVersion ${patch.baseVersion} does not match current doc ${options.baseVersionHash}`,
    };
  }

  for (const op of patch.operations) {
    const result = opIsSchemaSafe(op, options.schemaSummary);
    if (!result.ok) return result;
  }

  const withinSelection = options.selection
    ? isWithinSelection(patch.operations, options.selection)
    : false;
  if (!withinSelection) {
    if (patch.allowGlobal && options.confirmations.globalEditConfirmed) return { ok: true };
    if (patch.allowGlobal) {
      return {
        ok: false,
        reason: 'doc-wide-without-confirm',
        details: 'Doc-wide edits require explicit confirmation',
      };
    }
    return { ok: false, reason: 'out-of-scope', details: 'Patch operations exceed selection' };
  }

  return { ok: true };
};

export const applyTextOperations = (baseText: string, operations: EditorOp[]): string => {
  return [...operations]
    .sort((a, b) => {
      const aRange = opRange(a);
      const bRange = opRange(b);
      return (bRange?.from ?? 0) - (aRange?.from ?? 0);
    })
    .reduce((text, op) => {
      if (op.op === 'replace_text') {
        return `${text.slice(0, op.from)}${op.text}${text.slice(op.to)}`;
      }
      if (op.op === 'delete_range') {
        return `${text.slice(0, op.from)}${text.slice(op.to)}`;
      }
      return text;
    }, baseText);
};
