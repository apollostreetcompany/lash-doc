/**
 * @lash/tables-media — large-table virtualization + image upload/transform pipeline.
 *
 * NOTE: most table behavior already lives in `@lash/editor-core/extensions/table`,
 * including checklist behavior helpers (which stayed there per proconsult-m0/B
 * P2 — they belong with schema/plugin ownership, not with virtualization/media).
 *
 * Status: SCAFFOLD — implement in M5/F4 (perf gates) for tables, ad-hoc for media.
 */

export interface TableViewport {
  /** Visible row range. */
  rowFrom: number;
  rowTo: number;
  /** Visible col range. */
  colFrom: number;
  colTo: number;
}

export interface TableVirtualizer {
  selectVisibleCells(table: unknown, viewport: TableViewport): { row: number; col: number }[];
  onViewportChange(viewport: TableViewport): void;
}

export const createTableVirtualizer = (_config: {
  rowHeightPx: number;
  columnWidthPx: number;
}): TableVirtualizer => {
  throw new Error('createTableVirtualizer: not implemented (M5/F4)');
};

export interface UploadPipeline {
  upload(file: File): Promise<{ src: string; width?: number; height?: number }>;
  transform(src: string, ops: { resize?: { width: number; height?: number } }): Promise<string>;
}

export const createUploadPipeline = (_config: { endpoint: string }): UploadPipeline => {
  throw new Error('createUploadPipeline: not implemented (M5)');
};
