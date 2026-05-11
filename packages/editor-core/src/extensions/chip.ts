/**
 * @lash/editor-core/extensions/chip — internal-link "chip" node.
 *
 * A chip is an inline node representing an internal document link. It has:
 *  - `kind: 'doc'` — chip type discriminator (future: 'user', 'group', etc.)
 *  - `refId` — the document id (extracted from URL path)
 *  - `display` — visible label (title or URL)
 *  - `iconUrl?` — optional icon URL
 *  - `lastEditor?` — optional last-editor display name (for hover preview)
 *
 * Behavior:
 *  - Pasted URLs matching the internal-doc pattern auto-convert to chips
 *    via a paste-rule. After insertion the chip kicks off an async resolve
 *    to populate `display` / `iconUrl` / `lastEditor`.
 *  - The chip renders as a styled inline pill with a hover NodeView that
 *    opens a small preview popover (title + last editor).
 *  - Clicking the chip navigates to the doc in the same tab.
 *  - When the caret is inside (or adjacent to) a chip, `Cmd/Ctrl+K`
 *    reverts the chip to a plain link node.
 */

import { Node, mergeAttributes, nodePasteRule } from '@tiptap/core';
import type { CommandProps, NodeViewRendererProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView, NodeView } from '@tiptap/pm/view';

/** Pattern that matches internal-doc URLs (e.g. `https://lash.local/doc/<docId>`). */
export const INTERNAL_DOC_URL_REGEX = /https?:\/\/lash\.local\/doc\/([A-Za-z0-9_-]+)\/?/gi;

/** Single-shot variant for parsing in non-paste contexts. */
const INTERNAL_DOC_URL_SINGLE = /^https?:\/\/lash\.local\/doc\/([A-Za-z0-9_-]+)\/?$/i;

export interface ChipResolveResult {
  title: string;
  iconUrl?: string;
  lastEditor?: string;
}

export interface LashChipNodeOptions {
  /** Resolver returns metadata for a given doc id (or null if not found). */
  resolveDocChip?: (docId: string) => Promise<ChipResolveResult | null>;
}

export interface ChipAttrs {
  kind: 'doc';
  refId: string;
  display: string;
  iconUrl?: string | null;
  lastEditor?: string | null;
  /** Original URL used for revert. */
  href: string;
}

interface ChipStorage {
  resolving: Set<string>;
}

/** Walk the doc and update all chips that reference `refId`. */
const updateChipAttrsByRef = (
  view: EditorView,
  refId: string,
  attrs: Partial<ChipAttrs>,
) => {
  const { state } = view;
  let dirtyTr: Transaction | null = null;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'chip') {
      return true;
    }
    if (node.attrs.refId !== refId) {
      return true;
    }
    const tr: Transaction = dirtyTr ?? state.tr;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
    dirtyTr = tr;
    return false;
  });
  if (dirtyTr) {
    (dirtyTr as Transaction).setMeta('addToHistory', false);
    view.dispatch(dirtyTr);
  }
};

/** NodeView that owns the chip DOM + hover preview popover. */
class LashChipNodeView implements NodeView {
  dom: HTMLElement;

  private chipEl: HTMLAnchorElement;

  private iconEl: HTMLElement;

  private labelEl: HTMLElement;

  private previewEl: HTMLElement;

  private previewTitleEl: HTMLElement;

  private previewEditorEl: HTMLElement;

  private hoverTimer: number | null = null;

