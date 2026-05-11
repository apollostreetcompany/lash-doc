/**
 * panels/MarkdownIO — the markdown import/export buttons in the action bar.
 *
 * Owned by editor-core/markdown; this is a thin React shell. M1 does not
 * modify this directly.
 */
'use client';

import { type ChangeEvent, type RefObject } from 'react';

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
    <div className="lash-editor-action-group">
      <button
        type="button"
        className="chrome-button"
        data-testid="markdown-import-button"
        onClick={onImportClick}
      >
        Import Markdown
      </button>
      <button
        type="button"
        className="chrome-button"
        data-testid="markdown-export-button"
        onClick={onExportClick}
        disabled={exportDisabled}
      >
        Export Markdown
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
