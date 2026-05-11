/**
 * @lash/editor-core/schema/suggest — track-changes "suggest mode" marks.
 * Status: SLOT — to be filled by M4/E4 (suggest-visuals/accept/reject).
 *
 * When implemented, this module exposes `inserted` / `deleted` marks plus
 * an Accept/Reject command set. Hover surfaces author + ts + action.
 *
 * Lane E4 owns this file.
 */

import type { Extensions } from '@tiptap/core';

export interface LashSuggestOptions {
  /** When true, insertions/deletions write to the doc as suggest marks
   *  rather than direct text changes. The toggle UI lives in apps/web. */
  enabled?: boolean;
}

/** Returns an empty extensions array until M4/E4 lands. */
export const buildSuggestExtensions = (_options?: LashSuggestOptions): Extensions => [];
