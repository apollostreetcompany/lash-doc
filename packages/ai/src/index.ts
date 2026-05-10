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
  /** The user's selection at request time; ops must lie within unless
   *  `allowGlobal: true` AND `confirmations.globalEditConfirmed: true`. */
  selection: { from: number; to: number } | null;
  /** Schema definition for invariant checks. */
  schemaSummary: { nodeTypes: string[]; markTypes: string[] };
  /** Out-of-band confirmations gathered by the host UI. */
  confirmations: ValidationConfirmations;
}

/** Pure function — same input always returns same result. */
export const validateEditPatch = (_patch: EditPatch, _options: ValidatorOptions): ValidationResult => {
  throw new Error('validateEditPatch: not implemented (M4/E1)');
};

/** A safe fallback patch suggestion when validation fails. */
export const suggestFallback = (_patch: EditPatch, _reason: ValidationResult): EditPatch | null => {
  throw new Error('suggestFallback: not implemented (M4/E1)');
};

/** Helper — check whether a list of ops only touches positions inside `selection`. */
export const isWithinSelection = (
  _ops: EditorOp[],
  _selection: { from: number; to: number },
): boolean => {
  throw new Error('isWithinSelection: not implemented (M4/E1)');
};
