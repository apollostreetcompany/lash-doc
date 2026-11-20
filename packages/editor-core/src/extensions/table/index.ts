import { mergeAttributes, type NodeViewRendererProps } from '@tiptap/core';
import TableExtension from '@tiptap/extension-table';
import BaseTableCellExtension from '@tiptap/extension-table-cell';
import TableHeaderExtension from '@tiptap/extension-table-header';
import TableRowExtension from '@tiptap/extension-table-row';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { EditorView, ViewMutationRecord } from '@tiptap/pm/view';

import {
  applyMatrixToSelection,
  buildTsvFromMatrix,
  extractSelectionMatrix,
  parseClipboardTableText,
} from '../../table/interop';
import {
  sanitizeCellType,
  cloneDefaultSelectOptions,
  cloneDefaultStatusOptions,
  type LashTableCellAttrs,
  type LashTableOptions,
} from '../../table/types';
import {
  clampOptionIndex,
  collectSelectedCells,
  mergeCellAttrs,
  resolveOptions,
  setCellAttributes,
} from '../../table/utils';

type InteractionMeta =
  | { type: 'open' | 'toggle'; pos: number; index: number; optionCount: number }
  | { type: 'close' }
  | { type: 'move'; index: number };

type TableInteractionState =
  | { kind: 'closed'; openCellPos: null; activeIndex: 0; optionCount: 0 }
  | { kind: 'open'; openCellPos: number; activeIndex: number; optionCount: number };

const closedPicker = {
  kind: 'closed',
  openCellPos: null,
  activeIndex: 0,
  optionCount: 0,
} as const satisfies TableInteractionState;

const pickerCellAt = (doc: ProseMirrorNode, pos: number) => {
  const node = doc.nodeAt(pos);
  if (node?.type.name !== 'tableCell' && node?.type.name !== 'tableHeader') return null;
  const attrs = node.attrs as Partial<LashTableCellAttrs>;
  const cellType = sanitizeCellType(attrs.cellType);
  if (cellType === 'text') return null;
  return { node, options: resolveOptions(cellType, attrs.options) };
};

const parseOptionsAttr = (raw: string | null | undefined): string[] => {
  if (!raw) {
    return [];
  }
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) {
      return value.filter((item) => typeof item === 'string');
    }
  } catch (error) {
    // ignore malformed attribute value
  }
  return [];
};

const serializeOptions = (options: string[]): string | null => {
  if (!options.length) {
    return null;
  }
  return JSON.stringify(options);
};

const applyBaseAttributes = (
  dom: HTMLElement,
  htmlAttributes: Record<string, unknown>,
  node: ProseMirrorNode,
) => {
  const { cellType, value, options, ...rest } = node.attrs as LashTableCellAttrs &
    Record<string, unknown>;
  const merged = mergeAttributes(htmlAttributes, rest);
  Object.entries(merged).forEach(([key, attrValue]) => {
    if (attrValue === undefined || attrValue === null) {
      dom.removeAttribute(key);
      return;
    }
    if (Array.isArray(attrValue)) {
      dom.setAttribute(key, attrValue.join(','));
      return;
    }
    dom.setAttribute(key, String(attrValue));
  });
};

let cellCounter = 0;

type NodeViewInstance = {
  dom: HTMLTableCellElement;
  contentDOM: HTMLElement;
  ignoreMutation: (mutation: ViewMutationRecord) => boolean;
  stopEvent: (event: Event) => boolean;
  update: (node: ProseMirrorNode) => boolean;
  destroy: () => void;
};

