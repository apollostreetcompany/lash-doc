'use client';

import { applyTextOperations } from '@lash/ai';
import { createAuthorshipMap } from '@lash/authorship';
import {
  createLashEditorExtensions,
  createLocalStorageOutlinePersistence,
  getOutlineItems,
  hasOutlineTransactionMeta,
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
import {
  createDocumentId,
  hashCanonical,
  type DocumentId,
  type EditPatch,
  type HistoryEntry,
} from '@lash/types';
import type { Editor, EditorEvents } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type * as Y from 'yjs';

import { createBrowserImageUploader } from '../../lib/createBrowserImageUploader';
import {
  DEFAULT_DOC_TITLE,
  DEFAULT_DOCUMENT_ID,
  DOCUMENT_REGISTRY_STORAGE_KEY,
  createNewDocumentId,
  documentPath,
  listDocuments,
  normalizeDocumentId,
  readDocumentTitle,
  saveDocumentTitle,
  upsertDocument,
  type LashDocumentRecord,
} from '../../lib/documentRegistry';
import {
  inviteTokenFromLocation,
  validateInviteAccess,
  type InviteAccess,
} from '../../lib/inviteAccess';
import {
  createLashRealtimeCollaboration,
  type RealtimeSnapshot,
  type RealtimeSyncState,
} from '../../lib/realtimeCollaboration';
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

const HISTORY_SCHEMA_VERSION = 'lash-schema-v1';
const HISTORY_ACTOR = { type: 'user', id: 'local-user' } as const;
const HISTORY_AUDIT = { ua: 'lash-web/local-history' } as const;
const HISTORY_RECORD_DEBOUNCE_MS = 1800;
const AI_AUDIT = { ua: 'lash-local-ai-editor' };
const SUGGESTION_RESOLUTIONS_YMAP = 'lash:suggestion-resolutions';

type OutlineTransaction = EditorEvents['transaction']['transaction'];
type SuggestionResolutionAction = 'accepted' | 'rejected';
type SuggestionResolutionRecord = {
  id: string;
  entryId: string;
  action: SuggestionResolutionAction;
  ts: string;
  actorId: string;
};

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

const sameOutlineItems = (left: OutlineItem[], right: OutlineItem[]) =>
  left.length === right.length &&
  left.every((item, index) => {
    const next = right[index];
    return (
      item.headingId === next.headingId &&
      item.level === next.level &&
      item.title === next.title &&
      item.from === next.from &&
      item.to === next.to &&
      item.contentFrom === next.contentFrom &&
      item.contentTo === next.contentTo &&
      item.collapsed === next.collapsed &&
      item.descendantCount === next.descendantCount &&
      item.hiddenBlockCount === next.hiddenBlockCount
    );
  });

const sameActiveCell = (left: ActiveCell | null, right: ActiveCell | null) => {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.cellType === right.cellType &&
    left.value === right.value &&
    sameStringArray(left.options, right.options)
  );
};

const realtimeSyncLabels: Record<RealtimeSyncState, string> = {
  disabled: 'Local only',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  syncing: 'Saving',
  saved: 'Saved',
  offline: 'Offline',
};

const textToContent = (text: string) => ({
  type: 'doc',
  content: text.split('\n').map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : undefined,
  })),
});

const suggestionResolutionStorageKey = (docId: DocumentId) =>
  `lash:suggestion-resolutions:${docId}`;
const suggestionResolutionYMapPrefix = (docId: DocumentId) => `${String(docId)}:`;
const suggestionResolutionYMapKey = (docId: DocumentId, recordId: string) =>
  `${suggestionResolutionYMapPrefix(docId)}${recordId}`;

const sameSuggestionResolutions = (
  left: SuggestionResolutionRecord[],
  right: SuggestionResolutionRecord[],
) => JSON.stringify(left) === JSON.stringify(right);

const normalizeSuggestionResolution = (value: unknown): SuggestionResolutionRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<SuggestionResolutionRecord>;
  if (
    typeof record.id !== 'string' ||
    typeof record.entryId !== 'string' ||
    typeof record.ts !== 'string' ||
    typeof record.actorId !== 'string' ||
    (record.action !== 'accepted' && record.action !== 'rejected')
  ) {
    return null;
  }
  return {
    id: record.id,
    entryId: record.entryId,
    action: record.action,
    ts: record.ts,
    actorId: record.actorId,
  };
};

const parseSuggestionResolutions = (value: string | null | undefined) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeSuggestionResolution)
      .filter((record): record is SuggestionResolutionRecord => Boolean(record));
  } catch {
    return [];
  }
};

const parseSuggestionResolution = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    return normalizeSuggestionResolution(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
};

const readSuggestionResolutionsFromStorage = (docId: DocumentId) => {
  if (typeof window === 'undefined') return [];
  try {
    return parseSuggestionResolutions(
      window.localStorage.getItem(suggestionResolutionStorageKey(docId)),
    );
  } catch {
    return [];
  }
};

