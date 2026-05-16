'use client';

import { createAuthorshipMap } from '@lash/authorship';
import {
  createLashEditorExtensions,
  createLocalStorageOutlinePersistence,
  getOutlineItems,
  lashCommands,
  parseMarkdownToDoc,
  runToolbarAction,
  selectTableCells,
  serializeDocToMarkdown,
  toolbarGroups,
  type LashImageUploader,
  type LashTableCellAttrs,
  type LashTableCellType,
  type OutlineItem,
  type ToolbarButtonSpec,
} from '@lash/editor-core';
import { EMPTY_HISTORY_DOC, createHistoryStore } from '@lash/history';
import { createDocumentId, hashCanonical, type HistoryEntry } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AIPanel } from './panels/AIPanel';
import { AutosaveIndicator } from './panels/AutosaveIndicator';
import { ChatPanel } from './panels/ChatPanel';
import { EditorToolbar, type ToolbarMeta } from './panels/EditorToolbar';
import { FocusModeToggle } from './panels/FocusModeToggle';
import { HistoryPanel, type HistoryTimeFilter } from './panels/HistoryPanel';
import { MarkdownIO } from './panels/MarkdownIO';
import { OutlinePanel } from './panels/OutlinePanel';
import { SharePanel } from './panels/SharePanel';
import { TableCellPanel, type ActiveCell } from './panels/TableCellPanel';
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

const TOOLBAR_META: ToolbarMeta[] = [
  { label: 'Inline formatting', items: toolbarGroups.marks },
  { label: 'Structure', items: toolbarGroups.blocks },
];

const OUTLINE_DOC_ID = 'demo-document';
const HISTORY_DOC_ID = createDocumentId(OUTLINE_DOC_ID);
const HISTORY_SCHEMA_VERSION = 'lash-schema-v1';
const HISTORY_ACTOR = { type: 'user', id: 'local-user' } as const;
const HISTORY_AUDIT = { ua: 'lash-web/local-history' } as const;
const HISTORY_RECORD_DEBOUNCE_MS = 500;

const textReplaceOp = (before: string, after: string) => {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    op: 'replace_text' as const,
    from: prefix,
    to: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  };
};

const editorText = (activeEditor: Editor): string => activeEditor.getText({ blockSeparator: '\n' });

const blameFor = (entries: HistoryEntry[], text: string) => {
  const map = createAuthorshipMap();
  entries.forEach((entry) => map.recordEntry(entry));
  return map.blameByLine(text);
};

const textToContent = (text: string) => ({
  type: 'doc',
  content: text.split('\n').map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : undefined,
  })),
});

