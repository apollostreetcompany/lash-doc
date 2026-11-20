import { Node, mergeAttributes } from '@tiptap/core';
import type { CommandProps, NodeViewRendererProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Selection, Transaction } from '@tiptap/pm/state';
import { Plugin, PluginKey, Selection as PMSelection } from '@tiptap/pm/state';
import type { EditorView, NodeView } from '@tiptap/pm/view';

export type ImageStatus = 'idle' | 'uploading' | 'error';

export interface LashImageUploader {
  upload: (
    file: File,
    onProgress: (progress: number) => void,
  ) => Promise<{ src: string; width?: number; height?: number }>;
}

export interface LashImageOptions {
  uploader: LashImageUploader;
  initialWidth: number;
}

type UploadPhase =
  | { kind: 'queued'; source: 'insert' | 'retry' }
  | { kind: 'uploading' }
  | { kind: 'retryable' };

interface UploadEntry {
  phase: UploadPhase;
  file: File;
  resized: boolean;
}

type UploadView = Pick<EditorView, 'state' | 'dispatch'>;

interface UploadManager {
  plugin: Plugin;
  hasFile(uploadId: string): boolean;
  /** insert via direct view.dispatch — used by paste/drop handlers (outside CM context) */
  insert(view: UploadView, file: File): void;
  /** retry via direct view.dispatch — used outside CM context */
  retry(view: UploadView, uploadId: string): void;
  /** insert by mutating an existing tr — used inside addCommands so CM dispatches our tr cleanly */
  insertIntoTransaction(state: EditorState, tr: Transaction, view: EditorView, file: File): void;
  /** retry by mutating an existing tr — used inside addCommands */
  retryIntoTransaction(tr: Transaction, view: EditorView, uploadId: string): void;
}

interface LashImageStorage {
  uploadManager: UploadManager | null;
}

const uploadPluginKey = new PluginKey('lashImageUpload');

// Leave room for Yjs encoding and the verified 1 MiB collaboration body limit.
const MAX_BODY_BYTES_WITH_NEW_IMAGE = 768 * 1024;

export class ImageUploadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const findImageByUploadId = (
  doc: ProseMirrorNode,
  uploadId: string,
): { pos: number; node: ProseMirrorNode } | null => {
  let found: { pos: number; node: ProseMirrorNode } | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name === 'image' && node.attrs.uploadId === uploadId) {
      found = { pos, node };
      return false;
    }
    return true;
  });
  return found;
};

const updateImageAttrs = (
  state: EditorState,
  uploadId: string,
  attrs: Record<string, unknown>,
): Transaction | null => {
  const result = findImageByUploadId(state.doc, uploadId);
  if (!result) {
    return null;
  }
  const { pos, node } = result;
  const tr = state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    ...attrs,
  });
  return tr;
};

