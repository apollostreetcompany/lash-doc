import { mergeAttributes, type NodeViewRendererProps } from '@tiptap/core';
import TableExtension from '@tiptap/extension-table';
import BaseTableCellExtension from '@tiptap/extension-table-cell';
import TableHeaderExtension from '@tiptap/extension-table-header';
import TableRowExtension from '@tiptap/extension-table-row';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';

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

interface InteractionMeta {
  type: 'open' | 'close' | 'move' | 'toggle';
  pos?: number;
  index?: number;
  optionCount?: number;
}

interface TableInteractionState {
  openCellPos: number | null;
  activeIndex: number;
  optionCount: number;
}

const createInitialState = (): TableInteractionState => ({
  openCellPos: null,
  activeIndex: 0,
  optionCount: 0,
});

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
  update: (node: ProseMirrorNode) => boolean;
  destroy: () => void;
};

const updateCellValue = (view: EditorView, pos: number, value: string) => {
  const { state, dispatch } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) {
    return;
  }
  const cellInfo = { pos, node } as const;
  const tr = state.tr;
  setCellAttributes(tr, cellInfo, { value });
  dispatch(tr);
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
  control.className = 'lash-table-cell-control';
  control.dataset.role = 'table-cell-control';
  control.dataset.controlId = `control-${cellId}`;
  control.setAttribute('aria-haspopup', 'listbox');
  control.setAttribute('aria-expanded', 'false');
  control.tabIndex = -1;
  wrapper.append(control);

  const menu = document.createElement('ul');
  menu.className = 'lash-table-cell-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  menu.id = `${cellId}-picker`;
  wrapper.append(menu);

  control.setAttribute('aria-controls', menu.id);

  let optionButtons: HTMLButtonElement[] = [];

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
    dom.dataset.cellType = cellType;
    dom.setAttribute('data-cell-type', cellType);
    wrapper.dataset.cellType = cellType;
    wrapper.setAttribute('data-cell-type', cellType);
    wrapper.classList.toggle('lash-table-cell--status', cellType === 'status');
    wrapper.classList.toggle('lash-table-cell--select', cellType === 'select');
    wrapper.classList.toggle('lash-table-cell--text', cellType === 'text');
    applyBaseAttributes(dom, props.HTMLAttributes, target);
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
    currentOptions = [...fallbackOptions];
    if (currentOptions.length) {
      dom.dataset.cellOptions = JSON.stringify(currentOptions);
      dom.setAttribute('data-cell-options', dom.dataset.cellOptions);
      wrapper.dataset.cellOptions = dom.dataset.cellOptions;
    } else {
      delete dom.dataset.cellOptions;
      dom.removeAttribute('data-cell-options');
      delete wrapper.dataset.cellOptions;
      wrapper.removeAttribute('data-cell-options');
    }
    renderOptions(currentOptions);

    const rawValue = typeof attrs.value === 'string' ? attrs.value : '';
    const displayValue =
      cellType === 'text'
        ? rawValue
        : currentOptions.includes(rawValue)
          ? rawValue
          : (currentOptions[0] ?? '');
    dom.dataset.cellValue = displayValue;
    dom.setAttribute('data-cell-value', displayValue);
    wrapper.dataset.cellValue = displayValue;
    control.textContent = displayValue;
    control.hidden = cellType === 'text';
    control.tabIndex = cellType === 'text' ? -1 : 0;
    // Only set aria-expanded if it's not already set (preserve picker open state)
    if (!control.hasAttribute('aria-expanded')) {
      control.setAttribute('aria-expanded', 'false');
    }
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
    if (!view) {
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
  };

  function handleOptionClick(event: MouseEvent) {
    event.preventDefault();
    const button = event.currentTarget as HTMLButtonElement | null;
    const optionValue = button?.dataset.optionValue ?? '';
    const { view } = props;
    if (!view) {
      return;
    }
    const pos = typeof props.getPos === 'function' ? props.getPos() : null;
    if (typeof pos !== 'number') {
      return;
    }
    updateCellValue(view, pos, optionValue);
    view.dispatch(
      view.state.tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, {
        type: 'close',
      } satisfies InteractionMeta),
    );
  }

  const onControlClick = (event: MouseEvent) => {
    event.preventDefault();
    handleToggleRequest();
  };

  control.addEventListener('click', onControlClick);

  syncFromNode(node);

  // Check if this cell's picker should be open based on plugin state
  const cellPos = typeof props.getPos === 'function' ? props.getPos() : null;
  let pickerIsOpen = false;
  if (cellPos !== null && props.view) {
    const pluginState = TABLE_INTERACTION_PLUGIN_KEY.getState(props.view.state);
    if (pluginState && pluginState.openCellPos === cellPos) {
      pickerIsOpen = true;
      control.setAttribute('aria-expanded', 'true');
      control.dataset.active = 'true';
      menu.hidden = false;
      // Set active index
      const activeIndex = pluginState.activeIndex;
      dom.dataset.activeIndex = String(activeIndex);
      if (menu) {
        menu.dataset.activeIndex = String(activeIndex);
      }
      optionButtons.forEach((button, index) => {
        const isActive = index === activeIndex;
        button.dataset.active = isActive ? 'true' : 'false';
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }
  }
  // Always set picker-open attribute (true or false)
  dom.dataset.pickerOpen = pickerIsOpen ? 'true' : 'false';

  return {
    dom,
    contentDOM,
    destroy() {
      control.removeEventListener('click', onControlClick);
      cleanupOptionListeners();
    },
    update(updatedNode: ProseMirrorNode) {
      if (updatedNode.type.name !== node.type.name) {
        return false;
      }
      // Only sync if attributes actually changed
      const oldAttrs = node.attrs as Partial<LashTableCellAttrs>;
      const newAttrs = updatedNode.attrs as Partial<LashTableCellAttrs>;

      const cellTypeChanged = oldAttrs.cellType !== newAttrs.cellType;
      const valueChanged = oldAttrs.value !== newAttrs.value;
      const optionsChanged = JSON.stringify(oldAttrs.options) !== JSON.stringify(newAttrs.options);
      const attrsChanged = cellTypeChanged || valueChanged || optionsChanged;

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
    menu.hidden = !open;
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
  }
};

const commitCellValue = (
  view: EditorView,
  cell: { pos: number; node: ProseMirrorNode },
  value: string,
) => {
  const tr = view.state.tr;
  setCellAttributes(tr, cell, { value });
  view.dispatch(tr);
};

const handleCellKeydown = (view: EditorView, event: KeyboardEvent): boolean => {
  if (event.defaultPrevented) {
    return false;
  }
  const cells = collectSelectedCells(view.state as EditorState);
  if (!cells.length) {
    return false;
  }
  const cell = cells[0];
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

  const pluginState = TABLE_INTERACTION_PLUGIN_KEY.getState(view.state) ?? createInitialState();
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
    view.dispatch(
      view.state.tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, {
        type: 'close',
      } satisfies InteractionMeta),
    );
    return true;
  }

  if (event.key === 'Tab') {
    const value = options[currentIndex] ?? options[0] ?? '';
    commitCellValue(view, cell, value);
    view.dispatch(
      view.state.tr.setMeta(TABLE_INTERACTION_PLUGIN_KEY, {
        type: 'close',
      } satisfies InteractionMeta),
    );
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
      init: createInitialState,
      apply(tr, value) {
        const meta = tr.getMeta(TABLE_INTERACTION_PLUGIN_KEY) as InteractionMeta | undefined;
        if (meta) {
          if (meta.type === 'close') {
            return createInitialState();
          }
          if (meta.type === 'move') {
            return {
              openCellPos: value.openCellPos,
              activeIndex: typeof meta.index === 'number' ? meta.index : value.activeIndex,
              optionCount: value.optionCount,
            };
          }
          if (meta.type === 'open' || meta.type === 'toggle') {
            const targetPos = typeof meta.pos === 'number' ? meta.pos : value.openCellPos;
            const wasSame = targetPos === value.openCellPos;
            if (meta.type === 'toggle' && wasSame) {
              return createInitialState();
            }
            return {
              openCellPos: targetPos ?? null,
              activeIndex: typeof meta.index === 'number' ? meta.index : 0,
              optionCount:
                typeof meta.optionCount === 'number' ? meta.optionCount : value.optionCount,
            };
          }
        }
        if (value.openCellPos !== null && tr.docChanged) {
          return {
            openCellPos: tr.mapping.map(value.openCellPos, -1),
            activeIndex: value.activeIndex,
            optionCount: value.optionCount,
          };
        }
        return value;
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
      let previousPos: number | null = null;
      let previousIndex: number = 0;
      return {
        update(updatedView, _prevState) {
          const state =
            TABLE_INTERACTION_PLUGIN_KEY.getState(updatedView.state) ?? createInitialState();

          // Close previous picker if position changed
          if (previousPos !== null && previousPos !== state.openCellPos) {
            const dom = updatedView.nodeDOM(previousPos) as HTMLElement | null;
            if (dom) {
              setPickerOpen(dom, false);
            }
          }

          // Open/update current picker ONLY if position or index changed
          if (state.openCellPos !== null) {
            const positionChanged = previousPos !== state.openCellPos;
            const indexChanged = previousIndex !== state.activeIndex;

            if (positionChanged || indexChanged) {
              const dom = updatedView.nodeDOM(state.openCellPos) as HTMLElement | null;
              if (dom) {
                if (positionChanged) {
                  setPickerOpen(dom, true);
                }
                if (indexChanged) {
                  setPickerActiveIndex(dom, state.activeIndex);
                }
              }
            }
          }

          previousPos = state.openCellPos;
          previousIndex = state.activeIndex;
        },
        destroy() {
          if (previousPos !== null) {
            const dom = view.nodeDOM(previousPos) as HTMLElement | null;
            if (dom) {
              setPickerOpen(dom, false);
            }
          }
        },
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
