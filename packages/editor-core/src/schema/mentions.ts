/**
 * @lash/editor-core/schema/mentions — @user / @group / @date mention extensions.
 * Status: SLOT — to be filled by M3/D1.
 *
 * Lane D1 owns this file.
 */

import type { MentionContext, MentionProvider } from '@lash/mentions';
import type { Extensions } from '@tiptap/core';

export interface LashMentionOptions {
  context?: MentionContext;
  /** Resolved at editor-init time; the suggestion plugin queries this. */
  providers?: { user?: MentionProvider; group?: MentionProvider };
}

/** Returns an empty extensions array until M3/D1 lands. */
export const buildMentionExtensions = (_options?: LashMentionOptions): Extensions => [];
