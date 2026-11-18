'use client';

import { createAuthorshipMap } from '@lash/authorship';
import {
  createAnchor,
  hasSuggestionEdges,
  MAX_SUGGESTION_TEXT,
  readSuggestionContent,
  type ReviewProposal,
  type SuggestionDecision,
} from '@lash/doc-chat';
import {
  createLashEditorExtensions,
  createLocalStorageOutlinePersistence,
  getOutlineItems,
  hasOutlineTransactionMeta,
  lashCommands,
  prepareSuggestionReplacement,
  projectDocumentHeadingIds,
  readSuggestionRange,
  runToolbarAction,
  selectTableCells,
  serializeDocToMarkdown,
  toolbarGroups,
  type LashImageUploader,
  type LashTableCellAttrs,
  type LashTableCellType,
  type OutlineItem,
  type SuggestionRange,
  type ToolbarButtonSpec,
} from '@lash/editor-core';
import {
  createHistoryStore,
  historyBodySnapshotOp,
  type HistoryDocumentState,
} from '@lash/history';
import {
  canonicalize,
  createDocumentId,
  type DocumentId,
  type EditPatch,
  type HistoryEntry,
} from '@lash/types';
import { Extension, type Editor, type EditorEvents } from '@tiptap/core';
import type { Node as EditorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type * as Y from 'yjs';

import { ContextualRevision } from './ContextualRevision';
import { DocumentReferencePicker } from './DocumentReferencePicker';
import { AIPanel } from './panels/AIPanel';
import { AutosaveIndicator } from './panels/AutosaveIndicator';
import { captureChatAnchorRange, projectChatDocumentText } from './panels/chatAnchorPositions';
import { ChatPanel } from './panels/ChatPanel';
import { DocumentSettingsDialog } from './panels/DocumentSettingsDialog';
import { EditorToolbar, type ToolbarMeta } from './panels/EditorToolbar';
import {
  HistoryPanel,
  type HistoryAvailabilityState,
  type HistoryTimeFilter,
} from './panels/HistoryPanel';
import { LocalBodyRecoveryNotice, type LocalBodyNotice } from './panels/LocalBodyRecoveryNotice';
import { MarkdownIO } from './panels/MarkdownIO';
import {
  MarkdownTransferDialog,
  type MarkdownTransferDialogState,
} from './panels/MarkdownTransferDialog';
import { OutlinePanel } from './panels/OutlinePanel';
import { OwnerShareDialog, type OwnerShareDialogPhase } from './panels/OwnerShareDialog';
import { SharedHistoryPanel } from './panels/SharedHistoryPanel';
import { SharePanel } from './panels/SharePanel';
import { SuggestionCard, SuggestionComposer } from './panels/SuggestionControls';
import { TableCellPanel, type ActiveCell } from './panels/TableCellPanel';
import { prepareAiReplacement, type AiSelection } from '../../lib/aiSelection';
import type { AutosaveFlushController, AutosaveSaveContext } from '../../lib/autosave';
import { createBrowserImageUploader } from '../../lib/createBrowserImageUploader';
import {
  createBrowserDocumentAccessController,
  createInitialDocumentAccessSnapshot,
  type DocumentAccessController,
  type DocumentAccessResolution,
  type DocumentAccessSnapshot,
} from '../../lib/documentAccess';
import { allowsDocumentBodyTransaction } from '../../lib/documentMutationAuthority';
import { documentWorkspacePath, matchPreviewDocumentUrl } from '../../lib/documentNavigation';
import {
  createBrowserDocumentPromotionAttempt,
  type BrowserDocumentPromotionAttempt,
} from '../../lib/documentPromotion/browserClient';
import { readPublicAccessState } from '../../lib/documentPublicAccess/browserClient';
import type { PublicAccessStateV1 } from '../../lib/documentPublicAccess/types';
import { documentRecoveryPresentation } from '../../lib/documentRecoveryPresentation';
import { createDocumentReferenceCatalog } from '../../lib/documentReferenceCatalog';
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
  loadLocalDocumentBody,
  assertStrictLocalBodySchemaJson,
  localBodyExpectedRevision,
  localDocumentBodyKey,
  promoteRecoveredLocalDocumentBody,
  saveLocalDocumentBody,
  LocalBodyPersistenceError,
  type LocalBodyDocJson,
  type LocalBodyEnvelope,
  type LocalBodyExpectedRevision,
  type LocalBodyRecoveryToken,
} from '../../lib/localDocumentBodyPersistence';
import { createLocalDocumentHistoryPersistence } from '../../lib/localDocumentHistoryPersistence';
import {
  mapLocalSuggestions,
  MAX_LOCAL_SUGGESTIONS,
  type LocalSuggestion,
} from '../../lib/localSuggestions';
import {
  MARKDOWN_IMPORT_NAVIGATION_WATCHDOG_MS,
  acknowledgeMarkdownImportDestination,
  commitMarkdownImport,
  createMarkdownDownloadPlan,
  createMarkdownImportNavigationController,
  persistMarkdownImportHandoff,
  readMarkdownFileForImport,
  verifyMarkdownImportSourceQuiescence,
  type MarkdownImportDestination,
  type MarkdownImportNavigationController,
} from '../../lib/markdownDocumentTransfer';
import { createMobileRailActionCoordinator } from '../../lib/mobileRailActionCoordinator';
import { NAMED_EDIT_ROOM_ID } from '../../lib/namedEdit/contract';
import { createReadOnlyEditorTestFacade } from '../../lib/readOnlyEditorTestFacade';
import { realtimeSyncLabelForAccess } from '../../lib/realtimeAccessPresentation';
import { withLegacyChatThreads } from '../../lib/realtimeChatStore';
import {
  REALTIME_DOCUMENT_METADATA_YMAP,
  REALTIME_DOCUMENT_TITLE_KEY,
  REALTIME_SUGGESTION_RESOLUTIONS_YMAP,
  canMountSyntheticMentionFixture,
  readRealtimeDocumentTitle,
  readRealtimeSuggestionResolutions,
  readSuggestionResolutionRecords,
  realtimeSuggestionResolutionPrefix,
  writeRealtimeDocumentTitle,
  type RealtimeSuggestionResolutionRecord,
  type RealtimeSnapshot,
} from '../../lib/realtimeCollaboration';
import { AppShell, type MobileRailFocusRequest } from '../shell/AppShell';
import { Icon } from '../shell/Icon';
import { RightRail, type RailTab, type RailTabConfig } from '../shell/RightRail';
import { Sidebar } from '../shell/Sidebar';
import { TopBar } from '../shell/TopBar';

const SyntheticMentionPanel = lazy(async () => {
  const mentionModule = await import('./panels/MentionPanel');
  return { default: mentionModule.MentionPanel };
});

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

type SuggestionDraft = {
  id: string;
  range: SuggestionRange;
  document: EditorNode;
  quote: string;
  before: string;
  anchor: ReviewProposal['anchor'] | null;
};
const HISTORY_AUDIT = { ua: 'lash-web/local-history' } as const;
const HISTORY_RECORD_DEBOUNCE_MS = 1800;
const AI_AUDIT = { ua: 'lash-local-ai-editor' };

type OutlineTransaction = EditorEvents['transaction']['transaction'];
type SuggestionResolutionAction = 'accepted' | 'rejected';
type SuggestionResolutionRecord = RealtimeSuggestionResolutionRecord;
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

function LiveEditorText({
  editor,
  children,
}: {
  editor: Editor | null;
  children: (currentText: string) => ReactNode;
}) {
  // Selection-only transactions must also update comment and AI controls.
  useEditorState({ editor, selector: ({ transactionNumber }) => transactionNumber });
  const doc = editor?.state.doc;
  const currentText = useMemo(() => (editor && doc ? editorText(editor) : ''), [editor, doc]);
  return children(currentText);
}

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

const captureHistoryBody = (doc: EditorNode) =>
  projectDocumentHeadingIds(doc).toJSON() as LocalBodyDocJson;

const localHistoryOperations = (before: HistoryDocumentState, after: HistoryDocumentState) => [
  ...(before.text === after.text ? [] : [textReplaceOp(before.text, after.text)]),
  historyBodySnapshotOp(after, before.body),
];

const suggestionResolutionStorageKey = (docId: DocumentId) =>
  `lash:suggestion-resolutions:${docId}`;

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

const acceptedIdsFromResolutions = (records: SuggestionResolutionRecord[]) =>
  records
    .filter((record) => record.action === 'accepted')
    .map((record) => record.entryId)
    .sort();

const toRoute = (path: string) => path as Route;

const browserLocalStorage = (): Storage | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const browserSessionStorage = (): Storage | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

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
  staticPreview?: boolean;
}

