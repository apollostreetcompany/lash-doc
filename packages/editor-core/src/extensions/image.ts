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

interface UploadEntry {
  file: File;
  previewURL: string | null;
}

interface UploadManager {
  plugin: Plugin;
  /** insert via direct view.dispatch — used by paste/drop handlers (outside CM context) */
  insert(view: { state: EditorState; dispatch: (tr: Transaction) => void }, file: File): void;
  /** retry via direct view.dispatch — used outside CM context */
  retry(view: { state: EditorState; dispatch: (tr: Transaction) => void }, uploadId: string): void;
  /** insert by mutating an existing tr — used inside addCommands so CM dispatches our tr cleanly */
  insertIntoTransaction(
    state: EditorState,
    tr: Transaction,
    view: EditorView,
    file: File,
  ): void;
  /** retry by mutating an existing tr — used inside addCommands */
  retryIntoTransaction(
    state: EditorState,
    tr: Transaction,
    view: EditorView,
    uploadId: string,
  ): void;
}

interface LashImageStorage {
  uploadManager: UploadManager | null;
}

const uploadPluginKey = new PluginKey('lashImageUpload');

const generateUploadId = (() => {
  let counter = 0;
  return () => {
    counter += 1;
    return `lash-image-${counter}`;
  };
})();

const findImageByUploadId = (doc: ProseMirrorNode, uploadId: string) => {
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
  const { pos, node } = result as { pos: number; node: ProseMirrorNode };
  const tr = state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    ...attrs,
  });
  return tr;
};

const scheduleUpload = (
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  uploader: LashImageUploader,
  uploadId: string,
  entry: UploadEntry,
  onSuccess: () => void,
  onFailure: () => void,
) => {
  let cancelled = false;
  const onProgress = (progress: number) => {
    if (cancelled) {
      return;
    }
    const tr = updateImageAttrs(view.state, uploadId, { progress });
    if (tr) {
      view.dispatch(tr);
    }
  };

  uploader
    .upload(entry.file, onProgress)
    .then((result) => {
      if (cancelled) {
        return;
      }
      const attrs: Record<string, unknown> = {
        src: result.src,
        status: 'idle',
        uploadId: null,
        progress: 1,
        previewSrc: null,
      };
      if (typeof result.width === 'number' && result.width > 0) {
        attrs.width = result.width;
      }
      const successTr = updateImageAttrs(view.state, uploadId, attrs);
      if (successTr) {
        view.dispatch(successTr);
      }
      onSuccess();
    })
    .catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      const failureTr = updateImageAttrs(view.state, uploadId, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Upload failed',
      });
      if (failureTr) {
        view.dispatch(failureTr);
      }
      onFailure();
    });

  return () => {
    cancelled = true;
    onFailure();
  };
};

