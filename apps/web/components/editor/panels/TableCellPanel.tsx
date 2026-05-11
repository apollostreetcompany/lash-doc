/**
 * panels/TableCellPanel — controls for the currently-selected table cell.
 *
 * Surface for cell-type switching, value editing, and option cycling.
 * Driven by `lashCommands` from editor-core. M1 does not modify this
 * panel; B1-B5 lanes own other slots.
 */
'use client';

import type { LashTableCellAttrs, LashTableCellType } from '@lash/editor-core';

export type ActiveCell = Pick<LashTableCellAttrs, 'cellType' | 'value' | 'options'>;

export const TABLE_CELL_TYPES: Array<{ type: LashTableCellType; label: string }> = [
  { type: 'text', label: 'Text' },
  { type: 'status', label: 'Status' },
  { type: 'select', label: 'Select' },
];

export interface TableCellPanelProps {
  active: ActiveCell;
  onSetCellType: (type: LashTableCellType) => void;
  onSetValue: (value: string) => void;
  onCycle: (direction: 1 | -1) => void;
}

export function TableCellPanel({ active, onSetCellType, onSetValue, onCycle }: TableCellPanelProps) {
  return (
    <div className="lash-table-panel" data-cell-type={active.cellType} aria-live="polite">
      <div className="lash-table-panel-row">
        <span className="lash-table-panel-label">Cell type</span>
        <div className="lash-table-type-buttons" role="group" aria-label="Table cell type">
          {TABLE_CELL_TYPES.map(({ type, label }) => {
            const isActive = active.cellType === type;
            return (
              <button
                key={type}
                type="button"
                className="lash-table-type-button"
                data-active={isActive ? 'true' : 'false'}
                aria-pressed={isActive ? 'true' : 'false'}
                onClick={() => onSetCellType(type)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {active.cellType !== 'text' ? (
        <div className="lash-table-panel-row">
          <span className="lash-table-panel-label">Value</span>
          <div className="lash-table-value-controls">
            <span className="lash-table-value-chip">{active.value || '—'}</span>
            <button
              type="button"
              className="lash-table-cycle-button"
              onClick={() => onCycle(1)}
            >
              Cycle
            </button>
            <button
              type="button"
              className="lash-table-cycle-button"
              onClick={() => onCycle(-1)}
            >
              Back
            </button>
          </div>
          {active.options.length ? (
            <div className="lash-table-option-grid" role="listbox" aria-label="Table cell options">
              {active.options.map((option) => {
                const isActiveOption = option === active.value;
                return (
                  <button
                    key={option}
                    type="button"
                    className="lash-table-option-button"
                    role="option"
                    aria-selected={isActiveOption ? 'true' : 'false'}
                    data-active={isActiveOption ? 'true' : 'false'}
                    onClick={() => onSetValue(option)}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