const createCellNodeView = (
  props: NodeViewRendererProps,
  defaultStatusOptions: string[],
  defaultSelectOptions: string[],
): NodeViewInstance => {
  let node = props.node;
  let currentOptions: string[] = [];

  const dom = document.createElement('td');
  applyBaseAttributes(dom, props.HTMLAttributes, node);
  const cellId = `lash-table-cell-${(cellCounter += 1)}`;
  dom.id = cellId;

  const wrapper = document.createElement('div');
  wrapper.className = 'lash-table-cell-wrapper';
  dom.append(wrapper);

  const contentDOM = document.createElement('div');
  contentDOM.className = 'lash-table-cell-content';
  wrapper.append(contentDOM);

  const control = document.createElement('button');
  control.type = 'button';
  control.contentEditable = 'false';
  control.className = 'lash-table-cell-control';
  control.dataset.role = 'table-cell-control';
  control.dataset.controlId = `control-${cellId}`;
  control.setAttribute('aria-haspopup', 'listbox');
  control.setAttribute('aria-expanded', 'false');
  control.tabIndex = -1;
  wrapper.append(control);

  const menu = document.createElement('ul');
  menu.className = 'lash-table-cell-menu';
  menu.contentEditable = 'false';
  menu.hidden = true;
  menu.tabIndex = -1;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Cell options');
  menu.id = `${cellId}-picker`;
  if (typeof menu.showPopover === 'function') menu.setAttribute('popover', 'manual');
  wrapper.append(menu);

  control.setAttribute('aria-controls', menu.id);

  let optionButtons: HTMLButtonElement[] = [];
  menu.dataset.optionCount = '0';

  const cleanupOptionListeners = () => {
    optionButtons.forEach((button) => button.removeEventListener('click', handleOptionClick));
    optionButtons = [];
  };

  const renderOptions = (options: string[]) => {
    cleanupOptionListeners();
    menu.textContent = '';
    options.forEach((option, index) => {
      const item = document.createElement('li');
      item.className = 'lash-table-cell-menu-item';
      const optionButton = document.createElement('button');
      optionButton.type = 'button';
      optionButton.tabIndex = -1;
      optionButton.id = `${menu.id}-option-${index}`;
      optionButton.className = 'lash-table-cell-menu-option';
      optionButton.dataset.optionIndex = String(index);
      optionButton.dataset.optionValue = option;
      optionButton.setAttribute('role', 'option');
      optionButton.textContent = option;
      optionButton.addEventListener('click', handleOptionClick);
      optionButtons.push(optionButton);
      item.append(optionButton);
      menu.append(item);
    });
    menu.dataset.optionCount = String(options.length);
  };

  const syncFromNode = (target: ProseMirrorNode) => {
    const attrs = target.attrs as Partial<LashTableCellAttrs>;
    const cellType = sanitizeCellType(attrs.cellType);
    applyBaseAttributes(dom, props.HTMLAttributes, target);
    dom.dataset.cellType = cellType;
    wrapper.dataset.cellType = cellType;
    wrapper.classList.toggle('lash-table-cell--status', cellType === 'status');
    wrapper.classList.toggle('lash-table-cell--select', cellType === 'select');
    wrapper.classList.toggle('lash-table-cell--text', cellType === 'text');
    const providedOptions = Array.isArray(attrs.options)
      ? attrs.options.filter((item) => typeof item === 'string')
      : [];
    const fallbackOptions =
      cellType === 'status'
        ? providedOptions.length
          ? providedOptions
          : defaultStatusOptions
        : cellType === 'select'
          ? providedOptions.length
            ? providedOptions
            : defaultSelectOptions
          : [];
    const optionsChanged =
      currentOptions.length !== fallbackOptions.length ||
      currentOptions.some((option, index) => option !== fallbackOptions[index]);
    if (optionsChanged) {
      currentOptions = [...fallbackOptions];
      renderOptions(currentOptions);
    }
    if (currentOptions.length) {
      dom.dataset.cellOptions = JSON.stringify(currentOptions);
      wrapper.dataset.cellOptions = dom.dataset.cellOptions;
    } else {
      delete dom.dataset.cellOptions;
      delete wrapper.dataset.cellOptions;
    }

    const rawValue = typeof attrs.value === 'string' ? attrs.value : '';
    const displayValue =
      cellType === 'text'
        ? rawValue
        : currentOptions.includes(rawValue)
          ? rawValue
          : (currentOptions[0] ?? '');
    dom.dataset.cellValue = displayValue;
    wrapper.dataset.cellValue = displayValue;
    control.textContent = displayValue;
    control.hidden = cellType === 'text';
    control.tabIndex = cellType === 'text' ? -1 : 0;
    if (cellType !== 'text') {
      contentDOM.setAttribute('data-hidden-content', 'true');
      contentDOM.style.display = 'none';
    } else {
      contentDOM.removeAttribute('data-hidden-content');
      contentDOM.style.display = '';
    }
  };

  const handleToggleRequest = () => {
    const { view } = props;
    if (!view.editable) {
      return;
    }
    const pos = typeof props.getPos === 'function' ? props.getPos() : null;
    if (typeof pos !== 'number') {
      return;
    }
    const currentIndex = currentOptions.indexOf(dom.dataset.cellValue ?? '');
    view.dispatch(
      view.state.tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, {
        type: 'toggle',
        pos,
        index: currentIndex >= 0 ? currentIndex : 0,
        optionCount: currentOptions.length,
      } satisfies InteractionMeta),
    );
    if (TABLE_INTERACTION_PLUGIN_KEY.getState(view.state)?.openCellPos === pos) {
      menu.focus({ preventScroll: true });
    }
  };

  function handleOptionClick(event: MouseEvent) {
    event.preventDefault();
    const button = event.currentTarget as HTMLButtonElement | null;
    const optionValue = button?.dataset.optionValue ?? '';
    const { view } = props;
    const pos = typeof props.getPos === 'function' ? props.getPos() : null;
    if (
      !view.editable ||
      typeof pos !== 'number' ||
      TABLE_INTERACTION_PLUGIN_KEY.getState(view.state)?.openCellPos !== pos
    )
      return;
    const target = pickerCellAt(view.state.doc, pos);
    if (target?.options.includes(optionValue))
      commitCellValue(view, { pos, node: target.node }, optionValue);
  }

  const onMenuKeydown = (event: KeyboardEvent) => {
    const { view } = props;
    const pos = props.getPos();
    if (typeof pos !== 'number') return;
    const target = pickerCellAt(view.state.doc, pos);
    if (target) handleCellKeydown(view, event, { pos, node: target.node });
  };

  const onControlClick = (event: MouseEvent) => {
    event.preventDefault();
    handleToggleRequest();
  };

  control.addEventListener('click', onControlClick);
  menu.addEventListener('keydown', onMenuKeydown);

  syncFromNode(node);

  dom.dataset.pickerOpen = 'false';

  return {
    dom,
    contentDOM,
    stopEvent(event) {
      return (
        event.target instanceof Node &&
        (control.contains(event.target) || menu.contains(event.target))
      );
    },
    ignoreMutation(mutation) {
      if (mutation.type === 'selection') return false;
      // The picker owns its controls and the attributes on the content wrapper.
      // Treating these writes as edits redraws the cell, which reopens its picker.
      return (
        !contentDOM.contains(mutation.target) ||
        (mutation.type === 'attributes' && mutation.target === contentDOM)
      );
    },
    destroy() {
      control.removeEventListener('click', onControlClick);
      menu.removeEventListener('keydown', onMenuKeydown);
      cleanupOptionListeners();
    },
    update(updatedNode: ProseMirrorNode) {
      if (updatedNode.type.name !== node.type.name) {
        return false;
      }
      const attrsChanged = !node.sameMarkup(updatedNode);
      node = updatedNode;
      if (attrsChanged) {
        syncFromNode(updatedNode);
      }
      return true;
    },
  };
};

