/**
 * @lash/editor-core/schema/ai — AI-emitted-edit annotations.
 * Status: SLOT — to be filled by M4/E1+E2 (validator + orchestrator UI).
 *
 * When implemented, this module exposes an `aiLabel` mark / decoration
 * applied to ranges produced by an AI EditPatch, so the UI can label and
 * filter AI changes (per agents.md I.1 ai-labeling).
 *
 * Lanes E1 (validator) and E2 (orchestrator) jointly own this file. The
 * mark itself + apply/remove commands belong here; the validator logic
 * stays in `@lash/ai`.
 */

import type { Extensions } from '@tiptap/core';

export interface LashAiSchemaOptions {
  /** When true, AI-applied ranges are decorated visibly (default off). */
  decorateAiRanges?: boolean;
}

/** Returns an empty extensions array until M4/E1+E2 lands. */
export const buildAiExtensions = (_options?: LashAiSchemaOptions): Extensions => [];
