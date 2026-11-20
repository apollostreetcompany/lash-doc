/** @vitest-environment jsdom */

import {
  DEFAULT_STATUS_CELL_OPTIONS,
  TABLE_INTERACTION_PLUGIN_KEY,
  applyMatrixToSelection,
  buildTsvFromMatrix,
  createLashEditorExtensions,
  extractSelectionMatrix,
  lashCommands,
  parseClipboardTableText,
} from '@lash/editor-core';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap, findTable } from '@tiptap/pm/tables';
import { describe, expect, it } from 'vitest';

const createEditor = () =>
  new Editor({
    extensions: createLashEditorExtensions(),
    content: '<p></p>',
  });

const ensureTable = (editor: Editor, rows = 2, cols = 3) => {
  editor.commands.clearContent();
  editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run();
};

const locateTable = (editor: Editor) => {
  let tablePos = -1;
  let tableNode: Parameters<typeof TableMap.get>[0] | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      tablePos = pos;
      tableNode = node;
      return false;
    }
    return true;
  });
  if (tableNode == null) {
    throw new Error('Table not found in editor content');
  }
  return { tablePos, tableNode } as const;
};

const selectCell = (editor: Editor, row: number, col: number) => {
  const { state, view } = editor;
  const located =
    findTable(state.selection) ??
    (() => {
      const { tablePos, tableNode } = locateTable(editor);
      return { node: tableNode, start: tablePos + 1, pos: tablePos };
    })();
  const map = TableMap.get(located.node);
  const cellRelativePos = map.map[row * map.width + col];
  const cellAbsolutePos = located.start + cellRelativePos;
  const selection = CellSelection.create(state.doc, cellAbsolutePos, cellAbsolutePos);
  view.dispatch(state.tr.setSelection(selection));
};

const getCellAttrs = (editor: Editor, row: number, col: number) => {
  const { tablePos, tableNode } = locateTable(editor);
  const map = TableMap.get(tableNode);
  const cellRelativePos = map.map[row * map.width + col];
  const cellAbsolutePos = tablePos + 1 + cellRelativePos;
  const node = editor.state.doc.nodeAt(cellAbsolutePos);
  if (!node) {
    throw new Error('Cell node not found');
  }
  return node.attrs as { cellType: string; value: string; options: string[] };
};

const getCellText = (editor: Editor, row: number, col: number) => {
  const { tablePos, tableNode } = locateTable(editor);
  const map = TableMap.get(tableNode);
  const cellRelativePos = map.map[row * map.width + col];
  const cellAbsolutePos = tablePos + 1 + cellRelativePos;
  const node = editor.state.doc.nodeAt(cellAbsolutePos);
  if (!node) {
    throw new Error('Cell node not found');
  }
  return node.textContent ?? '';
};