const getPickerElements = (dom: HTMLElement) => {
  const control = dom.querySelector<HTMLButtonElement>('.lash-table-cell-control');
  const menu = dom.querySelector<HTMLElement>('.lash-table-cell-menu');
  const options = menu
    ? Array.from(menu.querySelectorAll<HTMLButtonElement>('.lash-table-cell-menu-option'))
    : [];
  return { control, menu, options };
};

const setPickerOpen = (dom: HTMLElement, open: boolean) => {
  dom.dataset.pickerOpen = open ? 'true' : 'false';
  const { control, menu } = getPickerElements(dom);
  if (control) {
    control.setAttribute('aria-expanded', open ? 'true' : 'false');
    control.dataset.active = open ? 'true' : 'false';
  }
  if (menu) {
    if (open) {
      menu.hidden = false;
      if (menu.isConnected && typeof menu.showPopover === 'function') menu.showPopover();
    } else {
      const restoreFocus = menu.contains(menu.ownerDocument.activeElement);
      if (menu.isConnected && typeof menu.hidePopover === 'function') menu.hidePopover();
      menu.hidden = true;
      if (restoreFocus && control?.isConnected && !control.hidden) {
        control.focus({ preventScroll: true });
      }
    }
  }
};

const setPickerActiveIndex = (dom: HTMLElement, index: number) => {
  dom.dataset.activeIndex = String(index);
  const { options, menu } = getPickerElements(dom);
  options.forEach((button, optionIndex) => {
    const isActive = optionIndex === index;
    button.dataset.active = isActive ? 'true' : 'false';
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  if (menu) {
    menu.dataset.activeIndex = String(index);
    const selected = options[index];
    if (selected) {
      menu.setAttribute('aria-activedescendant', selected.id);
      // Scroll only the listbox when there are more options than can fit.
      const option = selected.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      if (option.top < bounds.top) menu.scrollTop -= bounds.top - option.top;
      if (option.bottom > bounds.bottom) menu.scrollTop += option.bottom - bounds.bottom;
    }
  }
};

const trackPickerPosition = (view: EditorView, dom: HTMLElement) => {
  const { control, menu } = getPickerElements(dom);
  const owner = dom.ownerDocument;
  const window = owner.defaultView;
  if (!window || !control || !menu) return null;
  const viewport = window.visualViewport;
  const table = dom.closest('table');
  let frame: number | null = null;

  const close = () => {
    view.dispatch(
      view.state.tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, {
        type: 'close',
      } satisfies InteractionMeta),
    );
  };
  const position = () => {
    frame = null;
    if (!control.isConnected || !view.editable) {
      close();
      return;
    }
    const anchor = control.getBoundingClientRect();
    const x = viewport?.offsetLeft ?? 0;
    const y = viewport?.offsetTop ?? 0;
    const right = x + (viewport?.width ?? window.innerWidth);
    const bottom = y + (viewport?.height ?? window.innerHeight);
    const clip = table?.getBoundingClientRect();
    // Zero-sized boxes occur in non-rendering mounts, such as editor unit tests.
    if (!anchor.width || !anchor.height) return;
    if (
      anchor.right <= Math.max(x, clip?.left ?? x) ||
      anchor.left >= Math.min(right, clip?.right ?? right) ||
      anchor.bottom <= Math.max(y, clip?.top ?? y) ||
      anchor.top >= Math.min(bottom, clip?.bottom ?? bottom)
    ) {
      close();
      return;
    }

    const margin = 8;
    const gap = 6;
    const below = bottom - margin - anchor.bottom - gap;
    const above = anchor.top - gap - y - margin;
    menu.style.maxWidth = `${Math.max(0, right - x - margin * 2)}px`;
    const height = menu.scrollHeight + menu.offsetHeight - menu.clientHeight;
    const placeBelow = below >= height || below >= above;
    const space = Math.max(0, placeBelow ? below : above);
    menu.style.maxHeight = `${space}px`;
    menu.style.top = `${placeBelow ? anchor.bottom + gap : anchor.top - gap - Math.min(height, space)}px`;
    menu.style.left = `${Math.max(x + margin, Math.min(anchor.left, right - menu.offsetWidth - margin))}px`;
  };
  const schedule = () => {
    if (frame === null) frame = window.requestAnimationFrame(position);
  };
  const dismissOutside = (event: PointerEvent) => {
    if (
      event.target instanceof Node &&
      (control.contains(event.target) || menu.contains(event.target))
    )
      return;
    close();
  };

  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  viewport?.addEventListener('resize', schedule);
  owner.addEventListener('pointerdown', dismissOutside, true);
  schedule();
  return {
    schedule,
    destroy() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      viewport?.removeEventListener('resize', schedule);
      owner.removeEventListener('pointerdown', dismissOutside, true);
    },
  };
};

