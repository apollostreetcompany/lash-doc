/**
 * @lash/ai — EditPatch validator, selection-scope guardrails, citation formatting,
 *            replayable fixtures for the AI Edit agent.
 * Status: SCAFFOLD — implement in M4/E1 (validator), M4/E3 (citations).
 */

import type { EditPatch } from '@lash/types';

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'schema-invalid' | 'base-version-stale' | 'out-of-scope' | 'doc-wide-without-confirm'; details?: string };

export interface ValidatorOptions {
  /** the doc state JSON the patch should apply atop */
  baseDoc: unknown;
  /** the user's selection at request time; patch ops must lie within unless allowGlobal */
  selection: { from: number; to: number } | null;
  /** schema definition for invariant checks */
  schemaSummary: { nodeTypes: string[]; markTypes: string[] };
}

/** Pure function — same input always returns same result. */
export const validateEditPatch = (_patch: EditPatch, _options: ValidatorOptions): ValidationResult => {
  throw new Error('validateEditPatch: not implemented (M4/E1)');
};

/** A safe fallback patch suggestion when validation fails. */
export const suggestFallback = (_patch: EditPatch, _reason: ValidationResult): EditPatch | null => {
  throw new Error('suggestFallback: not implemented (M4/E1)');
};