describe('Table behavior', () => {
  it('sets status cell type with default options and value', () => {
    const editor = createEditor();
    ensureTable(editor, 2, 3);
    selectCell(editor, 0, 1);
    const result = lashCommands.setTableCellType(editor, 'status');
    expect(result).toBe(true);
    const attrs = getCellAttrs(editor, 0, 1);
    expect(attrs.cellType).toBe('status');
    expect(attrs.options).toEqual(DEFAULT_STATUS_CELL_OPTIONS);
    expect(attrs.value).toBe(DEFAULT_STATUS_CELL_OPTIONS[0]);
    editor.destroy();
  });

  it('cycles status values with keyboard utility', () => {
    const editor = createEditor();
    ensureTable(editor, 2, 3);
    selectCell(editor, 0, 1);
    lashCommands.setTableCellType(editor, 'status');
    expect(getCellAttrs(editor, 0, 1).value).toBe(DEFAULT_STATUS_CELL_OPTIONS[0]);
    lashCommands.cycleTableCellOption(editor);
    expect(getCellAttrs(editor, 0, 1).value).toBe(DEFAULT_STATUS_CELL_OPTIONS[1]);
    lashCommands.cycleTableCellOption(editor);
    expect(getCellAttrs(editor, 0, 1).value).toBe(DEFAULT_STATUS_CELL_OPTIONS[2]);
    lashCommands.cycleTableCellOption(editor);
    expect(getCellAttrs(editor, 0, 1).value).toBe(DEFAULT_STATUS_CELL_OPTIONS[0]);
    editor.destroy();
  });

  it('follows the open picker when its cell moves and closes when its row is deleted', () => {
    const editor = createEditor();
    try {
      ensureTable(editor, 3, 2);
      selectCell(editor, 1, 0);
      lashCommands.setTableCellType(editor, 'status');
      selectCell(editor, 2, 0);
      lashCommands.setTableCellType(editor, 'status');
      selectCell(editor, 1, 0);
      const cells = () => Array.from(editor.view.dom.querySelectorAll('td'));
      const control = () =>
        cells()[2].querySelector<HTMLButtonElement>('.lash-table-cell-control')!;
      const activeMenu = () =>
        editor.view.dom.querySelector('.lash-table-cell-menu-option[aria-selected="true"]');

      control().click();
      expect(control().getAttribute('aria-expanded')).toBe('true');
      expect(activeMenu()?.textContent).toBe(DEFAULT_STATUS_CELL_OPTIONS[0]);
      const before = TABLE_INTERACTION_PLUGIN_KEY.getState(editor.state)?.openCellPos;

      const paragraph = editor.schema.nodes.paragraph.create();
      editor.view.dispatch(editor.state.tr.insert(0, paragraph));
      expect(TABLE_INTERACTION_PLUGIN_KEY.getState(editor.state)?.openCellPos).toBe(
        before! + paragraph.nodeSize,
      );
      expect(control().getAttribute('aria-expanded')).toBe('true');
      expect(activeMenu()?.textContent).toBe(DEFAULT_STATUS_CELL_OPTIONS[0]);

      editor.commands.deleteRow();
      expect(TABLE_INTERACTION_PLUGIN_KEY.getState(editor.state)?.openCellPos).toBeNull();
      expect(control().getAttribute('aria-expanded')).toBe('false');
      expect(cells()[2].getAttribute('data-picker-open')).toBe('false');
    } finally {
      editor.destroy();
    }
  });

  it('mounts picker controls only for typed cells and preserves them through a value change', () => {
    const editor = createEditor();
    try {
      ensureTable(editor, 2, 3);
      const table = editor.view.dom.querySelector('table')!;
      const cells = [...table.querySelectorAll('td')];
      const pickerChrome = () =>
        table.querySelectorAll('.lash-table-cell-control, .lash-table-cell-menu');
      expect(cells).toHaveLength(6);
      expect(
        cells.every(
          (cell) => cell.children.length === 1 && cell.firstElementChild?.tagName === 'P',
        ),
      ).toBe(true);
      expect(pickerChrome()).toHaveLength(0);
      selectCell(editor, 0, 1);
      lashCommands.setTableCellValue(editor, 'Writer’s notes');
      const textCell = editor.view.dom.querySelectorAll('td')[1];
      expect(textCell.querySelector(':scope > p')?.textContent).toBe('Writer’s notes');
      lashCommands.setTableCellType(editor, 'status');
      const cell = editor.view.dom.querySelectorAll('td')[1];
      expect(cell).not.toBe(textCell);
      expect(pickerChrome()).toHaveLength(2);
      expect(cell.dataset.cellType).toBe('status');
      expect(getCellText(editor, 0, 1)).toBe('Writer’s notes');
      const control = cell.querySelector<HTMLButtonElement>('.lash-table-cell-control')!;
      const option = () => cell.querySelector('.lash-table-cell-menu-option');
      control.click();
      const firstOption = option();
      expect(firstOption).toBeTruthy();

      lashCommands.setTableCellValue(editor, DEFAULT_STATUS_CELL_OPTIONS[2]);
      expect(control.getAttribute('aria-expanded')).toBe('true');
      expect(option()).toBe(firstOption);

      lashCommands.setTableCellType(editor, 'text');
      const restoredCell = editor.view.dom.querySelectorAll('td')[1];
      expect(restoredCell).not.toBe(cell);
      expect(restoredCell.dataset.cellType).toBe('text');
      expect(restoredCell.querySelector(':scope > p')?.textContent).toBe(
        DEFAULT_STATUS_CELL_OPTIONS[2],
      );
      expect(pickerChrome()).toHaveLength(0);
      expect(control.getAttribute('aria-expanded')).toBe('false');
      expect(cell.querySelector<HTMLUListElement>('.lash-table-cell-menu')?.hidden).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it('moves focus through the clicked cell menu without changing the editor selection', () => {
    const editor = createEditor();
    const editorDom = editor.view.dom;
    document.body.append(editorDom);
    try {
      ensureTable(editor, 2, 2);
      selectCell(editor, 0, 1);
      lashCommands.setTableCellType(editor, 'status');
      selectCell(editor, 1, 0);
      const before = editor.state.selection;
      const cell = editorDom.querySelectorAll('td')[1];
      const control = cell.querySelector<HTMLButtonElement>('.lash-table-cell-control')!;
      const menu = cell.querySelector<HTMLUListElement>('.lash-table-cell-menu')!;
      control.click();
      expect(document.activeElement).toBe(menu);

      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const active = menu.querySelector('[aria-selected="true"]');
      expect(active?.textContent).toBe(DEFAULT_STATUS_CELL_OPTIONS[1]);
      expect(menu.getAttribute('aria-activedescendant')).toBe(active?.id);
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(getCellAttrs(editor, 0, 1).value).toBe(DEFAULT_STATUS_CELL_OPTIONS[1]);
      expect(editor.state.selection.eq(before)).toBe(true);
      expect(menu.hidden).toBe(true);
      expect(document.activeElement).toBe(control);
    } finally {
      editor.destroy();
      editorDom.remove();
    }
  });

  it('closes the active picker and discards stale option clicks when editing becomes unavailable', async () => {
    const editor = createEditor();
    try {
      ensureTable(editor, 2, 2);
      selectCell(editor, 0, 1);
      lashCommands.setTableCellType(editor, 'status');
      const cell = editor.view.dom.querySelectorAll('td')[1];
      const control = cell.querySelector<HTMLButtonElement>('.lash-table-cell-control')!;
      control.click();
      const option = cell.querySelectorAll<HTMLButtonElement>('.lash-table-cell-menu-option')[1];
      expect(control.getAttribute('aria-expanded')).toBe('true');

      editor.setEditable(false);
      expect(control.getAttribute('aria-expanded')).toBe('false');
      option.click();
      expect(getCellAttrs(editor, 0, 1).value).toBe(DEFAULT_STATUS_CELL_OPTIONS[0]);
      await Promise.resolve();
      editor.setEditable(true);
      expect(TABLE_INTERACTION_PLUGIN_KEY.getState(editor.state)?.openCellPos).toBeNull();
      expect(control.getAttribute('aria-expanded')).toBe('false');
    } finally {
      editor.destroy();
    }
  });

  it('reports active cell attrs through helper', () => {
    const editor = createEditor();
    ensureTable(editor, 1, 2);
    selectCell(editor, 0, 1);
    lashCommands.setTableCellType(editor, 'status');
    const attrs = lashCommands.getTableCellAttrs(editor);
    expect(attrs?.cellType).toBe('status');
    expect(attrs?.value).toBe(DEFAULT_STATUS_CELL_OPTIONS[0]);
    expect(attrs?.options).toEqual(DEFAULT_STATUS_CELL_OPTIONS);
    editor.destroy();
  });

  it('sets text cell value and updates node content', () => {
    const editor = createEditor();
    ensureTable(editor, 1, 1);
    selectCell(editor, 0, 0);
    const result = lashCommands.setTableCellValue(editor, 'Hello World');
    expect(result).toBe(true);
    expect(getCellText(editor, 0, 0)).toBe('Hello World');
    const attrs = getCellAttrs(editor, 0, 0);
    expect(attrs.value).toBe('Hello World');
    editor.destroy();
  });

  it('extracts and applies matrices for TSV interop', () => {
    const editor = createEditor();
    ensureTable(editor, 2, 2);
    selectCell(editor, 0, 0);
    lashCommands.setTableCellType(editor, 'text');
    lashCommands.setTableCellValue(editor, 'Alpha');
    selectCell(editor, 0, 1);
    lashCommands.setTableCellValue(editor, 'Beta');
    selectCell(editor, 1, 0);
    lashCommands.setTableCellValue(editor, 'Gamma');
    selectCell(editor, 1, 1);
    lashCommands.setTableCellValue(editor, 'Delta');

    const { tablePos, tableNode } = locateTable(editor);
    const map = TableMap.get(tableNode);
    const firstCellPos = tablePos + 1 + map.map[0];
    const lastCellPos = tablePos + 1 + map.map[map.map.length - 1];
    const selection = CellSelection.create(editor.state.doc, firstCellPos, lastCellPos);
    editor.view.dispatch(editor.state.tr.setSelection(selection));

    const matrix = extractSelectionMatrix(editor.state);
    expect(matrix).toEqual([
      ['Alpha', 'Beta'],
      ['Gamma', 'Delta'],
    ]);

    const pasted = parseClipboardTableText('One\tTwo\nThree\tFour');
    const tr = editor.state.tr;
    const changed = applyMatrixToSelection(editor.state, tr, pasted);
    expect(changed).toBe(true);
    editor.view.dispatch(tr);

    const updatedMatrix = extractSelectionMatrix(editor.state);
    expect(updatedMatrix).toEqual([
      ['One', 'Two'],
      ['Three', 'Four'],
    ]);

    expect(buildTsvFromMatrix(updatedMatrix)).toBe('One\tTwo\nThree\tFour');
    editor.destroy();
  });
});