const commitCellValue = (
  view: EditorView,
  cell: { pos: number; node: ProseMirrorNode },
  value: string,
) => {
  const tr = view.state.tr;
  setCellAttributes(tr, cell, { value });
  view.dispatch(
    tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, { type: 'close' } satisfies InteractionMeta),
  );
};

const handleCellKeydown = (
  view: EditorView,
  event: KeyboardEvent,
  target?: { pos: number; node: ProseMirrorNode },
): boolean => {
  if (!view.editable || event.defaultPrevented || event.isComposing) {
    return false;
  }
  const cell = target ?? collectSelectedCells(view.state as EditorState)[0];
  if (!cell) {
    return false;
  }
  const attrs = mergeCellAttrs(cell.node, cell.node.attrs) as LashTableCellAttrs &
    Record<string, unknown>;
  const cellType = sanitizeCellType(attrs.cellType);
  if (cellType === 'text') {
    return false;
  }

  const options = resolveOptions(cellType, attrs.options);
  if (!options.length) {
    return false;
  }

  const pluginState = TABLE_INTERACTION_PLUGIN_KEY.getState(view.state) ?? closedPicker;
  const isOpen = pluginState.openCellPos === cell.pos;

  if (!isOpen) {
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === ' ') {
      event.preventDefault();
      const currentIndex = options.indexOf(attrs.value);
      view.dispatch(
        view.state.tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, {
          type: 'open',
          pos: cell.pos,
          index: currentIndex >= 0 ? currentIndex : 0,
          optionCount: options.length,
        } satisfies InteractionMeta),
      );
      return true;
    }
    return false;
  }

  const currentIndex = clampOptionIndex(options, pluginState.activeIndex);

  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault();
    const nextIndex = clampOptionIndex(options, currentIndex + 1);
    view.dispatch(
      view.state.tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, {
        type: 'move',
        index: nextIndex,
      } satisfies InteractionMeta),
    );
    return true;
  }

  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault();
    const nextIndex = clampOptionIndex(options, currentIndex - 1);
    view.dispatch(
      view.state.tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, {
        type: 'move',
        index: nextIndex,
      } satisfies InteractionMeta),
    );
    return true;
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    const value = options[currentIndex] ?? options[0] ?? '';
    commitCellValue(view, cell, value);
    return true;
  }

  if (event.key === 'Tab') {
    const value = options[currentIndex] ?? options[0] ?? '';
    commitCellValue(view, cell, value);
    return false;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    view.dispatch(
      view.state.tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, {
        type: 'close',
      } satisfies InteractionMeta),
    );
    return true;
  }

  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    const lower = event.key.toLowerCase();
    const match = options.findIndex((option) => option.toLowerCase().startsWith(lower));
    if (match >= 0) {
      view.dispatch(
        view.state.tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, {
          type: 'move',
          index: match,
        } satisfies InteractionMeta),
      );
    }
    return true;
  }

  return false;
};

