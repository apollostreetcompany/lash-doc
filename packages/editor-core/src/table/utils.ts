import type { EditorState, Transaction } from '@tiptap/pm/state';
import { CellSelection, cellAround } from '@tiptap/pm/tables';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import type { LashTableCellAttrs, LashTableCellType } from './types';
import {
  sanitizeCellType,
  DEFAULT_SELECT_CELL_OPTIONS,
  DEFAULT_STATUS_CELL_OPTIONS,
} from './types';

export interface TableCellInfo {
  pos: number;
  node: ProseMirrorNode;
}

const isLashCell = (node: ProseMirrorNode | null | undefined): node is ProseMirrorNode => {
  if (!node) {
    return false;
  }
  return node.type.name === 'tableCell' || node.type.name === 'tableHeader';
};

export const collectSelectedCells = (state: EditorState): TableCellInfo[] => {
  const { selection } = state;
  if (selection instanceof CellSelection) {
    const cells: TableCellInfo[] = [];
    selection.forEachCell((node, pos) => {
      if (isLashCell(node)) {
        cells.push({ pos, node });
      }
    });
    return cells;
  }
  const resolved = cellAround(selection.$from);
  if (!resolved) {
    return [];
  }
  const node = resolved.nodeAfter ?? resolved.nodeBefore;
  if (!isLashCell(node)) {
    return [];
  }
  return [{ pos: resolved.pos, node }];
};

export const clampOptionIndex = (options: string[], index: number): number => {
  if (!options.length) {
    return -1;
  }
  const size = options.length;
  return ((index % size) + size) % size;
};

export const resolveOptions = (
  cellType: LashTableCellType,
  provided: string[] | null | undefined,
): string[] => {
  if (cellType === 'status') {
    const source = Array.isArray(provided) && provided.length ? provided : DEFAULT_STATUS_CELL_OPTIONS;
    return Array.from(source);
  }
  if (cellType === 'select') {
    const source = Array.isArray(provided) && provided.length ? provided : DEFAULT_SELECT_CELL_OPTIONS;
    return Array.from(source);
  }
  return Array.isArray(provided) ? provided.filter((item) => typeof item === 'string') : [];
};

export const mergeCellAttrs = (
  node: ProseMirrorNode,
  attrs: Partial<LashTableCellAttrs>,
): LashTableCellAttrs & Record<string, unknown> => {
  const current = node.attrs as LashTableCellAttrs & Record<string, unknown>;
  const nextType = sanitizeCellType(attrs.cellType ?? current.cellType);
  const options = resolveOptions(nextType, attrs.options ?? (current.options as string[]));
  const value =
    typeof attrs.value === 'string'
      ? attrs.value
      : typeof current.value === 'string'
        ? current.value
        : '';
  const adjustedValue =
    nextType === 'text' || !options.length ? value : options.includes(value) ? value : options[0] ?? '';

  return {
    ...current,
    ...attrs,
    cellType: nextType,
    options,
    value: adjustedValue,
  } as LashTableCellAttrs & Record<string, unknown>;
};

export const setCellAttributes = (
  tr: Transaction,
  cell: TableCellInfo,
  attrs: Partial<LashTableCellAttrs>,
) => {
  const nextAttrs = mergeCellAttrs(cell.node, attrs);
  tr.setNodeMarkup(cell.pos, cell.node.type, nextAttrs);
};

export const replaceCellContent = (tr: Transaction, cell: TableCellInfo, text: string) => {
  const schema = tr.doc.type.schema;
  const paragraph = schema.nodes.paragraph;
  if (!paragraph) {
    return;
  }
  const from = cell.pos + 1;
  const to = cell.pos + cell.node.nodeSize - 1;
  const textNode = text.length ? schema.text(text) : null;
  const paragraphNode = paragraph.create(null, textNode ? [textNode] : undefined);
  tr.replaceWith(from, to, paragraphNode);
};

export const getCellDisplayValue = (node: ProseMirrorNode): string => {
  const attrs = node.attrs as Partial<LashTableCellAttrs>;
  const cellType = sanitizeCellType(attrs.cellType);
  if (cellType === 'text') {
    return node.textContent ?? '';
  }
  return typeof attrs.value === 'string' ? attrs.value : '';
};
