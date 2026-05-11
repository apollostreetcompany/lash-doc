/**
 * @lash/editor-core/schema — composed editor schema.
 *
 * `createLashEditorExtensions(options?)` is the only public entry point.
 * It builds the full extension list by concatenating base + chips + mentions
 * + suggest + ai. Each feature module is owned by one M1-M4 lane (see file
 * headers). Adding a new extension means editing the appropriate sibling
 * module, NOT this index file (the import order here is a stable concat).
 */

import type { Extensions } from '@tiptap/core';

import { type LashAiSchemaOptions, buildAiExtensions } from './ai';
import { type LashSchemaOptions, buildBaseExtensions } from './base';
import { type LashChipOptions, buildChipExtensions } from './chips';
import { type LashMentionOptions, buildMentionExtensions } from './mentions';
import { type LashSuggestOptions, buildSuggestExtensions } from './suggest';

export type { LashSchemaOptions } from './base';
export type { LashChipOptions } from './chips';
export type { LashMentionOptions } from './mentions';
export type { LashSuggestOptions } from './suggest';
export type { LashAiSchemaOptions } from './ai';

export interface LashEditorOptions extends LashSchemaOptions {
  chips?: LashChipOptions;
  mentions?: LashMentionOptions;
  suggest?: LashSuggestOptions;
  ai?: LashAiSchemaOptions;
}

export const createLashEditorExtensions = (options?: LashEditorOptions): Extensions => {
  return [
    ...buildBaseExtensions(options),
    ...buildChipExtensions(options?.chips),
    ...buildMentionExtensions(options?.mentions),
    ...buildSuggestExtensions(options?.suggest),
    ...buildAiExtensions(options?.ai),
  ];
};