const writeSuggestionResolutionsToStorage = (
  docId: DocumentId,
  records: SuggestionResolutionRecord[],
) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(suggestionResolutionStorageKey(docId), JSON.stringify(records));
  } catch {
    // Best-effort local durability; online docs also persist the Yjs side channel.
  }
};

const readSuggestionResolutionsFromYMap = (map: Y.Map<string> | null, docId: DocumentId) =>
  map
    ? Array.from(map.entries())
        .filter(([key]) => key.startsWith(suggestionResolutionYMapPrefix(docId)))
        .map(([, value]) => parseSuggestionResolution(value))
        .filter((record): record is SuggestionResolutionRecord => Boolean(record))
        .sort((left, right) => left.ts.localeCompare(right.ts) || left.id.localeCompare(right.id))
    : [];

const writeSuggestionResolutionsToYMap = (
  map: Y.Map<string> | null,
  docId: DocumentId,
  records: SuggestionResolutionRecord[],
) => {
  if (!map) return;
  records.forEach((record) => {
    map.set(suggestionResolutionYMapKey(docId, record.id), JSON.stringify(record));
  });
};

const acceptedIdsFromResolutions = (records: SuggestionResolutionRecord[]) =>
  records
    .filter((record) => record.action === 'accepted')
    .map((record) => record.entryId)
    .sort();

const toRoute = (path: string) => path as Route;

// Copy `text` to the clipboard. Prefers the async Clipboard API, but falls
// back to a transient textarea + execCommand('copy') for HTTP previews,
// iframes, and older Safari that can't acquire clipboard-write permission.
const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the execCommand path below.
  }
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
};

export interface EditorWorkspaceProps {
  documentId?: string;
}

