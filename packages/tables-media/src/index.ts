/**
 * @lash/tables-media — large-table virtualization, image upload/transform pipeline,
 *                      checklist behavior helpers.
 *
 * NOTE: most table behavior already lives in `@lash/editor-core/extensions/table`.
 * This package owns features that are too heavy to colocate (virtualization, upload pipelines,
 * media transforms). Status: SCAFFOLD — implement in M5/F4 (perf gates).
 */

export interface TableViewport {
  /** visible row range */
  rowFrom: number;
  rowTo: number;
  /** visible col range */
  colFrom: number;
  colTo: number;
}

export interface TableVirtualizer {
  /** decide which cells to render given the viewport */
  selectVisibleCells(table: unknown, viewport: TableViewport): { row: number; col: number }[];
  /** notify of scroll/resize */
  onViewportChange(viewport: TableViewport): void;
}

export const createTableVirtualizer = (_config: { rowHeightPx: number; columnWidthPx: number }): TableVirtualizer => {
  throw new Error('createTableVirtualizer: not implemented (M5/F4)');
};

export interface UploadPipeline {
  upload(file: File): Promise<{ src: string; width?: number; height?: number }>;
  transform(src: string, ops: { resize?: { width: number; height?: number } }): Promise<string>;
}

export const createUploadPipeline = (_config: { endpoint: string }): UploadPipeline => {
  throw new Error('createUploadPipeline: not implemented (M5)');
};