  constructor(private node: ProseMirrorNode, private readonly view: EditorView) {
    this.dom = document.createElement('span');
    this.dom.className = 'lash-chip-wrapper';
    this.dom.setAttribute('data-testid', 'lash-chip-wrapper');

    this.chipEl = document.createElement('a');
    this.chipEl.className = 'lash-chip';
    this.chipEl.setAttribute('data-testid', 'lash-chip');
    this.chipEl.setAttribute('contenteditable', 'false');
    this.chipEl.setAttribute('data-chip-kind', 'doc');

    this.iconEl = document.createElement('span');
    this.iconEl.className = 'lash-chip-icon';
    this.iconEl.setAttribute('aria-hidden', 'true');
    this.iconEl.textContent = '\u{1F4C4}';
    this.chipEl.appendChild(this.iconEl);

    this.labelEl = document.createElement('span');
    this.labelEl.className = 'lash-chip-label';
    this.chipEl.appendChild(this.labelEl);

    this.dom.appendChild(this.chipEl);

    this.previewEl = document.createElement('span');
    this.previewEl.className = 'lash-chip-preview';
    this.previewEl.setAttribute('data-testid', 'lash-chip-preview');
    this.previewEl.setAttribute('role', 'tooltip');
    this.previewEl.style.display = 'none';

    this.previewTitleEl = document.createElement('span');
    this.previewTitleEl.className = 'lash-chip-preview-title';
    this.previewTitleEl.setAttribute('data-testid', 'lash-chip-preview-title');
    this.previewEl.appendChild(this.previewTitleEl);

    this.previewEditorEl = document.createElement('span');
    this.previewEditorEl.className = 'lash-chip-preview-editor';
    this.previewEditorEl.setAttribute('data-testid', 'lash-chip-preview-editor');
    this.previewEl.appendChild(this.previewEditorEl);

    this.dom.appendChild(this.previewEl);

    this.chipEl.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
        return;
      }
      const href = this.node.attrs.href as string | undefined;
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof window !== 'undefined') {
        window.location.assign(href);
      }
    });

    this.dom.addEventListener('mouseenter', () => this.showPreview());
    this.dom.addEventListener('mouseleave', () => this.hidePreview());
    this.chipEl.addEventListener('focus', () => this.showPreview());
    this.chipEl.addEventListener('blur', () => this.hidePreview());

    this.updateDom();
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    this.updateDom();
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  stopEvent(): boolean {
    return false;
  }

  destroy(): void {
    if (this.hoverTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  private updateDom() {
    const attrs = this.node.attrs as ChipAttrs;
    const display = attrs.display || attrs.href || 'document';
    this.labelEl.textContent = display;

    if (attrs.iconUrl) {
      this.iconEl.textContent = '';
      this.iconEl.style.backgroundImage = `url(${JSON.stringify(attrs.iconUrl)})`;
      this.iconEl.classList.add('has-image');
    } else {
      this.iconEl.style.backgroundImage = '';
      this.iconEl.classList.remove('has-image');
      this.iconEl.textContent = '\u{1F4C4}';
    }

    this.chipEl.href = attrs.href || '#';
    this.chipEl.setAttribute('data-ref-id', attrs.refId);
    this.chipEl.setAttribute('aria-label', `Internal document link: ${display}`);

    this.previewTitleEl.textContent = display;
    this.previewEditorEl.textContent = attrs.lastEditor
      ? `Last edited by ${attrs.lastEditor}`
      : 'Loading...';
  }

  private showPreview() {
    if (typeof window === 'undefined') return;
    if (this.hoverTimer !== null) {
      window.clearTimeout(this.hoverTimer);
    }
    this.hoverTimer = window.setTimeout(() => {
      this.previewEl.style.display = 'inline-flex';
      this.previewEl.setAttribute('data-visible', 'true');
    }, 80) as unknown as number;
  }

  private hidePreview() {
    if (typeof window === 'undefined') return;
    if (this.hoverTimer !== null) {
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    this.previewEl.style.display = 'none';
    this.previewEl.removeAttribute('data-visible');
  }
}

/** Helper: find the chip node + position that the selection is currently inside (or null). */
export const findChipAtSelection = (
  state: EditorState,
): { pos: number; node: ProseMirrorNode } | null => {
  const { selection } = state;
  const { $from } = selection;
  const after = $from.nodeAfter;
  if (after && after.type.name === 'chip') {
    return { pos: $from.pos, node: after };
  }
  const before = $from.nodeBefore;
  if (before && before.type.name === 'chip') {
    return { pos: $from.pos - before.nodeSize, node: before };
  }
  return null;
};

export const LashChip = Node.create<LashChipNodeOptions, ChipStorage>({
  name: 'chip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      resolveDocChip: undefined,
    } satisfies LashChipNodeOptions;
  },

  addStorage() {
    return {
      resolving: new Set<string>(),
    } satisfies ChipStorage;
  },

  addAttributes() {
    return {
      kind: {
        default: 'doc',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-chip-kind') ?? 'doc',
        renderHTML: (attrs: { kind?: string }) => ({
          'data-chip-kind': attrs.kind ?? 'doc',
        }),
      },
      refId: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-ref-id') ?? '',
        renderHTML: (attrs: { refId?: string }) => ({
          'data-ref-id': attrs.refId ?? '',
        }),
      },
      display: {
        default: '',
        parseHTML: (el: HTMLElement) => el.textContent ?? '',
        renderHTML: () => ({}),
      },
      iconUrl: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-icon-url') ?? null,
        renderHTML: (attrs: { iconUrl?: string | null }) =>
          attrs.iconUrl ? { 'data-icon-url': attrs.iconUrl } : {},
      },
      lastEditor: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-last-editor') ?? null,
        renderHTML: (attrs: { lastEditor?: string | null }) =>
          attrs.lastEditor ? { 'data-last-editor': attrs.lastEditor } : {},
      },
      href: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('href') ?? '',
        renderHTML: (attrs: { href?: string }) =>
          attrs.href ? { href: attrs.href } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-chip-kind]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const display = (node.attrs.display as string) || (node.attrs.href as string) || 'document';
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: 'lash-chip',
        'data-testid': 'lash-chip',
      }),
      display,
    ];
  },

  addNodeView() {
    return (props: NodeViewRendererProps) => {
      return new LashChipNodeView(props.node, props.editor.view);
    };
  },

  addCommands() {
    return {
      insertDocChip:
        (attrs: Partial<ChipAttrs> & { refId: string; href: string }) =>
        ({ tr, state, dispatch }: CommandProps) => {
          const type = state.schema.nodes.chip;
          if (!type) return false;
          const node = type.create({
            kind: 'doc',
            refId: attrs.refId,
            display: attrs.display ?? attrs.href,
            iconUrl: attrs.iconUrl ?? null,
            lastEditor: attrs.lastEditor ?? null,
            href: attrs.href,
          });
          if (!dispatch) return true;
          tr.replaceSelectionWith(node, false);
          return true;
        },
      revertChipAtSelection:
        () =>
        ({ tr, state, dispatch }: CommandProps) => {
          const found = findChipAtSelection(state);
          if (!found) return false;
          const { pos, node } = found;
          const href = (node.attrs.href as string) || '';
          if (!href) return false;
          if (!dispatch) return true;
          const linkType = state.schema.marks.link;
          const display = (node.attrs.display as string) || href;
          const textNode = linkType
            ? state.schema.text(display, [linkType.create({ href })])
            : state.schema.text(display);
          tr.replaceWith(pos, pos + node.nodeSize, textNode);
          const endPos = pos + textNode.nodeSize;
          tr.setSelection(TextSelection.create(tr.doc, endPos));
          return true;
        },
    };
  },

  addPasteRules() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const extension = this;
    return [
      nodePasteRule({
        find: INTERNAL_DOC_URL_REGEX,
        type: this.type,
        getAttributes: (match: RegExpMatchArray) => {
          const href = match[0];
          const refId = match[1] ?? '';
          const resolver = extension.options.resolveDocChip;
          if (resolver && refId) {
            const storage = extension.storage as ChipStorage;
            if (!storage.resolving.has(refId)) {
              storage.resolving.add(refId);
              queueMicrotask(() => {
                Promise.resolve(resolver(refId))
                  .then((result) => {
                    if (!result) return;
                    const view = extension.editor?.view;
                    if (!view) return;
                    updateChipAttrsByRef(view, refId, {
                      display: result.title,
                      iconUrl: result.iconUrl ?? null,
                      lastEditor: result.lastEditor ?? null,
                    });
                  })
                  .catch(() => {
                    // Swallow resolver errors — chip falls back to URL display.
                  })
                  .finally(() => {
                    storage.resolving.delete(refId);
                  });
              });
            }
          }
          return {
            kind: 'doc',
            refId,
            href,
            display: href,
            iconUrl: null,
            lastEditor: null,
          };
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        const { state } = this.editor;
        if (!findChipAtSelection(state)) {
          return false;
        }
        return this.editor.chain().focus().revertChipAtSelection().run();
      },
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chip: {
      insertDocChip: (
        attrs: Partial<ChipAttrs> & { refId: string; href: string },
      ) => ReturnType;
      revertChipAtSelection: () => ReturnType;
    };
  }
}

/** Test helper: detect whether a string is an internal-doc URL. */
export const matchInternalDocUrl = (text: string): { refId: string; href: string } | null => {
  const match = INTERNAL_DOC_URL_SINGLE.exec(text.trim());
  if (!match) return null;
  return { refId: match[1], href: match[0] };
};