const handleCopyEvent = (view: EditorView, event: ClipboardEvent): boolean => {
  // Only hijack the clipboard for a genuine multi-cell CellSelection. A plain
  // text caret inside a single cell is a TextSelection and must fall through to
  // ProseMirror's default copy so partial text selections work normally.
  if (!(view.state.selection instanceof CellSelection)) {
    return false;
  }
  const matrix = extractSelectionMatrix(view.state);
  if (!matrix) {
    return false;
  }
  const tsv = buildTsvFromMatrix(matrix);
  event.preventDefault();
  event.clipboardData?.setData('text/plain', tsv);
  event.clipboardData?.setData('text/tab-separated-values', tsv);
  return true;
};

const handlePasteEvent = (view: EditorView, event: ClipboardEvent): boolean => {
  // As with copy, only a real multi-cell CellSelection triggers TSV matrix
  // paste; a single-cell text caret uses ProseMirror's default paste handling.
  if (!(view.state.selection instanceof CellSelection)) {
    return false;
  }
  const data =
    event.clipboardData?.getData('text/tab-separated-values') ||
    event.clipboardData?.getData('text/plain');
  if (!data) {
    return false;
  }
  const matrix = parseClipboardTableText(data);
  const tr = view.state.tr;
  const changed = applyMatrixToSelection(view.state, tr, matrix);
  if (!changed) {
    return false;
  }
  event.preventDefault();
  tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, { type: 'close' } satisfies InteractionMeta);
  view.dispatch(tr);
  return true;
};

