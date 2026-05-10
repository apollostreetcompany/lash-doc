import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap, cellAround } from '@tiptap/pm/tables';

import type { LashTableCellAttrs } from './types';
import { sanitizeCellType } from './types';
import {
  collectSelectedCells,
  getCellDisplayValue,
  replaceCellContent,
  resolveOptions,
  setCellAttributes,
} from './utils';

export interface TableSelectionGeometry {
  table: ProseMirrorNode;
  tableStart: number;
  map: TableMap;
  rect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

const resolveSelectionGeometry = (state: EditorState): TableSelectionGeometry | null => {
  const { selection } = state;
  const cellSelection = selection instanceof CellSelection ? selection : null;
  const $anchor = cellSelection ? cellSelection.$anchorCell : cellAround(selection.$from);
  if (!$anchor) {
    return null;
  }
  const table = $anchor.node(-1);
  const tableStart = $anchor.start(-1);
  const map = TableMap.get(table);
  const anchorRect = map.findCell($anchor.pos - tableStart);
  const $head = cellSelection ? cellSelection.$headCell : $anchor;
  const headRect = map.findCell($head.pos - tableStart);
  const rect = {
    top: Math.min(anchorRect.top, headRect.top),
    left: Math.min(anchorRect.left, headRect.left),
    bottom: Math.max(anchorRect.bottom, headRect.bottom),
    right: Math.max(anchorRect.right, headRect.right),
  };
  return { table, tableStart, map, rect };
};

export const extractSelectionMatrix = (state: EditorState): string[][] | null => {
  const geometry = resolveSelectionGeometry(state);
  if (!geometry) {
    return null;
  }
  const {
    tableStart,
    map,
    rect,
  } = geometry;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const matrix: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => ''));
  const cellPositions = map.cellsInRect(rect);
  cellPositions.forEach((cellRelativePos, index) => {
    const row = Math.floor(index / width);
    const col = index % width;
    const absolutePos = tableStart + cellRelativePos;
    const node = state.doc.nodeAt(absolutePos);
    if (!node) {
      return;
    }
    matrix[row][col] = getCellDisplayValue(node);
  });
  return matrix;
};

const normalizePastedMatrix = (rows: string[][]): string[][] => {
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    if (row.length === maxColumns) {
      return row;
    }
    const next = row.slice(0);
    while (next.length < maxColumns) {
      next.push('');
    }
    return next;
  });
};

const parsePlainTableText = (text: string): string[][] => {
  if (!text.trim()) {
    return [['']];
  }
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const hasTabs = text.includes('\t');
  const delimiter = hasTabs ? '\t' : ',';
  const rows = lines.map((line) => {
    if (!line) {
      return [''];
    }
    return line.split(delimiter).map((cell) => cell.trim());
  });
  return normalizePastedMatrix(rows);
};

export const applyMatrixToSelection = (
  state: EditorState,
  tr: Transaction,
  matrix: string[][],
): boolean => {
  const geometry = resolveSelectionGeometry(state);
  if (!geometry) {
    return false;
  }
  const {
    map,
    tableStart,
    rect,
  } = geometry;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  let changed = false;

  // Track all cell positions before making changes
  const cellPositions: Array<{ originalPos: number; rowIndex: number; colIndex: number; value: string }> = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    for (let colIndex = 0; colIndex < width; colIndex += 1) {
      const value = matrix[rowIndex]?.[colIndex];
      if (typeof value !== 'string') {
        continue;
      }
      const mapIndex = (rect.top + rowIndex) * map.width + (rect.left + colIndex);
      const cellRelativePos = map.map[mapIndex];
      const pos = tableStart + cellRelativePos;
      cellPositions.push({ originalPos: pos, rowIndex, colIndex, value });
    }
  }

  // Apply changes and track position mappings
  for (const cellData of cellPositions) {
    // Map the position through any changes made so far
    const mappedPos = tr.mapping.map(cellData.originalPos);
    const node = tr.doc.nodeAt(mappedPos);
    if (!node) {
      continue;
    }
    const cellInfo = { pos: mappedPos, node } as const;
    const attrs = node.attrs as Partial<LashTableCellAttrs>;
    const cellType = sanitizeCellType(attrs.cellType);
    if (cellType === 'text') {
      replaceCellContent(tr, cellInfo, cellData.value);
    } else {
      const options = resolveOptions(cellType, attrs.options);
      const nextValue = options.includes(cellData.value) ? cellData.value : options[0] ?? '';
      setCellAttributes(tr, cellInfo, { value: nextValue });
    }
    changed = true;
  }
  return changed;
};

export const buildTsvFromMatrix = (matrix: string[][]): string =>
  matrix.map((row) => row.join('\t')).join('\n');

export const parseClipboardTableText = (text: string): string[][] => parsePlainTableText(text);

export const hasTableSelection = (state: EditorState): boolean => collectSelectedCells(state).length > 0;
