import type { Editor } from '@tiptap/core';
import { CellSelection, TableMap, findTable } from '@tiptap/pm/tables';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const selectTableCells = (
  editor: Editor,
  anchorRow: number,
  anchorCol: number,
  headRow = anchorRow,
  headCol = anchorCol,
): boolean => {
  const { state, view } = editor;
  if (!view) {
    return false;
  }

  const resolvedTable = findTable(state.selection.$from) ?? (() => {
    let located: { pos: number; start: number; node: Parameters<typeof TableMap.get>[0] } | null = null;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        located = { pos, start: pos + 1, node };
        return false;
      }
      return true;
    });
    return located;
  })();

  if (!resolvedTable) {
    return false;
  }

  const map = TableMap.get(resolvedTable.node);
  const maxRow = map.height - 1;
  const maxCol = map.width - 1;
  const safeAnchorRow = clamp(anchorRow, 0, maxRow);
  const safeAnchorCol = clamp(anchorCol, 0, maxCol);
  const safeHeadRow = clamp(headRow, 0, maxRow);
  const safeHeadCol = clamp(headCol, 0, maxCol);

  const anchorIndex = safeAnchorRow * map.width + safeAnchorCol;
  const headIndex = safeHeadRow * map.width + safeHeadCol;

  const anchorCellPos = map.map[anchorIndex];
  const headCellPos = map.map[headIndex];

  const selection = CellSelection.create(
    state.doc,
    resolvedTable.start + anchorCellPos,
    resolvedTable.start + headCellPos,
  );

  view.dispatch(state.tr.setSelection(selection));
  return true;
};
