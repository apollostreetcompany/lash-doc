/**
 * panels/MarkdownIO — markdown import/export buttons rendered as compact
 * chrome buttons with icons. Owned by editor-core/markdown.
 */
'use client';

import { type ChangeEvent, type RefObject } from 'react';

import { Icon } from '../../shell/Icon';

export interface MarkdownIOProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onImportClick: (trigger: HTMLButtonElement) => void;
  onExportClick: (trigger: HTMLButtonElement) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  importDisabled?: boolean;
  exportDisabled: boolean;
}

export function MarkdownIO({
  fileInputRef,
  onImportClick,
  onExportClick,
  onFileChange,
  importDisabled = false,
  exportDisabled,
}: MarkdownIOProps) {
  return (
    <div className="lash-editor-action-group lash-markdown-actions">
      <button
        type="button"
        className="lash-markdown-action"
        data-testid="markdown-import-button"
        onClick={(event) => onImportClick(event.currentTarget)}
        disabled={importDisabled}
      >
        <Icon name="upload" />
        <span>Import Markdown</span>
      </button>
      <button
        type="button"
        className="lash-markdown-action"
        data-testid="markdown-export-button"
        onClick={(event) => onExportClick(event.currentTarget)}
        disabled={exportDisabled}
      >
        <Icon name="download" />
        <span>Download Markdown</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,text/markdown"
        data-testid="markdown-import-input"
        onChange={onFileChange}
        disabled={importDisabled}
        style={{ display: 'none' }}
      />
    </div>
  );
}
