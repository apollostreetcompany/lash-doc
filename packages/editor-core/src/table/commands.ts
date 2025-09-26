import type { Editor } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';

import type { LashTableCellAttrs, LashTableCellType } from './types';
import { sanitizeCellType } from './types';
import {
  collectSelectedCells,
  mergeCellAttrs,
  resolveOptions,
  clampOptionIndex,
  setCellAttributes,
} from './utils';

const applyTransaction = (
  editor: Editor,
  mutator: (state: EditorState, tr: Transaction) => void,
): boolean => {
  const { state, view } = editor;
  const tr = state.tr;
  mutator(state, tr);
  if (tr.docChanged || tr.storedMarksSet || tr.selectionSet) {
    view?.dispatch(tr);
    return true;
  }
  return false;
};

export const setSelectionCellType = (
  editor: Editor,
  cellType: LashTableCellType,
  options?: string[],
): boolean => {
  const nextType = sanitizeCellType(cellType);
  return applyTransaction(editor, (state, tr) => {
    const cells = collectSelectedCells(state);
    cells.forEach((cell) => {
      const nextAttrs = mergeCellAttrs(cell.node, {
        cellType: nextType,
        options,
        value: options && options.length ? options[0] : undefined,
      } as Partial<LashTableCellAttrs>);
      tr.setNodeMarkup(cell.pos, cell.node.type, nextAttrs);
    });
  });
};

export const setSelectionCellValue = (editor: Editor, value: string): boolean =>
  applyTransaction(editor, (state, tr) => {
    const cells = collectSelectedCells(state);
    cells.forEach((cell) => {
      const nextAttrs = mergeCellAttrs(cell.node, { value });
      tr.setNodeMarkup(cell.pos, cell.node.type, nextAttrs);
    });
  });

export const cycleSelectionCellOption = (
  editor: Editor,
  direction: 1 | -1,
): boolean =>
  applyTransaction(editor, (state, tr) => {
    const cells = collectSelectedCells(state);
    cells.forEach((cell) => {
      const attrs = cell.node.attrs as LashTableCellAttrs;
      const options = resolveOptions(attrs.cellType, attrs.options);
      if (!options.length || attrs.cellType === 'text') {
        return;
      }
      const currentIndex = options.indexOf(attrs.value ?? '');
      const nextIndex = clampOptionIndex(options, currentIndex + direction);
      const nextValue = options[nextIndex] ?? options[0] ?? '';
      setCellAttributes(tr, cell, {
        value: nextValue,
      });
    });
  });

export const getActiveCellAttrs = (
  editor: Editor,
): (LashTableCellAttrs & Record<string, unknown>) | null => {
  const cells = collectSelectedCells(editor.state);
  if (!cells.length) {
    return null;
  }
  return mergeCellAttrs(cells[0].node, cells[0].node.attrs);
};
