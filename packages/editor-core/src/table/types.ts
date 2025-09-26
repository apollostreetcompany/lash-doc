export type LashTableCellType = 'text' | 'status' | 'select';

export type LashTableCellAttrs = {
  cellType: LashTableCellType;
  value: string;
  options: string[];
};

export interface LashTableOptions {
  defaultStatusOptions?: string[];
  defaultSelectOptions?: string[];
}

export const CELL_TYPES: readonly LashTableCellType[] = ['text', 'status', 'select'];

const STATUS_DEFAULTS: readonly string[] = ['Todo', 'In Progress', 'Done'];
const SELECT_DEFAULTS: readonly string[] = ['Option A', 'Option B', 'Option C'];

export const DEFAULT_STATUS_CELL_OPTIONS = STATUS_DEFAULTS;
export const DEFAULT_SELECT_CELL_OPTIONS = SELECT_DEFAULTS;

export const cloneDefaultStatusOptions = (): string[] => Array.from(STATUS_DEFAULTS);
export const cloneDefaultSelectOptions = (): string[] => Array.from(SELECT_DEFAULTS);

export const sanitizeCellType = (value: unknown): LashTableCellType => {
  if (typeof value === 'string' && (CELL_TYPES as readonly string[]).includes(value)) {
    return value as LashTableCellType;
  }
  return 'text';
};