export function EditorWorkspace() {
  const [version, setVersion] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isSuggestMode, setIsSuggestMode] = useState(false);
  const [activeTableCell, setActiveTableCell] = useState<ActiveCell | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [selectedHistoryEntryId, setSelectedHistoryEntryId] = useState<string | null>(null);
  const [historyAuthorFilter, setHistoryAuthorFilter] = useState<string | null>(null);
  const [historyTimeFilter, setHistoryTimeFilter] = useState<HistoryTimeFilter>(null);
  const [acceptedSuggestionIds, setAcceptedSuggestionIds] = useState<string[]>([]);
  const [blameLines, setBlameLines] = useState<Array<{ line: number; authorId: string | null }>>(
    [],
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const historyStoreRef = useRef(createHistoryStore());
  const historyHeadRef = useRef<string | null>(null);
  const historyTextRef = useRef('');
  const historyQueueRef = useRef(Promise.resolve());
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingHistoryRef = useRef(false);
  const suggestModeRef = useRef(false);

  const imageUploader = useMemo<LashImageUploader>(() => createBrowserImageUploader(), []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    suggestModeRef.current = isSuggestMode;
  }, [isSuggestMode]);

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
        chips: {
          // Mock chip resolver — returns a deterministic title for any
          // lash.local/doc/<id> URL. Real implementation lands in D2.
          resolveDocChip: async (docId) => ({
            title: `Internal Doc ${docId}`,
            lastEditor: 'Test User',
          }),
        },
      }),
    [handleLinkCommand, outlinePersistence, imageUploader],
  );

  const editor = useEditor(
    {
      extensions,
      autofocus: 'end',
      content: '<p></p>',
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: 'lash-editor-content',
        },
      },
    },
    [extensions],
  );

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
    if (!editor) {
      setHistoryEntries([]);
      setSelectedHistoryEntryId(null);
      setHistoryAuthorFilter(null);
      setHistoryTimeFilter(null);
      setAcceptedSuggestionIds([]);
      setBlameLines([]);
      historyHeadRef.current = null;
      historyTextRef.current = '';
      historyQueueRef.current = Promise.resolve();
      return;
    }

    let disposed = false;
    hashCanonical(EMPTY_HISTORY_DOC).then((emptySha) => {
      if (disposed) return;
      historyHeadRef.current = emptySha;
      historyTextRef.current = editorText(editor);
    });

    const recordHistory = () => {
      if (applyingHistoryRef.current) return;
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
      }
      historyTimerRef.current = setTimeout(() => {
        historyQueueRef.current = historyQueueRef.current.then(async () => {
          const before = historyTextRef.current;
          const after = editorText(editor);
          const expectedParentSha = historyHeadRef.current;
          if (!expectedParentSha || before === after) return;
          const result = await historyStoreRef.current.append({
            docId: HISTORY_DOC_ID,
            actor: HISTORY_ACTOR,
            expectedParentSha,
            schemaVersion: HISTORY_SCHEMA_VERSION,
            ops: [textReplaceOp(before, after)],
            intent: suggestModeRef.current ? 'suggest' : 'edit',
            audit: HISTORY_AUDIT,
          });
          if (!result.ok) return;
          historyHeadRef.current = result.entry.resultSha;
          historyTextRef.current = after;
          const entries = await historyStoreRef.current.list(HISTORY_DOC_ID);
          if (disposed) return;
          setHistoryEntries(entries);
          setSelectedHistoryEntryId(result.entry.id);
          setBlameLines(blameFor(entries, after));
        });
      }, HISTORY_RECORD_DEBOUNCE_MS);
    };

    editor.on('transaction', recordHistory);
    return () => {
      disposed = true;
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      editor.off('transaction', recordHistory);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      setActiveTableCell(null);
      return;
    }

    const update = () => {
      const attrs = lashCommands.getTableCellAttrs(editor);
      if (!attrs) {
        setActiveTableCell(null);
        return;
      }
      const normalizedOptions = Array.isArray(attrs.options)
        ? (attrs.options as unknown[]).filter(
            (option): option is string => typeof option === 'string',
          )
        : [];
      setActiveTableCell({
        cellType: attrs.cellType as LashTableCellType,
        value: typeof attrs.value === 'string' ? attrs.value : '',
        options: normalizedOptions,
      } satisfies Pick<LashTableCellAttrs, 'cellType' | 'value' | 'options'>);
    };

    update();
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  const handleSetTableCellType = useCallback(
    (type: LashTableCellType) => {
      if (!editor) return;
      lashCommands.setTableCellType(editor, type);
    },
    [editor],
  );

  const handleSetTableCellValue = useCallback(
    (value: string) => {
      if (!editor) return;
      lashCommands.setTableCellValue(editor, value);
    },
    [editor],
  );

  const handleCycleTableCellOption = useCallback(
    (direction: 1 | -1 = 1) => {
      if (!editor) return;
      lashCommands.cycleTableCellOption(editor, direction);
    },
    [editor],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__lashOutlineItems = outlineItems;
    return () => {
      if (typeof window === 'undefined') return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__lashOutlineItems;
    };
  }, [outlineItems]);

  useEffect(() => {
    if (typeof window === 'undefined' || !editor) return;
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
      getActive: () => lashCommands.getTableCellAttrs(editor),
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
    win.__lashInsertImageFromArrayBuffer = async (buffer: ArrayBuffer, mimeType = 'image/png') => {
      const file = new File([buffer], `import-${Date.now()}.${mimeType.split('/')[1] ?? 'png'}`, {
        type: mimeType,
      });
      editor.commands.insertImagePlaceholder(file);
    };
    return () => {
      if (typeof window === 'undefined') return;
      if (win.__lashEditor === editor) delete win.__lashEditor;
      if (win.__lashImageUploader === imageUploader) delete win.__lashImageUploader;
      if (win.__lashCommands === lashCommands) delete win.__lashCommands;
      if (win.__lashTable) delete win.__lashTable;
      delete win.__lashInsertTable;
      delete win.__lashSelectTableCells;
      delete win.__lashSerializeMarkdown;
      delete win.__lashInsertImageFromArrayBuffer;
    };
  }, [editor, imageUploader]);

  const isEditorReady = Boolean(editor);

  const handleToolbarClick = useCallback(
    (spec: ToolbarButtonSpec) => {
      if (!editor) return;
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
      if (!editor) return;
      lashCommands.toggleHeadingCollapse(editor, item.headingId);
    },
    [editor],
  );

  const handleFocusHeading = useCallback(
    (item: OutlineItem) => {
      if (!editor) return;
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

  const handleSelectHistoryEntry = useCallback((entryId: string) => {
    setSelectedHistoryEntryId(entryId);
  }, []);

  const handleBlameLineClick = useCallback((authorId: string | null) => {
    setHistoryAuthorFilter(authorId);
  }, []);

  const handleCopyHistoryFilterLink = useCallback(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('historyAuthor');
    url.searchParams.delete('historyTime');
    if (historyAuthorFilter) {
      url.searchParams.set('historyAuthor', historyAuthorFilter);
    }
    if (historyTimeFilter) {
      url.searchParams.set('historyTime', historyTimeFilter);
    }
    const link = url.toString();
    (window as Window & { __lashLastHistoryFilterLink?: string }).__lashLastHistoryFilterLink =
      link;
    void navigator.clipboard?.writeText(link).catch(() => undefined);
  }, [historyAuthorFilter, historyTimeFilter]);

  const handleAcceptSuggestion = useCallback(
    async (entry: HistoryEntry) => {
      if (!editor) return;
      const expectedParentSha = historyHeadRef.current;
      if (!expectedParentSha) return;
      const result = await historyStoreRef.current.append({
        docId: HISTORY_DOC_ID,
        actor: HISTORY_ACTOR,
        expectedParentSha,
        schemaVersion: HISTORY_SCHEMA_VERSION,
        ops: [
          {
            op: 'set_attr',
            nodeId: `suggestion:${entry.id}`,
            attrs: { accepted: true, entryId: entry.id },
          },
        ],
        intent: 'edit',
        audit: HISTORY_AUDIT,
      });
      if (!result.ok) return;
      const text = editorText(editor);
      historyHeadRef.current = result.entry.resultSha;
      historyTextRef.current = text;
      const entries = await historyStoreRef.current.list(HISTORY_DOC_ID);
      setAcceptedSuggestionIds((ids) => (ids.includes(entry.id) ? ids : [...ids, entry.id]));
      setHistoryEntries(entries);
      setSelectedHistoryEntryId(entry.id);
      setBlameLines(blameFor(entries, text));
    },
    [editor],
  );

  const handleRejectSuggestion = useCallback(
    async (entry: HistoryEntry) => {
      if (!editor) return;
      const expectedParentSha = historyHeadRef.current;
      if (!expectedParentSha) return;
      const parent = await historyStoreRef.current.loadAt(HISTORY_DOC_ID, entry.parentSha);
      const targetText =
        typeof parent === 'object' && parent && 'text' in parent ? String(parent.text) : '';
      const currentText = editorText(editor);
      if (currentText === targetText) return;
      const result = await historyStoreRef.current.append({
        docId: HISTORY_DOC_ID,
        actor: HISTORY_ACTOR,
        expectedParentSha,
        schemaVersion: HISTORY_SCHEMA_VERSION,
        ops: [{ op: 'replace_text', from: 0, to: currentText.length, text: targetText }],
        intent: 'edit',
        audit: HISTORY_AUDIT,
      });
      if (!result.ok) return;
      applyingHistoryRef.current = true;
      try {
        editor.commands.setContent(textToContent(targetText), false);
      } finally {
        applyingHistoryRef.current = false;
      }
      historyHeadRef.current = result.entry.resultSha;
      historyTextRef.current = targetText;
      const entries = await historyStoreRef.current.list(HISTORY_DOC_ID);
      setHistoryEntries(entries);
      setSelectedHistoryEntryId(result.entry.id);
      setBlameLines(blameFor(entries, targetText));
    },
    [editor],
  );

  const handleRestoreHistoryEntry = useCallback(
    async (entry: HistoryEntry) => {
      if (!editor) return;
      const result = await historyStoreRef.current.restore(
        HISTORY_DOC_ID,
        entry.resultSha,
        HISTORY_ACTOR,
        HISTORY_AUDIT,
      );
      if (!result.ok) return;
      const restored = await historyStoreRef.current.loadAt(HISTORY_DOC_ID, result.entry.resultSha);
      const text =
        typeof restored === 'object' && restored && 'text' in restored ? String(restored.text) : '';
      applyingHistoryRef.current = true;
      editor.commands.setContent(textToContent(text), false);
      applyingHistoryRef.current = false;
      historyHeadRef.current = result.entry.resultSha;
      historyTextRef.current = text;
      const entries = await historyStoreRef.current.list(HISTORY_DOC_ID);
      setHistoryEntries(entries);
      setSelectedHistoryEntryId(result.entry.id);
      setBlameLines(blameFor(entries, text));
    },
    [editor],
  );

  // Cmd/Ctrl+Shift+F binding per agents.md keymap. Listening at the shell
  // level (not via a TipTap extension) because focus mode is React state,
  // not editor state, and we need to toggle it regardless of editor focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // IME composition guard: keyCode === 229 covers older runtimes where
      // isComposing can be false during composition (MDN recommendation).
      if (event.isComposing || event.keyCode === 229) return;
      // Holding the shortcut shouldn't flip focus mode repeatedly.
      if (event.repeat) return;
      if (!event.shiftKey) return;
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) return;
      if (event.key !== 'F' && event.key !== 'f') return;
      event.preventDefault();
      setIsFocusMode((value) => !value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleImportMarkdown = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const showWarnings = useCallback((warnings: string[]) => {
    if (!warnings.length) return;
    const message = `Markdown warnings:\n${warnings.join('\n')}`;
    // eslint-disable-next-line no-console
    console.warn(message);
    if (typeof window !== 'undefined') {
      window.alert(message);
    }
  }, []);

  const handleMarkdownFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !editor) return;
      const text = await file.text();
      const { doc, warnings } = parseMarkdownToDoc(text, { documentId: OUTLINE_DOC_ID });
      editor.commands.setContent(doc, false);
      showWarnings(warnings);
    },
    [editor, showWarnings],
  );

  const handleExportMarkdown = useCallback(() => {
    if (!editor) return;
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
        <MarkdownIO
          fileInputRef={fileInputRef}
          onImportClick={handleImportMarkdown}
          onExportClick={handleExportMarkdown}
          onFileChange={handleMarkdownFileChange}
          exportDisabled={!isEditorReady}
        />
        <AutosaveIndicator editor={editor} />
        <FocusModeToggle isFocusMode={isFocusMode} onToggle={handleFocusModeToggle} />
        <button
          type="button"
          className="suggest-mode-toggle"
          data-testid="suggest-mode-toggle"
          data-active={isSuggestMode ? 'true' : 'false'}
          onClick={() => setIsSuggestMode((value) => !value)}
        >
          {isSuggestMode ? 'Suggesting' : 'Suggest'}
        </button>
      </div>
      <div className="lash-editor-layout">
        {!isFocusMode ? (
          <OutlinePanel
            items={outlineItems}
            onToggle={handleToggleHeading}
            onFocus={handleFocusHeading}
          />
        ) : null}
        <div className="lash-editor-main">
          <EditorToolbar
            editor={editor}
            groups={TOOLBAR_META}
            hidden={isFocusMode}
            onClick={handleToolbarClick}
          />

          {isEditorReady && activeTableCell && !isFocusMode ? (
            <TableCellPanel
              active={activeTableCell}
              onSetCellType={handleSetTableCellType}
              onSetValue={handleSetTableCellValue}
              onCycle={handleCycleTableCellOption}
            />
          ) : null}

          <div className="lash-editor-content-wrapper" role="region" aria-label="Document editor">
            {!isMounted || !isEditorReady ? (
              <div className="editor-loading">Loading editor...</div>
            ) : (
              <div className="lash-editor-with-blame">
                <div
                  className="lash-blame-gutter"
                  data-testid="blame-gutter"
                  aria-label="Blame gutter"
                >
                  {blameLines.length ? (
                    blameLines.map((line) => (
                      <button
                        key={line.line}
                        type="button"
                        className="lash-blame-line"
                        data-testid="blame-line"
                        data-author-id={line.authorId ?? ''}
                        title={
                          line.authorId
                            ? `Line ${line.line}: ${line.authorId}`
                            : `Line ${line.line}: unattributed`
                        }
                        onClick={() => handleBlameLineClick(line.authorId)}
                      >
                        {line.authorId ?? '-'}
                      </button>
                    ))
                  ) : (
                    <span className="lash-blame-empty">-</span>
                  )}
                </div>
                <EditorContent
                  editor={editor}
                  data-testid="lash-editor-content"
                  className="lash-editor-content"
                />
              </div>
            )}
          </div>

          {/* Slot panels for downstream lanes — render nothing until they're filled. */}
          <HistoryPanel
            editor={editor}
            entries={historyEntries}
            selectedEntryId={selectedHistoryEntryId}
            authorFilter={historyAuthorFilter}
            timeFilter={historyTimeFilter}
            acceptedSuggestionIds={acceptedSuggestionIds}
            onSelect={handleSelectHistoryEntry}
            onRestore={handleRestoreHistoryEntry}
            onSetAuthorFilter={setHistoryAuthorFilter}
            onClearAuthorFilter={() => setHistoryAuthorFilter(null)}
            onSetTimeFilter={setHistoryTimeFilter}
            onCopyFilterLink={handleCopyHistoryFilterLink}
            onAcceptSuggestion={handleAcceptSuggestion}
            onRejectSuggestion={handleRejectSuggestion}
          />
          <ChatPanel
            editor={editor}
            docId={HISTORY_DOC_ID}
            baseVersion={historyHeadRef.current}
            currentText={editor ? editorText(editor) : ''}
          />
          <SharePanel editor={editor} />
          <AIPanel editor={editor} />
        </div>
      </div>

      <span style={{ display: 'none' }}>{version}</span>
    </div>
  );
}

export default EditorWorkspace;