const createUploadManager = (options: LashImageOptions): UploadManager => {
  const uploads = new Map<string, UploadEntry>();

  const startUpload = async (view: UploadView, uploadId: string, entry: UploadEntry) => {
    if (uploads.get(uploadId) !== entry || entry.phase.kind !== 'queued') return;
    const placeholder = findImageByUploadId(view.state.doc, uploadId);
    if (!placeholder) {
      uploads.delete(uploadId);
      return;
    }
    // A transaction guard may have rejected the retry. Keep the original file.
    if (placeholder.node.attrs.status !== 'uploading') {
      if (entry.phase.source === 'retry') entry.phase = { kind: 'retryable' };
      else uploads.delete(uploadId);
      return;
    }

    // The phase object identifies this particular attempt, even across retries.
    const attempt = (entry.phase = { kind: 'uploading' });
    const isCurrent = () => uploads.get(uploadId) === entry && entry.phase === attempt;
    try {
      const result = await options.uploader.upload(entry.file, (progress) => {
        if (!isCurrent()) return;
        const tr = updateImageAttrs(view.state, uploadId, { progress });
        if (tr) view.dispatch(tr);
      });
      if (!isCurrent()) return;

      const current = findImageByUploadId(view.state.doc, uploadId);
      if (current) {
        const currentWidth = current.node.attrs.width;
        const width =
          typeof result.width === 'number' &&
          result.width > 0 &&
          !entry.resized &&
          (typeof currentWidth !== 'number' || currentWidth === options.initialWidth)
            ? result.width
            : currentWidth;
        const tr = view.state.tr.setNodeMarkup(current.pos, undefined, {
          ...current.node.attrs,
          src: result.src,
          status: 'idle',
          uploadId: null,
          progress: 1,
          previewSrc: null,
          error: null,
          width,
        });
        const bytes = new TextEncoder().encode(JSON.stringify(tr.doc.toJSON()));
        if (bytes.byteLength > MAX_BODY_BYTES_WITH_NEW_IMAGE) {
          throw new ImageUploadError('This document is too large to add this image.', true);
        }
        view.dispatch(tr);
        if (findImageByUploadId(view.state.doc, uploadId)) {
          throw new ImageUploadError(
            'The image could not be added. Try again when editing is available.',
            true,
          );
        }
      }
      if (isCurrent()) uploads.delete(uploadId);
    } catch (error: unknown) {
      if (!isCurrent()) return;
      if (error instanceof ImageUploadError && !error.retryable) uploads.delete(uploadId);
      else entry.phase = { kind: 'retryable' };
      const tr = updateImageAttrs(view.state, uploadId, {
        status: 'error',
        error: error instanceof Error ? error.message : 'The image could not be added.',
      });
      if (tr) view.dispatch(tr);
    }
  };

  const buildPlaceholderNode = (state: EditorState) => {
    const uploadId = `lash-image-${crypto.randomUUID()}`;
    const node = state.schema.nodes.image.create({
      src: '',
      alt: '',
      width: options.initialWidth,
      status: 'uploading',
      uploadId,
      progress: 0,
      error: null,
    });
    return { uploadId, node };
  };

  // Collapse a range without deleting it before an asynchronous file read.
  const insertPlaceholder = (tr: Transaction, node: ProseMirrorNode) => {
    if (!tr.selection.empty) {
      const pos = tr.selection.to;
      return tr.replaceRangeWith(pos, pos, node).scrollIntoView();
    }
    return tr.replaceSelectionWith(node).scrollIntoView();
  };

  const queueInsert = (state: EditorState, tr: Transaction, file: File) => {
    const { uploadId, node } = buildPlaceholderNode(state);
    insertPlaceholder(tr, node);
    const entry: UploadEntry = {
      phase: { kind: 'queued', source: 'insert' },
      file,
      resized: false,
    };
    uploads.set(uploadId, entry);
    return { uploadId, entry };
  };

  const queueRetry = (tr: Transaction, uploadId: string) => {
    const entry = uploads.get(uploadId);
    if (entry?.phase.kind !== 'retryable') return null;
    const image = findImageByUploadId(tr.doc, uploadId);
    if (!image) return null;

    tr.setNodeMarkup(image.pos, undefined, {
      ...image.node.attrs,
      status: 'uploading',
      progress: 0,
      error: null,
    });
    entry.phase = { kind: 'queued', source: 'retry' };
    return entry;
  };

  // Direct events dispatch before starting the file read. TipTap commands defer
  // the read until their transaction has been applied to the editor view.
  const insert = (view: UploadView, file: File) => {
    const tr = view.state.tr;
    const { uploadId, entry } = queueInsert(view.state, tr, file);
    view.dispatch(tr);
    void startUpload(view, uploadId, entry);
  };

  const retry = (view: UploadView, uploadId: string) => {
    const tr = view.state.tr;
    const entry = queueRetry(tr, uploadId);
    if (!entry) return;
    view.dispatch(tr);
    void startUpload(view, uploadId, entry);
  };

  const insertIntoTransaction = (
    state: EditorState,
    tr: Transaction,
    view: EditorView,
    file: File,
  ) => {
    const { uploadId, entry } = queueInsert(state, tr, file);
    queueMicrotask(() => void startUpload(view, uploadId, entry));
  };

  const retryIntoTransaction = (tr: Transaction, view: EditorView, uploadId: string) => {
    const entry = queueRetry(tr, uploadId);
    if (entry) queueMicrotask(() => void startUpload(view, uploadId, entry));
  };

  const plugin = new Plugin({
    key: uploadPluginKey,
    props: {
      handlePaste(view, event) {
        if (!view.editable) return false;
        const items = event.clipboardData?.items;
        if (!items) {
          return false;
        }
        const files: File[] = [];
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              files.push(file);
            }
          }
        }
        if (!files.length) {
          return false;
        }
        event.preventDefault();
        files.forEach((file) => insert(view, file));
        return true;
      },
      handleDrop(view, event) {
        if (!view.editable) return false;
        // Some synthetic DragEvent payloads (Playwright tests, programmatic
        // DataTransfer) populate `items` but not `files`. Read from both,
        // preferring `files` when populated, otherwise extracting from items.
        const dt = event.dataTransfer;
        const candidates: File[] = Array.from(dt?.files ?? []);
        if (!candidates.length && dt?.items) {
          for (let i = 0; i < dt.items.length; i += 1) {
            const item = dt.items[i];
            if (item.kind === 'file') {
              const f = item.getAsFile();
              if (f) candidates.push(f);
            }
          }
        }
        const files = candidates.filter((file) => file.type.startsWith('image/'));
        if (!files.length) {
          return false;
        }
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (coords) {
          const selection = PMSelection.near(view.state.doc.resolve(coords.pos));
          const tr = view.state.tr.setSelection(selection as Selection);
          view.dispatch(tr);
        }
        files.forEach((file) => insert(view, file));
        return true;
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (!uploads.size || !transactions.some((tr) => tr.docChanged)) {
        return null;
      }
      const active = new Set<string>();
      newState.doc.descendants((node) => {
        if (node.type.name === 'image' && typeof node.attrs.uploadId === 'string') {
          active.add(node.attrs.uploadId);
          const entry = uploads.get(node.attrs.uploadId);
          if (entry && node.attrs.width !== options.initialWidth) entry.resized = true;
        }
        return true;
      });
      for (const id of uploads.keys()) {
        if (!active.has(id)) uploads.delete(id);
      }
      return null;
    },
    view() {
      return {
        destroy() {
          uploads.clear();
        },
      };
    },
  });

  return {
    plugin,
    hasFile: (uploadId) => uploads.has(uploadId),
    insert,
    retry,
    insertIntoTransaction,
    retryIntoTransaction,
  };
};