const createUploadManager = (options: LashImageOptions): UploadManager => {
  const uploads = new Map<string, UploadEntry>();
  const disposers = new Map<string, () => void>();

  const startUpload = (
    view: { state: EditorState; dispatch: (tr: Transaction) => void },
    uploadId: string,
    entry: UploadEntry,
  ) => {
    uploads.set(uploadId, entry);
    const disposer = scheduleUpload(
      view,
      options.uploader,
      uploadId,
      entry,
      () => {
        if (entry.previewURL && typeof window !== 'undefined' && typeof window.URL?.revokeObjectURL === 'function') {
          window.URL.revokeObjectURL(entry.previewURL);
        }
        uploads.delete(uploadId);
        disposers.delete(uploadId);
      },
      () => {
        // keep preview for retries
      },
    );
    disposers.set(uploadId, disposer);
  };

  const buildPlaceholderNode = (state: EditorState, file: File): { uploadId: string; previewURL: string | null; node: ProseMirrorNode } => {
    const uploadId = generateUploadId();
    const previewURL =
      typeof window !== 'undefined' && typeof window.URL?.createObjectURL === 'function'
        ? window.URL.createObjectURL(file)
        : null;
    const node = state.schema.nodes.image.create({
      src: '',
      previewSrc: previewURL,
      alt: '',
      width: options.initialWidth,
      status: 'uploading',
      uploadId,
      progress: 0,
      error: null,
    });
    return { uploadId, previewURL, node };
  };

  // Direct-dispatch path: used by paste/drop handlers, outside CM context.
  const insert = (
    view: { state: EditorState; dispatch: (tr: Transaction) => void },
    file: File,
  ) => {
    const { uploadId, previewURL, node } = buildPlaceholderNode(view.state, file);
    const tr = view.state.tr.replaceSelectionWith(node).scrollIntoView();
    view.dispatch(tr);
    startUpload(view, uploadId, { file, previewURL });
  };

  const retry = (
    view: { state: EditorState; dispatch: (tr: Transaction) => void },
    uploadId: string,
  ) => {
    const entry = uploads.get(uploadId);
    if (!entry) {
      return;
    }
    startUpload(view, uploadId, entry);
    const resetTr = updateImageAttrs(view.state, uploadId, {
      status: 'uploading',
      progress: 0,
      error: null,
    });
    if (resetTr) {
      view.dispatch(resetTr);
    }
  };

  // Tr-mutation path: used by addCommands so TipTap CommandManager dispatches a single
  // coherent tr. Upload start is deferred to a microtask to ensure the placeholder is
  // committed to view.state before scheduleUpload's first onProgress runs.
  const insertIntoTransaction = (state: EditorState, tr: Transaction, view: EditorView, file: File) => {
    const { uploadId, previewURL, node } = buildPlaceholderNode(state, file);
    tr.replaceSelectionWith(node).scrollIntoView();
    queueMicrotask(() => startUpload(view, uploadId, { file, previewURL }));
  };

  const retryIntoTransaction = (state: EditorState, tr: Transaction, view: EditorView, uploadId: string) => {
    const entry = uploads.get(uploadId);
    if (!entry) {
      return;
    }
    const result = findImageByUploadId(state.doc, uploadId);
    if (result) {
      const { pos, node } = result as { pos: number; node: ProseMirrorNode };
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        status: 'uploading',
        progress: 0,
        error: null,
      });
    }
    queueMicrotask(() => startUpload(view, uploadId, entry));
  };

  const plugin = new Plugin({
    key: uploadPluginKey,
    props: {
      handlePaste(view, event) {
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
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
          file.type.startsWith('image/'),
        );
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
      if (!transactions.some((tr) => tr.docChanged)) {
        return null;
      }
      const active = new Set<string>();
      newState.doc.descendants((node) => {
        if (node.type.name === 'image' && typeof node.attrs.uploadId === 'string') {
          active.add(node.attrs.uploadId);
        }
        return true;
      });
      const removed: string[] = [];
      uploads.forEach((_entry, id) => {
        if (!active.has(id)) {
          removed.push(id);
        }
      });
      removed.forEach((id) => {
        const entry = uploads.get(id);
        if (entry?.previewURL && typeof window !== 'undefined' && typeof window.URL?.revokeObjectURL === 'function') {
          window.URL.revokeObjectURL(entry.previewURL);
        }
        uploads.delete(id);
        const disposer = disposers.get(id);
        disposer?.();
        disposers.delete(id);
      });
      return null;
    },
    view() {
      return {
        destroy() {
          disposers.forEach((dispose) => dispose());
          disposers.clear();
          uploads.forEach((entry) => {
            if (entry.previewURL && typeof window !== 'undefined' && typeof window.URL?.revokeObjectURL === 'function') {
              window.URL.revokeObjectURL(entry.previewURL);
            }
          });
          uploads.clear();
        },
      };
    },
  });

  return { plugin, insert, retry, insertIntoTransaction, retryIntoTransaction };
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
    wrapper.appendChild(this.progressEl);

    this.retryButton = document.createElement('button');
    this.retryButton.type = 'button';
    this.retryButton.className = 'lash-image-retry';
    this.retryButton.textContent = 'Retry upload';
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

    if (status === 'uploading') {
      const preview = attrs.previewSrc ?? '';
      if (preview) {
        this.imageEl.src = preview;
      }
      this.progressEl.style.display = 'block';
      const percent = Math.round((attrs.progress ?? 0) * 100);
      this.progressEl.textContent = `Uploading… ${percent}%`;
      this.retryButton.style.display = 'none';
    } else if (status === 'error') {
      if (attrs.previewSrc) {
        this.imageEl.src = attrs.previewSrc;
      } else {
        this.imageEl.removeAttribute('src');
      }
      this.progressEl.style.display = 'none';
      this.progressEl.textContent = '';
      this.retryButton.style.display = 'inline-flex';
    } else {
      this.retryButton.style.display = 'none';
      this.progressEl.style.display = 'none';
      this.progressEl.textContent = '';
      if (attrs.src) {
        this.imageEl.src = attrs.src;
      }
    }

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
        tag: 'img[src]'
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
        return ({ tr, state, view, dispatch }: CommandProps) => {
          const storage = extension.storage as LashImageStorage;
          if (!storage.uploadManager) {
            return false;
          }
          if (!dispatch) {
            return true;
          }
          storage.uploadManager.retryIntoTransaction(state, tr, view, uploadId);
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