export const TABLE_INTERACTION_PLUGIN_KEY = new PluginKey<TableInteractionState>(
  'lashTableInteraction',
);

export const createLashTableInteractionPlugin = () =>
  new Plugin<TableInteractionState>({
    key: TABLE_INTERACTION_PLUGIN_KEY,
    state: {
      init: () => closedPicker,
      apply(tr, value) {
        const meta = tr.getMeta(TABLE_INTERACTION_PLUGIN_KEY) as InteractionMeta | undefined;
        if (meta?.type === 'close') return closedPicker;
        if (meta?.type === 'open' || meta?.type === 'toggle') {
          if (meta.type === 'toggle' && value.openCellPos === meta.pos) return closedPicker;
          const cell = pickerCellAt(tr.doc, meta.pos);
          if (!cell?.options.length) return closedPicker;
          return {
            kind: 'open',
            openCellPos: meta.pos,
            activeIndex: clampOptionIndex(cell.options, meta.index),
            optionCount: cell.options.length,
          };
        }
        if (value.kind === 'closed') return value;
        if (meta?.type === 'move') {
          if (value.activeIndex === meta.index) return value;
          return { ...value, activeIndex: meta.index };
        }
        if (!tr.docChanged) return value;

        // The interior boundary survives a cell markup change. When the cell
        // itself is deleted, a raw position can point at an adjacent cell.
        const mapped = tr.mapping.mapResult(value.openCellPos + 1, -1);
        if (mapped.deletedAcross || mapped.pos < 1) return closedPicker;
        const pos = mapped.pos - 1;
        const cell = pickerCellAt(tr.doc, pos);
        if (!cell?.options.length) return closedPicker;
        const previousOptions = pickerCellAt(tr.before, value.openCellPos)?.options;
        const activeOption = previousOptions?.[value.activeIndex];
        const matchedIndex = activeOption === undefined ? -1 : cell.options.indexOf(activeOption);
        const activeIndex =
          matchedIndex >= 0 ? matchedIndex : Math.min(value.activeIndex, cell.options.length - 1);
        if (
          pos === value.openCellPos &&
          activeIndex === value.activeIndex &&
          cell.options.length === value.optionCount
        )
          return value;
        return { kind: 'open', openCellPos: pos, activeIndex, optionCount: cell.options.length };
      },
    },
    props: {
      handleDOMEvents: {
        keydown(view: EditorView, event: KeyboardEvent) {
          if (handleCellKeydown(view, event)) {
            return true;
          }
          const state = TABLE_INTERACTION_PLUGIN_KEY.getState(view.state);
          if (!state) {
            return false;
          }
          if (state.openCellPos !== null && event.key === 'Escape') {
            view.dispatch(
              view.state.tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, {
                type: 'close',
              } satisfies InteractionMeta),
            );
            return true;
          }
          return false;
        },
        copy: handleCopyEvent,
        paste: handlePasteEvent,
      },
    },
    view(view) {
      let rendered: {
        dom: HTMLElement;
        activeIndex: number;
        activeOption: Element | null;
        placement: ReturnType<typeof trackPickerPosition>;
      } | null = null;
      const closeRendered = () => {
        if (!rendered) return;
        rendered.placement?.destroy();
        setPickerOpen(rendered.dom, false);
        rendered = null;
      };
      const sync = (updatedView: EditorView, previousState?: EditorState) => {
        const state = TABLE_INTERACTION_PLUGIN_KEY.getState(updatedView.state);
        if (!updatedView.editable && state?.kind === 'open') {
          if (rendered) {
            closeRendered();
            // A plugin view cannot dispatch inside its own update. Clear this
            // picker after the current update without closing a newer one.
            queueMicrotask(() => {
              if (
                !updatedView.isDestroyed &&
                TABLE_INTERACTION_PLUGIN_KEY.getState(updatedView.state) === state
              ) {
                updatedView.dispatch(
                  updatedView.state.tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, {
                    type: 'close',
                  } satisfies InteractionMeta),
                );
              }
            });
          }
          return;
        }
        const dom = state?.kind === 'open' ? updatedView.nodeDOM(state.openCellPos) : null;
        if (rendered?.dom !== dom) closeRendered();
        if (state?.kind !== 'open' || !(dom instanceof HTMLElement)) return;

        if (!rendered) {
          setPickerOpen(dom, true);
          rendered = {
            dom,
            activeIndex: -1,
            activeOption: null,
            placement: trackPickerPosition(updatedView, dom),
          };
        }
        const activeOption = dom.querySelector(
          `.lash-table-cell-menu-option[data-option-index="${state.activeIndex}"]`,
        );
        if (rendered.activeIndex !== state.activeIndex || rendered.activeOption !== activeOption) {
          setPickerActiveIndex(dom, state.activeIndex);
          rendered.activeIndex = state.activeIndex;
          rendered.activeOption = activeOption;
        }
        if (previousState?.doc !== updatedView.state.doc) rendered.placement?.schedule();
      };
      sync(view);
      return {
        update: sync,
        destroy: closeRendered,
      };
    },
  });

