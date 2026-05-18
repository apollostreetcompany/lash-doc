/**
 * panels/MarkdownIO — markdown import/export buttons rendered as compact
 * chrome buttons with icons. Owned by editor-core/markdown.
 */
'use client';

import { type ChangeEvent, type RefObject } from 'react';

import { Icon } from '../../shell/Icon';

export interface MarkdownIOProps {
  fileInputRef: RefObject<HTMLInputElement>;
  onImportClick: () => void;
  onExportClick: () => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  exportDisabled: boolean;
}

export function MarkdownIO({
  fileInputRef,
  onImportClick,
  onExportClick,
  onFileChange,
  exportDisabled,
}: MarkdownIOProps) {
  return (
    <div className="lash-editor-action-group" style={{ display: 'inline-flex', gap: 4 }}>
      <button
        type="button"
        className="lash-icon-btn"
        data-testid="markdown-import-button"
        onClick={onImportClick}
        aria-label="Import markdown"
        data-tooltip="Import .md"
      >
        <Icon name="upload" />
      </button>
      <button
        type="button"
        className="lash-icon-btn"
        data-testid="markdown-export-button"
        onClick={onExportClick}
        disabled={exportDisabled}
        aria-label="Export markdown"
        data-tooltip="Export .md"
      >
        <Icon name="download" />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,text/markdown"
        data-testid="markdown-import-input"
        onChange={onFileChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
