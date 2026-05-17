'use client';

import { applyTextOperations } from '@lash/ai';
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
import { createDocumentId, hashCanonical, type EditPatch, type HistoryEntry } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createBrowserImageUploader } from '../../lib/createBrowserImageUploader';
import { AppShell } from '../shell/AppShell';
import { Icon } from '../shell/Icon';
import { RightRail, type RailTab, type RailTabConfig } from '../shell/RightRail';
import { Sidebar } from '../shell/Sidebar';
import { TopBar } from '../shell/TopBar';
import { AIPanel } from './panels/AIPanel';
import { ChatPanel } from './panels/ChatPanel';
import { EditorToolbar, type ToolbarMeta } from './panels/EditorToolbar';
import { HistoryPanel, type HistoryTimeFilter } from './panels/HistoryPanel';
import { MarkdownIO } from './panels/MarkdownIO';
import { MentionPanel } from './panels/MentionPanel';
import { OfflinePanel } from './panels/OfflinePanel';
import { SharePanel } from './panels/SharePanel';
import { TableCellPanel, type ActiveCell } from './panels/TableCellPanel';

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
const HISTORY_RECORD_DEBOUNCE_MS = 1800;
const AI_AUDIT = { ua: 'lash-local-ai-editor' };
const DOC_TITLE = 'Untitled document';

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