export function EditorWorkspace({
  documentId = DEFAULT_DOCUMENT_ID,
  staticPreview = false,
}: EditorWorkspaceProps) {
  const router = useRouter();
  const activeDocumentId = useMemo(() => normalizeDocumentId(documentId), [documentId]);
  const controllerRef = useRef<DocumentAccessController | null>(null);
  const controllerDocumentIdRef = useRef<string | null>(null);
  const [accessSnapshot, setAccessSnapshot] = useState<DocumentAccessSnapshot>(
    createInitialDocumentAccessSnapshot,
  );
  const [resolution, setResolution] = useState<DocumentAccessResolution | null>(null);
  const [recoveryActionStatus, setRecoveryActionStatus] = useState('');
  const accessHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const controller = createBrowserDocumentAccessController({
      documentId: activeDocumentId,
      navigateHome: () => router.replace(toRoute('/')),
      staticPreview,
    });
    controllerRef.current = controller;
    controllerDocumentIdRef.current = activeDocumentId;
    setAccessSnapshot(controller.getSnapshot());
    setResolution(null);
    const unsubscribe = controller.subscribe((nextSnapshot) => {
      setAccessSnapshot(nextSnapshot);
      setResolution(controller.getResolution());
    });
    void controller.start();
    return () => {
      unsubscribe();
      // React cleanup cannot present the typed disposition. The controller
      // itself retains sealed resources and owns the navigation warning when
      // recovery persistence blocks destruction.
      void controller.destroy();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        controllerDocumentIdRef.current = null;
      }
    };
  }, [activeDocumentId, router, staticPreview]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (accessSnapshot.phase === 'local-ready' || accessSnapshot.phase === 'remote-ready') return;
    document.title = 'Lash — Checking document access';
  }, [accessSnapshot.phase]);

  useEffect(() => {
    if (
      accessSnapshot.phase !== 'denied' &&
      accessSnapshot.phase !== 'unavailable' &&
      accessSnapshot.phase !== 'recovery-available' &&
      accessSnapshot.phase !== 'recovery-blocked'
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => accessHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [accessSnapshot.phase]);

  useEffect(() => {
    setRecoveryActionStatus('');
  }, [accessSnapshot.phase]);

  const resolvedForRoute =
    resolution?.documentId === activeDocumentId &&
    (accessSnapshot.phase === 'local-ready' || accessSnapshot.phase === 'remote-ready')
      ? resolution
      : null;

  if (resolvedForRoute) {
    return (
      <ResolvedDocumentWorkspace
        accessSnapshot={accessSnapshot}
        documentId={activeDocumentId}
        inviteIssuanceAuthority={controllerRef.current!}
        resolution={resolvedForRoute}
        staticPreview={staticPreview}
      />
    );
  }

  const checking =
    controllerDocumentIdRef.current !== activeDocumentId ||
    accessSnapshot.phase === 'checking' ||
    accessSnapshot.phase === 'authorizing' ||
    accessSnapshot.phase === 'remote-authorized' ||
    accessSnapshot.phase === 'remote-hydrating';
  const canonicalNamedRoute = NAMED_EDIT_ROOM_ID.test(activeDocumentId);
  const commentConnectionLost = accessSnapshot.reason === 'comment-connection-lost';
  const authorityUnavailable =
    accessSnapshot.reason === 'invite-authority-unavailable' ||
    accessSnapshot.reason === 'unavailable';
  const recoveryPhase =
    accessSnapshot.phase === 'recovery-available' || accessSnapshot.phase === 'recovery-blocked'
      ? accessSnapshot.phase
      : null;
  const recoveryPresentation = recoveryPhase
    ? documentRecoveryPresentation(
        recoveryPhase,
        accessSnapshot.recoveryUpdateCount,
        accessSnapshot.recoveryExportAvailable,
      )
    : null;
  const handleExportRecovery = () => {
    const payload = controllerRef.current?.exportRealtimeRecovery() ?? null;
    if (!payload) {
      setRecoveryActionStatus(
        'Recovery bytes are still retained in this tab, but an export snapshot is not available.',
      );
      return;
    }
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lash-recovery-${activeDocumentId}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setRecoveryActionStatus('Local recovery exported.');
    } catch {
      setRecoveryActionStatus('Local recovery export could not be started.');
    }
  };
  const handleDiscardRecoveryAndLeave = () => {
    if (accessSnapshot.phase !== 'recovery-available') return;
    const controller = controllerRef.current;
    if (!controller?.discardRealtimeRecovery()) {
      setRecoveryActionStatus(
        'Recovery was not discarded because verified journal deletion could not be confirmed.',
      );
      return;
    }
    if (controller.getSnapshot().phase === 'recovery-available') {
      setRecoveryActionStatus(
        'This recovery was discarded. Another verified local recovery is still available.',
      );
      return;
    }
    controller.clearCredentialAndNavigate();
  };
  return (
    <main
      className="lash-invite-gate"
      data-testid="invite-access-gate"
      data-state={checking ? 'checking' : (recoveryPhase ?? 'denied')}
      data-phase={accessSnapshot.phase}
      aria-busy={checking ? 'true' : undefined}
    >
      <section
        className="lash-local-body-notice"
        data-kind={checking ? 'loading' : recoveryPhase ? 'recovery' : 'failed'}
        aria-labelledby={
          checking
            ? 'invite-checking-heading'
            : recoveryPhase
              ? 'recovery-heading'
              : 'invite-unavailable-heading'
        }
        role={checking ? 'status' : undefined}
      >
        <div>
          <h1
            id={
              checking
                ? 'invite-checking-heading'
                : recoveryPhase
                  ? 'recovery-heading'
                  : 'invite-unavailable-heading'
            }
            data-testid={
              checking
                ? 'invite-checking-heading'
                : recoveryPhase
                  ? 'recovery-heading'
                  : 'invite-unavailable-heading'
            }
            ref={checking ? undefined : accessHeadingRef}
            tabIndex={checking ? undefined : -1}
          >
            {checking
              ? 'Checking shared document access…'
              : recoveryPresentation
                ? recoveryPresentation.heading
                : accessSnapshot.reason === 'sign-in-required'
                  ? 'Sign in to open this shared document'
                  : commentConnectionLost
                    ? 'Connection to the shared document ended'
                    : canonicalNamedRoute
                      ? 'Shared document unavailable'
                      : authorityUnavailable
                        ? 'This invite cannot load a shared document on this build'
                        : 'This invite could not be opened'}
          </h1>
          <p>
            {checking
              ? 'Lash will show the document only after access and shared content have been checked.'
              : recoveryPresentation
                ? recoveryPresentation.detail
                : commentConnectionLost
                  ? 'Reconnect to open the latest copy and continue the discussion.'
                  : canonicalNamedRoute
                    ? 'Use the account that accepted the invitation, or ask the owner to check your access.'
                    : 'No document content was opened. Return to your local documents to keep writing safely.'}
          </p>
        </div>
        {!checking && recoveryPresentation ? (
          <div className="lash-local-body-notice-actions">
            {recoveryPresentation.canExport ? (
              <button
                className="lash-local-body-notice-action"
                data-testid="recovery-export"
                type="button"
                onClick={handleExportRecovery}
              >
                Export local recovery
              </button>
            ) : null}
            {recoveryPresentation.canDiscardAndLeave ? (
              <button
                className="lash-local-body-notice-action"
                data-testid="recovery-discard-and-leave"
                type="button"
                onClick={handleDiscardRecoveryAndLeave}
              >
                Discard recovery and leave
              </button>
            ) : null}
            <span role="status" data-testid="recovery-action-status" aria-live="polite">
              {recoveryActionStatus}
            </span>
          </div>
        ) : !checking ? (
          <div className="lash-local-body-notice-actions">
            {accessSnapshot.reason === 'sign-in-required' ? (
              <a
                className="lash-local-body-notice-action"
                href={`/auth/sign-in?next=${encodeURIComponent(documentPath(activeDocumentId))}`}
              >
                Sign in
              </a>
            ) : null}
            {accessSnapshot.retryable ? (
              <button
                className="lash-local-body-notice-action"
                data-testid="invite-access-retry"
                type="button"
                onClick={() => void controllerRef.current?.retry()}
              >
                Retry
              </button>
            ) : null}
            <button
              className="lash-local-body-notice-action"
              data-testid="invite-safe-route"
              type="button"
              onClick={() => controllerRef.current?.clearCredentialAndNavigate()}
            >
              Back to my documents
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ResolvedDocumentWorkspace({
  accessSnapshot,
  documentId,
  inviteIssuanceAuthority,
  resolution,
  staticPreview,
}: {
  accessSnapshot: DocumentAccessSnapshot;
  documentId: string;
  inviteIssuanceAuthority: Pick<
    DocumentAccessController,
    'allowsInviteIssuance' | 'captureInviteIssuance' | 'promoteOwnerDocument'
  >;
  resolution: DocumentAccessResolution;
  staticPreview: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const activeDocumentId = useMemo(() => normalizeDocumentId(documentId), [documentId]);
  const navigateDocument = useCallback(
    (path: string) => {
      if (staticPreview) window.location.assign(path);
      else router.push(toRoute(path));
    },
    [router, staticPreview],
  );
  const historyDocumentId = useMemo(() => createDocumentId(activeDocumentId), [activeDocumentId]);
  const [isMounted, setIsMounted] = useState(false);
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [suggestionDraft, setSuggestionDraft] = useState<SuggestionDraft | null>(null);
  const [suggestionNotice, setSuggestionNotice] = useState('');
  const [localSuggestions, setLocalSuggestions] = useState<LocalSuggestion[]>([]);
  const localSuggestionsRef = useRef<LocalSuggestion[]>([]);
  const [docTitle, setDocTitle] = useState(DEFAULT_DOC_TITLE);
  const [documents, setDocuments] = useState<LashDocumentRecord[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [railOpen, setRailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<RailTab>('chat');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [mobileRailFocusRequest, setMobileRailFocusRequest] = useState<MobileRailFocusRequest>({
    trigger: null,
    restoreFocus: true,
  });
  const [isMobileRailViewport, setIsMobileRailViewport] = useState(false);
  const [activeTableCell, setActiveTableCell] = useState<ActiveCell | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyAvailability, setHistoryAvailability] =
    useState<HistoryAvailabilityState>('loading');
  const [selectedHistoryEntryId, setSelectedHistoryEntryId] = useState<string | null>(null);
  const [historyAuthorFilter, setHistoryAuthorFilter] = useState<string | null>(null);
  const [historyTimeFilter, setHistoryTimeFilter] = useState<HistoryTimeFilter>(null);
  const [showAuthorship, setShowAuthorship] = useState(false);
  const [acceptedSuggestionIds, setAcceptedSuggestionIds] = useState<string[]>([]);
  const [suggestionResolutions, setSuggestionResolutions] = useState<SuggestionResolutionRecord[]>(
    [],
  );
  const [legacySuggestionError, setLegacySuggestionError] = useState('');
  const [commentThreadCount, setCommentThreadCount] = useState(0);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [documentSettingsOpen, setDocumentSettingsOpen] = useState(false);
  const [publicAccessState, setPublicAccessState] = useState<PublicAccessStateV1 | null>(null);
  const [documentSettingsAnnouncement, setDocumentSettingsAnnouncement] = useState('');
  const [ownerSharePhase, setOwnerSharePhase] = useState<OwnerShareDialogPhase>(
    staticPreview ? 'unavailable' : 'checking-account',
  );
  const [ownerShareDetail, setOwnerShareDetail] = useState('');
  const [blameLines, setBlameLines] = useState<Array<{ line: number; authorId: string | null }>>(
    [],
  );
  // History head is mirrored: ref for synchronous access inside async
  // closures, state so React knows to re-render dependents (ChatPanel,
  // AIPanel) when the head advances.
  const [historyHead, setHistoryHead] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const markdownTriggerRef = useRef<HTMLElement | null>(null);
  const markdownGenerationRef = useRef(0);
  const markdownAutosaveControllerRef = useRef<AutosaveFlushController | null>(null);
  const markdownNavigationControllerRef = useRef<MarkdownImportNavigationController | null>(null);
  const [markdownDialogState, setMarkdownDialogState] =
    useState<MarkdownTransferDialogState | null>(null);
  const [markdownAnnouncement, setMarkdownAnnouncement] = useState('');
  const outlineItemsRef = useRef<OutlineItem[]>([]);
  const outlineFrameRef = useRef<number | null>(null);
  const outlineIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyStoreRef = useRef(
    createHistoryStore({
      snapshotInterval: 48,
      persistence: createLocalDocumentHistoryPersistence(),
    }),
  );
  const historyHeadRef = useRef<string | null>(null);
  const historyTextRef = useRef('');
  const historyBodyRef = useRef<LocalBodyDocJson | null>(null);
  const historyCapacityReachedRef = useRef(false);
  const historyQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingHistoryRef = useRef(false);
  const restoringLocalHistoryRef = useRef(false);
  const [historyRestoreNotice, setHistoryRestoreNotice] = useState('');
  const applyingAiPatchRef = useRef(false);
  const suggestionResolutionsRef = useRef<SuggestionResolutionRecord[]>([]);
  const activeTableCellRef = useRef<ActiveCell | null>(null);
  // Refs to the buttons that opened the mobile drawers, so focus can
  // return to them on close (a11y requirement: focus must not be lost).
  const mobileSidebarTriggerRef = useRef<HTMLElement | null>(null);
  const mobileRailActionCoordinatorRef = useRef(createMobileRailActionCoordinator());
  const mobileRailAvailabilityObserverRef = useRef<MutationObserver | null>(null);
  const railJumpSequenceRef = useRef(0);
  const activityRailTriggerRef = useRef<HTMLElement | null>(null);
  const shareTriggerRef = useRef<HTMLElement | null>(null);
  const documentSettingsTriggerRef = useRef<HTMLElement | null>(null);
  const promotionAttemptRef = useRef<BrowserDocumentPromotionAttempt | null>(null);
  const [railJumpRequest, setRailJumpRequest] = useState<{
    id: RailTab;
    requestId: number;
  } | null>(null);

  const commitHistoryHead = useCallback((sha: string | null) => {
    historyHeadRef.current = sha;
    setHistoryHead(sha);
  }, []);

  const loadHistoryDiff = useCallback(
    (from: string, to: string) => historyStoreRef.current.diff(historyDocumentId, from, to),
    [historyDocumentId],
  );

  const refreshDocuments = useCallback(() => {
    const storage = browserLocalStorage();
    setDocuments(storage ? listDocuments(storage) : []);
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
  const realtimeEnabled = resolution.kind === 'remote';
  const realtimeDoc = resolution.kind === 'remote' ? resolution.doc : null;
  const realtimeProvider = resolution.kind === 'remote' ? resolution.provider : null;
  const mutationAuthorityDocumentId = realtimeEnabled
    ? resolution.remoteDocumentId
    : activeDocumentId;
  const runtimeMode = resolution.runtime.mode;
  const mutationAuthority = resolution.authority;
  const canEditDocument = mutationAuthority.getSnapshot().bodyWrite;
  const namedMember =
    realtimeEnabled &&
    NAMED_EDIT_ROOM_ID.test(activeDocumentId) &&
    !accessSnapshot.authoritativeOwner;
  const namedComment = namedMember && accessSnapshot.scope === 'comment';
  const [localBodyState, setLocalBodyState] = useState<
    'loading' | 'ready' | 'recovered-awaiting-confirmation' | 'conflict' | 'unavailable' | 'failed'
  >('loading');
  const [localBodyNotice, setLocalBodyNotice] = useState<LocalBodyNotice | null>(null);
  const localBodyExpectedRef = useRef<LocalBodyExpectedRevision | null>(null);
  const recoveredLocalBodyRef = useRef<{
    envelope: LocalBodyEnvelope;
    recoveryToken: Readonly<LocalBodyRecoveryToken>;
  } | null>(null);
  const localRecoveryFocusDocumentRef = useRef<string | null>(null);
  const hydratedLocalEditorRef = useRef<Editor | null>(null);
  const localBodyMutationsAllowedRef = useRef(realtimeEnabled);
  const localBodySavingUnavailable = !realtimeEnabled && localBodyState === 'unavailable';
  const localBodyMutationLocked =
    !realtimeEnabled &&
    (localBodyState === 'loading' || localBodyState === 'recovered-awaiting-confirmation');
  const localHistoryMutationLocked =
    !realtimeEnabled &&
    !localBodySavingUnavailable &&
    historyAvailability !== 'ready' &&
    historyAvailability !== 'empty-baseline' &&
    historyAvailability !== 'capacity-reached';
  const documentMutationLocked =
    localBodyMutationLocked || localHistoryMutationLocked || !canEditDocument;
  const runDocumentMetadataMutation = useCallback(
    (mutate: () => void) =>
      mutationAuthority.runMetadataMutation(mutationAuthority.capture(), mutate),
    [mutationAuthority],
  );
  const chatRealtimeStore = useMemo(
    () =>
      realtimeDoc && realtimeProvider
        ? namedComment
          ? realtimeProvider.reviewStore
          : withLegacyChatThreads(realtimeProvider.reviewStore, realtimeDoc)
        : null,
    [namedComment, realtimeDoc, realtimeProvider],
  );
  const [sharedSuggestionsReady, setSharedSuggestionsReady] = useState(false);
  useEffect(() => {
    const refresh = () => setSharedSuggestionsReady(chatRealtimeStore?.isReady() ?? false);
    refresh();
    return chatRealtimeStore?.subscribe(refresh);
  }, [chatRealtimeStore]);
  const [realtimeSnapshot, setRealtimeSnapshot] = useState<RealtimeSnapshot>(
    () =>
      realtimeProvider?.getSnapshot() ?? {
        actorId: '',
        canWrite: false,
        connectionState: 'disabled',
        enabled: false,
        hydrated: false,
        peers: [],
        pendingUpdateCount: 0,
        queuedUpdateCount: 0,
        syncState: 'disabled',
      },
  );
  const localBodyMutationGuard = useMemo(
    () =>
      Extension.create({
        name: 'localBodyMutationGuard',
        addProseMirrorPlugins() {
          return [
            new Plugin({
              key: new PluginKey('localBodyMutationGuard'),
              filterTransaction: (transaction) =>
                allowsDocumentBodyTransaction({
                  authority: mutationAuthority,
                  documentId: mutationAuthorityDocumentId,
                  localBodyMutationsAllowed:
                    localBodyMutationsAllowedRef.current &&
                    !applyingAiPatchRef.current &&
                    (!restoringLocalHistoryRef.current || applyingHistoryRef.current),
                  transaction,
                }),
            }),
          ];
        },
      }),
    [mutationAuthority, mutationAuthorityDocumentId],
  );

  useEffect(() => {
    if (!realtimeProvider) {
      setRealtimeSnapshot({
        actorId: '',
        canWrite: false,
        connectionState: 'disabled',
        enabled: false,
        hydrated: false,
        peers: [],
        pendingUpdateCount: 0,
        queuedUpdateCount: 0,
        syncState: 'disabled',
      });
      return;
    }
    return realtimeProvider.subscribe(setRealtimeSnapshot);
  }, [realtimeProvider]);

  const publishSuggestionResolutions = useCallback(
    (
      nextRecords: SuggestionResolutionRecord[],
      options: { persist: boolean } = { persist: true },
    ) => {
      if (options.persist && realtimeEnabled) return;
      if (options.persist && !mutationAuthority.allowsBodyMutation(mutationAuthority.capture())) {
        return;
      }
      suggestionResolutionsRef.current = nextRecords;
      setSuggestionResolutions((current) =>
        sameSuggestionResolutions(current, nextRecords) ? current : nextRecords,
      );
      if (!options.persist) return;
      writeSuggestionResolutionsToStorage(historyDocumentId, nextRecords);
    },
    [historyDocumentId, mutationAuthority, realtimeEnabled],
  );

  useEffect(() => {
    const yMap = realtimeDoc
      ? realtimeDoc.getMap<string>(REALTIME_SUGGESTION_RESOLUTIONS_YMAP)
      : null;
    const initialRecords = readSuggestionResolutionRecords(
      yMap,
      historyDocumentId,
      readSuggestionResolutionsFromStorage,
    );
    publishSuggestionResolutions(initialRecords, { persist: false });

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== suggestionResolutionStorageKey(historyDocumentId) || yMap) return;
      publishSuggestionResolutions(parseSuggestionResolutions(event.newValue), { persist: false });
    };
    window.addEventListener('storage', handleStorage);

    const handleRemoteRecords = (event: Y.YMapEvent<string>) => {
      const prefix = realtimeSuggestionResolutionPrefix(historyDocumentId);
      if (![...event.keysChanged].some((key) => key.startsWith(prefix))) {
        return;
      }
      if (!yMap) return;
      const nextRecords = readRealtimeSuggestionResolutions(yMap, historyDocumentId);
      writeSuggestionResolutionsToStorage(historyDocumentId, nextRecords);
      publishSuggestionResolutions(nextRecords, { persist: false });
    };
    yMap?.observe(handleRemoteRecords);

    return () => {
      window.removeEventListener('storage', handleStorage);
      yMap?.unobserve(handleRemoteRecords);
    };
  }, [historyDocumentId, publishSuggestionResolutions, realtimeDoc]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useLayoutEffect(() => {
    const storage = browserLocalStorage();
    if (realtimeDoc) {
      const titleMap = realtimeDoc.getMap<string>(REALTIME_DOCUMENT_METADATA_YMAP);
      const publishRemoteTitle = () => {
        const title = readRealtimeDocumentTitle(realtimeDoc) ?? DEFAULT_DOC_TITLE;
        setDocTitle(title);
        try {
          setDocuments(storage ? listDocuments(storage) : []);
        } catch {
          setDocuments([]);
        }
      };
      const handleRemoteTitle = (event: Y.YMapEvent<string>) => {
        if (event.keysChanged.has(REALTIME_DOCUMENT_TITLE_KEY)) publishRemoteTitle();
      };
      publishRemoteTitle();
      titleMap.observe(handleRemoteTitle);
      return () => titleMap.unobserve(handleRemoteTitle);
    }
    if (!storage) {
      setDocTitle(DEFAULT_DOC_TITLE);
      setDocuments([]);
      return;
    }
    const storedTitle = readDocumentTitle(storage, activeDocumentId);
    setDocTitle(storedTitle);
    if (!canEditDocument) {
      try {
        setDocuments(listDocuments(storage));
      } catch {
        setDocuments([]);
      }
      return;
    }
    try {
      setDocuments(upsertDocument(storage, { id: activeDocumentId, title: storedTitle }));
    } catch {
      setDocuments([]);
    }
  }, [activeDocumentId, canEditDocument, realtimeDoc]);

  useEffect(() => {
    if (!isMounted || typeof window === 'undefined' || realtimeEnabled) return;
    try {
      setDocuments(listDocuments(browserLocalStorage()));
    } catch {
      setDocuments([]);
    }
  }, [isMounted, realtimeEnabled]);

  useEffect(() => {
    if (!isMounted) return;
    const normalizedTitle = docTitle.trim() || DEFAULT_DOC_TITLE;
    document.title = `${normalizedTitle} — Lash`;
  }, [docTitle, isMounted]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia('(max-width: 767px)');
    const syncViewport = () => setIsMobileRailViewport(query.matches);
    syncViewport();
    query.addEventListener('change', syncViewport);
    return () => query.removeEventListener('change', syncViewport);
  }, []);

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

  const cancelPendingMobileRailAction = useCallback(() => {
    mobileRailAvailabilityObserverRef.current?.disconnect();
    mobileRailAvailabilityObserverRef.current = null;
    mobileRailActionCoordinatorRef.current.cancel();
  }, []);

  const queueMobileRailAfterClose = useCallback(
    (run: () => void, cancel: () => void = () => undefined) => {
      cancelPendingMobileRailAction();
      mobileRailActionCoordinatorRef.current.queue({ documentId: activeDocumentId, run, cancel });
      setMobileRailOpen(false);
    },
    [activeDocumentId, cancelPendingMobileRailAction],
  );

  // A mobile rail is modal: AppShell keeps the canvas inert while it is open,
  // and the body-lock effect above releases scrolling during the close commit.
  // Consume the queued action only after both boundaries are observably gone.
  // MutationObserver makes this event-driven; if the canvas never becomes
  // available, the action intentionally fails closed instead of guessing at a
  // delay. The document-id/unmount cleanup prevents a stale target jump.
  useEffect(() => {
    if (mobileRailOpen || typeof document === 'undefined') return;
    if (!mobileRailActionCoordinatorRef.current.hasPending()) return;

    const consumeWhenAvailable = () => {
      const canvas = document.querySelector<HTMLElement>('.lash-canvas');
      const bodyScrollLocked = document.body.style.position === 'fixed';
      mobileRailActionCoordinatorRef.current.notifyRelease({
        documentId: activeDocumentId,
        canvasAvailable: Boolean(canvas && !canvas.hasAttribute('inert')),
        bodyScrollLocked,
      });
      if (!mobileRailActionCoordinatorRef.current.hasPending()) {
        mobileRailAvailabilityObserverRef.current?.disconnect();
        mobileRailAvailabilityObserverRef.current = null;
      }
    };

    consumeWhenAvailable();
    if (!mobileRailActionCoordinatorRef.current.hasPending()) return;

    const observer = new MutationObserver(consumeWhenAvailable);
    mobileRailAvailabilityObserverRef.current = observer;
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['inert', 'style'],
      childList: true,
      subtree: true,
    });
    return () => {
      if (mobileRailAvailabilityObserverRef.current === observer) {
        observer.disconnect();
        mobileRailAvailabilityObserverRef.current = null;
      }
    };
  }, [activeDocumentId, cancelPendingMobileRailAction, mobileRailOpen]);

  useEffect(
    () => () => {
      cancelPendingMobileRailAction();
    },
    [activeDocumentId, cancelPendingMobileRailAction],
  );

  const closeMobileRail = useCallback(() => {
    cancelPendingMobileRailAction();
    setMobileRailFocusRequest((request) => ({ ...request, restoreFocus: true }));
    setMobileRailOpen(false);
  }, [cancelPendingMobileRailAction]);

  const closeActivityRail = useCallback(() => {
    const trigger = activityRailTriggerRef.current;
    const closesMobileDrawer =
      typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
    setRailOpen(false);
    closeMobileRail();
    if (closesMobileDrawer) return;
    activityRailTriggerRef.current = null;
    window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
  }, [closeMobileRail]);

  const handleChatDocumentNavigation = useCallback(
    (navigateToTarget: () => void) => {
      const mobileDrawerOpen =
        mobileRailOpen &&
        typeof window !== 'undefined' &&
        window.matchMedia('(max-width: 767px)').matches;
      if (!mobileDrawerOpen) {
        navigateToTarget();
        return;
      }

      // Show owns the next focus target. Keep the true origin recorded for
      // auditability, but explicitly suppress normal drawer restoration.
      setMobileRailFocusRequest((request) => ({ ...request, restoreFocus: false }));
      queueMobileRailAfterClose(navigateToTarget);
    },
    [mobileRailOpen, queueMobileRailAfterClose],
  );

  const openDiscussionPanel = useCallback(
    (trigger: HTMLElement, tab: 'chat' | 'ai' = 'chat') => {
      cancelPendingMobileRailAction();
      activityRailTriggerRef.current = trigger;
      setMobileRailFocusRequest({ trigger, restoreFocus: true });
      setIsFocusMode(false);
      setActiveTab(tab);
      setRailOpen(true);
      railJumpSequenceRef.current += 1;
      setRailJumpRequest({ id: tab, requestId: railJumpSequenceRef.current });
      const opensMobileDrawer =
        typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
      if (opensMobileDrawer) {
        setMobileRailOpen(true);
      } else {
        setMobileRailOpen(false);
      }
    },
    [cancelPendingMobileRailAction],
  );

  const handleDiscussionClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      openDiscussionPanel(event.currentTarget);
    },
    [openDiscussionPanel],
  );

  const outlinePersistence = useMemo(
    () => createLocalStorageOutlinePersistence(browserLocalStorage()),
    [],
  );

  const handleLinkCommand = useCallback(
    (activeEditor: Editor) => {
      if (
        !localBodyMutationsAllowedRef.current ||
        !mutationAuthority.allowsBodyMutation(mutationAuthority.capture())
      ) {
        return false;
      }
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
    },
    [mutationAuthority],
  );

  const referenceCatalog = useMemo(
    () =>
      createDocumentReferenceCatalog(
        realtimeDoc
          ? {
              kind: 'shared',
              readCurrent: () => {
                const title = readRealtimeDocumentTitle(realtimeDoc);
                return title &&
                  NAMED_EDIT_ROOM_ID.test(mutationAuthorityDocumentId) &&
                  realtimeProvider?.getSnapshot().hydrated
                  ? { id: mutationAuthorityDocumentId, title }
                  : null;
              },
            }
          : { kind: 'local', storage: browserLocalStorage },
      ),
    [mutationAuthorityDocumentId, realtimeDoc, realtimeProvider],
  );

  const extensions = useMemo(
    () => [
      ...createLashEditorExtensions({
        onRequestLink: handleLinkCommand,
        outline: {
          documentId: activeDocumentId,
          persistence: outlinePersistence,
        },
        image: {
          uploader: imageUploader,
        },
        collaboration: realtimeDoc
          ? {
              document: realtimeDoc,
              field: 'content',
            }
          : undefined,
        chips: {
          resolveDocChip: staticPreview
            ? (id) => {
                const reference = referenceCatalog.resolve(id);
                return reference
                  ? { ...reference, navigationHref: documentWorkspacePath(id, true) }
                  : null;
              }
            : referenceCatalog.resolve,
          matchAlternateDocUrl: staticPreview ? matchPreviewDocumentUrl : undefined,
        },
      }),
      localBodyMutationGuard,
    ],
    [
      handleLinkCommand,
      activeDocumentId,
      outlinePersistence,
      imageUploader,
      realtimeDoc,
      referenceCatalog,
      staticPreview,
      localBodyMutationGuard,
    ],
  );

  const editor = useEditor(
    {
      extensions,
      autofocus: namedComment ? false : 'end',
      editable: !namedComment,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: 'lash-editor-content',
          ...(namedComment ? { tabindex: '0' } : {}),
        },
      },
    },
    [extensions],
  );

  const validateLocalBodySchema = useCallback(
    (doc: Record<string, unknown>) => {
      if (!editor) {
        throw new Error('Editor schema is unavailable during local body validation.');
      }
      assertStrictLocalBodySchemaJson(doc, editor.schema);
      const node = editor.schema.nodeFromJSON(doc);
      node.check();
    },
    [editor],
  );

  const canonicalizeLocalBodySchema = useCallback(
    (doc: LocalBodyDocJson) => {
      if (!editor) {
        throw new Error('Editor schema is unavailable during local body canonicalization.');
      }
      const node = editor.schema.nodeFromJSON(doc);
      node.check();
      const projected = projectDocumentHeadingIds(node);
      projected.check();
      const canonical = projected.toJSON() as LocalBodyDocJson;
      assertStrictLocalBodySchemaJson(canonical, editor.schema);
      return canonical;
    },
    [editor],
  );

  useLayoutEffect(() => {
    if (!editor || hydratedLocalEditorRef.current === editor) return;
    hydratedLocalEditorRef.current = editor;
    localBodyExpectedRef.current = null;
    localSuggestionsRef.current = [];
    setLocalSuggestions([]);
    recoveredLocalBodyRef.current = null;
    localBodyMutationsAllowedRef.current = realtimeEnabled;
    setLocalBodyNotice(null);

    if (realtimeEnabled) {
      // Yjs and the Durable Object are the sole body authority in realtime
      // mode. Do not even read the local body keys here.
      setLocalBodyState('ready');
      return;
    }

    // Local content is not interactable until the reader has either hydrated
    // a verified snapshot or chosen a fail-visible recovery state.
    localBodyMutationsAllowedRef.current = false;
    editor.setEditable(false);
    const storage = browserLocalStorage();
    if (!storage) {
      setLocalBodyNotice({
        kind: 'unavailable',
        detail: 'Browser local storage could not be acquired.',
      });
      localBodyMutationsAllowedRef.current = true;
      setLocalBodyState('unavailable');
      return;
    }
    const result = loadLocalDocumentBody({
      storage,
      documentId: activeDocumentId,
      validateSchema: validateLocalBodySchema,
    });

    try {
      if (result.state === 'ready') {
        localBodyMutationsAllowedRef.current = true;
        editor.commands.setContent(result.envelope.doc, false);
        localSuggestionsRef.current = result.envelope.suggestions ?? [];
        setLocalSuggestions(localSuggestionsRef.current);
        localBodyExpectedRef.current = result.expected;
        setLocalBodyState('ready');
        return;
      }
      if (result.state === 'empty') {
        localBodyMutationsAllowedRef.current = true;
        setLocalBodyState('ready');
        return;
      }
      if (result.state === 'recovered-awaiting-confirmation') {
        localBodyMutationsAllowedRef.current = true;
        editor.commands.setContent(result.envelope.doc, false);
        localSuggestionsRef.current = result.envelope.suggestions ?? [];
        setLocalSuggestions(localSuggestionsRef.current);
        localBodyMutationsAllowedRef.current = false;
        recoveredLocalBodyRef.current = {
          envelope: result.envelope,
          recoveryToken: result.recoveryToken,
        };
        setLocalBodyNotice({ kind: 'recovered' });
        setLocalBodyState('recovered-awaiting-confirmation');
        return;
      }
      if (result.state === 'unavailable') {
        setLocalBodyNotice({ kind: 'unavailable', detail: result.error.message });
        localBodyMutationsAllowedRef.current = true;
        setLocalBodyState('unavailable');
        return;
      }
      setLocalBodyNotice({
        kind: 'failed',
        detail: result.primaryError?.message ?? result.backupError?.message,
      });
      localBodyMutationsAllowedRef.current = true;
      setLocalBodyState('failed');
    } catch (error) {
      // Active-schema validation already succeeded. A setContent failure is
      // nevertheless fail-closed and must never enable autosave.
      setLocalBodyNotice({
        kind: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      });
      localBodyMutationsAllowedRef.current = true;
      setLocalBodyState('failed');
    }
  }, [activeDocumentId, editor, realtimeEnabled, validateLocalBodySchema]);

  const inviteScope = accessSnapshot.scope;
  const documentSurfaceReady = true;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!documentMutationLocked);
    if (!documentMutationLocked && localRecoveryFocusDocumentRef.current === activeDocumentId) {
      localRecoveryFocusDocumentRef.current = null;
      const ownerDocument = editor.view.dom.ownerDocument;
      if (ownerDocument.activeElement === ownerDocument.body) editor.view.focus();
    }
  }, [activeDocumentId, documentMutationLocked, editor]);

  useEffect(() => {
    if (!editor || !realtimeProvider) return;
    const publishSelection = () => {
      const { from, to } = editor.state.selection;
      realtimeProvider.setLocalSelection({ from, to });
    };
    publishSelection();
    editor.on('selectionUpdate', publishSelection);
    editor.on('transaction', publishSelection);
    return () => {
      editor.off('selectionUpdate', publishSelection);
      editor.off('transaction', publishSelection);
      realtimeProvider.setLocalSelection(null);
    };
  }, [editor, realtimeProvider]);

  const localBodyConsumersReady =
    documentSurfaceReady &&
    (realtimeEnabled ||
      (localBodyState !== 'loading' && localBodyState !== 'recovered-awaiting-confirmation'));

  useLayoutEffect(() => {
    if (!editor || realtimeEnabled || !localBodyConsumersReady) return;
    const mapSuggestions = ({ transaction }: EditorEvents['transaction']) => {
      const current = localSuggestionsRef.current;
      if (
        !current.length ||
        !transaction.docChanged ||
        transaction.getMeta('local-suggestion-committed')
      )
        return;
      const next = mapLocalSuggestions(current, transaction);
      if (next === current) return;
      localSuggestionsRef.current = next;
      setLocalSuggestions(next);
    };
    editor.on('transaction', mapSuggestions);
    return () => {
      editor.off('transaction', mapSuggestions);
    };
  }, [editor, localBodyConsumersReady, realtimeEnabled]);

  useEffect(() => {
    if (!editor || !localBodyConsumersReady) {
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
  }, [editor, localBodyConsumersReady]);

  useEffect(() => {
    if (!editor || !localBodyConsumersReady) {
      setHistoryEntries([]);
      setHistoryAvailability('loading');
      setSelectedHistoryEntryId(null);
      setAcceptedSuggestionIds(acceptedIdsFromResolutions(suggestionResolutionsRef.current));
      setBlameLines([]);
      commitHistoryHead(null);
      historyTextRef.current = '';
      historyBodyRef.current = null;
      historyQueueRef.current = Promise.resolve();
      return;
    }

    let disposed = false;
    let listenerAttached = false;
    setHistoryEntries([]);
    setHistoryAvailability(realtimeEnabled ? 'remote-disabled' : localBodySavingUnavailable ? 'body-saving-unavailable' : 'loading');
    setSelectedHistoryEntryId(null);
    setAcceptedSuggestionIds(acceptedIdsFromResolutions(suggestionResolutionsRef.current));
    setBlameLines([]);
    commitHistoryHead(null);
    historyTextRef.current = editorText(editor);
    historyBodyRef.current = null;
    historyCapacityReachedRef.current = false;
    historyQueueRef.current = Promise.resolve();

    if (realtimeEnabled || localBodySavingUnavailable) {
      // Account-backed history is loaded through its room. Local history
      // waits for local body storage so it cannot publish an unsaved head.
      return () => {
        disposed = true;
      };
    }

    const recordHistory = (event?: EditorEvents['transaction']) => {
      if (
        (event && !event.transaction.docChanged) ||
        applyingHistoryRef.current ||
        historyCapacityReachedRef.current
      )
        return;
      const ticket = mutationAuthority.capture();
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
      }
      historyTimerRef.current = setTimeout(() => {
        historyTimerRef.current = null;
        // Recover the queue if a prior task rejected: catch the error,
        // log it, then resume. Without this, one failed append would
        // wedge every subsequent history write.
        historyQueueRef.current = historyQueueRef.current
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('[lash] history queue recovered from error:', err);
          })
          .then(async () => {
            if (disposed || !mutationAuthority.allowsBodyMutation(ticket)) return;
            const doc = editor.state.doc;
            const before = historyTextRef.current;
            const after = editorText(editor);
            const body = captureHistoryBody(doc);
            const expectedParentSha = historyHeadRef.current;
            if (
              !expectedParentSha ||
              (before === after &&
                historyBodyRef.current &&
                canonicalize(historyBodyRef.current) === canonicalize(body))
            )
              return;
            const historyStore = historyStoreRef.current;
            const result = await historyStore.append(
              {
                docId: historyDocumentId,
                actor: HISTORY_ACTOR,
                expectedParentSha,
                schemaVersion: HISTORY_SCHEMA_VERSION,
                ops: localHistoryOperations(
                  {
                    type: 'doc',
                    text: before,
                    ...(historyBodyRef.current ? { body: historyBodyRef.current } : {}),
                  },
                  { type: 'doc', text: after, body },
                ),
                intent: 'edit',
                audit: HISTORY_AUDIT,
              },
              {
                commitGuard: () => !disposed && mutationAuthority.allowsBodyMutation(ticket),
              },
            );
            if (!result.ok) {
              if (result.reason === 'commit-uncertain') {
                if (!disposed) setHistoryAvailability('corrupt');
              } else if (result.reason === 'history-capacity') {
                historyCapacityReachedRef.current = true;
                if (!disposed) setHistoryAvailability('capacity-reached');
              } else if (
                result.reason === 'persistence-unavailable' ||
                result.reason === 'schema-invalid' ||
                result.reason === 'parent-mismatch'
              ) {
                if (!disposed) setHistoryAvailability('unavailable');
              }
              return;
            }
            if (!mutationAuthority.allowsBodyMutation(ticket)) return;
            historyTextRef.current = after;
            historyBodyRef.current = body;
            commitHistoryHead(result.entry.resultSha);
            const entries = await historyStore.list(historyDocumentId);
            if (disposed || !mutationAuthority.allowsBodyMutation(ticket)) return;
            setHistoryAvailability('ready');
            setHistoryEntries(entries);
            setSelectedHistoryEntryId(result.entry.id);
            setBlameLines(blameFor(entries, after));
          });
      }, HISTORY_RECORD_DEBOUNCE_MS);
    };

    const initialBody = captureHistoryBody(editor.state.doc);
    const initialHistory: HistoryDocumentState = {
      type: 'doc',
      text: editorText(editor),
      body: initialBody,
    };
    void historyStoreRef.current
      .hydrate(historyDocumentId, initialHistory)
      .then(async (hydration) => {
        if (disposed) return;
        if (hydration.state !== 'ready' && hydration.state !== 'empty-baseline') {
          setHistoryAvailability(hydration.state);
          return;
        }

        const historyStore = historyStoreRef.current;
        let entries = await historyStore.list(historyDocumentId);
        let headDocument = (await historyStore.loadAt(
          historyDocumentId,
          hydration.head,
        )) as HistoryDocumentState;
        let head = hydration.head;
        if (disposed) return;
        let capacityReached = false;
        const currentBody = captureHistoryBody(editor.state.doc);
        const liveText = editorText(editor);
        const bodyDiffersFromHistory =
          headDocument.text !== liveText ||
          (headDocument.body && canonicalize(headDocument.body) !== canonicalize(currentBody));
        if (bodyDiffersFromHistory) {
          const storage = browserLocalStorage();
          const expectedBody = localBodyExpectedRef.current;
          const historicalTimestamp = entries.at(-1)?.ts;
          const ticket = mutationAuthority.capture();
          const document = editor.state.doc;
          const currentBodyIsDurableAndNewer = () => {
            if (
              disposed ||
              editor.isDestroyed ||
              editor.state.doc !== document ||
              !storage ||
              !expectedBody ||
              !historicalTimestamp ||
              !mutationAuthority.allowsBodyMutation(ticket)
            )
              return false;
            const persisted = loadLocalDocumentBody({
              storage,
              documentId: activeDocumentId,
              validateSchema: validateLocalBodySchema,
            });
            return (
              persisted.state === 'ready' &&
              persisted.expected.revision === expectedBody.revision &&
              persisted.expected.writeId === expectedBody.writeId &&
              Date.parse(persisted.envelope.savedAt) > Date.parse(historicalTimestamp) &&
              canonicalize(persisted.envelope.doc) === canonicalize(currentBody)
            );
          };
          if (!currentBodyIsDurableAndNewer()) {
            setHistoryAvailability('corrupt');
            return;
          }
          const repaired: HistoryDocumentState = { type: 'doc', text: liveText, body: currentBody };
          const result = await historyStore.append(
            {
              docId: historyDocumentId,
              actor: HISTORY_ACTOR,
              expectedParentSha: head,
              schemaVersion: HISTORY_SCHEMA_VERSION,
              ops: localHistoryOperations(headDocument, repaired),
              intent: 'edit',
              audit: HISTORY_AUDIT,
            },
            { commitGuard: currentBodyIsDurableAndNewer },
          );
          if (disposed || !mutationAuthority.allowsBodyMutation(ticket)) return;
          if (!result.ok && result.reason !== 'history-capacity') {
            setHistoryAvailability(
              result.reason === 'commit-uncertain' ? 'corrupt' : 'unavailable',
            );
            return;
          }
          if (result.ok) {
            entries = [...entries, result.entry];
            head = result.entry.resultSha;
            headDocument = repaired;
          } else {
            capacityReached = true;
            historyCapacityReachedRef.current = true;
          }
        }

        historyTextRef.current = headDocument.text;
        historyBodyRef.current = headDocument.body ?? null;
        commitHistoryHead(head);
        setHistoryEntries(entries);
        setSelectedHistoryEntryId(entries.at(-1)?.id ?? null);
        setBlameLines(capacityReached ? [] : blameFor(entries, headDocument.text));
        setHistoryAvailability(
          capacityReached ? 'capacity-reached' : entries.length > 0 ? 'ready' : 'empty-baseline',
        );
        editor.on('transaction', recordHistory);
        listenerAttached = true;
      })
      .catch(() => {
        if (!disposed) {
          setHistoryAvailability('unavailable');
        }
      });

    return () => {
      disposed = true;
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      if (listenerAttached) {
        editor.off('transaction', recordHistory);
      }
    };
  }, [
    activeDocumentId,
    editor,
    historyDocumentId,
    commitHistoryHead,
    localBodyConsumersReady,
    localBodySavingUnavailable,
    mutationAuthority,
    realtimeEnabled,
    validateLocalBodySchema,
  ]);

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
      if (!editor || documentMutationLocked) return;
      lashCommands.setTableCellType(editor, type);
    },
    [documentMutationLocked, editor],
  );

  const handleSetTableCellValue = useCallback(
    (value: string) => {
      if (!editor || documentMutationLocked) return;
      lashCommands.setTableCellValue(editor, value);
    },
    [documentMutationLocked, editor],
  );

  const handleCycleTableCellOption = useCallback(
    (direction: 1 | -1 = 1) => {
      if (!editor || documentMutationLocked) return;
      lashCommands.cycleTableCellOption(editor, direction);
    },
    [documentMutationLocked, editor],
  );

  // Power-user test hooks (window.__lash*) are not safe to ship to end
  // users — they expose document commands and editor state. They stay
  // available in dev and when the build is explicitly tagged for tests
  // (Playwright sets NEXT_PUBLIC_LASH_TEST_HOOKS=true at build time).
  const exposeTestHooks =
    process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_LASH_TEST_HOOKS === 'true';

  useEffect(() => {
    if (typeof window === 'undefined' || !exposeTestHooks || !documentSurfaceReady) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__lashOutlineItems = outlineItems;
    return () => {
      if (typeof window === 'undefined') return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__lashOutlineItems;
    };
  }, [documentSurfaceReady, outlineItems, exposeTestHooks]);

  useEffect(() => {
    if (typeof window === 'undefined' || !editor || !exposeTestHooks || !localBodyConsumersReady) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    const editorTestHook = documentMutationLocked ? createReadOnlyEditorTestFacade(editor) : editor;
    win.__lashEditor = editorTestHook;
    win.__lashImageUploadMock = win.__lashImageUploadMock ?? {};
    if (!documentMutationLocked) {
      win.__lashImageUploader = imageUploader;
      win.__lashCommands = lashCommands;
    } else {
      delete win.__lashImageUploader;
      delete win.__lashCommands;
    }
    win.__lashTable = {
      setCellType: (type: string, options?: string[]) =>
        documentMutationLocked
          ? false
          : lashCommands.setTableCellType(editor, type as never, options),
      setCellValue: (value: string) =>
        documentMutationLocked ? false : lashCommands.setTableCellValue(editor, value),
      cycle: (direction = 1) =>
        documentMutationLocked
          ? false
          : lashCommands.cycleTableCellOption(editor, direction as 1 | -1),
      getActive: () => lashCommands.getTableCellAttrs(editor),
    };
    win.__lashInsertTable = (rows = 3, cols = 3) => {
      if (documentMutationLocked) return false;
      lashCommands.insertTable(editor, { rows, cols });
      return true;
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
      getSnapshot: () => realtimeProvider?.getSnapshot() ?? realtimeSnapshot,
      disconnectForTest: () => realtimeProvider?.disconnectForTest(),
      reconnectForTest: () => realtimeProvider?.reconnectForTest(),
    };
    win.__lashRealtime = realtimeApi;
    win.__lashInsertImageFromArrayBuffer = async (buffer: ArrayBuffer, mimeType = 'image/png') => {
      const ticket = mutationAuthority.capture();
      if (!mutationAuthority.allowsBodyMutation(ticket)) return false;
      const file = new File([buffer], `import-${Date.now()}.${mimeType.split('/')[1] ?? 'png'}`, {
        type: mimeType,
      });
      return mutationAuthority.runBodyMutation(ticket, () => {
        editor.commands.insertImagePlaceholder(file);
      });
    };
    return () => {
      if (typeof window === 'undefined') return;
      if (win.__lashEditor === editorTestHook) delete win.__lashEditor;
      if (win.__lashImageUploader === imageUploader) delete win.__lashImageUploader;
      if (win.__lashCommands === lashCommands) delete win.__lashCommands;
      if (win.__lashTable) delete win.__lashTable;
      delete win.__lashInsertTable;
      delete win.__lashSelectTableCells;
      delete win.__lashSerializeMarkdown;
      if (win.__lashRealtime === realtimeApi) delete win.__lashRealtime;
      delete win.__lashInsertImageFromArrayBuffer;
    };
  }, [
    editor,
    imageUploader,
    activeDocumentId,
    exposeTestHooks,
    realtimeProvider,
    realtimeSnapshot,
    localBodyConsumersReady,
    documentMutationLocked,
    mutationAuthority,
  ]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !editor ||
      !exposeTestHooks ||
      !documentSurfaceReady ||
      !localBodyMutationLocked
    ) {
      return;
    }
    const win = window as Window & {
      __lashRecoveryProbe?: {
        getJSON: () => Record<string, unknown>;
        attemptSetContent: (content: Record<string, unknown>) => boolean;
      };
    };
    const probe = {
      getJSON: () => editor.getJSON(),
      attemptSetContent: (content: Record<string, unknown>) =>
        editor.commands.setContent(content, false),
    };
    win.__lashRecoveryProbe = probe;
    return () => {
      if (win.__lashRecoveryProbe === probe) delete win.__lashRecoveryProbe;
    };
  }, [documentSurfaceReady, editor, exposeTestHooks, localBodyMutationLocked]);

  const isEditorReady = Boolean(editor && (realtimeEnabled || localBodyState !== 'loading'));
  const canImportMarkdown = isEditorReady && localBodyState !== 'recovered-awaiting-confirmation';

  const handleToolbarClick = useCallback(
    (spec: ToolbarButtonSpec) => {
      if (!editor || documentMutationLocked) return;
      if (spec.id === 'link') {
        handleLinkCommand(editor);
        return;
      }
      runToolbarAction(editor, spec.id);
    },
    [documentMutationLocked, editor, handleLinkCommand],
  );

  const handleToggleHeading = useCallback(
    (item: OutlineItem) => {
      if (!editor || documentMutationLocked) return;
      lashCommands.toggleHeadingCollapse(editor, item.headingId);
    },
    [documentMutationLocked, editor],
  );

  const handleExpandAll = useCallback(() => {
    if (!editor || documentMutationLocked) return;
    lashCommands.expandAllHeadings(editor);
  }, [documentMutationLocked, editor]);

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
    const canvas =
      typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.lash-canvas');
    const canvasScrollTop = canvas?.scrollTop ?? 0;
    const windowScrollY = typeof window === 'undefined' ? 0 : window.scrollY;

    setIsFocusMode((value) => !value);

    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (canvas) canvas.scrollTop = canvasScrollTop;
        window.scrollTo({ top: windowScrollY, behavior: 'auto' });
      });
    });
  }, []);

  const handleSelectHistoryEntry = useCallback((entryId: string) => {
    setLegacySuggestionError('');
    setSelectedHistoryEntryId(entryId);
  }, []);

  const handleToggleAuthorship = useCallback(() => {
    if (showAuthorship && activityRailTriggerRef.current?.closest('.lash-blame-gutter')) {
      const stableReturnTarget =
        typeof document === 'undefined'
          ? null
          : document.querySelector<HTMLElement>('[data-testid="topbar-discussion-button"]');
      if (stableReturnTarget) {
        activityRailTriggerRef.current = stableReturnTarget;
        setMobileRailFocusRequest({ trigger: stableReturnTarget, restoreFocus: true });
      }
    }
    setShowAuthorship((visible) => !visible);
  }, [showAuthorship]);

  const handleBlameLineClick = useCallback(
    (authorId: string | null, trigger: HTMLButtonElement) => {
      cancelPendingMobileRailAction();
      activityRailTriggerRef.current = trigger;
      setMobileRailFocusRequest({ trigger, restoreFocus: true });
      setHistoryAuthorFilter(authorId);
      setIsFocusMode(false);
      setActiveTab('history');
      setRailOpen(true);
      railJumpSequenceRef.current += 1;
      setRailJumpRequest({ id: 'history', requestId: railJumpSequenceRef.current });
      setMobileRailOpen(
        typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
      );
    },
    [cancelPendingMobileRailAction],
  );

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

  // History storage can hydrate in several stages. Filter state follows the document route.
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const requestedAuthor = params.get('historyAuthor');
    const author = requestedAuthor?.trim() ? requestedAuthor : null;
    const time = params.get('historyTime') === 'last-7-days' ? 'last-7-days' : null;
    setHistoryAuthorFilter(author);
    setHistoryTimeFilter(time);
    if (author || time) {
      setActiveTab('history');
      setRailOpen(true);
    }
  }, [activeDocumentId]);

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

  const resolveLegacySuggestion = async (entry: HistoryEntry, decision: SuggestionDecision) => {
    const ticket = mutationAuthority.capture();
    if (
      realtimeEnabled ||
      !editor ||
      documentMutationLocked ||
      editor.view.composing ||
      !mutationAuthority.allowsBodyMutation(ticket)
    )
      return;
    setLegacySuggestionError('');
    const originalDoc = editor.state.doc;
    const history = historyStoreRef.current;
    const unsafe =
      'This older suggestion can no longer be matched to the current document. Its version is available above.';
    try {
      const after = await history.loadAt(historyDocumentId, entry.resultSha);
      const before =
        decision === 'rejected' ? await history.loadAt(historyDocumentId, entry.parentSha) : null;
      if (
        editor.isDestroyed ||
        !mutationAuthority.allowsBodyMutation(ticket) ||
        suggestionResolutionsRef.current.some((record) => record.entryId === entry.id)
      )
        return;
      const currentText = editorText(editor);
      if (
        editor.state.doc !== originalDoc ||
        historyHeadRef.current !== entry.resultSha ||
        !after ||
        typeof after !== 'object' ||
        !('text' in after) ||
        after.text !== currentText
      ) {
        setLegacySuggestionError(unsafe);
        return;
      }
      if (decision === 'rejected') {
        // Older suggestions stored plaintext history. Only a unique insertion can
        // be removed without reconstructing lost formatting or document structure.
        const [operation] = entry.ops;
        if (
          entry.ops.length !== 1 ||
          operation?.op !== 'replace_text' ||
          operation.from !== operation.to ||
          !operation.text ||
          currentText.indexOf(operation.text) !== operation.from ||
          currentText.indexOf(operation.text, operation.from + 1) !== -1 ||
          !before ||
          typeof before !== 'object' ||
          !('text' in before) ||
          typeof before.text !== 'string'
        ) {
          setLegacySuggestionError(unsafe);
          return;
        }
        const projection = projectChatDocumentText(editor);
        const range = projection.toEditorRange({
          from: operation.from,
          to: operation.from + operation.text.length,
        });
        const target = range && readSuggestionRange(originalDoc, range);
        const prepared =
          range && target && prepareSuggestionReplacement(originalDoc, range, target.before, '');
        if (
          !range ||
          !prepared ||
          target?.text !== operation.text ||
          projection.text !== currentText ||
          currentText.slice(0, operation.from) +
            currentText.slice(operation.from + operation.text.length) !==
            before.text
        ) {
          setLegacySuggestionError(unsafe);
          return;
        }
        editor.view.dispatch(editor.state.tr.replace(range.from, range.to, prepared.content));
        if (!editor.state.doc.eq(prepared.doc)) {
          setLegacySuggestionError(unsafe);
          return;
        }
      }
      recordSuggestionResolution(entry, decision);
    } catch {
      setLegacySuggestionError(unsafe);
    }
  };

  const handleRestoreHistoryEntry = useCallback(
    async (entry: HistoryEntry) => {
      if (realtimeEnabled) return;
      const ticket = mutationAuthority.capture();
      if (
        !editor ||
        documentMutationLocked ||
        editor.view.composing ||
        restoringLocalHistoryRef.current ||
        applyingAiPatchRef.current ||
        !mutationAuthority.allowsBodyMutation(ticket)
      ) {
        return;
      }
      const expectedHead = historyHeadRef.current;
      const originalDocument = editor.state.doc;
      const lastBody = historyBodyRef.current;
      if (
        !expectedHead ||
        !lastBody ||
        historyTimerRef.current !== null ||
        canonicalize(lastBody) !== canonicalize(captureHistoryBody(originalDocument))
      ) {
        setHistoryRestoreNotice('Wait for your latest edit to appear in History before restoring.');
        return;
      }
      const storage = browserLocalStorage();
      const expectedBody = localBodyExpectedRef.current;
      const currentBodyMatchesStorage = () => {
        if (!storage || !expectedBody) return false;
        const persisted = loadLocalDocumentBody({
          storage,
          documentId: activeDocumentId,
          validateSchema: validateLocalBodySchema,
        });
        return (
          persisted.state === 'ready' &&
          persisted.expected.revision === expectedBody.revision &&
          persisted.expected.writeId === expectedBody.writeId &&
          canonicalize(persisted.envelope.doc) === canonicalize(lastBody)
        );
      };
      if (!currentBodyMatchesStorage()) {
        setHistoryRestoreNotice(
          'The current document has not been verified as saved. Reload before restoring.',
        );
        return;
      }
      const stillAuthorized = () =>
        !editor.isDestroyed &&
        localBodyMutationsAllowedRef.current &&
        mutationAuthority.allowsBodyMutation(ticket);
      const canCommit = () =>
        stillAuthorized() &&
        editor.state.doc === originalDocument &&
        historyHeadRef.current === expectedHead &&
        currentBodyMatchesStorage();
      const history = historyStoreRef.current;
      restoringLocalHistoryRef.current = true;
      editor.setEditable(false, false);
      setHistoryRestoreNotice('');
      let keepEditingLocked = false;
      try {
        const target = (await history.loadAt(
          historyDocumentId,
          entry.resultSha,
        )) as HistoryDocumentState;
        if (!target.body) {
          setHistoryRestoreNotice(
            'This older version saved text only. You can review it, but its original formatting cannot be restored.',
          );
          return;
        }
        if (!canCommit()) return;
        validateLocalBodySchema(target.body);
        const targetNode = editor.schema.nodeFromJSON(target.body);
        const result = await history.restore(
          historyDocumentId,
          entry.resultSha,
          HISTORY_ACTOR,
          HISTORY_AUDIT,
          {
            commitGuard: canCommit,
          },
        );
        if (!result.ok) {
          if (result.reason === 'history-capacity') {
            historyCapacityReachedRef.current = true;
            setHistoryAvailability('capacity-reached');
          }
          if (result.reason === 'commit-uncertain') {
            keepEditingLocked = true;
            setHistoryAvailability('corrupt');
          }
          setHistoryRestoreNotice(
            'The version could not be restored. Review the latest changes and try again.',
          );
          return;
        }
        keepEditingLocked = true;
        if (!canCommit()) {
          if (stillAuthorized()) {
            setHistoryAvailability('corrupt');
            setHistoryRestoreNotice(
              'The document changed while restoring. Reload to check the saved version.',
            );
          }
          return;
        }
        applyingHistoryRef.current = true;
        try {
          editor.commands.setContent(target.body, false);
        } finally {
          applyingHistoryRef.current = false;
        }
        const saved =
          editor.state.doc.eq(targetNode) &&
          (await markdownAutosaveControllerRef.current?.flushVerified());
        if (!stillAuthorized()) return;
        if (!saved) {
          setHistoryAvailability('corrupt');
          setHistoryRestoreNotice(
            'The version was recorded, but Lash could not verify the document save.',
          );
          return;
        }
        historyTextRef.current = target.text;
        historyBodyRef.current = target.body;
        commitHistoryHead(result.entry.resultSha);
        const entries = await history.list(historyDocumentId);
        if (!stillAuthorized()) return;
        setHistoryEntries(entries);
        setSelectedHistoryEntryId(result.entry.id);
        setBlameLines(blameFor(entries, target.text));
        setHistoryRestoreNotice('Version restored. The previous version is still in History.');
        keepEditingLocked = false;
      } catch {
        if (keepEditingLocked && stillAuthorized()) setHistoryAvailability('corrupt');
        setHistoryRestoreNotice('The version could not be restored.');
      } finally {
        restoringLocalHistoryRef.current = false;
        if (!keepEditingLocked && stillAuthorized()) editor.setEditable(true, false);
      }
    },
    [
      activeDocumentId,
      commitHistoryHead,
      documentMutationLocked,
      editor,
      historyDocumentId,
      mutationAuthority,
      realtimeEnabled,
      validateLocalBodySchema,
    ],
  );

  const handleApplyAiPatch = useCallback(
    async (
      patch: EditPatch,
      selection: AiSelection,
    ): Promise<{ ok: true } | { ok: false; reason: string }> => {
      if (realtimeEnabled) {
        return { ok: false, reason: 'Version history is unavailable in this shared document.' };
      }
      const ticket = mutationAuthority.capture();
      if (
        !editor ||
        !editor.isEditable ||
        documentMutationLocked ||
        historyCapacityReachedRef.current ||
        applyingAiPatchRef.current ||
        patch.docId !== historyDocumentId ||
        patch.schemaVersion !== HISTORY_SCHEMA_VERSION ||
        patch.author.type !== 'ai' ||
        !mutationAuthority.allowsBodyMutation(ticket)
      ) {
        return { ok: false, reason: 'Editing is unavailable right now.' };
      }
      const expectedParentSha = historyHeadRef.current;
      if (
        !expectedParentSha ||
        patch.baseVersion !== expectedParentSha ||
        editorText(editor) !== historyTextRef.current ||
        (historyBodyRef.current &&
          canonicalize(historyBodyRef.current) !==
            canonicalize(captureHistoryBody(editor.state.doc)))
      ) {
        return { ok: false, reason: 'The draft changed. Request a fresh revision.' };
      }

      const prepared = prepareAiReplacement(editor, patch, selection);
      if (!prepared) return { ok: false, reason: 'Select the original passage and try again.' };
      const body = captureHistoryBody(prepared.transaction.doc);
      const canCommit = () =>
        !editor.isDestroyed &&
        localBodyMutationsAllowedRef.current &&
        mutationAuthority.allowsBodyMutation(ticket) &&
        editor.state.doc === selection.document;

      // Keep the captured body stable during the asynchronous history commit.
      // The transaction filter also covers editing commands invoked by buttons.
      applyingAiPatchRef.current = true;
      editor.setEditable(false, false);
      let restoreEditing = true;
      try {
        const historyStore = historyStoreRef.current;
        const result = await historyStore.append(
          {
            docId: historyDocumentId,
            actor: patch.author,
            expectedParentSha,
            schemaVersion: patch.schemaVersion,
            ops: [
              ...patch.operations,
              historyBodySnapshotOp(
                { type: 'doc', text: prepared.after, body },
                historyBodyRef.current ?? undefined,
              ),
            ],
            intent: 'ai',
            audit: AI_AUDIT,
          },
          { commitGuard: canCommit },
        );
        if (!result.ok) {
          if (result.reason === 'history-capacity') {
            historyCapacityReachedRef.current = true;
            setHistoryAvailability('capacity-reached');
          }
          if (result.reason === 'commit-uncertain') {
            restoreEditing = false;
            setHistoryAvailability('corrupt');
          }
          return { ok: false, reason: 'The version could not be saved. Request a fresh revision.' };
        }
        if (!canCommit()) return { ok: false, reason: 'Document access changed.' };

        applyingAiPatchRef.current = false;
        applyingHistoryRef.current = true;
        try {
          editor.view.dispatch(prepared.transaction);
        } finally {
          applyingHistoryRef.current = false;
        }
        if (editorText(editor) !== prepared.after) {
          restoreEditing = false;
          setHistoryAvailability('corrupt');
          return { ok: false, reason: 'The revision could not be saved safely.' };
        }
        historyTextRef.current = prepared.after;
        historyBodyRef.current = body;
        commitHistoryHead(result.entry.resultSha);
        const entries = await historyStore.list(historyDocumentId);
        if (editor.isDestroyed || !mutationAuthority.allowsBodyMutation(ticket)) {
          return { ok: false, reason: 'Document access changed.' };
        }
        setHistoryEntries(entries);
        setSelectedHistoryEntryId(result.entry.id);
        setBlameLines(blameFor(entries, prepared.after));
        return { ok: true };
      } finally {
        applyingAiPatchRef.current = false;
        if (
          restoreEditing &&
          !editor.isDestroyed &&
          localBodyMutationsAllowedRef.current &&
          mutationAuthority.allowsBodyMutation(ticket)
        ) {
          editor.setEditable(true, false);
        }
      }
    },
    [
      commitHistoryHead,
      documentMutationLocked,
      editor,
      historyDocumentId,
      mutationAuthority,
      realtimeEnabled,
    ],
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
      handleFocusModeToggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleFocusModeToggle]);

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

  const hasVerifiedLocalMarkdownSourceReceipt = useCallback(() => {
    if (realtimeEnabled || localBodyState !== 'ready' || !editor) return false;
    const storage = browserLocalStorage();
    const expected = localBodyExpectedRef.current;
    if (!storage || !expected) return false;
    const loaded = loadLocalDocumentBody({
      storage,
      documentId: activeDocumentId,
      validateSchema: validateLocalBodySchema,
    });
    return (
      loaded.state === 'ready' &&
      loaded.expected.revision === expected.revision &&
      loaded.expected.writeId === expected.writeId &&
      JSON.stringify(loaded.envelope.doc) === JSON.stringify(editor.getJSON())
    );
  }, [activeDocumentId, editor, localBodyState, realtimeEnabled, validateLocalBodySchema]);

  const inspectCurrentMarkdownSource = useCallback(
    () =>
      realtimeEnabled
        ? verifyMarkdownImportSourceQuiescence({
            kind: 'remote',
            accessHydrated: accessSnapshot.hydrated,
            providerHydrated: realtimeSnapshot.hydrated,
            syncState: realtimeSnapshot.syncState,
            pendingUpdateCount: realtimeSnapshot.pendingUpdateCount,
            queuedUpdateCount: realtimeSnapshot.queuedUpdateCount,
            readOnly: !canEditDocument,
          })
        : Promise.resolve(
            hasVerifiedLocalMarkdownSourceReceipt()
              ? ({ ok: true } as const)
              : ({
                  ok: false,
                  message:
                    'Finish saving or recover your current document before opening the imported document.',
                } as const),
          ),
    [
      accessSnapshot.hydrated,
      canEditDocument,
      hasVerifiedLocalMarkdownSourceReceipt,
      realtimeEnabled,
      realtimeSnapshot.hydrated,
      realtimeSnapshot.pendingUpdateCount,
      realtimeSnapshot.queuedUpdateCount,
      realtimeSnapshot.syncState,
    ],
  );

  const verifyCurrentMarkdownSource = useCallback(
    () =>
      realtimeEnabled
        ? inspectCurrentMarkdownSource()
        : verifyMarkdownImportSourceQuiescence({
            kind: 'local',
            localBodyState,
            flushVerified: async () =>
              hasVerifiedLocalMarkdownSourceReceipt() ||
              ((await markdownAutosaveControllerRef.current?.flushVerified()) ?? false),
          }),
    [
      hasVerifiedLocalMarkdownSourceReceipt,
      inspectCurrentMarkdownSource,
      localBodyState,
      realtimeEnabled,
    ],
  );

  const handleImportMarkdown = useCallback(
    (trigger: HTMLButtonElement) => {
      if (!canImportMarkdown) return;
      markdownTriggerRef.current = trigger;
      fileInputRef.current?.click();
    },
    [canImportMarkdown],
  );

  const handleMarkdownFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !editor || !canImportMarkdown) return;
      const generation = markdownGenerationRef.current + 1;
      markdownGenerationRef.current = generation;
      setMarkdownDialogState({ kind: 'reading' });
      const result = await readMarkdownFileForImport({
        file,
        generation,
        isGenerationCurrent: () => markdownGenerationRef.current === generation,
        validateSchema: validateLocalBodySchema,
        canonicalizeSchema: canonicalizeLocalBodySchema,
      });
      if (markdownGenerationRef.current !== generation || result.status === 'ignored') return;
      if (result.status === 'error') {
        setMarkdownDialogState({ kind: 'import-error', detail: result.message });
        return;
      }
      setMarkdownDialogState({
        kind: 'import',
        phase: 'preview',
        plan: result.plan,
        sourceReady: false,
      });
      const quiescence = await inspectCurrentMarkdownSource();
      if (markdownGenerationRef.current !== generation) return;
      setMarkdownDialogState({
        kind: 'import',
        phase: 'preview',
        plan: result.plan,
        sourceReady: quiescence.ok,
      });
    },
    [
      canImportMarkdown,
      canonicalizeLocalBodySchema,
      editor,
      inspectCurrentMarkdownSource,
      validateLocalBodySchema,
    ],
  );

  const handleExportMarkdown = useCallback(
    (trigger: HTMLButtonElement) => {
      if (!editor) return;
      markdownTriggerRef.current = trigger;
      setMarkdownDialogState({
        kind: 'download',
        plan: createMarkdownDownloadPlan({
          doc: editor.getJSON(),
          title: docTitle,
          documentId: activeDocumentId,
        }),
      });
    },
    [activeDocumentId, docTitle, editor],
  );

  const closeMarkdownDialog = useCallback(() => {
    markdownGenerationRef.current += 1;
    setMarkdownDialogState(null);
  }, []);

  const confirmMarkdownTransfer = useCallback(async () => {
    const state = markdownDialogState;
    if (!state) return;
    if (state.kind === 'download') {
      if (state.plan.status !== 'ready') return;
      const { filename, markdown } = state.plan;
      (
        window as Window & {
          __lashLastExport?: string;
        }
      ).__lashLastExport = markdown;
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMarkdownDialogState(null);
      window.requestAnimationFrame(() =>
        markdownTriggerRef.current?.focus({ preventScroll: true }),
      );
      return;
    }
    if (state.kind !== 'import' || state.phase !== 'preview' || !state.sourceReady) return;

    const plan = state.plan;
    setMarkdownDialogState({
      kind: 'import',
      phase: 'committing',
      plan,
      sourceReady: true,
    });
    const quiescence = await verifyCurrentMarkdownSource();
    if (!quiescence.ok) {
      setMarkdownDialogState({
        kind: 'import',
        phase: 'preview',
        plan,
        sourceReady: false,
      });
      return;
    }

    const storage = browserLocalStorage();
    if (!storage) {
      setMarkdownDialogState({
        kind: 'import',
        phase: 'commit-failed',
        plan,
        sourceReady: true,
        detail:
          'The document wasn’t created. Your current document is unchanged. Browser storage is unavailable.',
      });
      return;
    }
    const result = commitMarkdownImport({
      storage,
      sourceDocumentId: activeDocumentId,
      plan,
      createDocumentId: createNewDocumentId,
      validateSchema: validateLocalBodySchema,
    });
    if (result.status === 'cleanup-unverified') {
      setMarkdownDialogState({
        kind: 'import',
        phase: 'cleanup-unverified',
        plan,
        sourceReady: true,
        detail: `Import could not finish, and Lash could not verify cleanup. Your current document is unchanged. Recovery ID: ${result.destinationId}.`,
      });
      return;
    }
    if (result.status !== 'committed') {
      setMarkdownDialogState({
        kind: 'import',
        phase: 'commit-failed',
        plan,
        sourceReady: true,
        detail:
          'The document wasn’t created. Your current document is unchanged. Storage or verification failed.',
      });
      return;
    }

    refreshDocuments();
    const destination: MarkdownImportDestination = {
      attemptId:
        typeof window.crypto?.randomUUID === 'function'
          ? window.crypto.randomUUID()
          : `attempt-${result.destination.id}-${Date.now().toString(36)}`,
      ...result.destination,
    };
    const handoffStorage = browserSessionStorage();
    if (handoffStorage) {
      persistMarkdownImportHandoff(
        handoffStorage,
        destination,
        Date.now() + MARKDOWN_IMPORT_NAVIGATION_WATCHDOG_MS,
      );
    }
    markdownNavigationControllerRef.current?.dispose();
    const controller = createMarkdownImportNavigationController({
      push: (targetPath) => {
        navigateDocument(staticPreview ? documentWorkspacePath(destination.id, true) : targetPath);
      },
      onStateChange: (navigationState) => {
        if (navigationState.status === 'created-opening') {
          setMarkdownDialogState({
            kind: 'import',
            phase: 'created-opening',
            plan,
            sourceReady: true,
          });
        } else if (navigationState.status === 'created-open-failed') {
          setMarkdownDialogState({
            kind: 'import',
            phase: 'created-open-failed',
            plan,
            sourceReady: true,
          });
        }
      },
    });
    markdownNavigationControllerRef.current = controller;
    controller.start(destination);
  }, [
    activeDocumentId,
    markdownDialogState,
    navigateDocument,
    refreshDocuments,
    staticPreview,
    validateLocalBodySchema,
    verifyCurrentMarkdownSource,
  ]);

  const retryOpeningImportedDocument = useCallback(() => {
    markdownNavigationControllerRef.current?.retry();
  }, []);

  useEffect(
    () => () => {
      markdownNavigationControllerRef.current?.dispose();
      markdownNavigationControllerRef.current = null;
    },
    [],
  );

  const historyPanelEditor = documentMutationLocked || realtimeEnabled ? null : editor;
  const canStartSuggestion = realtimeEnabled
    ? Boolean(editor && sharedSuggestionsReady && (namedComment || canEditDocument))
    : Boolean(editor && !documentMutationLocked && localBodyState === 'ready');

  const handleStartSuggestion = (trigger: HTMLButtonElement) => {
    if (!editor || editor.isDestroyed || !canStartSuggestion) return;
    openDiscussionPanel(trigger);
    setSuggestionNotice('');
    const { from, to } = editor.state.selection;
    const range = { from, to };
    const target = readSuggestionRange(editor.state.doc, range);
    if (!target || target.text.length > MAX_SUGGESTION_TEXT || target.before.length > 5_000) {
      setSuggestionDraft(null);
      setSuggestionNotice('Select the words you want to replace, then choose Suggest wording.');
      return;
    }
    let anchor: ReviewProposal['anchor'] | null = null;
    if (realtimeEnabled) {
      const documentText = projectChatDocumentText(editor);
      const textRange = documentText.toTextRange(range);
      const relativeRange = captureChatAnchorRange(editor, range);
      if (
        !textRange ||
        !relativeRange ||
        !hasSuggestionEdges(relativeRange) ||
        documentText.text.slice(textRange.from, textRange.to) !== target.text
      ) {
        setSuggestionDraft(null);
        setSuggestionNotice('Select words within one paragraph or heading to start a suggestion.');
        return;
      }
      anchor = {
        ...createAnchor({ baseVersion: null, docText: documentText.text, ...textRange }),
        relativeRange,
      };
    }
    setSuggestionDraft({
      id: crypto.randomUUID(),
      document: editor.state.doc,
      range,
      quote: target.text,
      before: target.before,
      anchor,
    });
  };

  const persistLocalSuggestion = (doc: EditorNode, next: LocalSuggestion[]) => {
    const storage = browserLocalStorage();
    if (!storage) {
      throw new LocalBodyPersistenceError('storage-unavailable', 'Local storage is unavailable.');
    }
    const envelope = saveLocalDocumentBody({
      storage,
      documentId: activeDocumentId,
      doc: projectDocumentHeadingIds(doc).toJSON() as LocalBodyDocJson,
      suggestions: next,
      expected: localBodyExpectedRef.current,
      validateSchema: validateLocalBodySchema,
    });
    localBodyExpectedRef.current = localBodyExpectedRevision(envelope);
    localSuggestionsRef.current = next;
    setLocalSuggestions(next);
    setLocalBodyNotice(null);
  };

  const localSuggestionError = (error: unknown) => {
    if (error instanceof LocalBodyPersistenceError && error.code === 'conflict') {
      setLocalBodyState('conflict');
      setLocalBodyNotice({ kind: 'conflict', detail: error.message });
      return {
        ok: false as const,
        message: 'This draft changed in another tab. Reopen it before making a decision.',
      };
    }
    return { ok: false as const, message: 'Lash could not save this suggestion. Try again.' };
  };

  const postSuggestion = async (replacement: string, note: string) => {
    const draft = suggestionDraft;
    if (
      !draft ||
      !editor ||
      editor.isDestroyed ||
      !canStartSuggestion ||
      !readSuggestionContent({ before: draft.before, replacement })
    ) {
      return {
        ok: false as const,
        message: 'The suggestion is unavailable. Select the words again.',
      };
    }
    if (draft.anchor && chatRealtimeStore) {
      const result = await chatRealtimeStore.submit({
        type: 'propose',
        threadId: draft.id,
        anchor: draft.anchor,
        before: draft.before,
        replacement,
        body: note,
      });
      if (!result.ok) return result;
    } else {
      const ticket = mutationAuthority.capture();
      if (
        realtimeEnabled ||
        !mutationAuthority.allowsBodyMutation(ticket) ||
        editor.state.doc !== draft.document ||
        !localBodyMutationsAllowedRef.current
      ) {
        return { ok: false as const, message: 'The document changed. Select the words again.' };
      }
      if (localSuggestionsRef.current.length >= MAX_LOCAL_SUGGESTIONS) {
        return { ok: false as const, message: 'This draft has reached its suggestion limit.' };
      }
      if (!prepareSuggestionReplacement(editor.state.doc, draft.range, draft.before, replacement)) {
        return { ok: false as const, message: 'Change the proposed wording before posting.' };
      }
      try {
        persistLocalSuggestion(editor.state.doc, [
          ...localSuggestionsRef.current,
          {
            id: draft.id,
            quote: draft.quote,
            before: draft.before,
            replacement,
            note: note.trim(),
            range: draft.range,
            createdAt: new Date().toISOString(),
          },
        ]);
      } catch (error) {
        return localSuggestionError(error);
      }
    }
    setSuggestionDraft((current) => (current?.id === draft.id ? null : current));
    setSuggestionNotice('Suggestion posted.');
    return { ok: true as const };
  };

  const decideLocalSuggestion = (id: string, decision: SuggestionDecision) => {
    const ticket = mutationAuthority.capture();
    if (
      !editor ||
      editor.isDestroyed ||
      realtimeEnabled ||
      !canStartSuggestion ||
      !mutationAuthority.allowsBodyMutation(ticket) ||
      !localBodyMutationsAllowedRef.current ||
      editor.view.composing ||
      applyingAiPatchRef.current
    ) {
      return {
        ok: false as const,
        message: 'Suggestions are temporarily unavailable in this draft.',
      };
    }
    const current = localSuggestionsRef.current;
    const proposal = current.find((suggestion) => suggestion.id === id);
    if (!proposal || proposal.decision) {
      return {
        ok: false as const,
        message: 'A decision has already been recorded for this suggestion.',
      };
    }
    try {
      let transaction = null;
      if (decision === 'accepted') {
        const range = proposal.range;
        const prepared =
          range &&
          prepareSuggestionReplacement(
            editor.state.doc,
            range,
            proposal.before,
            proposal.replacement,
          );
        if (!range || !prepared) {
          return {
            ok: false as const,
            message: 'The selected text changed. Make a new suggestion.',
          };
        }
        transaction = editor.state.tr.replace(range.from, range.to, prepared.content);
        if (!transaction.doc.eq(prepared.doc)) {
          return {
            ok: false as const,
            message: 'The selected text changed. Make a new suggestion.',
          };
        }
      }
      const status = { action: decision, at: new Date().toISOString() };
      const updated = current.map((suggestion) =>
        suggestion.id === id ? { ...suggestion, decision: status } : suggestion,
      );
      const mapped = transaction ? mapLocalSuggestions(updated, transaction) : updated;
      persistLocalSuggestion(transaction?.doc ?? editor.state.doc, mapped);
      if (transaction) {
        // The proposal records already use the committed transaction's mapped positions.
        transaction.setMeta('local-suggestion-committed', true);
        editor.view.dispatch(transaction);
      }
      return { ok: true as const };
    } catch (error) {
      return localSuggestionError(error);
    }
  };

  const unresolvedSuggestionCount = useMemo(() => {
    const resolved = new Set(suggestionResolutions.map((record) => record.entryId));
    return (
      historyEntries.filter((entry) => entry.intent === 'suggest' && !resolved.has(entry.id))
        .length + localSuggestions.filter((suggestion) => !suggestion.decision).length
    );
  }, [historyEntries, localSuggestions, suggestionResolutions]);
  const signInHref = `/auth/sign-in?next=${encodeURIComponent(documentPath(activeDocumentId))}`;
  const ownerBacked =
    realtimeEnabled &&
    accessSnapshot.phase === 'remote-ready' &&
    accessSnapshot.authoritativeOwner &&
    accessSnapshot.hydrated;

  useEffect(() => {
    if (!ownerBacked || !shareDialogOpen) {
      setPublicAccessState(null);
      return;
    }
    const abort = new AbortController();
    void readPublicAccessState({
      localDocumentId: activeDocumentId,
      expectedOrigin: window.location.origin,
      signal: abort.signal,
    }).then((result) => {
      if (!abort.signal.aborted && result.ok) setPublicAccessState(result.state);
    });
    return () => abort.abort();
  }, [activeDocumentId, ownerBacked, shareDialogOpen]);

  useEffect(() => {
    if (!shareDialogOpen || staticPreview) return;
    if (ownerBacked) {
      setOwnerSharePhase('saved');
      setOwnerShareDetail('');
      return;
    }

    const abortController = new AbortController();
    setOwnerSharePhase('checking-account');
    setOwnerShareDetail('');
    void fetch('/api/account/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: abortController.signal,
    })
      .then((response) => {
        if (abortController.signal.aborted) return;
        if (
          response.status === 204 &&
          response.headers.get('x-lash-account-status') === 'authenticated'
        ) {
          setOwnerSharePhase('ready');
          return;
        }
        if (response.status === 401) {
          setOwnerSharePhase('signed-out');
          return;
        }
        setOwnerSharePhase('unavailable');
      })
      .catch((error: unknown) => {
        if (
          abortController.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }
        setOwnerSharePhase('unavailable');
      });
    return () => abortController.abort();
  }, [ownerBacked, shareDialogOpen, staticPreview]);

  const closeOwnerShareDialog = useCallback(() => {
    if (ownerSharePhase === 'saving') return;
    setShareDialogOpen(false);
    if (ownerSharePhase !== 'retryable') promotionAttemptRef.current = null;
    const trigger = shareTriggerRef.current;
    window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
  }, [ownerSharePhase]);

  const handleOwnerPromotion = useCallback(async () => {
    if (staticPreview || !editor || ownerSharePhase === 'saving' || ownerBacked) return;
    if (typeof window === 'undefined' || !window.crypto?.subtle) {
      setOwnerSharePhase('unavailable');
      setOwnerShareDetail(
        'Secure account saving is unavailable in this browser. Your document is still on this device.',
      );
      return;
    }

    promotionAttemptRef.current ??= createBrowserDocumentPromotionAttempt(
      {
        adjuncts: {
          comments: commentThreadCount,
          suggestions: unresolvedSuggestionCount,
        },
        body: editor.getJSON(),
        localDocumentId: activeDocumentId,
        title: docTitle,
      },
      window.crypto,
    );
    const attempt = promotionAttemptRef.current;
    setOwnerSharePhase('saving');
    setOwnerShareDetail('');
    const result = await inviteIssuanceAuthority.promoteOwnerDocument(attempt);
    if (result.ok) {
      promotionAttemptRef.current = null;
      setOwnerSharePhase('saved');
      return;
    }
    if (result.reason === 'promotion-failed') {
      const promotion = result.promotion;
      if (promotion.reason === 'adjuncts-present') {
        promotionAttemptRef.current = null;
        setOwnerSharePhase('blocked');
        return;
      }
      if (promotion.reason === 'server-rejected' && promotion.error === 'unauthorized') {
        promotionAttemptRef.current = null;
        setOwnerSharePhase('signed-out');
        return;
      }
    }
    if (result.retryable) {
      setOwnerShareDetail(
        result.reason === 'promotion-failed'
          ? 'Lash could not reach account storage. Your document is still on this device.'
          : 'Your document was saved, but Lash could not reconnect to it. Try again to finish opening the account copy.',
      );
      setOwnerSharePhase('retryable');
      return;
    }
    promotionAttemptRef.current = null;
    setOwnerSharePhase('unavailable');
  }, [
    activeDocumentId,
    commentThreadCount,
    docTitle,
    editor,
    inviteIssuanceAuthority,
    ownerBacked,
    ownerSharePhase,
    staticPreview,
    unresolvedSuggestionCount,
  ]);
  const syntheticMentionFixtureEnabled =
    typeof window !== 'undefined' &&
    canMountSyntheticMentionFixture({
      access: accessSnapshot,
      documentId: activeDocumentId,
      marker: (
        window as Window & {
          __lashMentionFixture?: unknown;
        }
      ).__lashMentionFixture,
      runtime: resolution.runtime,
      testHooksEnabled: exposeTestHooks,
    });

  useEffect(() => {
    if (!syntheticMentionFixtureEnabled && activeTab === 'activity') {
      setActiveTab('chat');
    }
  }, [activeTab, syntheticMentionFixtureEnabled]);

  const syntheticAiFixtureEnabled =
    process.env.NEXT_PUBLIC_LASH_TEST_HOOKS === 'true' &&
    typeof window !== 'undefined' &&
    (window as Window & { __lashAiFixture?: boolean }).__lashAiFixture === true;

  const railTabs: RailTabConfig[] = [
    {
      id: 'chat',
      label: 'Chat',
      icon: 'message',
      content: (
        <LiveEditorText editor={activeTab === 'chat' ? editor : null}>
          {(currentText) => (
            <ChatPanel
              editor={editor}
              docId={historyDocumentId}
              baseVersion={realtimeEnabled ? null : historyHead}
              currentText={currentText}
              open={activeTab === 'chat'}
              showTestAiReply={!namedComment && syntheticAiFixtureEnabled}
              mutationEnabled={namedComment || !documentMutationLocked}
              statusChangesEnabled={!namedComment}
              mutationUnavailableReason={
                !namedComment && (inviteScope === 'comment' || inviteScope === 'suggest')
                  ? `${inviteScope === 'comment' ? 'Comment' : 'Suggest'} access is read-only in this runtime. Existing threads remain available to read and navigate.`
                  : undefined
              }
              realtimeStore={chatRealtimeStore}
              actorId={realtimeEnabled ? realtimeSnapshot.actorId : undefined}
              runDocumentMutation={runDocumentMetadataMutation}
              requestDocumentNavigation={handleChatDocumentNavigation}
              onThreadCountChange={setCommentThreadCount}
              suggestionComposer={
                <>
                  {suggestionNotice ? <p role="status">{suggestionNotice}</p> : null}
                  {suggestionDraft ? (
                    <SuggestionComposer
                      key={suggestionDraft.id}
                      quote={suggestionDraft.quote}
                      onCancel={() => {
                        setSuggestionDraft(null);
                        setSuggestionNotice('');
                      }}
                      onSubmit={postSuggestion}
                    />
                  ) : null}
                  {localSuggestions.map((proposal) => (
                    <article className="chat-thread" key={proposal.id}>
                      <SuggestionCard
                        author="You"
                        createdAt={proposal.createdAt}
                        quote={proposal.quote}
                        replacement={proposal.replacement}
                        status={proposal.decision?.action ?? 'pending'}
                        stale={proposal.range === null}
                        onDecide={
                          canStartSuggestion
                            ? (decision) => decideLocalSuggestion(proposal.id, decision)
                            : undefined
                        }
                      />
                      {proposal.note ? <p>{proposal.note}</p> : null}
                    </article>
                  ))}
                </>
              }
              renderSuggestion={(thread, stale) =>
                thread.proposal ? (
                  <SuggestionCard
                    author={
                      thread.proposal.actorId === realtimeSnapshot.actorId ? 'You' : 'Collaborator'
                    }
                    createdAt={thread.proposal.createdAt}
                    quote={namedComment && stale ? '' : thread.anchor.token.text}
                    replacement={thread.proposal.replacement}
                    status={thread.proposal.status}
                    stale={stale}
                    onDecide={
                      canEditDocument && chatRealtimeStore && sharedSuggestionsReady
                        ? (decision) =>
                            chatRealtimeStore.submit({
                              type: 'decide',
                              threadId: thread.id,
                              decision,
                            })
                        : undefined
                    }
                  />
                ) : null
              }
            />
          )}
        </LiveEditorText>
      ),
    },
    {
      id: 'history',
      label: 'History',
      icon: 'history',
      badge: historyEntries.length || undefined,
      content: realtimeProvider?.hasSharedHistory() ? (
        <SharedHistoryPanel
          client={realtimeProvider.sharedHistory}
          open={activeTab === 'history'}
          connected={realtimeSnapshot.hydrated && realtimeSnapshot.connectionState === 'connected'}
          canSendRestore={
            ownerBacked && !documentMutationLocked && realtimeSnapshot.syncState === 'saved'
          }
        />
      ) : (
        <HistoryPanel
          editor={historyPanelEditor}
          entries={historyEntries}
          open={activeTab === 'history'}
          selectedEntryId={selectedHistoryEntryId}
          authorFilter={historyAuthorFilter}
          timeFilter={historyTimeFilter}
          acceptedSuggestionIds={acceptedSuggestionIds}
          suggestionResolutions={[
            ...suggestionResolutions,
            ...localSuggestions.flatMap((proposal) =>
              proposal.decision
                ? [
                    {
                      id: proposal.id,
                      entryId: proposal.id,
                      action: proposal.decision.action,
                      ts: proposal.decision.at,
                      actorId: HISTORY_ACTOR.id,
                    },
                  ]
                : [],
            ),
          ]}
          legacySuggestionError={legacySuggestionError}
          restoreNotice={historyRestoreNotice}
          loadDiff={loadHistoryDiff}
          availability={historyAvailability}
          canRestore={
            !realtimeEnabled &&
            historyAvailability === 'ready' &&
            !documentMutationLocked &&
            Boolean(editor)
          }
          authorshipVisible={showAuthorship}
          onSelect={handleSelectHistoryEntry}
          onRestore={handleRestoreHistoryEntry}
          onToggleAuthorship={handleToggleAuthorship}
          onSetAuthorFilter={setHistoryAuthorFilter}
          onClearAuthorFilter={() => setHistoryAuthorFilter(null)}
          onSetTimeFilter={setHistoryTimeFilter}
          onCopyFilterLink={handleCopyHistoryFilterLink}
          onAcceptSuggestion={(entry) => void resolveLegacySuggestion(entry, 'accepted')}
          onRejectSuggestion={(entry) => void resolveLegacySuggestion(entry, 'rejected')}
        />
      ),
    },
    {
      id: 'ai',
      label: 'AI',
      icon: 'sparkles',
      content: (
        <LiveEditorText editor={activeTab === 'ai' ? editor : null}>
          {(currentText) => (
            <AIPanel
              editor={documentMutationLocked ? null : editor}
              docId={historyDocumentId}
              baseVersion={historyHead}
              currentText={currentText}
              schemaVersion={HISTORY_SCHEMA_VERSION}
              open={activeTab === 'ai'}
              revisionFocusRequest={
                railJumpRequest?.id === 'ai' ? railJumpRequest.requestId : undefined
              }
              showTestControls={syntheticAiFixtureEnabled}
              onApplyPatch={handleApplyAiPatch}
            />
          )}
        </LiveEditorText>
      ),
    },
    ...(runtimeMode === 'development-loopback'
      ? ([
          {
            id: 'share',
            label: 'Share',
            icon: 'share',
            content: (
              <SharePanel
                editor={editor}
                docId={historyDocumentId}
                accessScope={inviteScope}
                allowsInviteIssuance={inviteIssuanceAuthority.allowsInviteIssuance.bind(
                  inviteIssuanceAuthority,
                )}
                authorized={accessSnapshot.authorized}
                hydrated={accessSnapshot.hydrated}
                canIssueInvites={accessSnapshot.canIssueInvites}
                canMutateDocument={canEditDocument}
                captureInviteIssuance={inviteIssuanceAuthority.captureInviteIssuance.bind(
                  inviteIssuanceAuthority,
                )}
                runtimeMode={runtimeMode}
                exposeInviteTestHook={exposeTestHooks}
              />
            ),
          },
        ] satisfies RailTabConfig[])
      : []),
    ...(syntheticMentionFixtureEnabled
      ? ([
          {
            id: 'activity',
            label: 'Activity (test fixture)',
            icon: 'cloud',
            content: (
              <section
                aria-label="Synthetic mention test fixture"
                data-testid="synthetic-mention-fixture"
              >
                <p>Test fixture: synthetic mention identities, not real collaborators.</p>
                <Suspense fallback={<p>Loading mention fixture…</p>}>
                  <LiveEditorText editor={documentMutationLocked ? null : editor}>
                    {(currentText) => (
                      <SyntheticMentionPanel
                        editor={documentMutationLocked ? null : editor}
                        currentText={currentText}
                      />
                    )}
                  </LiveEditorText>
                </Suspense>
              </section>
            ),
          },
        ] satisfies RailTabConfig[])
      : []),
  ];

  const handleCreateDocument = useCallback(() => {
    const nextDocumentId = createNewDocumentId();
    const storage = browserLocalStorage();
    if (storage) {
      upsertDocument(storage, { id: nextDocumentId, title: DEFAULT_DOC_TITLE });
      refreshDocuments();
    }
    navigateDocument(documentWorkspacePath(nextDocumentId, staticPreview));
  }, [navigateDocument, refreshDocuments, staticPreview]);

  const handleOpenDocument = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      navigateDocument(event.target.value);
    },
    [navigateDocument],
  );

  const documentOptions = documents.some((record) => record.id === activeDocumentId)
    ? documents.map((record) =>
        record.id === activeDocumentId
          ? { ...record, title: docTitle.trim() || DEFAULT_DOC_TITLE }
          : record,
      )
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
        value={documentWorkspacePath(activeDocumentId, staticPreview)}
      >
        {documentOptions.map((record) => (
          <option key={record.id} value={documentWorkspacePath(record.id, staticPreview)}>
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

  const openSharePanel = useCallback(
    (trigger?: HTMLElement | null) => {
      cancelPendingMobileRailAction();
      if (runtimeMode !== 'development-loopback') {
        shareTriggerRef.current = trigger ?? null;
        setShareDialogOpen(true);
        return;
      }
      activityRailTriggerRef.current = trigger ?? null;
      if (trigger) {
        setMobileRailFocusRequest({ trigger, restoreFocus: true });
      }
      setActiveTab('share');
      setRailOpen(true);
      railJumpSequenceRef.current += 1;
      setRailJumpRequest({ id: 'share', requestId: railJumpSequenceRef.current });
      // On narrow widths the rail is a slide-in drawer.
      if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
        setMobileRailOpen(true);
      } else {
        setMobileRailOpen(false);
      }
    },
    [cancelPendingMobileRailAction, runtimeMode],
  );

  const handleShareClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      openSharePanel(event.currentTarget);
    },
    [openSharePanel],
  );

  const handleDocumentSettingsClick = useCallback(
    (trigger: HTMLButtonElement) => {
      cancelPendingMobileRailAction();
      documentSettingsTriggerRef.current = trigger;
      setDocumentSettingsAnnouncement('');
      setDocumentSettingsOpen(true);
    },
    [cancelPendingMobileRailAction],
  );

  const handleRealtimeRetry = useCallback(() => {
    realtimeProvider?.reconnectNow();
  }, [realtimeProvider]);

  const remoteAccessEstablished = realtimeEnabled && accessSnapshot.authorized;
  const realtimeClaimsReady = remoteAccessEstablished && accessSnapshot.hydrated;
  const canShowInviteShortcut =
    runtimeMode === 'development-loopback' &&
    realtimeClaimsReady &&
    accessSnapshot.canIssueInvites &&
    accessSnapshot.authoritativeOwner;
  const remotePeers = realtimeClaimsReady ? realtimeSnapshot.peers : [];
  const realtimeLabel = realtimeSyncLabelForAccess({
    canWrite: canEditDocument,
    scope: inviteScope,
    syncState: realtimeSnapshot.syncState,
  });
  const realtimeDisplayState =
    realtimeClaimsReady && !canEditDocument ? 'read-only' : realtimeSnapshot.syncState;
  const realtimeVisibleLabel =
    !canEditDocument &&
    (realtimeSnapshot.syncState === 'saved' || realtimeSnapshot.syncState === 'syncing')
      ? 'Read only'
      : realtimeLabel;
  const handleMarkdownAutosaveControllerChange = useCallback(
    (controller: AutosaveFlushController | null) => {
      markdownAutosaveControllerRef.current = controller;
    },
    [],
  );
  const showRealtimeRetry =
    remoteAccessEstablished &&
    (realtimeSnapshot.syncState === 'reconnecting' || realtimeSnapshot.syncState === 'offline');
  const sharedAccessLabel = namedMember
    ? namedComment
      ? 'Can comment'
      : 'Can edit'
    : inviteScope
      ? `${inviteScope.charAt(0).toUpperCase()}${inviteScope.slice(1)} access`
      : 'Owner access';
  const renderDocumentStatus = () => (
    <div
      className="lash-document-status lash-realtime-presence"
      role="group"
      aria-label="Document status"
      data-testid="realtime-presence-bar"
      data-enabled={remoteAccessEstablished ? 'true' : 'false'}
    >
      {remoteAccessEstablished ? (
        <>
          <span className="lash-document-status-item">
            {runtimeMode === 'development-loopback'
              ? 'Development session'
              : accessSnapshot.authoritativeOwner
                ? 'Saved to your account'
                : 'Shared'}
          </span>
          <span className="lash-document-status-item" data-testid="invite-access-status">
            {accessSnapshot.authoritativeOwner ? 'Owner access' : sharedAccessLabel}
          </span>
          <span
            className="lash-realtime-sync-state lash-document-status-item"
            data-testid="realtime-sync-state"
            data-state={realtimeDisplayState}
            aria-hidden="true"
          >
            {realtimeVisibleLabel}
          </span>
          <span className="sr-only" data-testid="sync-feedback" aria-live="polite">
            {realtimeLabel}
          </span>
        </>
      ) : (
        <>
          <span className="lash-document-status-item" data-testid="invite-access-status">
            On this device
          </span>
          {!realtimeEnabled && localBodyState === 'ready' ? (
            <AutosaveIndicator
              editor={editor}
              onSave={handleLocalBodySave}
              onControllerChange={handleMarkdownAutosaveControllerChange}
            />
          ) : null}
          {historyAvailability === 'capacity-reached' ? (
            <span className="lash-document-status-item" role="status">
              Version history is full
            </span>
          ) : null}
        </>
      )}
      {showRealtimeRetry ? (
        <button
          type="button"
          className="lash-sync-retry-button lash-document-status-item"
          data-testid="sync-retry-button"
          onClick={handleRealtimeRetry}
        >
          Retry
        </button>
      ) : null}
      {canShowInviteShortcut ? (
        <button
          type="button"
          className="lash-collaboration-share-shortcut lash-document-status-item"
          data-testid="collaboration-share-shortcut"
          aria-label="Invite collaborator"
          onClick={(event) => openSharePanel(event.currentTarget)}
        >
          Invite
        </button>
      ) : null}
      {remotePeers.length ? (
        <div
          className="lash-realtime-peers lash-document-status-item"
          aria-label="Collaborators online"
        >
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
      ) : null}
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

  const handleOpenMobileSidebar = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      cancelPendingMobileRailAction();
      mobileSidebarTriggerRef.current = event.currentTarget;
      setMobileSidebarOpen(true);
    },
    [cancelPendingMobileRailAction],
  );

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
    // Return focus to the trigger so AT users don't get dumped at the
    // document root after the drawer closes.
    mobileSidebarTriggerRef.current?.focus();
  }, []);
  const handleDocTitleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (documentMutationLocked) return;
      const nextTitle = event.target.value;
      if (realtimeDoc) {
        const ticket = mutationAuthority.capture();
        mutationAuthority.runDocumentMetadataMutation(ticket, realtimeDoc, () => {
          writeRealtimeDocumentTitle(realtimeDoc, nextTitle);
        });
        return;
      }
      runDocumentMetadataMutation(() => {
        setDocTitle(nextTitle);
        const storage = browserLocalStorage();
        if (storage) {
          saveDocumentTitle(storage, activeDocumentId, nextTitle);
          refreshDocuments();
        }
      });
    },
    [
      activeDocumentId,
      documentMutationLocked,
      mutationAuthority,
      realtimeDoc,
      refreshDocuments,
      runDocumentMetadataMutation,
    ],
  );

  const handleDocTitleBlur = useCallback(() => {
    if (documentMutationLocked) return;
    const normalizedTitle = docTitle.trim() || DEFAULT_DOC_TITLE;
    if (realtimeDoc) {
      const ticket = mutationAuthority.capture();
      mutationAuthority.runDocumentMetadataMutation(ticket, realtimeDoc, () => {
        writeRealtimeDocumentTitle(realtimeDoc, normalizedTitle);
      });
      return;
    }
    runDocumentMetadataMutation(() => {
      const storage = browserLocalStorage();
      const persistedTitle = storage
        ? saveDocumentTitle(storage, activeDocumentId, docTitle)
        : normalizedTitle;
      refreshDocuments();
      setDocTitle(persistedTitle);
    });
  }, [
    activeDocumentId,
    docTitle,
    documentMutationLocked,
    mutationAuthority,
    realtimeDoc,
    refreshDocuments,
    runDocumentMetadataMutation,
  ]);

  const handleLocalBodySave = useCallback(
    ({ docJson, savedAt }: AutosaveSaveContext) => {
      if (realtimeEnabled) {
        throw new Error('Local body persistence cannot run while realtime is authoritative.');
      }
      try {
        const storage = browserLocalStorage();
        if (!storage) {
          throw new LocalBodyPersistenceError(
            'storage-unavailable',
            'Browser local storage could not be acquired.',
          );
        }
        const envelope = saveLocalDocumentBody({
          storage,
          documentId: activeDocumentId,
          doc: docJson,
          expected: localBodyExpectedRef.current,
          savedAt,
          suggestions: localSuggestionsRef.current,
          validateSchema: validateLocalBodySchema,
        });
        localBodyExpectedRef.current = localBodyExpectedRevision(envelope);
        setDocuments(
          upsertDocument(storage, {
            id: activeDocumentId,
            title: docTitle.trim() || DEFAULT_DOC_TITLE,
          }),
        );
        setLocalBodyNotice(null);
      } catch (error) {
        if (error instanceof LocalBodyPersistenceError && error.code === 'conflict') {
          setLocalBodyState('conflict');
          setLocalBodyNotice({ kind: 'conflict', detail: error.message });
        } else {
          setLocalBodyNotice({
            kind: 'save-error',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    },
    [activeDocumentId, docTitle, realtimeEnabled, validateLocalBodySchema],
  );

  const handleKeepRecoveredCopy = useCallback(() => {
    const recovered = recoveredLocalBodyRef.current;
    if (!editor || !recovered || realtimeEnabled) return;

    try {
      const storage = browserLocalStorage();
      if (!storage) {
        throw new LocalBodyPersistenceError(
          'storage-unavailable',
          'Browser local storage could not be acquired.',
        );
      }
      const promoted = promoteRecoveredLocalDocumentBody({
        storage,
        documentId: activeDocumentId,
        recovered: {
          ...recovered.envelope,
          doc: editor.getJSON(),
        },
        recoveryToken: recovered.recoveryToken,
        validateSchema: validateLocalBodySchema,
      });
      localBodyExpectedRef.current = localBodyExpectedRevision(promoted);
      recoveredLocalBodyRef.current = null;
      localBodyMutationsAllowedRef.current = true;
      if (canEditDocument) localRecoveryFocusDocumentRef.current = activeDocumentId;
      setLocalBodyState('ready');
      setLocalBodyNotice(null);
      try {
        setDocuments(
          upsertDocument(storage, {
            id: activeDocumentId,
            title: docTitle.trim() || DEFAULT_DOC_TITLE,
          }),
        );
      } catch (error) {
        setLocalBodyNotice({
          kind: 'save-error',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      if (error instanceof LocalBodyPersistenceError && error.code === 'conflict') {
        // A newer primary appeared while the recovered backup was awaiting
        // confirmation. Keep this recovery draft transaction-locked and offer
        // reload; do not advertise an editable state while the guard is closed.
        setLocalBodyState('recovered-awaiting-confirmation');
        setLocalBodyNotice({ kind: 'conflict', detail: error.message });
        return;
      }
      localBodyMutationsAllowedRef.current = false;
      editor.setEditable(false);
      setLocalBodyState('recovered-awaiting-confirmation');
      setLocalBodyNotice({
        kind: 'recovery-error',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    activeDocumentId,
    canEditDocument,
    docTitle,
    editor,
    realtimeEnabled,
    validateLocalBodySchema,
  ]);

  useEffect(() => {
    if (realtimeEnabled || localBodyState !== 'ready') return;
    const primaryKey = localDocumentBodyKey(activeDocumentId);
    const handleBodyStorage = (event: StorageEvent) => {
      if (event.key !== primaryKey) return;
      const storage = browserLocalStorage();
      if (!storage) {
        setLocalBodyState('unavailable');
        setLocalBodyNotice({ kind: 'unavailable' });
        return;
      }
      const next = loadLocalDocumentBody({
        storage,
        documentId: activeDocumentId,
        validateSchema: validateLocalBodySchema,
      });
      const expected = localBodyExpectedRef.current;
      const stillCurrent =
        next.state === 'ready' &&
        expected !== null &&
        next.expected.revision === expected.revision &&
        next.expected.writeId === expected.writeId;
      const stillEmpty = next.state === 'empty' && expected === null;
      if (stillCurrent || stillEmpty) return;
      setLocalBodyState('conflict');
      setLocalBodyNotice({ kind: 'conflict' });
    };
    window.addEventListener('storage', handleBodyStorage);
    return () => window.removeEventListener('storage', handleBodyStorage);
  }, [activeDocumentId, localBodyState, realtimeEnabled, validateLocalBodySchema]);

  useEffect(() => {
    if (realtimeEnabled || localBodyState !== 'ready') return;
    const expected = localBodyExpectedRef.current;
    const documentStorage = browserLocalStorage();
    const handoffStorage = browserSessionStorage();
    if (!expected || !documentStorage || !handoffStorage) return;
    const acknowledgement = acknowledgeMarkdownImportDestination({
      handoffStorage,
      documentStorage,
      pathname: staticPreview && pathname === '/' ? documentPath(activeDocumentId) : pathname,
      documentId: activeDocumentId,
      title: docTitle,
      bodyRevision: expected.revision,
      bodyWriteId: expected.writeId,
      validateSchema: validateLocalBodySchema,
    });
    if (acknowledgement) {
      setMarkdownAnnouncement('Imported document opened.');
    }
  }, [
    activeDocumentId,
    docTitle,
    localBodyState,
    pathname,
    realtimeEnabled,
    staticPreview,
    validateLocalBodySchema,
  ]);

  const topBar = (
    <TopBar
      focusMode={isFocusMode}
      suggestionAvailable={canStartSuggestion}
      mobileSidebarExpanded={mobileSidebarOpen}
      mobileDiscussionVisible
      discussionExpanded={
        isMobileRailViewport
          ? mobileRailOpen && ['chat', 'history', 'ai'].includes(activeTab)
          : railOpen && ['chat', 'history', 'ai'].includes(activeTab)
      }
      shareExpanded={
        runtimeMode === 'development-loopback'
          ? isMobileRailViewport
            ? mobileRailOpen && activeTab === 'share'
            : railOpen && activeTab === 'share'
          : shareDialogOpen
      }
      settingsExpanded={documentSettingsOpen}
      shareControlsPresent={railOpen}
      shareControlsId={
        runtimeMode === 'development-loopback' ? 'lash-rail' : 'lash-owner-share-dialog'
      }
      shareHasPopup={runtimeMode === 'development-loopback' ? undefined : 'dialog'}
      onToggleFocusMode={handleFocusModeToggle}
      onStartSuggestion={handleStartSuggestion}
      onDiscussionClick={handleDiscussionClick}
      onShareClick={namedMember ? undefined : handleShareClick}
      onSettingsClick={namedMember ? undefined : handleDocumentSettingsClick}
      onOpenMobileSidebar={handleOpenMobileSidebar}
      extras={namedComment ? undefined : documentControls}
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

  const hasAttributedBlame = blameLines.some((line) => line.authorId !== null);

  const rail = (
    <RightRail
      active={activeTab}
      onChange={setActiveTab}
      tabs={namedComment ? railTabs.filter(({ id }) => id === 'chat') : railTabs}
      jumpRequest={railJumpRequest}
      onClose={closeActivityRail}
    />
  );

  return (
    <>
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
          mobileRailFocusRequest={mobileRailFocusRequest}
          onMobileSidebarClose={closeMobileSidebar}
          onMobileRailClose={closeActivityRail}
        >
          <EditorToolbar
            editor={editor}
            groups={TOOLBAR_META}
            hidden={isFocusMode || namedComment}
            disabled={documentMutationLocked}
            onClick={handleToolbarClick}
            trailing={
              <MarkdownIO
                fileInputRef={fileInputRef}
                onImportClick={handleImportMarkdown}
                onExportClick={handleExportMarkdown}
                onFileChange={handleMarkdownFileChange}
                importDisabled={!canImportMarkdown}
                exportDisabled={!isEditorReady}
              />
            }
          />

          <div className="lash-doc-wrap">
            <div className="lash-doc-layout">
              <article className="lash-doc-paper" aria-labelledby="lash-doc-title-text">
                {editor &&
                historyHead &&
                historyAvailability === 'ready' &&
                !documentMutationLocked &&
                !realtimeEnabled &&
                !isFocusMode ? (
                  <ContextualRevision
                    editor={editor}
                    onRevise={(trigger) => openDiscussionPanel(trigger, 'ai')}
                  />
                ) : null}
                <header className="lash-doc-header">
                  <input
                    aria-label="Document title"
                    className="lash-doc-title lash-doc-title-input"
                    data-testid="lash-doc-title-input"
                    disabled={!namedComment && documentMutationLocked}
                    id="lash-doc-title-text"
                    onBlur={handleDocTitleBlur}
                    onChange={handleDocTitleChange}
                    readOnly={namedComment}
                    type="text"
                    value={docTitle}
                  />
                  {renderDocumentStatus()}
                </header>

                {!realtimeEnabled && localBodyNotice ? (
                  <LocalBodyRecoveryNotice
                    notice={localBodyNotice}
                    onKeepRecoveredCopy={
                      localBodyNotice.kind === 'recovered' ||
                      localBodyNotice.kind === 'recovery-error'
                        ? handleKeepRecoveredCopy
                        : undefined
                    }
                    onReloadNewerCopy={
                      localBodyNotice.kind === 'conflict'
                        ? () => window.location.reload()
                        : undefined
                    }
                  />
                ) : null}

                {isEditorReady && !documentMutationLocked && activeTableCell && !isFocusMode ? (
                  <TableCellPanel
                    active={activeTableCell}
                    onSetCellType={handleSetTableCellType}
                    onSetValue={handleSetTableCellValue}
                    onCycle={handleCycleTableCellOption}
                  />
                ) : null}

                <div
                  className="lash-editor-content-wrapper"
                  role="region"
                  aria-label="Writing canvas"
                  data-body-mutation-locked={documentMutationLocked ? 'true' : 'false'}
                >
                  {remoteCursorMarkers.length ? (
                    <div className="lash-remote-cursor-layer" aria-hidden="true">
                      {remoteCursorMarkers}
                    </div>
                  ) : null}
                  {!isMounted || !isEditorReady ? (
                    <div className="editor-loading">Preparing your editor…</div>
                  ) : (
                    <div
                      className="lash-editor-with-blame"
                      data-blame-on={showAuthorship ? 'true' : 'false'}
                    >
                      <div
                        className="lash-blame-gutter"
                        data-testid="blame-gutter"
                        aria-hidden={showAuthorship && hasAttributedBlame ? undefined : true}
                        aria-label={
                          showAuthorship && hasAttributedBlame ? 'Blame gutter' : undefined
                        }
                      >
                        {blameLines.map((line) =>
                          line.authorId ? (
                            <button
                              key={line.line}
                              type="button"
                              className="lash-blame-line"
                              data-testid="blame-line"
                              data-author-id={line.authorId}
                              title={`Line ${line.line}: ${line.authorId}`}
                              onClick={(event) =>
                                handleBlameLineClick(line.authorId, event.currentTarget)
                              }
                            >
                              {line.authorId}
                            </button>
                          ) : (
                            <span key={line.line} className="lash-blame-empty" aria-hidden="true" />
                          ),
                        )}
                      </div>
                      <EditorContent
                        editor={editor}
                        data-testid="lash-editor-content"
                        className="lash-editor-content"
                      />
                      {editor && !documentMutationLocked && !syntheticMentionFixtureEnabled ? (
                        <DocumentReferencePicker
                          editor={editor}
                          searchDocuments={referenceCatalog.search}
                        />
                      ) : null}
                    </div>
                  )}
                </div>
              </article>

              {!isFocusMode && outlineItems.length > 0 ? (
                <div className="lash-document-outline" data-testid="lash-document-outline">
                  <OutlinePanel
                    items={outlineItems}
                    onToggle={handleToggleHeading}
                    onFocus={handleFocusHeading}
                    onExpandAll={handleExpandAll}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </AppShell>
      </div>
      <OwnerShareDialog
        adjuncts={{
          comments: commentThreadCount,
          suggestions: unresolvedSuggestionCount,
        }}
        detail={
          staticPreview ? 'Account saving and sharing aren’t available in this preview.' : ownerShareDetail
        }
        documentTitle={docTitle.trim() || DEFAULT_DOC_TITLE}
        onClose={closeOwnerShareDialog}
        onPrimary={() => void handleOwnerPromotion()}
        open={shareDialogOpen}
        phase={ownerSharePhase}
        namedEditRoomId={
          ownerBacked &&
          resolution.kind === 'remote' &&
          NAMED_EDIT_ROOM_ID.test(resolution.remoteDocumentId)
            ? resolution.remoteDocumentId
            : undefined
        }
        signInHref={signInHref}
        publicAccess={publicAccessState}
        onManagePublicAccess={() => {
          documentSettingsTriggerRef.current = shareTriggerRef.current;
          setShareDialogOpen(false);
          setDocumentSettingsOpen(true);
        }}
      />
      <DocumentSettingsDialog
        localDocumentId={activeDocumentId}
        onClose={() => setDocumentSettingsOpen(false)}
        onUpdated={(state) => {
          setPublicAccessState(state);
          setDocumentSettingsAnnouncement('Public access updated.');
        }}
        open={documentSettingsOpen}
        ownerBacked={ownerBacked}
        returnFocusTo={documentSettingsTriggerRef.current}
        signInHref={staticPreview ? undefined : signInHref}
      />
      <MarkdownTransferDialog
        state={markdownDialogState}
        returnFocusTo={markdownTriggerRef.current}
        onClose={closeMarkdownDialog}
        onConfirm={() => void confirmMarkdownTransfer()}
        onRetryOpen={retryOpeningImportedDocument}
      />
      <span className="sr-only" aria-live="polite">
        {documentSettingsAnnouncement || markdownAnnouncement}
      </span>
    </>
  );
}

export default EditorWorkspace;