class LashImageNodeView implements NodeView {
  dom: HTMLElement;

  private imageEl: HTMLImageElement;

  private progressEl: HTMLElement;

  private retryButton: HTMLButtonElement;

  private widthSlider: HTMLInputElement;

  private altButton: HTMLButtonElement;

  private infoEl: HTMLElement;

  constructor(
    private node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number,
    private readonly uploadManager: UploadManager,
  ) {
    this.dom = document.createElement('figure');
    this.dom.className = 'lash-image-node';
    this.dom.setAttribute('data-testid', 'lash-image-node');
    this.dom.contentEditable = 'false';

    const wrapper = document.createElement('div');
    wrapper.className = 'lash-image-wrapper';

    this.imageEl = document.createElement('img');
    this.imageEl.className = 'lash-image-media';
    this.imageEl.draggable = false;
    wrapper.appendChild(this.imageEl);

    this.progressEl = document.createElement('div');
    this.progressEl.className = 'lash-image-progress';
    this.progressEl.setAttribute('data-testid', 'image-upload-progress');
    this.progressEl.setAttribute('role', 'status');
    wrapper.appendChild(this.progressEl);

    this.retryButton = document.createElement('button');
    this.retryButton.type = 'button';
    this.retryButton.className = 'lash-image-retry';
    this.retryButton.textContent = 'Try again';
    this.retryButton.setAttribute('data-testid', 'image-retry-button');
    this.retryButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const uploadId = this.node.attrs.uploadId;
      if (typeof uploadId === 'string') {
        this.uploadManager.retry(this.view, uploadId);
      }
      this.view.focus();
    });
    wrapper.appendChild(this.retryButton);

    this.dom.appendChild(wrapper);

    const controls = document.createElement('div');
    controls.className = 'lash-image-controls';

    this.altButton = document.createElement('button');
    this.altButton.type = 'button';
    this.altButton.className = 'lash-image-alt';
    this.altButton.textContent = 'Alt text';
    this.altButton.setAttribute('data-testid', 'image-alt-edit');
    this.altButton.addEventListener('click', () => {
      const next = window.prompt('Image description (alt text)', this.node.attrs.alt ?? '');
      if (next === null) {
        return;
      }
      this.updateNodeAttrs({ alt: next });
      this.view.focus();
    });
    controls.appendChild(this.altButton);

    this.widthSlider = document.createElement('input');
    this.widthSlider.type = 'range';
    this.widthSlider.min = '120';
    this.widthSlider.max = '960';
    this.widthSlider.step = '10';
    this.widthSlider.className = 'lash-image-width-slider';
    this.widthSlider.setAttribute('data-testid', 'image-width-slider');
    this.widthSlider.setAttribute('aria-label', 'Image width');
    this.widthSlider.addEventListener('input', (event) => {
      const value = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
      this.updateNodeAttrs({ width: value });
    });
    this.widthSlider.addEventListener('keydown', (event) => {
      const min = Number.parseInt(this.widthSlider.min, 10);
      const max = Number.parseInt(this.widthSlider.max, 10);
      const current = Number.parseInt(this.widthSlider.value, 10);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = Math.max(current - 10, min);
        this.widthSlider.value = String(next);
        this.updateNodeAttrs({ width: next });
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = Math.min(current + 10, max);
        this.widthSlider.value = String(next);
        this.updateNodeAttrs({ width: next });
      }
    });
    controls.appendChild(this.widthSlider);

    this.infoEl = document.createElement('span');
    this.infoEl.className = 'lash-image-info';
    controls.appendChild(this.infoEl);

    this.dom.appendChild(controls);

    this.updateDom();
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    this.updateDom();
    return true;
  }

  selectNode() {
    this.dom.classList.add('is-selected');
  }

  deselectNode() {
    this.dom.classList.remove('is-selected');
  }

  stopEvent(event: Event) {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return false;
    }
    if (this.dom.contains(target) && target !== this.dom) {
      return true;
    }
    return false;
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    // no-op
  }

  private updateNodeAttrs(attrs: Record<string, unknown>) {
    const pos = this.getPos();
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      ...attrs,
    });
    this.view.dispatch(tr);
    this.view.focus();
  }

  private updateDom() {
    const { attrs } = this.node;
    const width = typeof attrs.width === 'number' ? attrs.width : 320;
    const status: ImageStatus = attrs.status ?? 'idle';

    this.dom.setAttribute('data-status', status);
    this.widthSlider.value = String(width);
    this.imageEl.style.width = `${width}px`;
    this.imageEl.hidden = status !== 'idle' || !attrs.src;

    if (status === 'uploading') {
      this.progressEl.style.display = 'block';
      const percent = Math.round((attrs.progress ?? 0) * 100);
      this.progressEl.textContent = this.uploadManager.hasFile(attrs.uploadId)
        ? `Adding image… ${percent}%`
        : 'Image unavailable. If you added it, paste or drop the original file again.';
      this.retryButton.style.display = 'none';
    } else if (status === 'error') {
      this.progressEl.style.display = 'block';
      this.progressEl.textContent = attrs.error || 'Paste or drop the original image again.';
      this.retryButton.style.display =
        this.view.editable && this.uploadManager.hasFile(attrs.uploadId) ? 'inline-flex' : 'none';
    } else {
      this.retryButton.style.display = 'none';
      this.progressEl.style.display = 'none';
      this.progressEl.textContent = '';
      if (attrs.src) {
        this.imageEl.src = attrs.src;
      }
    }
    if (status !== 'idle' || !attrs.src) this.imageEl.removeAttribute('src');

    const alt = attrs.alt ?? '';
    this.imageEl.alt = alt;
    const baseLabel = alt ? `Alt: ${alt}` : 'Alt text missing';
    this.infoEl.textContent = `${baseLabel} · Width: ${width}px`;
  }
}

