/**
 * @lash/editor-core/schema/mentions — @user / @group / @date mention extensions.
 * Status: SLOT — to be filled by M3/D1.
 *
 * Lane D1 owns this file.
 */

import type { MentionContext, MentionProvider } from '@lash/mentions';
import { Node, mergeAttributes, type Extensions } from '@tiptap/core';

export interface LashMentionOptions {
  context?: MentionContext;
  /** Resolved at editor-init time; the suggestion plugin queries this. */
  providers?: { user?: MentionProvider; group?: MentionProvider };
}

const LashMention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      kind: {
        default: 'user',
        parseHTML: (element) => element.getAttribute('data-kind') ?? 'user',
      },
      refId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-ref-id') ?? '',
      },
      display: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-display') ?? '',
      },
      iso: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-iso'),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const iso = typeof node.attrs.iso === 'string' ? node.attrs.iso : undefined;
    const display = String(node.attrs.display ?? '');
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'lash-inline-mention',
        'data-testid': 'lash-inline-mention',
        'data-type': 'mention',
        'data-kind': node.attrs.kind,
        'data-ref-id': node.attrs.refId,
        'data-display': display,
        ...(iso ? { 'data-iso': iso } : {}),
        title: iso ?? display,
      }),
      `@${display}`,
    ];
  },

  renderText({ node }) {
    return `@${String(node.attrs.display ?? '')}`;
  },
});

export const buildMentionExtensions = (_options?: LashMentionOptions): Extensions => [LashMention];
