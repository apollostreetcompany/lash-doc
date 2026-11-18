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
  /**
   * Forward-looking contract for a future in-editor suggestion plugin. NOTE: the
   * live mention picker is currently driven by the React `MentionPanel`, which
   * calls the providers directly — `buildMentionExtensions` only registers the
   * mention node schema and does not yet consume these options.
   */
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
        rendered: false,
        parseHTML: (element) => element.getAttribute('data-kind') ?? 'user',
      },
      refId: {
        default: '',
        rendered: false,
        parseHTML: (element) => element.getAttribute('data-ref-id') ?? '',
      },
      display: {
        default: '',
        rendered: false,
        parseHTML: (element) => element.getAttribute('data-display') ?? '',
      },
      iso: {
        default: null,
        rendered: false,
        parseHTML: (element) => element.getAttribute('data-iso'),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const hidden = node.attrs.kind === 'group';
    const iso =
      node.attrs.kind === 'date' && typeof node.attrs.iso === 'string' ? node.attrs.iso : undefined;
    const label = visibleMentionLabel(node.attrs);
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'lash-inline-mention',
        'data-testid': 'lash-inline-mention',
        'data-type': 'mention',
        'data-kind': node.attrs.kind,
        ...(!hidden
          ? {
              'data-ref-id': node.attrs.refId,
              'data-display': node.attrs.display,
            }
          : {}),
        ...(iso ? { 'data-iso': iso } : {}),
        title: iso ?? label,
      }),
      label,
    ];
  },

  renderText({ node }) {
    return visibleMentionLabel(node.attrs);
  },
});

export const visibleMentionLabel = (attrs: Readonly<Record<string, unknown>>): string => {
  // There is no account-backed group directory in the editor. A persisted
  // label is not proof that the current reader can see the group.
  if (attrs.kind === 'group') return '@hidden-group';
  return typeof attrs.display === 'string' && attrs.display ? `@${attrs.display}` : '';
};

export const buildMentionExtensions = (_options?: LashMentionOptions): Extensions => [LashMention];
