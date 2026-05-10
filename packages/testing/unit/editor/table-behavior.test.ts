/** @vitest-environment jsdom */

import {
  DEFAULT_STATUS_CELL_OPTIONS,
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
  const located = findTable(state.selection) ?? (() => {
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