const sameStringArray = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameActiveCell = (left: ActiveCell | null, right: ActiveCell | null) => {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.cellType === right.cellType &&
    left.value === right.value &&
    sameStringArray(left.options, right.options)
  );
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<RailTab>('chat');
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
  const activeTableCellRef = useRef<ActiveCell | null>(null);

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
      activeTableCellRef.current = null;
      setActiveTableCell(null);
      return;
    }

    const publishActiveCell = (next: ActiveCell | null) => {
      if (sameActiveCell(activeTableCellRef.current, next)) {
        return;
      }
      activeTableCellRef.current = next;
      setActiveTableCell(next);
    };

    const update = () => {
      const attrs = lashCommands.getTableCellAttrs(editor);
      if (!attrs) {
        publishActiveCell(null);
        return;
      }
      const normalizedOptions = Array.isArray(attrs.options)
        ? (attrs.options as unknown[]).filter(
            (option): option is string => typeof option === 'string',
          )
        : [];
      publishActiveCell({
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
    ) =>
      selectTableCells(editor, anchorRow, anchorCol, headRow, headCol, {
        scrollIntoView: false,
      });
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
    setActiveTab('history');
    setRailOpen(true);
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

  const handleApplyAiPatch = useCallback(
    async (patch: EditPatch): Promise<{ ok: true } | { ok: false; reason: string }> => {
      if (!editor) return { ok: false, reason: 'editor unavailable' };
      const expectedParentSha = historyHeadRef.current;
      if (!expectedParentSha) return { ok: false, reason: 'history unavailable' };
      if (patch.baseVersion !== expectedParentSha)
        return { ok: false, reason: 'base version stale' };
      const before = editorText(editor);
      if (before !== historyTextRef.current) {
        return { ok: false, reason: 'pending local history flush' };
      }

      const after = applyTextOperations(before, patch.operations);
      const result = await historyStoreRef.current.append({
        docId: HISTORY_DOC_ID,
        actor: patch.author,
        expectedParentSha,
        schemaVersion: patch.schemaVersion,
        ops: patch.operations,
        intent: 'ai',
        audit: AI_AUDIT,
      });
      if (!result.ok) return { ok: false, reason: result.reason };

      applyingHistoryRef.current = true;
      try {
        editor.commands.setContent(textToContent(after), false);
      } finally {
        applyingHistoryRef.current = false;
      }
      historyHeadRef.current = result.entry.resultSha;
      historyTextRef.current = after;
      const entries = await historyStoreRef.current.list(HISTORY_DOC_ID);
      setHistoryEntries(entries);
      setSelectedHistoryEntryId(result.entry.id);
      setBlameLines(blameFor(entries, after));
      return { ok: true };
    },
    [editor],
  );

  // Cmd/Ctrl+Shift+F binding for focus mode.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
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

  // Cmd/Ctrl+/ toggles right rail
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.repeat) return;
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) return;
      if (event.key !== '/') return;
      event.preventDefault();
      setRailOpen((value) => !value);
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

  const currentText = editor ? editorText(editor) : '';

  // Recompute on every render: panels rely on live editor selection state, so
  // memoizing on text alone would mask selection-only updates.
  const railTabs: RailTabConfig[] = [
    {
      id: 'chat',
      label: 'Chat',
      icon: 'message',
      content: (
        <ChatPanel
          editor={editor}
          docId={HISTORY_DOC_ID}
          baseVersion={historyHeadRef.current}
          currentText={currentText}
        />
      ),
    },
    {
      id: 'history',
      label: 'History',
      icon: 'history',
      badge: historyEntries.length || undefined,
      content: (
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
      ),
    },
    {
      id: 'ai',
      label: 'AI',
      icon: 'sparkles',
      content: (
        <AIPanel
          editor={editor}
          docId={HISTORY_DOC_ID}
          baseVersion={historyHeadRef.current}
          currentText={currentText}
          schemaVersion={HISTORY_SCHEMA_VERSION}
          onApplyPatch={handleApplyAiPatch}
        />
      ),
    },
    {
      id: 'share',
      label: 'Share',
      icon: 'share',
      content: <SharePanel editor={editor} docId={HISTORY_DOC_ID} />,
    },
    {
      id: 'activity',
      label: 'Activity',
      icon: 'cloud',
      content: (
        <>
          <MentionPanel editor={editor} currentText={currentText} />
          <OfflinePanel editor={editor} />
        </>
      ),
    },
  ];

  const topBar = (
    <TopBar
      editor={editor}
      docTitle={DOC_TITLE}
      focusMode={isFocusMode}
      suggestMode={isSuggestMode}
      railOpen={railOpen}
      onToggleFocusMode={handleFocusModeToggle}
      onToggleSuggestMode={() => setIsSuggestMode((value) => !value)}
      onToggleRail={() => setRailOpen((value) => !value)}
    />
  );

  const sidebar = (
    <Sidebar
      collapsed={sidebarCollapsed}
      onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      outlineItems={outlineItems}
      onToggleHeading={handleToggleHeading}
      onFocusHeading={handleFocusHeading}
      hideOutline={isFocusMode}
    />
  );

  const rail = (
    <RightRail
      active={activeTab}
      onChange={setActiveTab}
      tabs={railTabs}
      onClose={() => setRailOpen(false)}
    />
  );

  return (
    <div
      data-testid="lash-editor-shell"
      data-focus-mode={isFocusMode ? 'true' : 'false'}
      aria-live="polite"
      className="lash-editor-shell"
    >
      <AppShell
        topBar={topBar}
        sidebar={sidebar}
        rail={rail}
        focusMode={isFocusMode}
        railOpen={railOpen}
        sidebarCollapsed={sidebarCollapsed}
        onSidebarCollapsedChange={setSidebarCollapsed}
        onRailOpenChange={setRailOpen}
      >
        <EditorToolbar
          editor={editor}
          groups={TOOLBAR_META}
          hidden={isFocusMode}
          onClick={handleToolbarClick}
          trailing={
            <MarkdownIO
              fileInputRef={fileInputRef}
              onImportClick={handleImportMarkdown}
              onExportClick={handleExportMarkdown}
              onFileChange={handleMarkdownFileChange}
              exportDisabled={!isEditorReady}
            />
          }
        />

        <div className="lash-doc-wrap">
          <article className="lash-doc-paper" aria-labelledby="lash-doc-title-text">
            <header className="lash-doc-header">
              <h1 className="lash-doc-title" id="lash-doc-title-text">
                {DOC_TITLE}
              </h1>
              <div className="lash-doc-meta" aria-label="Document metadata">
                <span>Edited by Apollo</span>
                <span className="lash-doc-meta-dot" aria-hidden="true" />
                <span>
                  {historyEntries.length} version{historyEntries.length === 1 ? '' : 's'}
                </span>
                <span className="lash-doc-meta-dot" aria-hidden="true" />
                <span>
                  {outlineItems.length} section{outlineItems.length === 1 ? '' : 's'}
                </span>
                {isSuggestMode ? (
                  <>
                    <span className="lash-doc-meta-dot" aria-hidden="true" />
                    <span
                      style={{
                        color: 'var(--color-coral-600)',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Icon name="pencil" width={12} height={12} /> Suggesting
                    </span>
                  </>
                ) : null}
              </div>
            </header>

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
                <div className="editor-loading">Preparing your editor…</div>
              ) : (
                <div className="lash-editor-with-blame" data-blame-on="true">
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
                          {line.authorId ?? '·'}
                        </button>
                      ))
                    ) : (
                      <span className="lash-blame-empty">·</span>
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
          </article>
        </div>
      </AppShell>

      <span style={{ display: 'none' }}>{version}</span>
    </div>
  );
}

export default EditorWorkspace;