export const LashImage = Node.create<LashImageOptions>({
  name: 'image',
  group: 'block',
  draggable: true,
  selectable: true,
  addOptions() {
    return {
      uploader: {
        upload: async () => ({ src: '', width: 360 }),
      },
      initialWidth: 360,
    } satisfies LashImageOptions;
  },
  addStorage() {
    return {
      uploadManager: null,
    } satisfies LashImageStorage;
  },
  addAttributes() {
    return {
      src: {
        default: '',
      },
      alt: {
        default: '',
      },
      width: {
        default: this.options.initialWidth,
      },
      status: {
        default: 'idle',
      },
      uploadId: {
        default: null,
      },
      previewSrc: {
        default: null,
      },
      progress: {
        default: 0,
      },
      error: {
        default: null,
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'img[src]',
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const { src, alt, width } = HTMLAttributes;
    const attrs: Record<string, unknown> = {};
    if (src) {
      attrs.src = src;
    }
    if (alt) {
      attrs.alt = alt;
    }
    if (width) {
      attrs.width = width;
    }
    return ['img', mergeAttributes(attrs)];
  },
  addCommands() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const extension = this;
    return {
      insertImagePlaceholder(file: File) {
        return ({ tr, state, view, dispatch }: CommandProps) => {
          const storage = extension.storage as LashImageStorage;
          if (!storage.uploadManager) {
            return false;
          }
          if (!dispatch) {
            return true;
          }
          storage.uploadManager.insertIntoTransaction(state, tr, view, file);
          return true;
        };
      },
      updateImageAttributes(attrs: Record<string, unknown>) {
        return ({ tr, state, dispatch }: CommandProps) => {
          const { selection } = state;
          let updated = false;
          state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
            if (node.type.name === 'image') {
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  ...attrs,
                });
              }
              updated = true;
              return false;
            }
            return true;
          });
          return updated;
        };
      },
      retryImageUpload(uploadId: string) {
        return ({ tr, view, dispatch }: CommandProps) => {
          const storage = extension.storage as LashImageStorage;
          if (!storage.uploadManager) {
            return false;
          }
          if (!dispatch) {
            return true;
          }
          storage.uploadManager.retryIntoTransaction(tr, view, uploadId);
          return true;
        };
      },
    };
  },
  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const extension = this;
    return (props: NodeViewRendererProps) => {
      const storage = extension.storage as LashImageStorage;
      if (!storage.uploadManager) {
        throw new Error('LashImage upload manager not initialised');
      }
      return new LashImageNodeView(
        props.node,
        props.editor.view,
        props.getPos as () => number,
        storage.uploadManager,
      );
    };
  },
  addProseMirrorPlugins() {
    const manager = createUploadManager(this.options);
    (this.storage as LashImageStorage).uploadManager = manager;
    return [manager.plugin];
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      insertImagePlaceholder: (file: File) => ReturnType;
      updateImageAttributes: (attrs: Record<string, unknown>) => ReturnType;
      retryImageUpload: (uploadId: string) => ReturnType;
    };
  }
}
