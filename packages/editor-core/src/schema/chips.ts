/**
 * @lash/editor-core/schema/chips — internal-link "chip" extensions.
 * Status: SLOT — to be filled by M1/B1 (chip-autoconvert/hover/revert).
 *
 * When implemented, this module exposes a `buildChipExtensions(options?)`
 * function that returns the chip Node + any plugins. The function is
 * called from ./index.ts after the base extensions so chips can layer on
 * top of links / paragraphs.
 *
 * Lane B1 owns this file.
 */

import type { Extensions } from '@tiptap/core';

export interface LashChipOptions {
  /** Resolver that returns chip metadata (title, icon, last editor) for a doc id. */
  resolveDocChip?: (docId: string) => Promise<{ title: string; iconUrl?: string; lastEditor?: string } | null>;
}

/** Returns an empty extensions array until M1/B1 lands. */
export const buildChipExtensions = (_options?: LashChipOptions): Extensions => [];
