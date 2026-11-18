import { Node, mergeAttributes } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';

export interface ChipResolveResult {
  title: string;
  lastEditor?: string;
  navigationHref?: string;
}

export interface LashChipNodeOptions {
  /** Resolve metadata the current viewer can see without storing it in the document. */
  resolveDocChip?: (docId: string) => ChipResolveResult | null;
  /** Translate a host-specific document address to the canonical stored reference. */
  matchAlternateDocUrl?: (text: string, origin: string) => ChipReference | null;
}

interface ChipReference {
  refId: string;
  href: string;
}

const DOC_PATH = /^\/doc\/([a-z0-9-]{1,96})\/?$/;

export const matchInternalDocUrl = (text: string, origin: string): ChipReference | null => {
  const href = text.trim();
  if (href.startsWith('/')) {
    const refId = DOC_PATH.exec(href)?.[1];
    return refId ? { refId, href: `/doc/${refId}` } : null;
  }

  try {
    const url = new URL(href);
    const refId = DOC_PATH.exec(url.pathname)?.[1];
    if (!refId || url.origin !== origin || href !== `${url.origin}${url.pathname}`) return null;
    return { refId, href: `/doc/${refId}` };
  } catch {
    return null;
  }
};

// Older documents may contain an absolute link. Preserve HTTP(S) links and
// reject schemes that an imported node or collaborative edit could forge.
export const safeChipHref = (href: unknown): string => {
  if (typeof href !== 'string') return '';
  if (DOC_PATH.test(href)) return href;
  try {
    const url = new URL(href);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
};

class LashChipNodeView implements NodeView {
  readonly dom = document.createElement('span');

  private readonly link = document.createElement('a');

  private readonly icon = document.createElement('span');

  private readonly label = document.createElement('span');

  private readonly preview = document.createElement('span');

  private readonly previewTitle = document.createElement('span');

  private readonly previewEditor = document.createElement('span');

  constructor(
    private node: ProseMirrorNode,
    private readonly resolveDocChip: LashChipNodeOptions['resolveDocChip'],
  ) {
    this.dom.contentEditable = 'false';
    this.link.append(this.label);
    this.icon.className = 'lash-chip-icon';
    this.icon.setAttribute('aria-hidden', 'true');
    this.icon.textContent = '\u{1F4C4}';
    this.label.className = 'lash-chip-label';
    this.preview.className = 'lash-chip-preview';
    this.preview.setAttribute('data-testid', 'lash-chip-preview');
    this.preview.setAttribute('role', 'tooltip');
    this.previewTitle.className = 'lash-chip-preview-title';
    this.previewTitle.setAttribute('data-testid', 'lash-chip-preview-title');
    this.previewEditor.className = 'lash-chip-preview-editor';
    this.previewEditor.setAttribute('data-testid', 'lash-chip-preview-editor');
    this.preview.append(this.previewTitle, this.previewEditor);
    this.dom.append(this.link, this.preview);

    this.link.addEventListener('click', (event) => event.stopPropagation());
    this.dom.addEventListener('mouseenter', () => this.showPreview());
    this.dom.addEventListener('mouseleave', () => this.hidePreview());
    this.link.addEventListener('focus', () => this.showPreview());
    this.link.addEventListener('blur', () => this.hidePreview());
    this.updateDom();
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.updateDom();
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  private updateDom(): boolean {
    const href = safeChipHref(this.node.attrs.href);
    const reference = matchInternalDocUrl(href, window.location.origin);
    const metadata = reference ? this.resolveDocChip?.(reference.refId) : null;

    if (href) this.link.setAttribute('href', metadata?.navigationHref ?? href);
    else this.link.removeAttribute('href');
    this.label.textContent = metadata?.title || href || 'Document link';
    this.link.className = metadata ? 'lash-chip' : '';
    this.dom.className = metadata ? 'lash-chip-wrapper' : '';
    if (metadata && reference) {
      if (!this.icon.parentElement) this.link.insertBefore(this.icon, this.label);
      this.dom.setAttribute('data-testid', 'lash-chip-wrapper');
      this.link.setAttribute('data-testid', 'lash-chip');
      this.link.setAttribute('data-chip-kind', 'doc');
      this.link.setAttribute('data-ref-id', reference.refId);
      this.previewTitle.textContent = metadata.title;
      this.previewEditor.textContent = metadata.lastEditor
        ? `Last edited by ${metadata.lastEditor}`
        : '';
    } else {
      this.icon.remove();
      this.dom.removeAttribute('data-testid');
      this.link.removeAttribute('data-testid');
      this.link.removeAttribute('data-chip-kind');
      this.link.removeAttribute('data-ref-id');
      this.previewTitle.textContent = '';
      this.previewEditor.textContent = '';
    }
    this.previewEditor.hidden = !this.previewEditor.textContent;
    this.hidePreview();
    return Boolean(metadata);
  }

  private showPreview() {
    if (!this.updateDom()) return;
    this.preview.style.display = 'inline-flex';
    this.preview.setAttribute('data-visible', 'true');
  }

  private hidePreview() {
    this.preview.style.display = 'none';
    this.preview.removeAttribute('data-visible');
  }
}

const findChipAtSelection = (state: EditorState): { pos: number; node: ProseMirrorNode } | null => {
  const { $from } = state.selection;
  const after = $from.nodeAfter;
  if (after?.type.name === 'chip') return { pos: $from.pos, node: after };
  const before = $from.nodeBefore;
  if (before?.type.name === 'chip') return { pos: $from.pos - before.nodeSize, node: before };
  return null;
};

export const LashChip = Node.create<LashChipNodeOptions>({
  name: 'chip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  // Our exact same-origin paste rule runs before the ordinary Link rule.
  priority: 1010,

  addAttributes() {
    return {
      kind: { default: 'doc', rendered: false },
      refId: {
        default: '',
        rendered: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-ref-id') ?? '',
      },
      // Keep legacy attrs in the schema for old local bodies and shared history.
      // Their contents never drive the rendered link or preview.
      display: { default: '', rendered: false },
      iconUrl: { default: null, rendered: false },
      lastEditor: { default: null, rendered: false },
      href: {
        default: '',
        rendered: false,
        parseHTML: (element: HTMLElement) => safeChipHref(element.getAttribute('href')),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-chip-kind="doc"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const href = safeChipHref(node.attrs.href);
    const refId = DOC_PATH.exec(href)?.[1];
    const attributes = {
      'data-chip-kind': 'doc',
      ...(href ? { href } : {}),
      ...(refId ? { 'data-ref-id': refId } : {}),
    };
    return ['a', mergeAttributes(HTMLAttributes, attributes), href || 'Document link'];
  },

  renderText({ node }) {
    return safeChipHref(node.attrs.href) || 'Document link';
  },

  addNodeView() {
    return ({ node }) => new LashChipNodeView(node, this.options.resolveDocChip);
  },

  addCommands() {
    return {
      revertChipAtSelection:
        () =>
        ({ tr, state, dispatch }: CommandProps) => {
          const found = findChipAtSelection(state);
          if (!found) return false;
          const { pos, node } = found;
          const href = safeChipHref(node.attrs.href);
          if (!href) return false;
          if (!dispatch) return true;
          const link = state.schema.marks.link;
          const text = state.schema.text(href, link ? [link.create({ href })] : []);
          tr.replaceWith(pos, pos + node.nodeSize, text);
          tr.setSelection(TextSelection.create(tr.doc, pos + text.nodeSize));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste: (view, event, slice) => {
            const text = event.clipboardData?.getData('text/plain') ?? '';
            if (
              !this.editor.isEditable ||
              view.state.selection.$from.parent.type.spec.code ||
              slice.content.textBetween(0, slice.content.size, '\n', '\uFFFC').trim() !==
                text.trim()
            )
              return false;
            const origin = window.location.origin;
            const reference =
              matchInternalDocUrl(text, origin) ??
              this.options.matchAlternateDocUrl?.(text, origin);
            if (!reference || !this.options.resolveDocChip?.(reference.refId)) return false;

            const { state } = view;
            const chip = this.type.create(reference);
            view.dispatch(
              state.tr.replaceSelectionWith(chip, false).setMeta('paste', true).scrollIntoView(),
            );
            return true;
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => this.editor.isEditable && this.editor.commands.revertChipAtSelection(),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chip: {
      revertChipAtSelection: () => ReturnType;
    };
  }
}