const LashTableCell = BaseTableCellExtension.extend<{ table: LashTableOptions }>({
  addOptions() {
    return {
      ...this.parent?.(),
      table: {},
    };
  },

  addAttributes() {
    const parentAttributes = this.parent?.() ?? {};
    return {
      ...parentAttributes,
      cellType: {
        default: 'text',
        parseHTML: (element) => sanitizeCellType(element.getAttribute('data-cell-type')),
        renderHTML: (attrs) => ({ 'data-cell-type': sanitizeCellType(attrs.cellType) }),
      },
      value: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-cell-value') ?? '',
        renderHTML: (attrs) => ({
          'data-cell-value': typeof attrs.value === 'string' ? attrs.value : '',
        }),
      },
      options: {
        default: [],
        parseHTML: (element) => parseOptionsAttr(element.getAttribute('data-cell-options')),
        renderHTML: (attrs) => {
          const options = Array.isArray(attrs.options)
            ? attrs.options.filter((item) => typeof item === 'string')
            : [];
          const serialized = serializeOptions(options);
          return serialized ? { 'data-cell-options': serialized } : {};
        },
      },
    };
  },

  addNodeView() {
    const tableOptions = this.options.table ?? {};
    const defaultStatusOptions = tableOptions.defaultStatusOptions ?? cloneDefaultStatusOptions();
    const defaultSelectOptions = tableOptions.defaultSelectOptions ?? cloneDefaultSelectOptions();
    return (props) =>
      createCellNodeView(props, [...defaultStatusOptions], [...defaultSelectOptions]);
  },
});

export const createLashTableExtensions = (options: LashTableOptions = {}) => {
  const table = TableExtension.configure({
    resizable: false,
    allowTableNodeSelection: true,
    lastColumnResizable: false,
    HTMLAttributes: { class: 'lash-table' },
  });

  const tableRow = TableRowExtension;
  const tableHeader = TableHeaderExtension;
  const tableCell = LashTableCell.configure({ table: options });

  return [table, tableRow, tableHeader, tableCell] as const;
};

export {
  DEFAULT_SELECT_CELL_OPTIONS,
  DEFAULT_STATUS_CELL_OPTIONS,
  sanitizeCellType,
} from '../../table/types';

export type { LashTableCellAttrs, LashTableCellType, LashTableOptions } from '../../table/types';
