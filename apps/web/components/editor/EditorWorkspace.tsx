'use client';

import {
  createLashEditorExtensions,
  createLocalStorageOutlinePersistence,
  getOutlineItems,
  isToolbarButtonActive,
  lashCommands,
  parseMarkdownToDoc,
  runToolbarAction,
  selectTableCells,
  serializeDocToMarkdown,
  toolbarGroups,
  type LashImageUploader,
  type OutlineItem,
  type ToolbarButtonSpec,
} from '@lash/editor-core';
import { ToolbarButton, ToolbarGroup } from '@lash/ui';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createBrowserImageUploader } from '../../lib/createBrowserImageUploader';

const normalizeUrl = (href: string): string => {
  if (!href) {
    return href;
  }
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
};

const TOOLBAR_META = [
  { label: 'Inline formatting', items: toolbarGroups.marks },
  { label: 'Structure', items: toolbarGroups.blocks },
];

const OUTLINE_DOC_ID = 'demo-document';

export function EditorWorkspace() {
  const [version, setVersion] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const imageUploader = useMemo<LashImageUploader>(() => createBrowserImageUploader(), []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const outlinePersistence = useMemo(
    () =>
      createLocalStorageOutlinePersistence(
        typeof window === 'undefined' ? undefined : window.localStorage,
      ),
    [],
  );

  const handleLinkCommand = useCallback((activeEditor: Editor) => {
    const currentHref = activeEditor.getAttributes('link').href as string | undefined;
    const next = window.prompt('Link URL', currentHref ?? '');
    if (next === null) {
      return false;
    }
    const normalized = normalizeUrl(next);
    if (!normalized) {
      return runToolbarAction(activeEditor, 'link');
    }
    return runToolbarAction(activeEditor, 'link', { href: normalized });
  }, []);

  const extensions = useMemo(
    () =>
      createLashEditorExtensions({
        onRequestLink: handleLinkCommand,
        outline: {
          documentId: OUTLINE_DOC_ID,
          persistence: outlinePersistence,
        },
        image: {
          uploader: imageUploader,
        },
      }),
    [handleLinkCommand, outlinePersistence, imageUploader],
  );

  const editor = useEditor({
    extensions,
    autofocus: 'end',
    content: '<p></p>',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'lash-editor-content',
      },
    },
  }, [extensions]);

  useEffect(() => {
    if (!editor) {
      setOutlineItems([]);
      return;
    }
    const updateOutline = () => {
      setOutlineItems(getOutlineItems(editor.state));
      setVersion((value) => value + 1);
    };
    updateOutline();
    editor.on('selectionUpdate', updateOutline);
    editor.on('transaction', updateOutline);
    return () => {
      editor.off('selectionUpdate', updateOutline);
      editor.off('transaction', updateOutline);
    };
  }, [editor]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__lashOutlineItems = outlineItems;
    return () => {
      if (typeof window === 'undefined') {
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__lashOutlineItems;
    };
  }, [outlineItems]);

  useEffect(() => {
    if (typeof window === 'undefined' || !editor) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    win.__lashEditor = editor;
    win.__lashImageUploader = imageUploader;
    win.__lashImageUploadMock = win.__lashImageUploadMock ?? {};
    win.__lashCommands = lashCommands;
    win.__lashTable = {
      setCellType: (type: string, options?: string[]) =>
        lashCommands.setTableCellType(editor, type as never, options),
      setCellValue: (value: string) => lashCommands.setTableCellValue(editor, value),
      cycle: (direction = 1) => lashCommands.cycleTableCellOption(editor, direction as 1 | -1),
    };
    win.__lashInsertTable = (rows = 3, cols = 3) => {
      lashCommands.insertTable(editor, { rows, cols });
    };
    win.__lashSelectTableCells = (
      anchorRow: number,
      anchorCol: number,
      headRow = anchorRow,
      headCol = anchorCol,
    ) => selectTableCells(editor, anchorRow, anchorCol, headRow, headCol);
    win.__lashSerializeMarkdown = () =>
      serializeDocToMarkdown(editor.getJSON(), { documentId: OUTLINE_DOC_ID }).markdown;
    win.__lashInsertImageFromArrayBuffer = async (
      buffer: ArrayBuffer,
      mimeType = 'image/png',
    ) => {
      const file = new File([buffer], `import-${Date.now()}.${mimeType.split('/')[1] ?? 'png'}`, {
        type: mimeType,
      });
      editor.commands.insertImagePlaceholder(file);
    };
    return () => {
      if (typeof window === 'undefined') {
        return;
      }
      if (win.__lashEditor === editor) {
        delete win.__lashEditor;
      }
      if (win.__lashImageUploader === imageUploader) {
        delete win.__lashImageUploader;
      }
      if (win.__lashCommands === lashCommands) {
        delete win.__lashCommands;
      }
      if (win.__lashTable) {
        delete win.__lashTable;
      }
      delete win.__lashInsertTable;
      delete win.__lashSelectTableCells;
      delete win.__lashSerializeMarkdown;
      delete win.__lashInsertImageFromArrayBuffer;
    };
  }, [editor, imageUploader]);

  const isEditorReady = Boolean(editor);
  const toolbarData = useMemo(() => TOOLBAR_META, []);

  const handleToolbarClick = useCallback(
    (spec: ToolbarButtonSpec) => {
      if (!editor) {
        return;
      }
      if (spec.id === 'link') {
        handleLinkCommand(editor);
        return;
      }
      runToolbarAction(editor, spec.id);
    },
    [editor, handleLinkCommand],
  );

  const handleToggleHeading = useCallback(
    (item: OutlineItem) => {
      if (!editor) {
        return;
      }
      lashCommands.toggleHeadingCollapse(editor, item.headingId);
    },
    [editor],
  );

  const handleFocusHeading = useCallback(
    (item: OutlineItem) => {
      if (!editor) {
        return;
      }
      editor
        .chain()
        .focus()
        .setTextSelection({ from: item.from, to: item.from })
        .scrollIntoView()
        .run();
    },
    [editor],
  );

  const handleFocusModeToggle = useCallback(() => {
    setIsFocusMode((value) => !value);
  }, []);

  const handleImportMarkdown = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const showWarnings = useCallback((warnings: string[]) => {
    if (!warnings.length) {
      return;
    }
    const message = `Markdown warnings:\n${warnings.join('\n')}`;
    console.warn(message);
    if (typeof window !== 'undefined') {
      window.alert(message);
    }
  }, []);

  const handleMarkdownFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !editor) {
        return;
      }
      const text = await file.text();
      const { doc, warnings } = parseMarkdownToDoc(text, { documentId: OUTLINE_DOC_ID });
      editor.commands.setContent(doc, false);
      showWarnings(warnings);
    },
    [editor, showWarnings],
  );

  const handleExportMarkdown = useCallback(() => {
    if (!editor) {
      return;
    }
    const { markdown, warnings } = serializeDocToMarkdown(editor.getJSON(), {
      documentId: OUTLINE_DOC_ID,
    });
    showWarnings(warnings);
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__lashLastExport = markdown;
    }
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'document.md';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [editor, showWarnings]);

  return (
    <div
      data-testid="lash-editor-shell"
      data-focus-mode={isFocusMode ? 'true' : 'false'}
      aria-live="polite"
      className="lash-editor-shell"
    >
      <div className="lash-editor-controls">
        <div className="lash-editor-action-group">
          <button
            type="button"
            className="chrome-button"
            data-testid="markdown-import-button"
            onClick={handleImportMarkdown}
          >
            Import Markdown
          </button>
          <button
            type="button"
            className="chrome-button"
            data-testid="markdown-export-button"
            onClick={handleExportMarkdown}
            disabled={!isEditorReady}
          >
            Export Markdown
          </button>
        </div>
        <button
          type="button"
          data-testid="focus-mode-toggle"
          onClick={handleFocusModeToggle}
          aria-pressed={isFocusMode ? 'true' : 'false'}
          className="focus-mode-toggle"
        >
          {isFocusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,text/markdown"
          data-testid="markdown-import-input"
          onChange={handleMarkdownFileChange}
          style={{ display: 'none' }}
        />
      </div>
      <div className="lash-editor-layout">
        {!isFocusMode ? (
          <aside
            data-testid="lash-outline-panel"
            aria-label="Document outline"
            className="lash-outline-panel"
          >
            <div className="outline-header">
              <h2 className="outline-title" id="lash-outline-title">
                Outline
              </h2>
            </div>
            <ol className="outline-list" aria-labelledby="lash-outline-title">
              {outlineItems.map((item) => {
                const indentStyle = { marginLeft: `${(item.level - 1) * 1.1}rem` };
                const metaLabel = `${item.descendantCount} sections · ${item.hiddenBlockCount} blocks`;
                return (
                  <li
                    key={item.headingId}
                    data-heading-id={item.headingId}
                    className="outline-entry"
                    data-level={item.level}
                    data-collapsed={item.collapsed ? 'true' : 'false'}
                    style={indentStyle}
                  >
                    <button
                      type="button"
                      className="outline-collapse-button"
                      data-testid={`outline-toggle-${item.headingId}`}
                      aria-label={item.collapsed ? 'Expand section' : 'Collapse section'}
                      aria-expanded={item.collapsed ? 'false' : 'true'}
                      onClick={() => handleToggleHeading(item)}
                    >
                      {item.collapsed ? '▶' : '▼'}
                    </button>
                    <button
                      type="button"
                      className="outline-jump-button"
                      data-testid={`outline-jump-${item.headingId}`}
                      onClick={() => handleFocusHeading(item)}
                    >
                      <span className="outline-text">{item.title}</span>
                      <span className="outline-meta" aria-hidden="true">
                        {metaLabel}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>
        ) : null}
        <div className="lash-editor-main">
          <div
            role="toolbar"
            aria-label="Editor toolbar"
            data-testid="lash-toolbar"
            className="lash-toolbar"
            hidden={isFocusMode}
          >
            {toolbarData.map(({ label, items }) => (
              <ToolbarGroup key={label} label={label}>
                {items.map((item) => {
                  const active = editor ? isToolbarButtonActive(editor, item.id) : false;
                  return (
                    <ToolbarButton
                      key={item.id}
                      data-testid={`toolbar-btn-${item.id}`}
                      title={item.hotkey ? `${item.label} (${item.hotkey})` : item.label}
                      shortcut={item.hotkey}
                      onClick={() => handleToolbarClick(item)}
                      active={active}
                      disabled={!isEditorReady}
                      icon={item.icon}
                    />
                  );
                })}
              </ToolbarGroup>
            ))}
          </div>

          <div className="lash-editor-content-wrapper" role="region" aria-label="Document editor">
            {!isMounted || !isEditorReady ? (
              <div className="editor-loading">Loading editor...</div>
            ) : (
              <EditorContent
                editor={editor}
                data-testid="lash-editor-content"
                className="lash-editor-content"
              />
            )}
          </div>
        </div>
      </div>

      <span style={{ display: 'none' }}>{version}</span>
    </div>
  );
}

export default EditorWorkspace;
