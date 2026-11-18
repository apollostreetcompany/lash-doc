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
  resized: boolean;
}

interface UploadManager {
  plugin: Plugin;
  hasFile(uploadId: string): boolean;
  /** insert via direct view.dispatch — used by paste/drop handlers (outside CM context) */
  insert(view: { state: EditorState; dispatch: (tr: Transaction) => void }, file: File): void;
  /** retry via direct view.dispatch — used outside CM context */
  retry(view: { state: EditorState; dispatch: (tr: Transaction) => void }, uploadId: string): void;
  /** insert by mutating an existing tr — used inside addCommands so CM dispatches our tr cleanly */
  insertIntoTransaction(state: EditorState, tr: Transaction, view: EditorView, file: File): void;
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
  initialWidth: number,
  uploadId: string,
  entry: UploadEntry,
  onSuccess: () => void,
  onFailure: (retryable: boolean) => void,
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
        error: null,
      };
      const current = findImageByUploadId(view.state.doc, uploadId) as {
        pos: number;
        node: ProseMirrorNode;
      } | null;
      const currentWidth = current?.node.attrs.width;
      if (
        typeof result.width === 'number' &&
        result.width > 0 &&
        !entry.resized &&
        (typeof currentWidth !== 'number' || currentWidth === initialWidth)
      ) {
        attrs.width = result.width;
      }
      const successTr = updateImageAttrs(view.state, uploadId, attrs);
      if (successTr) {
        const encoded = new TextEncoder().encode(JSON.stringify(successTr.doc.toJSON()));
        if (encoded.byteLength > MAX_BODY_BYTES_WITH_NEW_IMAGE) {
          throw new ImageUploadError('This document is too large to add this image.', true);
        }
        view.dispatch(successTr);
        if (findImageByUploadId(view.state.doc, uploadId)) {
          throw new ImageUploadError(
            'The image could not be added. Try again when editing is available.',
            true,
          );
        }
      }
      onSuccess();
    })
    .catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      onFailure(!(error instanceof ImageUploadError) || error.retryable);
      const failureTr = updateImageAttrs(view.state, uploadId, {
        status: 'error',
        error: error instanceof Error ? error.message : 'The image could not be added.',
      });
      if (failureTr) {
        view.dispatch(failureTr);
      }
    });

  return () => {
    cancelled = true;
  };
};

const createUploadManager = (options: LashImageOptions): UploadManager => {
  const uploads = new Map<string, UploadEntry>();
  const disposers = new Map<string, () => void>();
  // Flipped by the plugin's view().destroy() — used by deferred microtasks
  // to skip uploads after editor teardown (proconsult-m0/A P1).
  let destroyed = false;

  const startUpload = (
    view: { state: EditorState; dispatch: (tr: Transaction) => void },
    uploadId: string,
    entry: UploadEntry,
  ) => {
    uploads.set(uploadId, entry);
    const disposer = scheduleUpload(
      view,
      options.uploader,
      options.initialWidth,
      uploadId,
      entry,
      () => {
        uploads.delete(uploadId);
        disposers.delete(uploadId);
      },
      (retryable) => {
        if (!retryable) uploads.delete(uploadId);
        disposers.delete(uploadId);
      },
    );
    disposers.set(uploadId, disposer);
  };

  // Defer work from command transactions until the placeholder has committed.
  const startUploadIfPlaceholderAlive = (
    view: { state: EditorState; dispatch: (tr: Transaction) => void },
    uploadId: string,
    entry: UploadEntry,
  ) => {
    if (destroyed || !findImageByUploadId(view.state.doc, uploadId)) {
      uploads.delete(uploadId);
      return;
    }
    startUpload(view, uploadId, entry);
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

  // Direct-dispatch path: used by paste/drop handlers, outside CM context.
  const insert = (
    view: { state: EditorState; dispatch: (tr: Transaction) => void },
    file: File,
  ) => {
    const { uploadId, node } = buildPlaceholderNode(view.state);
    const tr = insertPlaceholder(view.state.tr, node);
    const entry = { file, resized: false };
    uploads.set(uploadId, entry);
    view.dispatch(tr);
    startUploadIfPlaceholderAlive(view, uploadId, entry);
  };

  const retry = (
    view: { state: EditorState; dispatch: (tr: Transaction) => void },
    uploadId: string,
  ) => {
    const entry = uploads.get(uploadId);
    if (!entry || disposers.has(uploadId)) {
      return;
    }
    const resetTr = updateImageAttrs(view.state, uploadId, {
      status: 'uploading',
      progress: 0,
      error: null,
    });
    if (resetTr) {
      view.dispatch(resetTr);
      startUploadIfPlaceholderAlive(view, uploadId, entry);
    }
  };

  // Tr-mutation path: used by addCommands so TipTap CommandManager dispatches a single
  // coherent tr. Upload start is deferred to a microtask to ensure the placeholder is
  // committed to view.state before scheduleUpload's first onProgress runs. The deferred
  // start is guarded in case the insert is undone or the editor closes first.
  const insertIntoTransaction = (
    state: EditorState,
    tr: Transaction,
    view: EditorView,
    file: File,
  ) => {
    const { uploadId, node } = buildPlaceholderNode(state);
    insertPlaceholder(tr, node);
    const entry = { file, resized: false };
    uploads.set(uploadId, entry);
    queueMicrotask(() => startUploadIfPlaceholderAlive(view, uploadId, entry));
  };

  const retryIntoTransaction = (
    state: EditorState,
    tr: Transaction,
    view: EditorView,
    uploadId: string,
  ) => {
    const entry = uploads.get(uploadId);
    if (!entry || disposers.has(uploadId)) {
      return;
    }
    const result = findImageByUploadId(state.doc, uploadId);
    if (!result) {
      // Placeholder is already gone — caller is retrying a stale id.
      return;
    }
    const { pos, node } = result as { pos: number; node: ProseMirrorNode };
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      status: 'uploading',
      progress: 0,
      error: null,
    });
    queueMicrotask(() => startUploadIfPlaceholderAlive(view, uploadId, entry));
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
      const removed: string[] = [];
      uploads.forEach((_entry, id) => {
        if (!active.has(id)) {
          removed.push(id);
        }
      });
      removed.forEach((id) => {
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
          destroyed = true;
          disposers.forEach((dispose) => dispose());
          disposers.clear();
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
