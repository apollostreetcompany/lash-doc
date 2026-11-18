/**
 * @lash/editor-core/schema/chips — internal-link "chip" extensions.
 *
 * Wires the `LashChip` Node into the editor schema. A chip is an inline
 * atom node representing a resolved internal-doc link. The Node itself
 * owns:
 *  - parse/serialize rules (anchor with `data-chip-kind`)
 *  - paste handling for accessible same-origin document URLs
 *  - NodeView with click-to-navigate + hover preview + `Cmd/Ctrl+K` revert
 *
 * See `../extensions/chip.ts` for the implementation.
 */

import type { Extensions } from '@tiptap/core';

import { LashChip, type ChipResolveResult } from '../extensions/chip';

export interface LashChipOptions {
  /** Resolve metadata the current viewer can see without storing it in the document. */
  resolveDocChip?: (docId: string) => ChipResolveResult | null;
}

export const buildChipExtensions = (options?: LashChipOptions): Extensions => [
  LashChip.configure({
    resolveDocChip: options?.resolveDocChip,
  }),
];
