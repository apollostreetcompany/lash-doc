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
  replaceCellContent,
} from './utils';

const applyTransaction = (
  editor: Editor,
  mutator: (state: EditorState, tr: Transaction) => boolean | void,
): boolean => {
  const { state, view } = editor;
  const tr = state.tr;
  const handled = mutator(state, tr);
  if (tr.docChanged || tr.storedMarksSet || tr.selectionSet) {
    view?.dispatch(tr);
    return true;
  }
  return Boolean(handled);
};

export const setSelectionCellType = (
  editor: Editor,
  cellType: LashTableCellType,
  options?: string[],
): boolean => {
  const nextType = sanitizeCellType(cellType);
  return applyTransaction(editor, (state, tr) => {
    const cells = collectSelectedCells(state);
    if (!cells.length) {
      return false;
    }
    const providedOptions = Array.isArray(options)
      ? options.filter((item): item is string => typeof item === 'string')
      : null;
    cells.forEach((cell) => {
      const patch: Partial<LashTableCellAttrs> = { cellType: nextType };
      if (nextType === 'text') {
        patch.options = [];
      } else if (providedOptions !== null) {
        patch.options = [...providedOptions];
        if (providedOptions.length) {
          patch.value = providedOptions[0];
        }
      } else {
        patch.options = undefined;
        patch.value = undefined;
      }
      const previousAttrs = cell.node.attrs as LashTableCellAttrs;
      const previousType = sanitizeCellType(previousAttrs.cellType);
      if (nextType === 'text' && previousType !== 'text') {
        const restoredValue =
          typeof patch.value === 'string'
            ? patch.value
            : typeof previousAttrs.value === 'string'
              ? previousAttrs.value
              : '';
        replaceCellContent(tr, cell, restoredValue);
        patch.value = restoredValue;
      }
      setCellAttributes(tr, cell, patch);
    });
    return true;
  });
};

export const setSelectionCellValue = (editor: Editor, value: string): boolean =>
  applyTransaction(editor, (state, tr) => {
    const cells = collectSelectedCells(state);
    if (!cells.length) {
      return false;
    }
    const stringValue = value == null ? '' : String(value);
    cells.forEach((cell) => {
      const attrs = cell.node.attrs as LashTableCellAttrs;
      const cellType = sanitizeCellType(attrs.cellType);
      if (cellType === 'text') {
        replaceCellContent(tr, cell, stringValue);
      }
      setCellAttributes(tr, cell, { value: stringValue });
    });
    return true;
  });

export const cycleSelectionCellOption = (
  editor: Editor,
  direction: 1 | -1,
): boolean =>
  applyTransaction(editor, (state, tr) => {
    const cells = collectSelectedCells(state);
    if (!cells.length) {
      return false;
    }
    let handled = false;
    cells.forEach((cell) => {
      const attrs = cell.node.attrs as LashTableCellAttrs;
      const cellType = sanitizeCellType(attrs.cellType);
      if (cellType === 'text') {
        return;
      }
      const options = resolveOptions(cellType, attrs.options);
      if (!options.length) {
        return;
      }
      const currentIndex = options.indexOf(attrs.value ?? '');
      const nextIndex = clampOptionIndex(options, currentIndex + direction);
      const nextValue = options[nextIndex] ?? options[0] ?? '';
      setCellAttributes(tr, cell, {
        value: nextValue,
      });
      handled = true;
    });
    return handled;
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