export function EditorWorkspace({ documentId = DEFAULT_DOCUMENT_ID }: EditorWorkspaceProps) {
  const router = useRouter();
  const activeDocumentId = useMemo(() => normalizeDocumentId(documentId), [documentId]);
  const historyDocumentId = useMemo(() => createDocumentId(activeDocumentId), [activeDocumentId]);
  const [isMounted, setIsMounted] = useState(false);
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isSuggestMode, setIsSuggestMode] = useState(false);
  const [docTitle, setDocTitle] = useState(DEFAULT_DOC_TITLE);
  const [documents, setDocuments] = useState<LashDocumentRecord[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<RailTab>('chat');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [activeTableCell, setActiveTableCell] = useState<ActiveCell | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [selectedHistoryEntryId, setSelectedHistoryEntryId] = useState<string | null>(null);
  const [historyAuthorFilter, setHistoryAuthorFilter] = useState<string | null>(null);
  const [historyTimeFilter, setHistoryTimeFilter] = useState<HistoryTimeFilter>(null);
  const [inviteAccess, setInviteAccess] = useState<InviteAccess | null>(null);
  const [acceptedSuggestionIds, setAcceptedSuggestionIds] = useState<string[]>([]);
  const [suggestionResolutions, setSuggestionResolutions] = useState<SuggestionResolutionRecord[]>(
    [],
  );
  const [blameLines, setBlameLines] = useState<Array<{ line: number; authorId: string | null }>>(
    [],
  );
  // History head is mirrored: ref for synchronous access inside async
  // closures, state so React knows to re-render dependents (ChatPanel,
  // AIPanel) when the head advances.
  const [historyHead, setHistoryHead] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const outlineItemsRef = useRef<OutlineItem[]>([]);
  const outlineFrameRef = useRef<number | null>(null);
  const outlineIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyStoreRef = useRef(createHistoryStore());
  const historyHeadRef = useRef<string | null>(null);
  const historyTextRef = useRef('');
  const historyQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingHistoryRef = useRef(false);
  const suggestModeRef = useRef(false);
  const suggestionResolutionsRef = useRef<SuggestionResolutionRecord[]>([]);
  const activeTableCellRef = useRef<ActiveCell | null>(null);
  const inviteAccessDocumentRef = useRef<string | null>(null);
  // Refs to the buttons that opened the mobile drawers, so focus can
  // return to them on close (a11y requirement: focus must not be lost).
  const mobileSidebarTriggerRef = useRef<HTMLElement | null>(null);
  const mobileRailTriggerRef = useRef<HTMLElement | null>(null);

  const commitHistoryHead = useCallback((sha: string | null) => {
    historyHeadRef.current = sha;
    setHistoryHead(sha);
  }, []);

  const refreshDocuments = useCallback(() => {
    if (typeof window === 'undefined') return;
    setDocuments(listDocuments(window.localStorage));
  }, []);

  // Cross-tab sync: when another tab creates a document or renames one, the
  // registry / per-doc title keys change in localStorage. Refresh the switcher
  // so it stays current without a manual reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleRegistryStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === DOCUMENT_REGISTRY_STORAGE_KEY ||
        event.key.startsWith('lash:title:')
      ) {
        refreshDocuments();
      }
    };
    window.addEventListener('storage', handleRegistryStorage);
    return () => window.removeEventListener('storage', handleRegistryStorage);
  }, [refreshDocuments]);

  const imageUploader = useMemo<LashImageUploader>(() => createBrowserImageUploader(), []);
  const realtimeCollaboration = useMemo(
    () => createLashRealtimeCollaboration(activeDocumentId),
    [activeDocumentId],
  );
  const [realtimeSnapshot, setRealtimeSnapshot] = useState<RealtimeSnapshot>(() =>
    realtimeCollaboration.provider.getSnapshot(),
  );

  useEffect(() => {
    return () => {
      realtimeCollaboration.provider.destroy();
      realtimeCollaboration.doc.destroy();
    };
  }, [realtimeCollaboration]);

  useEffect(
    () => realtimeCollaboration.provider.subscribe(setRealtimeSnapshot),
    [realtimeCollaboration],
  );

  const publishSuggestionResolutions = useCallback(
    (
      nextRecords: SuggestionResolutionRecord[],
      options: { persist: boolean } = { persist: true },
    ) => {
      suggestionResolutionsRef.current = nextRecords;
      setSuggestionResolutions((current) =>
        sameSuggestionResolutions(current, nextRecords) ? current : nextRecords,
      );
      if (!options.persist) return;
      writeSuggestionResolutionsToStorage(historyDocumentId, nextRecords);
      const yMap = realtimeCollaboration.enabled
        ? realtimeCollaboration.doc.getMap<string>(SUGGESTION_RESOLUTIONS_YMAP)
        : null;
      writeSuggestionResolutionsToYMap(yMap, historyDocumentId, nextRecords);
    },
    [historyDocumentId, realtimeCollaboration],
  );

  useEffect(() => {
    const yMap = realtimeCollaboration.enabled
      ? realtimeCollaboration.doc.getMap<string>(SUGGESTION_RESOLUTIONS_YMAP)
      : null;
    const storedRecords = readSuggestionResolutionsFromStorage(historyDocumentId);
    const yRecordsExist =
      yMap &&
      Array.from(yMap.keys()).some((key) =>
        key.startsWith(suggestionResolutionYMapPrefix(historyDocumentId)),
      );
    const initialRecords = yRecordsExist
      ? readSuggestionResolutionsFromYMap(yMap, historyDocumentId)
      : storedRecords;
    publishSuggestionResolutions(initialRecords, { persist: false });
    if (yMap && !yRecordsExist && storedRecords.length) {
      writeSuggestionResolutionsToYMap(yMap, historyDocumentId, storedRecords);
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== suggestionResolutionStorageKey(historyDocumentId) || yMap) return;
      publishSuggestionResolutions(parseSuggestionResolutions(event.newValue), { persist: false });
    };
    window.addEventListener('storage', handleStorage);

    const handleRemoteRecords = (event: Y.YMapEvent<string>) => {
      if (
        ![...event.keysChanged].some((key) =>
          key.startsWith(suggestionResolutionYMapPrefix(historyDocumentId)),
        )
      ) {
        return;
      }
      const nextRecords = readSuggestionResolutionsFromYMap(yMap, historyDocumentId);
      writeSuggestionResolutionsToStorage(historyDocumentId, nextRecords);
      publishSuggestionResolutions(nextRecords, { persist: false });
    };
    yMap?.observe(handleRemoteRecords);

    return () => {
      window.removeEventListener('storage', handleStorage);
      yMap?.unobserve(handleRemoteRecords);
    };
  }, [historyDocumentId, publishSuggestionResolutions, realtimeCollaboration]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const storedTitle = readDocumentTitle(window.localStorage, activeDocumentId);
    setDocTitle(storedTitle);
    setDocuments(upsertDocument(window.localStorage, { id: activeDocumentId, title: storedTitle }));
  }, [activeDocumentId]);

  useEffect(() => {
    if (!isMounted || typeof window === 'undefined') return;
    try {
      setDocuments(listDocuments(window.localStorage));
    } catch {
      setDocuments([]);
    }
  }, [isMounted]);

  useEffect(() => {
    if (!isMounted) return;
    const normalizedTitle = docTitle.trim() || DEFAULT_DOC_TITLE;
    document.title = `${normalizedTitle} — Lash`;
  }, [docTitle, isMounted]);

  useEffect(() => {
    suggestModeRef.current = isSuggestMode;
  }, [isSuggestMode]);

  // iOS scroll lock while a mobile drawer is open. CSS `overflow: hidden`
  // alone does not stop iOS rubber-band scroll on the document body — the
  // proven trick is to position-fix the body at a negative top offset
  // equal to the prior scroll position, then restore on close.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const drawerOpen = mobileSidebarOpen || mobileRailOpen;
    if (!drawerOpen) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [mobileSidebarOpen, mobileRailOpen]);

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
          documentId: activeDocumentId,
          persistence: outlinePersistence,
        },
        image: {
          uploader: imageUploader,
        },
        collaboration: realtimeCollaboration.enabled
          ? {
              document: realtimeCollaboration.doc,
              field: 'content',
            }
          : undefined,
        chips: {
          resolveDocChip: async (docId) => ({
            title: `Internal Doc ${docId}`,
            lastEditor: 'Test User',
          }),
        },
      }),
    [handleLinkCommand, activeDocumentId, outlinePersistence, imageUploader, realtimeCollaboration],
  );

  const editor = useEditor(
    {
      extensions,
      autofocus: 'end',
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: 'lash-editor-content',
        },
      },
    },
    [extensions],
  );

  const inviteScope = inviteAccess?.ok ? inviteAccess.scope : null;
  const canEditDocument =
    inviteAccess === null || (inviteAccess.ok && inviteAccess.scope === 'edit');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let disposed = false;
    const inviteStorageKey = `lash:invite-token:${activeDocumentId}`;
    const token =
      inviteTokenFromLocation(window.location) ?? window.sessionStorage.getItem(inviteStorageKey);
    if (!token) {
      if (inviteAccessDocumentRef.current !== activeDocumentId) {
        inviteAccessDocumentRef.current = null;
        setInviteAccess(null);
      }
      return;
    }
    void validateInviteAccess(window.localStorage, activeDocumentId, token).then((result) => {
      if (disposed) return;
      inviteAccessDocumentRef.current = activeDocumentId;
      setInviteAccess(result);
      try {
        if (result?.ok) {
          window.sessionStorage.setItem(inviteStorageKey, token);
        } else {
          window.sessionStorage.removeItem(inviteStorageKey);
        }
      } catch {
        // Session storage is best-effort; the URL hash still authorized this page load.
      }
      if (window.location.hash.includes('invite=')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    });
    return () => {
      disposed = true;
    };
  }, [activeDocumentId]);

  useEffect(() => {
    editor?.setEditable(canEditDocument);
  }, [editor, canEditDocument]);

  useEffect(() => {
    if (!editor || !realtimeCollaboration.enabled) return;
    const publishSelection = () => {
      const { from, to } = editor.state.selection;
      realtimeCollaboration.provider.setLocalSelection({ from, to });
    };
    publishSelection();
    editor.on('selectionUpdate', publishSelection);
    editor.on('transaction', publishSelection);
    return () => {
      editor.off('selectionUpdate', publishSelection);
      editor.off('transaction', publishSelection);
      realtimeCollaboration.provider.setLocalSelection(null);
    };
  }, [editor, realtimeCollaboration]);

  useEffect(() => {
    if (!editor) {
      outlineItemsRef.current = [];
      setOutlineItems([]);
      return;
    }
    const publishOutline = () => {
      const nextItems = getOutlineItems(editor.state);
      if (sameOutlineItems(outlineItemsRef.current, nextItems)) {
        return;
      }
      outlineItemsRef.current = nextItems;
      setOutlineItems(nextItems);
    };
    const scheduleOutline = (transaction?: OutlineTransaction) => {
      if (transaction && !transaction.docChanged && !hasOutlineTransactionMeta(transaction)) {
        return;
      }
      const shouldPublishSoon =
        !transaction ||
        hasOutlineTransactionMeta(transaction) ||
        transaction.selection.$from.parent.type.name === 'heading' ||
        transaction.selection.$to.parent.type.name === 'heading';
      if (shouldPublishSoon && outlineIdleTimerRef.current !== null) {
        clearTimeout(outlineIdleTimerRef.current);
        outlineIdleTimerRef.current = null;
      }
      if (outlineFrameRef.current !== null) {
        return;
      }
      if (!shouldPublishSoon) {
        if (outlineIdleTimerRef.current !== null) {
          return;
        }
        outlineIdleTimerRef.current = setTimeout(() => {
          outlineIdleTimerRef.current = null;
          publishOutline();
        }, 500);
        return;
      }
      outlineFrameRef.current = window.requestAnimationFrame(() => {
        outlineFrameRef.current = null;
        publishOutline();
      });
    };
    publishOutline();
    const handleTransaction = ({ transaction }: { transaction: OutlineTransaction }) => {
      scheduleOutline(transaction);
    };
    editor.on('transaction', handleTransaction);
    return () => {
      if (outlineFrameRef.current !== null) {
        window.cancelAnimationFrame(outlineFrameRef.current);
        outlineFrameRef.current = null;
      }
      if (outlineIdleTimerRef.current !== null) {
        clearTimeout(outlineIdleTimerRef.current);
        outlineIdleTimerRef.current = null;
      }
      editor.off('transaction', handleTransaction);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      setHistoryEntries([]);
      setSelectedHistoryEntryId(null);
      setHistoryAuthorFilter(null);
      setHistoryTimeFilter(null);
      setAcceptedSuggestionIds(acceptedIdsFromResolutions(suggestionResolutionsRef.current));
      setBlameLines([]);
      commitHistoryHead(null);
      historyTextRef.current = '';
      historyQueueRef.current = Promise.resolve();
      return;
    }

    let disposed = false;
    setHistoryEntries([]);
    setSelectedHistoryEntryId(null);
    setHistoryAuthorFilter(null);
    setHistoryTimeFilter(null);
    setAcceptedSuggestionIds(acceptedIdsFromResolutions(suggestionResolutionsRef.current));
    setBlameLines([]);
    commitHistoryHead(null);
    historyTextRef.current = editorText(editor);
    historyQueueRef.current = Promise.resolve();
    hashCanonical(EMPTY_HISTORY_DOC).then((emptySha) => {
      if (disposed) return;
      // Only seed the baseline if the editor hasn't been touched yet —
      // otherwise we'd overwrite a real edit that landed during the async
      // hash computation.
      if (!historyTextRef.current) {
        historyTextRef.current = editorText(editor);
      }
      commitHistoryHead(emptySha);
    });

    const recordHistory = () => {
      if (applyingHistoryRef.current) return;
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
      }
      historyTimerRef.current = setTimeout(() => {
        // Recover the queue if a prior task rejected: catch the error,
        // log it, then resume. Without this, one failed append would
        // wedge every subsequent history write.
        historyQueueRef.current = historyQueueRef.current
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('[lash] history queue recovered from error:', err);
          })
          .then(async () => {
            const before = historyTextRef.current;
            const after = editorText(editor);
            const expectedParentSha = historyHeadRef.current;
            if (!expectedParentSha || before === after) return;
            const result = await historyStoreRef.current.append({
              docId: historyDocumentId,
              actor: HISTORY_ACTOR,
              expectedParentSha,
              schemaVersion: HISTORY_SCHEMA_VERSION,
              ops: [textReplaceOp(before, after)],
              intent: suggestModeRef.current ? 'suggest' : 'edit',
              audit: HISTORY_AUDIT,
            });
            if (!result.ok) return;
            historyTextRef.current = after;
            commitHistoryHead(result.entry.resultSha);
            const entries = await historyStoreRef.current.list(historyDocumentId);
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
  }, [editor, historyDocumentId, commitHistoryHead]);

  useEffect(() => {
    setAcceptedSuggestionIds(acceptedIdsFromResolutions(suggestionResolutions));
  }, [suggestionResolutions]);

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

  // Power-user test hooks (window.__lash*) are not safe to ship to end
  // users — they expose document commands and editor state. They stay
  // available in dev and when the build is explicitly tagged for tests
  // (Playwright sets NEXT_PUBLIC_LASH_TEST_HOOKS=true at build time).
  const exposeTestHooks =
    process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_LASH_TEST_HOOKS === 'true';

  useEffect(() => {
    if (typeof window === 'undefined' || !exposeTestHooks) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__lashOutlineItems = outlineItems;
    return () => {
      if (typeof window === 'undefined') return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__lashOutlineItems;
    };
  }, [outlineItems, exposeTestHooks]);

  useEffect(() => {
    if (typeof window === 'undefined' || !editor || !exposeTestHooks) return;
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
      serializeDocToMarkdown(editor.getJSON(), { documentId: activeDocumentId }).markdown;
    const realtimeApi = {
      getSnapshot: () => realtimeCollaboration.provider.getSnapshot(),
      disconnectForTest: () => realtimeCollaboration.provider.disconnectForTest(),
      reconnectForTest: () => realtimeCollaboration.provider.reconnectForTest(),
    };
    win.__lashRealtime = realtimeApi;
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
      if (win.__lashRealtime === realtimeApi) delete win.__lashRealtime;
      delete win.__lashInsertImageFromArrayBuffer;
    };
  }, [editor, imageUploader, activeDocumentId, exposeTestHooks, realtimeCollaboration]);

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

  const handleExpandAll = useCallback(() => {
    if (!editor) return;
    lashCommands.expandAllHeadings(editor);
  }, [editor]);

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
    // navigator.clipboard requires a secure context and may reject inside
    // iframes or older Safari builds — fall back to the execCommand
    // textarea dance so mobile Safari and HTTP previews still produce a
    // working copy. The result is mirrored to a test hook so e2e can
    // distinguish ok / failed outcomes.
    void copyToClipboard(link).then((ok) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__lashLastCopyResult = ok ? 'ok' : 'failed';
    });
  }, [historyAuthorFilter, historyTimeFilter]);

  // Hydrate history filters from a shared filter link (?historyAuthor=&historyTime=)
  // so opening a copied link lands on the same filtered diff view. Runs once.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URL(window.location.href).searchParams;
    const author = params.get('historyAuthor');
    const time = params.get('historyTime');
    if (author) setHistoryAuthorFilter(author);
    if (time === 'last-7-days') setHistoryTimeFilter('last-7-days');
    if (author || time) {
      setActiveTab('history');
      setRailOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recordSuggestionResolution = useCallback(
    (entry: HistoryEntry, action: SuggestionResolutionAction) => {
      const record: SuggestionResolutionRecord = {
        id: `suggestion-resolution:${entry.id}:${action}`,
        entryId: entry.id,
        action,
        ts: new Date().toISOString(),
        actorId: HISTORY_ACTOR.id,
      };
      publishSuggestionResolutions([
        ...suggestionResolutionsRef.current.filter((item) => item.entryId !== entry.id),
        record,
      ]);
    },
    [publishSuggestionResolutions],
  );

  const handleAcceptSuggestion = useCallback(
    async (entry: HistoryEntry) => {
      if (!editor) return;
      const expectedParentSha = historyHeadRef.current;
      if (!expectedParentSha) return;
      const result = await historyStoreRef.current.append({
        docId: historyDocumentId,
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
      historyTextRef.current = text;
      commitHistoryHead(result.entry.resultSha);
      const entries = await historyStoreRef.current.list(historyDocumentId);
      recordSuggestionResolution(entry, 'accepted');
      setAcceptedSuggestionIds((ids) => (ids.includes(entry.id) ? ids : [...ids, entry.id]));
      setHistoryEntries(entries);
      setSelectedHistoryEntryId(entry.id);
      setBlameLines(blameFor(entries, text));
    },
    [editor, historyDocumentId, commitHistoryHead, recordSuggestionResolution],
  );

  const handleRejectSuggestion = useCallback(
    async (entry: HistoryEntry) => {
      if (!editor) return;
      const expectedParentSha = historyHeadRef.current;
      if (!expectedParentSha) return;
      const parent = await historyStoreRef.current.loadAt(historyDocumentId, entry.parentSha);
      const targetText =
        typeof parent === 'object' && parent && 'text' in parent ? String(parent.text) : '';
      const currentText = editorText(editor);
      if (currentText === targetText) return;
      const result = await historyStoreRef.current.append({
        docId: historyDocumentId,
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
      historyTextRef.current = targetText;
      commitHistoryHead(result.entry.resultSha);
      const entries = await historyStoreRef.current.list(historyDocumentId);
      recordSuggestionResolution(entry, 'rejected');
      setHistoryEntries(entries);
      setSelectedHistoryEntryId(result.entry.id);
      setBlameLines(blameFor(entries, targetText));
    },
    [editor, historyDocumentId, commitHistoryHead, recordSuggestionResolution],
  );

  const handleRestoreHistoryEntry = useCallback(
    async (entry: HistoryEntry) => {
      if (!editor) return;
      const result = await historyStoreRef.current.restore(
        historyDocumentId,
        entry.resultSha,
        HISTORY_ACTOR,
        HISTORY_AUDIT,
      );
      if (!result.ok) return;
      const restored = await historyStoreRef.current.loadAt(
        historyDocumentId,
        result.entry.resultSha,
      );
      const text =
        typeof restored === 'object' && restored && 'text' in restored ? String(restored.text) : '';
      applyingHistoryRef.current = true;
      editor.commands.setContent(textToContent(text), false);
      applyingHistoryRef.current = false;
      historyTextRef.current = text;
      commitHistoryHead(result.entry.resultSha);
      const entries = await historyStoreRef.current.list(historyDocumentId);
      setHistoryEntries(entries);
      setSelectedHistoryEntryId(result.entry.id);
      setBlameLines(blameFor(entries, text));
    },
    [editor, historyDocumentId, commitHistoryHead],
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
        docId: historyDocumentId,
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
      historyTextRef.current = after;
      commitHistoryHead(result.entry.resultSha);
      const entries = await historyStoreRef.current.list(historyDocumentId);
      setHistoryEntries(entries);
      setSelectedHistoryEntryId(result.entry.id);
      setBlameLines(blameFor(entries, after));
      return { ok: true };
    },
    [editor, historyDocumentId, commitHistoryHead],
  );

  // Cmd/Ctrl+Shift+F binding for focus mode. Touch devices never fire this
  // chord (no physical keyboard in the common case), so skip the listener
  // there to avoid hijacking the iOS software-keyboard "F" shortcut row.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(pointer: coarse)').matches) return;
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
      const { doc, warnings } = parseMarkdownToDoc(text, { documentId: activeDocumentId });
      editor.commands.setContent(doc, false);
      showWarnings(warnings);
    },
    [editor, activeDocumentId, showWarnings],
  );

  const handleExportMarkdown = useCallback(() => {
    if (!editor) return;
    const { markdown, warnings } = serializeDocToMarkdown(editor.getJSON(), {
      documentId: activeDocumentId,
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
  }, [editor, activeDocumentId, showWarnings]);

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
          docId={historyDocumentId}
          baseVersion={historyHead}
          currentText={currentText}
          realtimeDoc={realtimeCollaboration.enabled ? realtimeCollaboration.doc : null}
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
          suggestionResolutions={suggestionResolutions}
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
          docId={historyDocumentId}
          baseVersion={historyHead}
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
      content: <SharePanel editor={editor} docId={historyDocumentId} accessScope={inviteScope} />,
    },
    {
      id: 'activity',
      label: 'Activity',
      icon: 'cloud',
      content: (
        <>
          <MentionPanel editor={editor} currentText={currentText} />
          <OfflinePanel editor={editor} documentId={activeDocumentId} />
        </>
      ),
    },
  ];

  const handleCreateDocument = useCallback(() => {
    const nextDocumentId = createNewDocumentId();
    if (typeof window !== 'undefined') {
      upsertDocument(window.localStorage, { id: nextDocumentId, title: DEFAULT_DOC_TITLE });
      refreshDocuments();
    }
    router.push(toRoute(documentPath(nextDocumentId)));
  }, [refreshDocuments, router]);

  const handleOpenDocument = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      router.push(toRoute(event.target.value));
    },
    [router],
  );

  const documentOptions = documents.some((record) => record.id === activeDocumentId)
    ? documents
    : [
        {
          id: activeDocumentId,
          title: docTitle.trim() || DEFAULT_DOC_TITLE,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        ...documents,
      ];

  const documentControls = (
    <div className="lash-document-controls">
      <select
        aria-label="Open document"
        className="lash-document-select"
        data-testid="document-open-select"
        onChange={handleOpenDocument}
        value={documentPath(activeDocumentId)}
      >
        {documentOptions.map((record) => (
          <option key={record.id} value={documentPath(record.id)}>
            {record.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="lash-icon-btn lash-new-doc-button"
        aria-label="New document"
        data-testid="new-document-button"
        data-tooltip="New document"
        onClick={handleCreateDocument}
      >
        <Icon name="plus" />
      </button>
    </div>
  );

  const openSharePanel = useCallback((trigger?: HTMLElement | null) => {
    setActiveTab('share');
    setRailOpen(true);
    // On narrow widths the rail is a slide-in drawer.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      if (trigger) {
        mobileRailTriggerRef.current = trigger;
      }
      setMobileRailOpen(true);
    }
  }, []);

  const handleShareClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      openSharePanel(event.currentTarget);
    },
    [openSharePanel],
  );

  const handleRealtimeRetry = useCallback(() => {
    realtimeCollaboration.provider.reconnectNow();
  }, [realtimeCollaboration]);

  const remotePeers = realtimeSnapshot.peers;
  const topBarPeers = remotePeers.map((peer) => ({ actorId: peer.actorId, label: peer.label }));
  const realtimeLabel = realtimeSyncLabels[realtimeSnapshot.syncState];
  const showRealtimeRetry =
    realtimeSnapshot.enabled &&
    (realtimeSnapshot.syncState === 'reconnecting' || realtimeSnapshot.syncState === 'offline');
  const realtimePresence = (
    <div
      className="lash-realtime-presence"
      data-testid="realtime-presence-bar"
      data-enabled={realtimeSnapshot.enabled ? 'true' : 'false'}
    >
      <span
        className="lash-realtime-sync-state"
        data-testid="realtime-sync-state"
        data-state={realtimeSnapshot.syncState}
        aria-hidden={realtimeSnapshot.enabled ? 'true' : undefined}
      >
        {realtimeLabel}
      </span>
      {realtimeSnapshot.enabled ? (
        <span className="sr-only" data-testid="sync-feedback" aria-live="polite">
          {realtimeLabel}
        </span>
      ) : null}
      {showRealtimeRetry ? (
        <button
          type="button"
          className="lash-sync-retry-button"
          data-testid="sync-retry-button"
          onClick={handleRealtimeRetry}
        >
          Retry
        </button>
      ) : null}
      {remotePeers.length ? (
        <div className="lash-realtime-peers" aria-label="Collaborators online">
          {remotePeers.map((peer) => (
            <span
              key={peer.actorId}
              className="lash-realtime-peer"
              data-testid="remote-collaborator"
              data-actor-id={peer.actorId}
              style={{ '--presence-color': peer.color } as CSSProperties}
              title={`${peer.label} is in this document`}
            >
              {peer.label}
            </span>
          ))}
        </div>
      ) : realtimeSnapshot.enabled ? (
        <div className="lash-collaboration-empty" data-testid="collaboration-empty-state">
          <span className="lash-realtime-empty" data-testid="remote-collaborator-empty">
            Ready
          </span>
          <button
            type="button"
            className="lash-collaboration-share-shortcut"
            data-testid="collaboration-share-shortcut"
            aria-label="Invite collaborator"
            onClick={() => openSharePanel()}
          >
            Invite
          </button>
        </div>
      ) : (
        <span className="lash-realtime-empty" data-testid="remote-collaborator-empty">
          Solo
        </span>
      )}
    </div>
  );

  const remoteCursorMarkers = remotePeers.map((peer) => {
    const cursorText = peer.selection
      ? peer.selection.from === peer.selection.to
        ? `cursor ${peer.selection.from}`
        : `selection ${peer.selection.from}-${peer.selection.to}`
      : 'online';
    return (
      <span
        key={peer.actorId}
        className="lash-remote-cursor-marker"
        data-testid="remote-cursor-marker"
        data-actor-id={peer.actorId}
        style={{ '--presence-color': peer.color } as CSSProperties}
      >
        {peer.label}: {cursorText}
      </span>
    );
  });

  const handleOpenMobileSidebar = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    mobileSidebarTriggerRef.current = event.currentTarget;
    setMobileSidebarOpen(true);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
    // Return focus to the trigger so AT users don't get dumped at the
    // document root after the drawer closes.
    mobileSidebarTriggerRef.current?.focus();
  }, []);
  const closeMobileRail = useCallback(() => {
    setMobileRailOpen(false);
    mobileRailTriggerRef.current?.focus();
  }, []);

  const handleDocTitleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextTitle = event.target.value;
      setDocTitle(nextTitle);
      if (typeof window !== 'undefined') {
        saveDocumentTitle(window.localStorage, activeDocumentId, nextTitle);
        refreshDocuments();
      }
    },
    [activeDocumentId, refreshDocuments],
  );

  const handleDocTitleBlur = useCallback(() => {
    setDocTitle((value) => {
      const normalizedTitle =
        typeof window === 'undefined'
          ? value.trim() || DEFAULT_DOC_TITLE
          : saveDocumentTitle(window.localStorage, activeDocumentId, value);
      refreshDocuments();
      return normalizedTitle;
    });
  }, [activeDocumentId, refreshDocuments]);

  const topBar = (
    <TopBar
      editor={editor}
      peers={topBarPeers}
      docTitle={docTitle.trim() || DEFAULT_DOC_TITLE}
      focusMode={isFocusMode}
      suggestMode={isSuggestMode}
      railOpen={railOpen}
      onToggleFocusMode={handleFocusModeToggle}
      onToggleSuggestMode={() => setIsSuggestMode((value) => !value)}
      onShareClick={handleShareClick}
      onOpenMobileSidebar={handleOpenMobileSidebar}
      extras={documentControls}
    />
  );

  const sidebar = (
    <Sidebar
      collapsed={sidebarCollapsed}
      onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      outlineItems={outlineItems}
      onToggleHeading={handleToggleHeading}
      onFocusHeading={handleFocusHeading}
      onExpandAll={handleExpandAll}
      hideOutline={isFocusMode}
      onCloseMobile={mobileSidebarOpen ? closeMobileSidebar : undefined}
    />
  );

  const rail = (
    <RightRail
      active={activeTab}
      onChange={setActiveTab}
      tabs={railTabs}
      onClose={() => {
        setRailOpen(false);
        setMobileRailOpen(false);
      }}
    />
  );

  return (
    <div
      data-testid="lash-editor-shell"
      data-focus-mode={isFocusMode ? 'true' : 'false'}
      className="lash-editor-shell"
    >
      <AppShell
        topBar={topBar}
        sidebar={sidebar}
        rail={rail}
        focusMode={isFocusMode}
        railOpen={railOpen}
        sidebarCollapsed={sidebarCollapsed}
        mobileSidebarOpen={mobileSidebarOpen}
        mobileRailOpen={mobileRailOpen}
        onMobileSidebarClose={closeMobileSidebar}
        onMobileRailClose={closeMobileRail}
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
              <input
                aria-label="Document title"
                className="lash-doc-title lash-doc-title-input"
                data-testid="lash-doc-title-input"
                id="lash-doc-title-text"
                onBlur={handleDocTitleBlur}
                onChange={handleDocTitleChange}
                type="text"
                value={docTitle}
              />
              <div
                className="lash-doc-meta"
                aria-label="Document metadata"
                data-testid="lash-doc-meta"
              >
                <span>
                  {historyEntries.length} version{historyEntries.length === 1 ? '' : 's'}
                </span>
                <span className="lash-doc-meta-dot" aria-hidden="true" />
                <span>
                  {outlineItems.length} section{outlineItems.length === 1 ? '' : 's'}
                </span>
                <span className="lash-doc-meta-dot" aria-hidden="true" />
                <span data-testid="lash-doc-route">{documentPath(activeDocumentId)}</span>
                <span className="lash-doc-meta-dot" aria-hidden="true" />
                <span data-testid="invite-access-status">
                  {inviteAccess === null
                    ? 'Owner access'
                    : inviteAccess.ok
                      ? `Access granted: ${inviteAccess.scope}`
                      : `Denied: ${inviteAccess.reason}`}
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
              {realtimePresence}
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
              {remoteCursorMarkers.length ? (
                <div className="lash-remote-cursor-layer" aria-label="Remote cursors">
                  {remoteCursorMarkers}
                </div>
              ) : null}
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
    </div>
  );
}

export default EditorWorkspace;
