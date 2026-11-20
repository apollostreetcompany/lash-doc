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
import {
  Extension,
  getTextBetween,
  getTextSerializersFromSchema,
  type Editor,
  type EditorEvents,
} from '@tiptap/core';
import type { Node as EditorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
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
  useReducer,
  useRef,
  useState,
} from 'react';
import type * as Y from 'yjs';

import { DocumentReferencePicker } from './DocumentReferencePicker';
import { AIPanel } from './panels/AIPanel';
import { AutosaveIndicator } from './panels/AutosaveIndicator';
import { captureChatAnchorRange, projectChatDocumentText } from './panels/chatAnchorPositions';
import {
  ChatPanel,
  readLocalChatThreadCount,
  type AnchoredCommentRequest,
} from './panels/ChatPanel';
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
  createMarkdownShareFile,
  downloadMarkdownFile,
  MarkdownTransferDialog,
  type MarkdownTransferDialogState,
} from './panels/MarkdownTransferDialog';
import { OutlinePanel } from './panels/OutlinePanel';
import { OwnerShareDialog, type OwnerShareDialogPhase } from './panels/OwnerShareDialog';
import { SharedHistoryPanel } from './panels/SharedHistoryPanel';
import { SharePanel } from './panels/SharePanel';
import { SuggestionCard, SuggestionComposer } from './panels/SuggestionControls';
import { TableCellPanel, type ActiveCell } from './panels/TableCellPanel';
import { SelectionActions } from './SelectionActions';
import {
  initialWorkspaceChrome,
  MOBILE_WORKSPACE_QUERY,
  transitionWorkspaceChrome,
  type WorkspaceViewport,
} from './workspaceChrome';
import { prepareAiReplacement, type AiSelection } from '../../lib/aiSelection';
import type { AutosaveFlushController, AutosaveSaveContext } from '../../lib/autosave';
import { createBrowserImageUploader } from '../../lib/createBrowserImageUploader';
import {
  createBrowserDocumentAccessController,
  createInitialDocumentAccessSnapshot,
  DEVICE_DRAFT_QUERY_PARAM,
  type DocumentAccessController,
  type DocumentAccessResolution,
  type DocumentAccessSnapshot,
  type OwnerCutoverResult,
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
  commitNewDeviceDocument,
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
import { AppShell } from '../shell/AppShell';
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
type SuggestionAuthoring =
  | { kind: 'idle' }
  | { kind: 'draft'; draft: SuggestionDraft }
  | { kind: 'notice'; message: string };

type ShareAdjuncts = Readonly<{ comments: number; suggestions: number }>;

type OwnerShareState =
  | { phase: 'closed' | 'checking-account' | 'ready' | 'signed-out' | 'saved' }
  | {
      phase: 'saving' | 'checking-copy' | 'opening-copy' | 'creating-device-draft';
      request: object;
    }
  | { phase: 'retryable' | 'unavailable'; detail?: string }
  | { phase: 'promotion-recovery'; detail?: string; mayCreateDeviceDraft?: true }
  | { phase: 'device-copy-ready'; path: string }
  | { phase: 'blocked'; adjuncts: ShareAdjuncts };

type OwnerShareAttempt = {
  attempt: BrowserDocumentPromotionAttempt;
  body: EditorNode;
  title: string;
  retryDetail?: string;
};

const NO_SHARE_ADJUNCTS: ShareAdjuncts = { comments: 0, suggestions: 0 };

type LocalBodyState =
  | { kind: 'loading' }
  | { kind: 'ready'; notice?: Extract<LocalBodyNotice, { kind: 'save-error' }> }
  | {
      kind: 'recovered-awaiting-confirmation';
      notice: Extract<LocalBodyNotice, { kind: 'recovered' | 'recovery-error' | 'conflict' }>;
    }
  | Extract<LocalBodyNotice, { kind: 'unavailable' | 'failed' | 'conflict' }>;

function getWorkspaceViewport(): WorkspaceViewport {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_WORKSPACE_QUERY).matches
    ? 'mobile'
    : 'desktop';
}

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
  // Comment and AI controls need live content and selection, but focus or
  // metadata-only transactions do not change either input.
  useEditorState({
    editor,
    selector: () => editor?.state ?? null,
    equalityFn: (next, previous) =>
      next === previous ||
      Boolean(
        next && previous && next.doc === previous.doc && next.selection.eq(previous.selection),
      ),
  });
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
        key={activeDocumentId}
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
    | 'allowsInviteIssuance'
    | 'captureInviteIssuance'
    | 'checkAccountCopy'
    | 'getResolution'
    | 'getSnapshot'
    | 'openAccountCopy'
    | 'promoteOwnerDocument'
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
  const [chrome, dispatchChrome] = useReducer(transitionWorkspaceChrome, initialWorkspaceChrome);
  const { activeTab, focusMode: isFocusMode, railFocus: mobileRailFocusRequest } = chrome;
  const mobileSidebarOpen = chrome.drawer === 'sidebar';
  const mobileRailOpen = chrome.drawer === 'rail';
  const railOpen = chrome.viewport === 'mobile' ? mobileRailOpen : chrome.desktopRailOpen;
  const railVisible = railOpen && !isFocusMode;
  const chatVisible = railVisible && activeTab === 'chat';
  const aiVisible = railVisible && activeTab === 'ai';
  const historyVisible = railVisible && activeTab === 'history';
  const [anchoredCommentRequest, setAnchoredCommentRequest] =
    useState<AnchoredCommentRequest | null>(null);
  const [suggestionAuthoring, setSuggestionAuthoring] = useState<SuggestionAuthoring>({
    kind: 'idle',
  });
  const [localSuggestions, setLocalSuggestions] = useState<LocalSuggestion[]>([]);
  const localSuggestionsRef = useRef<LocalSuggestion[]>([]);
  const [docTitle, setDocTitle] = useState(DEFAULT_DOC_TITLE);
  const [documents, setDocuments] = useState<LashDocumentRecord[]>([]);
  const [documentIndexNeedsRetry, setDocumentIndexNeedsRetry] = useState(false);
  const [documentCreateError, setDocumentCreateError] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [activeTableCell, setActiveTableCell] = useState<ActiveCell | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyAvailability, setHistoryAvailability] =
    useState<HistoryAvailabilityState>('loading');
  const [divergentHistoryHead, setDivergentHistoryHead] = useState<string | null>(null);
  // A writer inspecting a version keeps that selection as autosave appends new entries.
  // Null follows the history head until the writer chooses a version explicitly.
  const [inspectedHistoryEntryId, setInspectedHistoryEntryId] = useState<string | null>(null);
  const selectedHistoryEntryId = inspectedHistoryEntryId ?? historyEntries.at(-1)?.id ?? null;
  const [historyAuthorFilter, setHistoryAuthorFilter] = useState<string | null>(null);
  const [historyTimeFilter, setHistoryTimeFilter] = useState<HistoryTimeFilter>(null);
  const [showAuthorship, setShowAuthorship] = useState(false);
  const [suggestionResolutions, setSuggestionResolutions] = useState<SuggestionResolutionRecord[]>(
    [],
  );
  const acceptedSuggestionIds = useMemo(
    () => acceptedIdsFromResolutions(suggestionResolutions),
    [suggestionResolutions],
  );
  const [legacySuggestionError, setLegacySuggestionError] = useState('');
  const [ownerShare, setOwnerShare] = useState<OwnerShareState>({ phase: 'closed' });
  const shareDialogOpen = ownerShare.phase !== 'closed';
  const [documentSettingsOpen, setDocumentSettingsOpen] = useState(false);
  const [publicAccessState, setPublicAccessState] = useState<PublicAccessStateV1 | null>(null);
  const [documentSettingsAnnouncement, setDocumentSettingsAnnouncement] = useState('');
  const [blameText, setBlameText] = useState<string | null>(null);
  const blameLines = useMemo(
    () => (showAuthorship && blameText !== null ? blameFor(historyEntries, blameText) : []),
    [blameText, historyEntries, showAuthorship],
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
  const [historyStore] = useState(() =>
    createHistoryStore({
      snapshotInterval: 48,
      persistence: createLocalDocumentHistoryPersistence(),
    }),
  );
  const historyHeadRef = useRef<string | null>(null);
  const historyTextRef = useRef('');
  const historyBodyRef = useRef<LocalBodyDocJson | null>(null);
  const historyCapacityReachedRef = useRef(false);
  const firstHistoryCheckpointRef = useRef<'none' | 'initially-empty' | 'pending' | 'recorded'>(
    'none',
  );
  const historyQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordSavedLocalHistoryRef = useRef<((saved: LocalBodyEnvelope) => void) | null>(null);
  const applyingHistoryRef = useRef(false);
  const restoringLocalHistoryRef = useRef(false);
  const [historyRestoreNotice, setHistoryRestoreNotice] = useState('');
  const applyingAiPatchRef = useRef(false);
  const suggestionResolutionsRef = useRef<SuggestionResolutionRecord[]>([]);
  const activeTableCellRef = useRef<ActiveCell | null>(null);
  const [mobileRailActionCoordinator] = useState(createMobileRailActionCoordinator);
  const mobileRailAvailabilityObserverRef = useRef<MutationObserver | null>(null);
  const railJumpSequenceRef = useRef(0);
  const activityRailTriggerRef = useRef<HTMLElement | null>(null);
  const shareTriggerRef = useRef<HTMLElement | null>(null);
  const documentSettingsTriggerRef = useRef<HTMLElement | null>(null);
  const promotionAttemptRef = useRef<OwnerShareAttempt | null>(null);
  const promotionInFlightRef = useRef<object | null>(null);
  const [railJumpRequest, setRailJumpRequest] = useState<{
    id: RailTab;
    requestId: number;
  } | null>(null);

  const commitHistoryHead = useCallback((sha: string | null) => {
    historyHeadRef.current = sha;
    setHistoryHead(sha);
  }, []);

  const loadHistoryDiff = useCallback(
    (from: string, to: string) => historyStore.diff(historyDocumentId, from, to),
    [historyDocumentId, historyStore],
  );

  const refreshDocuments = useCallback(() => {
    const storage = browserLocalStorage();
    try {
      setDocuments(storage ? listDocuments(storage) : []);
    } catch {
      setDocuments([]);
      setDocumentIndexNeedsRetry(true);
    }
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
  const [localBody, setLocalBody] = useState<LocalBodyState>({ kind: 'loading' });
  const localBodyState = localBody.kind;
  const localBodyNotice =
    localBody.kind === 'loading'
      ? undefined
      : localBody.kind === 'ready' || localBody.kind === 'recovered-awaiting-confirmation'
        ? localBody.notice
        : localBody;
  const localBodyExpectedRef = useRef<LocalBodyExpectedRevision | null>(null);
  const divergentHistoryMarkerRef = useRef<LocalBodyEnvelope['divergentHistoryHead']>(undefined);
  const recoveredLocalBodyRef = useRef<{
    envelope: LocalBodyEnvelope;
    recoveryToken: Readonly<LocalBodyRecoveryToken>;
  } | null>(null);
  const localRecoveryFocusDocumentRef = useRef<string | null>(null);
  const initialFocusEditorRef = useRef<Editor | null>(null);
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
    historyAvailability !== 'capacity-reached' &&
    historyAvailability !== 'body-history-diverged';
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
      setDocumentIndexNeedsRetry(false);
    } catch {
      setDocuments([]);
      setDocumentIndexNeedsRetry(true);
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
    const query = window.matchMedia(MOBILE_WORKSPACE_QUERY);
    const syncViewport = () => {
      dispatchChrome({ type: 'viewport', viewport: query.matches ? 'mobile' : 'desktop' });
    };
    syncViewport();
    query.addEventListener('change', syncViewport);
    return () => query.removeEventListener('change', syncViewport);
  }, []);

  // iOS scroll lock while a mobile drawer is open. CSS `overflow: hidden`
  // alone does not stop iOS rubber-band scroll on the document body — the
  // proven trick is to position-fix the body at a negative top offset
  // equal to the prior scroll position, then restore on close.
  const drawerOpen = chrome.drawer !== null;
  useEffect(() => {
    if (typeof window === 'undefined' || !drawerOpen) return;
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
  }, [drawerOpen]);

  const cancelPendingMobileRailAction = useCallback(() => {
    mobileRailAvailabilityObserverRef.current?.disconnect();
    mobileRailAvailabilityObserverRef.current = null;
    mobileRailActionCoordinator.cancel();
  }, [mobileRailActionCoordinator]);

  const queueMobileRailAfterClose = useCallback(
    (run: () => void, cancel: () => void = () => undefined) => {
      cancelPendingMobileRailAction();
      mobileRailActionCoordinator.queue({ documentId: activeDocumentId, run, cancel });
      dispatchChrome({ type: 'close-rail', restoreFocus: false });
    },
    [activeDocumentId, cancelPendingMobileRailAction, mobileRailActionCoordinator],
  );

  // A mobile rail is modal: AppShell keeps the canvas inert while it is open,
  // and the body-lock effect above releases scrolling during the close commit.
  // Consume the queued action only after both boundaries are observably gone.
  // MutationObserver makes this event-driven; if the canvas never becomes
  // available, the action intentionally fails closed instead of guessing at a
  // delay. The document-id/unmount cleanup prevents a stale target jump.
  useEffect(() => {
    if (mobileRailOpen || typeof document === 'undefined') return;
    if (!mobileRailActionCoordinator.hasPending()) return;

    const consumeWhenAvailable = () => {
      const canvas = document.querySelector<HTMLElement>('.lash-canvas');
      const bodyScrollLocked = document.body.style.position === 'fixed';
      mobileRailActionCoordinator.notifyRelease({
        documentId: activeDocumentId,
        canvasAvailable: Boolean(canvas && !canvas.hasAttribute('inert')),
        bodyScrollLocked,
      });
      if (!mobileRailActionCoordinator.hasPending()) {
        mobileRailAvailabilityObserverRef.current?.disconnect();
        mobileRailAvailabilityObserverRef.current = null;
      }
    };

    consumeWhenAvailable();
    if (!mobileRailActionCoordinator.hasPending()) return;

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
  }, [activeDocumentId, mobileRailActionCoordinator, mobileRailOpen]);

  useEffect(
    () => () => {
      cancelPendingMobileRailAction();
    },
    [activeDocumentId, cancelPendingMobileRailAction],
  );

  const closeActivityRail = useCallback(() => {
    cancelPendingMobileRailAction();
    if (getWorkspaceViewport() === 'desktop') {
      const trigger = activityRailTriggerRef.current;
      activityRailTriggerRef.current = null;
      if (trigger?.isConnected && !trigger.closest('#lash-rail')) {
        const { activeElement, body } = trigger.ownerDocument;
        // Return focus before the rail unmounts, while its focus is still ours to move.
        if (activeElement === body || activeElement?.closest('#lash-rail')) {
          trigger.focus({ preventScroll: true });
        }
      }
    }
    dispatchChrome({ type: 'close-rail', restoreFocus: true });
  }, [cancelPendingMobileRailAction]);

  const handleChatDocumentNavigation = useCallback(
    (navigateToTarget: () => void) => {
      if (mobileRailOpen && getWorkspaceViewport() === 'mobile') {
        // The document target owns focus once the modal and scroll lock are gone.
        queueMobileRailAfterClose(navigateToTarget);
      } else {
        navigateToTarget();
      }
    },
    [mobileRailOpen, queueMobileRailAfterClose],
  );

  const openActivityPanel = useCallback(
    (tab: RailTab, trigger: HTMLElement | null) => {
      cancelPendingMobileRailAction();
      activityRailTriggerRef.current = trigger;
      dispatchChrome({ type: 'open-rail', viewport: getWorkspaceViewport(), tab, trigger });
      railJumpSequenceRef.current += 1;
      setRailJumpRequest({ id: tab, requestId: railJumpSequenceRef.current });
    },
    [cancelPendingMobileRailAction],
  );

  const openDiscussionPanel = useCallback(
    (trigger: HTMLElement, tab: 'chat' | 'ai' = 'chat') => openActivityPanel(tab, trigger),
    [openActivityPanel],
  );

  const selectRailTab = useCallback((tab: RailTab) => {
    dispatchChrome({ type: 'select-tab', tab });
  }, []);

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
      autofocus: false,
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
      return node;
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
    divergentHistoryMarkerRef.current = undefined;
    firstHistoryCheckpointRef.current = 'none';
    localSuggestionsRef.current = [];
    setLocalSuggestions([]);
    recoveredLocalBodyRef.current = null;
    localBodyMutationsAllowedRef.current = realtimeEnabled;
    if (realtimeEnabled) {
      // Yjs and the Durable Object are the sole body authority in realtime
      // mode. Do not even read the local body keys here.
      setLocalBody({ kind: 'ready' });
      return;
    }

    // Local content is not interactable until the reader has either hydrated
    // a verified snapshot or chosen a fail-visible recovery state.
    localBodyMutationsAllowedRef.current = false;
    editor.setEditable(false);
    const storage = browserLocalStorage();
    if (!storage) {
      localBodyMutationsAllowedRef.current = true;
      setLocalBody({
        kind: 'unavailable',
        detail: 'Browser local storage could not be acquired.',
      });
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
        divergentHistoryMarkerRef.current = result.envelope.divergentHistoryHead;
        if (result.envelope.firstHistoryPending) firstHistoryCheckpointRef.current = 'pending';
        setLocalBody({ kind: 'ready' });
        return;
      }
      if (result.state === 'empty') {
        // A fresh body can later reconstruct its first checkpoint from this
        // exact schema baseline. Existing unmarked drafts retain their history.
        const emptyDocument = editor.schema.topNodeType.createAndFill();
        if (emptyDocument?.eq(editor.state.doc))
          firstHistoryCheckpointRef.current = 'initially-empty';
        localBodyMutationsAllowedRef.current = true;
        setLocalBody({ kind: 'ready' });
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
        setLocalBody({ kind: 'recovered-awaiting-confirmation', notice: { kind: 'recovered' } });
        return;
      }
      if (result.state === 'unavailable') {
        localBodyMutationsAllowedRef.current = true;
        setLocalBody({ kind: 'unavailable', detail: result.error.message });
        return;
      }
      localBodyMutationsAllowedRef.current = true;
      setLocalBody({
        kind: 'failed',
        detail: result.primaryError?.message ?? result.backupError?.message,
      });
    } catch (error) {
      // Active-schema validation already succeeded. A setContent failure is
      // nevertheless fail-closed and must never enable autosave.
      localBodyMutationsAllowedRef.current = true;
      setLocalBody({
        kind: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, [activeDocumentId, editor, realtimeEnabled, validateLocalBodySchema]);

  const inviteScope = accessSnapshot.scope;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!documentMutationLocked);
    if (documentMutationLocked) return;
    if (localRecoveryFocusDocumentRef.current === activeDocumentId) {
      localRecoveryFocusDocumentRef.current = null;
      initialFocusEditorRef.current = editor;
      const ownerDocument = editor.view.dom.ownerDocument;
      if (ownerDocument.activeElement === ownerDocument.body) editor.view.focus();
      return;
    }
    if (initialFocusEditorRef.current === editor) return;

    const { doc, selection } = editor.state;
    const frame = window.requestAnimationFrame(() => {
      if (editor.isDestroyed || !editor.isEditable || !editor.view.dom.isConnected) return;
      initialFocusEditorRef.current = editor;
      const { view } = editor;
      const ownerDocument = view.dom.ownerDocument;
      // A control can acquire focus or a transaction can move the editor before this frame runs.
      if (ownerDocument.activeElement !== ownerDocument.body) return;
      if (view.state.doc !== doc || view.state.selection !== selection) return;
      view.focus();
      view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).scrollIntoView());
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeDocumentId, documentMutationLocked, editor]);

  useEffect(() => {
    if (!editor || !realtimeProvider) return;
    const publishSelection = () => {
      const { from, to } = editor.state.selection;
      realtimeProvider.setLocalSelection({ from, to });
    };
    publishSelection();
    editor.on('transaction', publishSelection);
    return () => {
      editor.off('transaction', publishSelection);
      realtimeProvider.setLocalSelection(null);
    };
  }, [editor, realtimeProvider]);

  const localBodyConsumersReady =
    realtimeEnabled ||
    (localBodyState !== 'loading' && localBodyState !== 'recovered-awaiting-confirmation');

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
      // Persistence and decisions use the mapped positions. Cards only need
      // an update when a target becomes stale.
      if (next.some((item, index) => (item.range === null) !== (current[index].range === null))) {
        setLocalSuggestions(next);
      }
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
    setDivergentHistoryHead(null);
    if (!editor || !localBodyConsumersReady) {
      setHistoryEntries([]);
      setHistoryAvailability('loading');
      setInspectedHistoryEntryId(null);
      setBlameText(null);
      commitHistoryHead(null);
      historyTextRef.current = '';
      historyBodyRef.current = null;
      historyQueueRef.current = Promise.resolve();
      return;
    }

    let disposed = false;
    setHistoryEntries([]);
    setHistoryAvailability(
      realtimeEnabled
        ? 'remote-disabled'
        : localBodySavingUnavailable
          ? 'body-saving-unavailable'
          : 'loading',
    );
    setInspectedHistoryEntryId(null);
    setBlameText(null);
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

    const bodyKey = localDocumentBodyKey(activeDocumentId);
    const readPrimaryBodyBytes = () => {
      try {
        return browserLocalStorage()?.getItem(bodyKey) ?? null;
      } catch {
        return null;
      }
    };
    const recordHistory = (saved: LocalBodyEnvelope) => {
      if (
        saved.documentId !== activeDocumentId ||
        saved.divergentHistoryHead !== undefined ||
        restoringLocalHistoryRef.current ||
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
            if (disposed || editor.isDestroyed || !mutationAuthority.allowsBodyMutation(ticket))
              return;
            // The body writer verified these exact JSON bytes before handing over this receipt.
            const expectedRaw = JSON.stringify(saved);
            const canCommit = () => {
              const expected = localBodyExpectedRef.current;
              if (
                disposed ||
                editor.isDestroyed ||
                !mutationAuthority.allowsBodyMutation(ticket) ||
                expected?.revision !== saved.revision ||
                expected.writeId !== saved.writeId
              ) {
                return false;
              }
              return readPrimaryBodyBytes() === expectedRaw;
            };
            if (!canCommit()) return;
            const doc = editor.schema.nodeFromJSON(saved.doc);
            const before = historyTextRef.current;
            const after = getTextBetween(
              doc,
              { from: 0, to: doc.content.size },
              {
                blockSeparator: '\n',
                textSerializers: getTextSerializersFromSchema(editor.schema),
              },
            );
            const body = captureHistoryBody(doc);
            const expectedParentSha = historyHeadRef.current;
            if (
              !expectedParentSha ||
              (before === after &&
                historyBodyRef.current &&
                canonicalize(historyBodyRef.current) === canonicalize(body))
            )
              return;
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
              { commitGuard: canCommit },
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
            if (disposed || !mutationAuthority.allowsBodyMutation(ticket)) return;
            firstHistoryCheckpointRef.current = 'recorded';
            historyTextRef.current = after;
            historyBodyRef.current = body;
            commitHistoryHead(result.entry.resultSha);
            const entries = await historyStore.list(historyDocumentId);
            if (disposed || !mutationAuthority.allowsBodyMutation(ticket)) return;
            setHistoryAvailability('ready');
            setHistoryEntries(entries);
            setBlameText(after);
          });
      }, HISTORY_RECORD_DEBOUNCE_MS);
    };

    const currentBody = captureHistoryBody(editor.state.doc);
    const liveText = editorText(editor);
    const expectedBody = localBodyExpectedRef.current;
    const hasPendingFirstCheckpoint = firstHistoryCheckpointRef.current === 'pending';
    const pendingBodyBytes = hasPendingFirstCheckpoint ? readPrimaryBodyBytes() : null;
    const ticket = mutationAuthority.capture();
    const readVerifiedCurrentBody = () => {
      const storage = browserLocalStorage();
      if (
        disposed ||
        editor.isDestroyed ||
        !storage ||
        !expectedBody ||
        !mutationAuthority.allowsBodyMutation(ticket)
      ) {
        return null;
      }
      const persisted = loadLocalDocumentBody({
        storage,
        documentId: activeDocumentId,
        validateSchema: validateLocalBodySchema,
      });
      return persisted.state === 'ready' &&
        persisted.expected.revision === expectedBody.revision &&
        persisted.expected.writeId === expectedBody.writeId &&
        canonicalize(persisted.envelope.doc) === canonicalize(currentBody) &&
        (!hasPendingFirstCheckpoint ||
          (pendingBodyBytes !== null && readPrimaryBodyBytes() === pendingBodyBytes))
        ? persisted.envelope
        : null;
    };
    const existingDivergence = divergentHistoryMarkerRef.current;
    if (existingDivergence !== undefined) {
      const verified = readVerifiedCurrentBody();
      setHistoryAvailability(verified ? 'body-history-diverged' : 'corrupt');
      if (verified && existingDivergence !== null) {
        // A delayed or failed History read cannot lock a verified saved draft.
        void historyStore
          .hydrate(historyDocumentId)
          .then((hydration) => {
            if (
              !disposed &&
              mutationAuthority.allowsBodyMutation(ticket) &&
              hydration.state === 'ready' &&
              hydration.head === existingDivergence
            ) {
              setDivergentHistoryHead(existingDivergence);
            }
          })
          .catch(() => {
            // Leave the preview unavailable.
          });
      }
      return () => {
        disposed = true;
      };
    }

    const pendingInitialDocument =
      hasPendingFirstCheckpoint && readVerifiedCurrentBody()?.firstHistoryPending
        ? editor.schema.topNodeType.createAndFill()
        : null;
    const initialHistory: HistoryDocumentState = pendingInitialDocument
      ? { type: 'doc', text: '', body: captureHistoryBody(pendingInitialDocument) }
      : { type: 'doc', text: liveText, body: currentBody };
    void historyStore
      .hydrate(historyDocumentId, initialHistory)
      .then(async (hydration) => {
        if (disposed) return;
        if (hydration.state !== 'ready' && hydration.state !== 'empty-baseline') {
          setHistoryAvailability(hydration.state);
          return;
        }

        let entries = await historyStore.list(historyDocumentId);
        let headDocument = (await historyStore.loadAt(
          historyDocumentId,
          hydration.head,
        )) as HistoryDocumentState;
        let head = hydration.head;
        if (disposed) return;
        let capacityReached = false;
        const bodyDiffersFromHistory =
          headDocument.text !== liveText ||
          (headDocument.body && canonicalize(headDocument.body) !== canonicalize(currentBody));
        if (bodyDiffersFromHistory) {
          const historicalTimestamp = entries.at(-1)?.ts;
          const pendingFirstCheckpoint =
            pendingInitialDocument !== null &&
            hydration.state === 'empty-baseline' &&
            !hydration.durable &&
            entries.length === 0;
          const isNewerThanHistory = (verified: LocalBodyEnvelope | null) =>
            verified !== null &&
            (pendingFirstCheckpoint
              ? verified.firstHistoryPending === true
              : historicalTimestamp !== undefined &&
                Date.parse(verified.savedAt) > Date.parse(historicalTimestamp));
          const verified = readVerifiedCurrentBody();
          if (!verified) {
            setHistoryAvailability('corrupt');
            return;
          }
          if (!isNewerThanHistory(verified)) {
            divergentHistoryMarkerRef.current = head;
            if (entries.length) setDivergentHistoryHead(head);
            setHistoryAvailability('body-history-diverged');
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
            { commitGuard: () => isNewerThanHistory(readVerifiedCurrentBody()) },
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

        if (entries.length > 0) firstHistoryCheckpointRef.current = 'recorded';
        historyTextRef.current = headDocument.text;
        historyBodyRef.current = headDocument.body ?? null;
        commitHistoryHead(head);
        setHistoryEntries(entries);
        setBlameText(capacityReached ? null : headDocument.text);
        setHistoryAvailability(
          capacityReached ? 'capacity-reached' : entries.length > 0 ? 'ready' : 'empty-baseline',
        );
        recordSavedLocalHistoryRef.current = recordHistory;
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
      if (recordSavedLocalHistoryRef.current === recordHistory) {
        recordSavedLocalHistoryRef.current = null;
      }
    };
  }, [
    activeDocumentId,
    editor,
    historyDocumentId,
    historyStore,
    commitHistoryHead,
    localBodyConsumersReady,
    localBodySavingUnavailable,
    mutationAuthority,
    realtimeEnabled,
    validateLocalBodySchema,
  ]);

  const loadHistoryVersion = useCallback(
    async (sha: string) => {
      if (!editor || realtimeEnabled) return null;
      const ticket = mutationAuthority.capture();
      const canRead = () =>
        !editor.isDestroyed &&
        ticket.routeDocumentId === activeDocumentId &&
        ticket.remoteDocumentId === null &&
        mutationAuthority.allowsBodyMutation(ticket);
      if (!canRead()) return null;
      const version = (await historyStore.loadAt(historyDocumentId, sha)) as HistoryDocumentState;
      if (!canRead()) return null;
      const { text, body } = version;
      if (!body) return { text };
      try {
        return { text, document: validateLocalBodySchema(body) };
      } catch {
        // Some verified older versions only support the stored text projection.
        return { text };
      }
    },
    [
      activeDocumentId,
      editor,
      historyDocumentId,
      historyStore,
      mutationAuthority,
      realtimeEnabled,
      validateLocalBodySchema,
    ],
  );

  const loadSavedHistoryPreview = useCallback(async () => {
    if (!divergentHistoryHead || realtimeEnabled) return null;
    const ticket = mutationAuthority.capture();
    const canRead = () =>
      ticket.routeDocumentId === activeDocumentId && mutationAuthority.allowsBodyMutation(ticket);
    if (!canRead()) return null;
    // Use a fresh validated persisted read rather than the mounted History cache.
    const history = createHistoryStore({ persistence: createLocalDocumentHistoryPersistence() });
    const hydration = await history.hydrate(historyDocumentId);
    if (hydration.state !== 'ready' || hydration.head !== divergentHistoryHead || !canRead()) {
      return null;
    }
    const version = (await history.loadAt(
      historyDocumentId,
      divergentHistoryHead,
    )) as HistoryDocumentState;
    return canRead() ? { text: version.text } : null;
  }, [
    activeDocumentId,
    divergentHistoryHead,
    historyDocumentId,
    mutationAuthority,
    realtimeEnabled,
  ]);

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
    editor.on('transaction', update);
    return () => {
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
    if (typeof window === 'undefined' || !editor || !exposeTestHooks || !localBodyMutationLocked) {
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
  }, [editor, exposeTestHooks, localBodyMutationLocked]);

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

    cancelPendingMobileRailAction();
    dispatchChrome({ type: 'focus' });

    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (canvas) canvas.scrollTop = canvasScrollTop;
        window.scrollTo({ top: windowScrollY, behavior: 'auto' });
      });
    });
  }, [cancelPendingMobileRailAction]);

  const handleSelectHistoryEntry = useCallback((entryId: string) => {
    setLegacySuggestionError('');
    setInspectedHistoryEntryId(entryId);
  }, []);

  const handleToggleAuthorship = useCallback(() => {
    if (showAuthorship && activityRailTriggerRef.current?.closest('.lash-blame-gutter')) {
      const stableReturnTarget =
        typeof document === 'undefined'
          ? null
          : document.querySelector<HTMLElement>('[data-testid="topbar-discussion-button"]');
      if (stableReturnTarget) {
        activityRailTriggerRef.current = stableReturnTarget;
        dispatchChrome({ type: 'rail-return-target', trigger: stableReturnTarget });
      }
    }
    setShowAuthorship((visible) => !visible);
  }, [showAuthorship]);

  const handleBlameLineClick = useCallback(
    (authorId: string | null, trigger: HTMLButtonElement) => {
      setHistoryAuthorFilter(authorId);
      openActivityPanel('history', trigger);
    },
    [openActivityPanel],
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
    if ((author || time) && !namedComment) {
      const trigger = document.querySelector<HTMLElement>(
        '[data-testid="topbar-discussion-button"]',
      );
      openActivityPanel('history', trigger);
    }
  }, [activeDocumentId, namedComment, openActivityPanel]);

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
    const history = historyStore;
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
      const history = historyStore;
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
        setInspectedHistoryEntryId(null);
        setBlameText(target.text);
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
      historyStore,
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
        setBlameText(prepared.after);
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
      historyStore,
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
      if (event.repeat || drawerOpen) return;
      if (!event.shiftKey) return;
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) return;
      if (event.key !== 'F' && event.key !== 'f') return;
      event.preventDefault();
      handleFocusModeToggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, handleFocusModeToggle]);

  // Cmd/Ctrl+/ toggles the activity surface for the current viewport.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.repeat) return;
      if (!(event.metaKey || event.ctrlKey) || event.key !== '/' || mobileSidebarOpen) return;
      event.preventDefault();
      if (railVisible) {
        closeActivityRail();
      } else {
        const trigger = document.activeElement;
        openActivityPanel(activeTab, trigger instanceof HTMLElement ? trigger : null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, closeActivityRail, mobileSidebarOpen, openActivityPanel, railVisible]);

  const readVerifiedLocalBodyReceipt = useCallback(() => {
    if (realtimeEnabled || localBodyState !== 'ready' || !editor || editor.isDestroyed) return null;
    const storage = browserLocalStorage();
    const expected = localBodyExpectedRef.current;
    if (!storage || !expected) return null;
    const loaded = loadLocalDocumentBody({
      storage,
      documentId: activeDocumentId,
      validateSchema: validateLocalBodySchema,
    });
    return loaded.state === 'ready' &&
      loaded.expected.revision === expected.revision &&
      loaded.expected.writeId === expected.writeId &&
      JSON.stringify(loaded.envelope.doc) === JSON.stringify(editor.getJSON())
      ? loaded.envelope
      : null;
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
            readVerifiedLocalBodyReceipt()
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
      readVerifiedLocalBodyReceipt,
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
              Boolean(readVerifiedLocalBodyReceipt()) ||
              ((await markdownAutosaveControllerRef.current?.flushVerified()) ?? false),
          }),
    [readVerifiedLocalBodyReceipt, inspectCurrentMarkdownSource, localBodyState, realtimeEnabled],
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

  const deviceCopyEditor =
    resolution.kind === 'local' &&
    resolution.routeDocumentId === activeDocumentId &&
    accessSnapshot.phase === 'local-ready' &&
    localBodyState === 'ready' &&
    editor &&
    !editor.isDestroyed &&
    hydratedLocalEditorRef.current === editor
      ? editor
      : null;
  const canShareCopy = useCallback(
    (source: object) =>
      deviceCopyEditor === source &&
      !deviceCopyEditor.isDestroyed &&
      hydratedLocalEditorRef.current === deviceCopyEditor &&
      inviteIssuanceAuthority.getResolution() === resolution &&
      inviteIssuanceAuthority.getSnapshot().phase === 'local-ready' &&
      resolution.authority.getSnapshot().bodyWrite,
    [deviceCopyEditor, inviteIssuanceAuthority, resolution],
  );
  const shareCopy = markdownDialogState?.kind === 'share-copy' ? markdownDialogState : null;
  const shareCopyOpen = Boolean(shareCopy && canShareCopy(shareCopy.source));

  useLayoutEffect(() => {
    if (shareCopy && !shareCopyOpen) {
      setMarkdownDialogState((current) => (current === shareCopy ? null : current));
    }
  }, [shareCopy, shareCopyOpen]);

  const openShareCopy = useCallback(
    (trigger: HTMLElement | null) => {
      if (!deviceCopyEditor || !canShareCopy(deviceCopyEditor) || promotionInFlightRef.current) {
        return false;
      }
      const plan = createMarkdownDownloadPlan({
        doc: deviceCopyEditor.getJSON(),
        title: docTitle,
        documentId: activeDocumentId,
        mode: 'share-copy',
      });
      markdownTriggerRef.current = trigger;
      setMarkdownDialogState({
        kind: 'share-copy',
        plan,
        nativeFile: createMarkdownShareFile(plan),
        source: deviceCopyEditor,
      });
      return true;
    },
    [activeDocumentId, canShareCopy, deviceCopyEditor, docTitle],
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
      downloadMarkdownFile(state.plan);
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
  const canCommentOnSelection =
    (namedComment || !documentMutationLocked) &&
    (realtimeEnabled ? sharedSuggestionsReady : Boolean(historyHead));
  const canReviseSelection =
    !realtimeEnabled &&
    !documentMutationLocked &&
    Boolean(historyHead) &&
    historyAvailability === 'ready';
  const handleSelectionComment = useCallback(
    (range: { from: number; to: number }) => {
      if (!editor || editor.isDestroyed || !canCommentOnSelection) return;
      setAnchoredCommentRequest({
        editor,
        docId: historyDocumentId,
        document: editor.state.doc,
        from: range.from,
        to: range.to,
      });
      // The selection action disappears when focus moves into the composer.
      openDiscussionPanel(editor.view.dom);
    },
    [canCommentOnSelection, editor, historyDocumentId, openDiscussionPanel],
  );
  const handleCommentRequestHandled = useCallback((request: AnchoredCommentRequest) => {
    setAnchoredCommentRequest((pending) => (pending === request ? null : pending));
  }, []);
  const handleSelectionRevision = useCallback(
    (trigger: HTMLButtonElement) => openDiscussionPanel(trigger, 'ai'),
    [openDiscussionPanel],
  );
  const canStartSuggestion = realtimeEnabled
    ? Boolean(editor && sharedSuggestionsReady && (namedComment || canEditDocument))
    : Boolean(editor && !documentMutationLocked && localBodyState === 'ready');

  const handleStartSuggestion = (trigger: HTMLButtonElement) => {
    if (!editor || editor.isDestroyed || !canStartSuggestion) return;
    openDiscussionPanel(trigger);
    const { from, to } = editor.state.selection;
    const range = { from, to };
    const target = readSuggestionRange(editor.state.doc, range);
    if (!target || target.text.length > MAX_SUGGESTION_TEXT || target.before.length > 5_000) {
      setSuggestionAuthoring({
        kind: 'notice',
        message: 'Select the words you want to replace, then choose Suggest wording.',
      });
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
        setSuggestionAuthoring({
          kind: 'notice',
          message: 'Select words within one paragraph or heading to start a suggestion.',
        });
        return;
      }
      anchor = {
        ...createAnchor({ baseVersion: null, docText: documentText.text, ...textRange }),
        relativeRange,
      };
    }
    setSuggestionAuthoring({
      kind: 'draft',
      draft: {
        id: crypto.randomUUID(),
        document: editor.state.doc,
        range,
        quote: target.text,
        before: target.before,
        anchor,
      },
    });
  };

  const firstHistoryPendingForLocalSave = useCallback(() => {
    if (firstHistoryCheckpointRef.current === 'recorded') return false;
    if (firstHistoryCheckpointRef.current === 'initially-empty' && !localBodyExpectedRef.current)
      return true;
    return undefined;
  }, []);

  const publishVerifiedLocalBody = useCallback((envelope: LocalBodyEnvelope) => {
    localBodyExpectedRef.current = localBodyExpectedRevision(envelope);
    if (envelope.firstHistoryPending) firstHistoryCheckpointRef.current = 'pending';
    recordSavedLocalHistoryRef.current?.(envelope);
    setLocalBody((body) => (body.kind === 'ready' && body.notice ? { kind: 'ready' } : body));
  }, []);

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
      divergentHistoryHead: divergentHistoryMarkerRef.current,
      expected: localBodyExpectedRef.current,
      firstHistoryPending: firstHistoryPendingForLocalSave(),
      validateSchema: validateLocalBodySchema,
    });
    publishVerifiedLocalBody(envelope);
    localSuggestionsRef.current = next;
    setLocalSuggestions(next);
  };

  const localSuggestionError = (error: unknown) => {
    if (error instanceof LocalBodyPersistenceError && error.code === 'conflict') {
      setLocalBody({ kind: 'conflict', detail: error.message });
      return {
        ok: false as const,
        message: 'This draft changed in another tab. Reopen it before making a decision.',
      };
    }
    return { ok: false as const, message: 'Lash could not save this suggestion. Try again.' };
  };

  const postSuggestion = async (replacement: string, note: string) => {
    const draft = suggestionAuthoring.kind === 'draft' ? suggestionAuthoring.draft : null;
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
    setSuggestionAuthoring((current) =>
      current.kind === 'draft' && current.draft === draft
        ? { kind: 'notice', message: 'Suggestion posted.' }
        : current,
    );
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
  const promotionRecovery = accessSnapshot.promotionRecovery;
  const deviceDraft =
    promotionRecovery === 'device-draft' || promotionRecovery === 'account-copy-available';
  const accountCopyOpen = promotionRecovery === 'account-copy-open' && ownerBacked;
  const promotionBaselineReady =
    localBodyState === 'ready' &&
    (historyAvailability === 'ready' ||
      historyAvailability === 'empty-baseline' ||
      historyAvailability === 'capacity-reached');

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
    if (ownerShare.phase !== 'checking-account') return;
    const abort = new AbortController();
    const complete = (next: OwnerShareState) => {
      if (abort.signal.aborted) return;
      setOwnerShare((current) => (current === ownerShare ? next : current));
    };

    void fetch('/api/account/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: abort.signal,
    })
      .then((response) => {
        if (
          response.status === 204 &&
          response.headers.get('x-lash-account-status') === 'authenticated'
        ) {
          const retryDetail = promotionAttemptRef.current?.retryDetail;
          complete(retryDetail ? { phase: 'retryable', detail: retryDetail } : { phase: 'ready' });
        } else {
          complete({ phase: response.status === 401 ? 'signed-out' : 'unavailable' });
        }
      })
      .catch(() => complete({ phase: 'unavailable' }));
    return () => abort.abort();
  }, [ownerShare]);

  const verifySavedDeviceDraft = useCallback(async () => {
    let envelope = readVerifiedLocalBodyReceipt();
    if (!envelope) {
      if (!(await markdownAutosaveControllerRef.current?.flushVerified())) return null;
      envelope = readVerifiedLocalBodyReceipt();
    }
    const storage = browserLocalStorage();
    const title = docTitle.trim() || DEFAULT_DOC_TITLE;
    return storage && envelope && readDocumentTitle(storage, activeDocumentId) === title
      ? { storage, envelope, title }
      : null;
  }, [activeDocumentId, docTitle, readVerifiedLocalBodyReceipt]);

  const closeOwnerShareDialog = useCallback(() => {
    if (promotionInFlightRef.current) return;
    setOwnerShare({ phase: 'closed' });
    const trigger = shareTriggerRef.current;
    window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
  }, []);

  const beginOwnerShareRequest = useCallback(
    (phase: 'saving' | 'checking-copy' | 'opening-copy' | 'creating-device-draft') => {
      if (promotionInFlightRef.current) return null;
      const request = {};
      promotionInFlightRef.current = request;
      setOwnerShare({ phase, request });
      return {
        complete(next: OwnerShareState) {
          setOwnerShare((current) =>
            'request' in current && current.request === request ? next : current,
          );
        },
        release() {
          if (promotionInFlightRef.current === request) promotionInFlightRef.current = null;
        },
      };
    },
    [],
  );

  const handleOwnerPromotion = useCallback(async () => {
    if (
      staticPreview ||
      !editor ||
      editor.isDestroyed ||
      ownerBacked ||
      deviceDraft ||
      !promotionBaselineReady ||
      promotionInFlightRef.current ||
      (ownerShare.phase !== 'ready' && ownerShare.phase !== 'retryable')
    ) {
      return;
    }
    if (typeof window === 'undefined' || !window.crypto?.subtle) {
      setOwnerShare({
        phase: 'unavailable',
        detail:
          'Secure account saving is unavailable in this browser. Your document is still on this device.',
      });
      return;
    }

    const activity = beginOwnerShareRequest('saving');
    if (!activity) return;
    let submission = promotionAttemptRef.current;
    try {
      if (!(await verifySavedDeviceDraft())) {
        activity.complete({
          phase: submission ? 'promotion-recovery' : 'unavailable',
          detail:
            'Lash couldn’t verify the device draft. Finish saving it before moving to the account copy.',
        });
        return;
      }

      // The rail can be closed or unmounted. Read the persisted discussion,
      // including resolved threads and changes from other tabs.
      const comments = readLocalChatThreadCount(historyDocumentId);
      const body = editor.state.doc;
      const title = docTitle.trim() || DEFAULT_DOC_TITLE;
      if (
        submission &&
        (submission.title !== title ||
          !submission.body.eq(body) ||
          comments !== 0 ||
          unresolvedSuggestionCount !== 0)
      ) {
        activity.complete({ phase: 'promotion-recovery' });
        return;
      }
      if (comments === null) {
        activity.complete({
          phase: 'unavailable',
          detail:
            'Lash couldn’t verify the comments saved on this device. Your document is still here. Reopen Share to try again.',
        });
        return;
      }
      const adjuncts = { comments, suggestions: unresolvedSuggestionCount };
      if (adjuncts.comments > 0 || adjuncts.suggestions > 0) {
        activity.complete({ phase: 'blocked', adjuncts });
        return;
      }

      submission ??= {
        attempt: createBrowserDocumentPromotionAttempt(
          { adjuncts, body: editor.getJSON(), localDocumentId: activeDocumentId, title },
          window.crypto,
        ),
        body,
        title,
      };
      const result: OwnerCutoverResult = await inviteIssuanceAuthority.promoteOwnerDocument(
        submission.attempt,
      );
      if (result.ok) {
        promotionAttemptRef.current = null;
        activity.complete({ phase: 'saved' });
        return;
      }
      if (result.reason === 'device-draft-preserved') {
        activity.complete({ phase: 'promotion-recovery' });
        return;
      }
      if (result.reason === 'promotion-failed') {
        const promotion = result.promotion;
        if (promotion.reason === 'device-draft-unverified') {
          activity.complete({
            phase: 'unavailable',
            detail: 'Lash couldn’t verify the device draft. Finish saving it before trying again.',
          });
          return;
        }
        if (promotion.reason === 'adjuncts-present') {
          promotionAttemptRef.current = null;
          activity.complete({ phase: 'blocked', adjuncts: promotion.adjuncts });
          return;
        }
        if (promotion.reason === 'server-rejected' && promotion.error === 'unauthorized') {
          promotionAttemptRef.current = null;
          activity.complete({ phase: 'signed-out' });
          return;
        }
      }
      if (result.retryable) {
        const detail =
          result.reason === 'promotion-failed'
            ? 'Lash could not reach account storage. Your document is still on this device.'
            : 'Your document was saved, but Lash could not reconnect to it. Try again to finish opening the account copy.';
        promotionAttemptRef.current = { ...submission, retryDetail: detail };
        activity.complete({ phase: 'retryable', detail });
        return;
      }
      promotionAttemptRef.current = null;
      activity.complete({ phase: 'unavailable' });
    } catch {
      // A missing response may follow a successful write. Reuse its exact
      // request while it still describes the verified device draft.
      const detail = 'Lash couldn’t confirm account saving. Try again to check the account copy.';
      if (submission) promotionAttemptRef.current = { ...submission, retryDetail: detail };
      activity.complete({ phase: submission ? 'retryable' : 'unavailable', detail });
    } finally {
      activity.release();
    }
  }, [
    activeDocumentId,
    beginOwnerShareRequest,
    deviceDraft,
    docTitle,
    editor,
    historyDocumentId,
    inviteIssuanceAuthority,
    ownerBacked,
    ownerShare.phase,
    promotionBaselineReady,
    staticPreview,
    unresolvedSuggestionCount,
    verifySavedDeviceDraft,
  ]);

  const checkAccountCopy = useCallback(async () => {
    const activity = beginOwnerShareRequest('checking-copy');
    if (!activity) return;
    try {
      await inviteIssuanceAuthority.checkAccountCopy();
      const available =
        inviteIssuanceAuthority.getSnapshot().promotionRecovery === 'account-copy-available';
      activity.complete({
        phase: 'promotion-recovery',
        ...(available
          ? {}
          : {
              detail:
                'Lash couldn’t verify an account copy. Your edits are still in this device draft.',
              mayCreateDeviceDraft: true,
            }),
      });
    } catch {
      activity.complete({
        phase: 'promotion-recovery',
        detail: 'Lash couldn’t check the account copy. Your edits are still in this device draft.',
        mayCreateDeviceDraft: true,
      });
    } finally {
      activity.release();
    }
  }, [beginOwnerShareRequest, inviteIssuanceAuthority]);

  const openAccountCopy = useCallback(async () => {
    if (promotionRecovery !== 'account-copy-available') return;
    const activity = beginOwnerShareRequest('opening-copy');
    if (!activity) return;
    try {
      if (!(await verifySavedDeviceDraft())) {
        activity.complete({
          phase: 'promotion-recovery',
          detail:
            'Lash couldn’t verify the device draft. Finish saving it before opening the account copy.',
        });
        return;
      }
      const result = await inviteIssuanceAuthority.openAccountCopy();
      if (result.ok) {
        promotionAttemptRef.current = null;
        activity.complete({ phase: 'closed' });
        return;
      }
    } catch {
      // The controller keeps the device draft mounted if the copy cannot open.
    } finally {
      activity.release();
    }
    activity.complete({
      phase: 'promotion-recovery',
      detail: 'Lash couldn’t open the account copy. Your edits are still in this device draft.',
    });
  }, [beginOwnerShareRequest, inviteIssuanceAuthority, promotionRecovery, verifySavedDeviceDraft]);

  const createSeparateDeviceDraft = useCallback(async () => {
    if (
      ownerShare.phase !== 'promotion-recovery' ||
      !ownerShare.mayCreateDeviceDraft ||
      inviteIssuanceAuthority.getSnapshot().promotionRecovery === 'account-copy-available'
    ) {
      return;
    }
    const activity = beginOwnerShareRequest('creating-device-draft');
    if (!activity) return;
    const fail = (detail: string) =>
      activity.complete({ phase: 'promotion-recovery', detail, mayCreateDeviceDraft: true });
    try {
      const source = await verifySavedDeviceDraft();
      if (!source) {
        fail('Lash couldn’t verify this draft. Finish saving it before creating a separate draft.');
        return;
      }

      const result = commitNewDeviceDocument({
        storage: source.storage,
        sourceDocumentId: activeDocumentId,
        doc: source.envelope.doc,
        title: source.title,
        createDocumentId: createNewDocumentId,
        validateSchema: validateLocalBodySchema,
        shouldCancelBeforeCommit: () => !editor || editor.isDestroyed,
      });
      if (result.status === 'cleanup-unverified') {
        fail(
          `Lash couldn’t verify cleanup of the incomplete copy. Your original is still here. Recovery ID: ${result.destinationId}.`,
        );
        return;
      }
      if (result.status !== 'committed') {
        fail('Lash couldn’t save a separate draft on this device. Your original is still here.');
        return;
      }
      const { path } = result.destination;
      activity.complete({ phase: 'device-copy-ready', path });
      window.requestAnimationFrame(() => navigateDocument(path));
    } catch {
      fail('Lash couldn’t save a separate draft on this device. Your original is still here.');
    } finally {
      activity.release();
    }
  }, [
    activeDocumentId,
    beginOwnerShareRequest,
    editor,
    inviteIssuanceAuthority,
    navigateDocument,
    ownerShare,
    validateLocalBodySchema,
    verifySavedDeviceDraft,
  ]);

  let ownerSharePhase: OwnerShareDialogPhase =
    ownerShare.phase === 'closed' || ownerShare.phase === 'promotion-recovery'
      ? 'checking-account'
      : ownerShare.phase;
  let ownerShareDetail = 'detail' in ownerShare ? ownerShare.detail : undefined;
  if (ownerBacked) {
    ownerSharePhase = 'saved';
  } else if (
    ownerShare.phase !== 'device-copy-ready' &&
    !('request' in ownerShare) &&
    (deviceDraft || ownerShare.phase === 'promotion-recovery')
  ) {
    ownerSharePhase =
      promotionRecovery === 'account-copy-available' ? 'account-copy-available' : 'device-draft';
  } else if (
    !promotionBaselineReady &&
    (ownerSharePhase === 'ready' || ownerSharePhase === 'retryable')
  ) {
    if (localBodyState === 'loading' || historyAvailability === 'loading') {
      ownerSharePhase = 'checking-account';
      ownerShareDetail = 'Checking saved versions…';
    } else {
      ownerSharePhase = 'unavailable';
      ownerShareDetail =
        'Lash couldn’t verify this device’s saved draft and versions. Export a copy before leaving, or reopen the draft to retry.';
    }
  }
  const handleOwnerSharePrimary = () => {
    if (ownerShare.phase === 'device-copy-ready') navigateDocument(ownerShare.path);
    else if (ownerSharePhase === 'device-draft') void checkAccountCopy();
    else if (ownerSharePhase === 'account-copy-available') void openAccountCopy();
    else void handleOwnerPromotion();
  };
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
      selectRailTab('chat');
    }
  }, [activeTab, selectRailTab, syntheticMentionFixtureEnabled]);

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
        <LiveEditorText editor={chatVisible ? editor : null}>
          {(currentText) => (
            <ChatPanel
              editor={editor}
              docId={historyDocumentId}
              anchoredCommentRequest={anchoredCommentRequest}
              onAnchoredCommentRequestHandled={handleCommentRequestHandled}
              baseVersion={realtimeEnabled ? null : historyHead}
              currentText={currentText}
              open={chatVisible}
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
              suggestionComposer={
                <>
                  {suggestionAuthoring.kind === 'notice' ? (
                    <p role="status">{suggestionAuthoring.message}</p>
                  ) : null}
                  {suggestionAuthoring.kind === 'draft' ? (
                    <SuggestionComposer
                      key={suggestionAuthoring.draft.id}
                      quote={suggestionAuthoring.draft.quote}
                      onCancel={() => setSuggestionAuthoring({ kind: 'idle' })}
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
          open={historyVisible}
          connected={realtimeSnapshot.hydrated && realtimeSnapshot.connectionState === 'connected'}
          canSendRestore={
            ownerBacked && !documentMutationLocked && realtimeSnapshot.syncState === 'saved'
          }
        />
      ) : (
        <HistoryPanel
          editor={historyPanelEditor}
          entries={historyEntries}
          open={historyVisible}
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
          loadVersion={
            !realtimeEnabled && !namedComment && canEditDocument ? loadHistoryVersion : undefined
          }
          loadSavedHistoryPreview={
            !realtimeEnabled &&
            historyAvailability === 'body-history-diverged' &&
            divergentHistoryHead
              ? loadSavedHistoryPreview
              : undefined
          }
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
        <LiveEditorText editor={aiVisible && !documentMutationLocked ? editor : null}>
          {(currentText) => (
            <AIPanel
              editor={documentMutationLocked ? null : editor}
              docId={historyDocumentId}
              baseVersion={historyHead}
              currentText={currentText}
              schemaVersion={HISTORY_SCHEMA_VERSION}
              open={aiVisible}
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
                  <LiveEditorText
                    editor={
                      railVisible && activeTab === 'activity' && !documentMutationLocked
                        ? editor
                        : null
                    }
                  >
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
      try {
        upsertDocument(storage, { id: nextDocumentId, title: DEFAULT_DOC_TITLE });
      } catch {
        setDocumentCreateError(true);
        return;
      }
      refreshDocuments();
    }
    setDocumentCreateError(false);
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
        if (staticPreview && openShareCopy(trigger ?? null)) return;
        shareTriggerRef.current = trigger ?? null;
        setOwnerShare((current) => {
          if (current.phase !== 'closed') return current;
          if (ownerBacked) return { phase: 'saved' };
          if (deviceDraft) return { phase: 'promotion-recovery' };
          const earlier = promotionAttemptRef.current;
          const title = docTitle.trim() || DEFAULT_DOC_TITLE;
          if (
            earlier &&
            (earlier.title !== title || (editor && !earlier.body.eq(editor.state.doc)))
          ) {
            return { phase: 'promotion-recovery' };
          }
          return staticPreview
            ? {
                phase: 'unavailable',
                detail: 'This document isn’t ready to share a copy. Return to it and try again.',
              }
            : { phase: 'checking-account' };
        });
        return;
      }
      openActivityPanel('share', trigger ?? null);
    },
    [
      cancelPendingMobileRailAction,
      deviceDraft,
      docTitle,
      editor,
      openActivityPanel,
      openShareCopy,
      ownerBacked,
      runtimeMode,
      staticPreview,
    ],
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
  const remotePeers = realtimeClaimsReady ? realtimeSnapshot.peers : null;
  const canOpenHistory =
    !namedComment &&
    (realtimeEnabled
      ? realtimeClaimsReady && realtimeProvider?.hasSharedHistory()
      : canEditDocument);
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
  const canReturnToDeviceDraft =
    realtimeSnapshot.syncState === 'saved' &&
    realtimeSnapshot.pendingUpdateCount === 0 &&
    realtimeSnapshot.queuedUpdateCount === 0;
  const returnToDeviceDraft = () => {
    const current = realtimeProvider?.getSnapshot();
    if (
      accountCopyOpen &&
      current?.syncState === 'saved' &&
      current.pendingUpdateCount === 0 &&
      current.queuedUpdateCount === 0
    ) {
      const target = new URL(window.location.href);
      target.searchParams.set(DEVICE_DRAFT_QUERY_PARAM, '1');
      if (target.href === window.location.href) window.location.reload();
      else window.location.assign(target.href);
    }
  };
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
      {canOpenHistory ? (
        <button
          type="button"
          className="lash-document-history-button lash-document-status-item"
          data-testid="document-history-button"
          aria-expanded={historyVisible}
          aria-controls={railOpen ? 'lash-rail' : undefined}
          onClick={(event) => openActivityPanel('history', event.currentTarget)}
        >
          History
        </button>
      ) : null}
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
      {Boolean(remotePeers?.length) ? (
        <div
          className="lash-realtime-peers lash-document-status-item"
          aria-label="Collaborators online"
        >
          {remotePeers?.map((peer) => (
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

  const remoteCursorMarkers = useMemo(
    () =>
      remotePeers?.map((peer) => {
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
      }),
    [remotePeers],
  );

  const handleOpenMobileSidebar = useCallback(() => {
    cancelPendingMobileRailAction();
    dispatchChrome({ type: 'open-sidebar' });
  }, [cancelPendingMobileRailAction]);

  const closeMobileSidebar = useCallback(() => {
    dispatchChrome({ type: 'close-sidebar' });
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

  const updateLocalDocumentIndex = useCallback(
    (storage: Storage | undefined) => {
      if (!storage) return;
      try {
        setDocuments(
          upsertDocument(storage, {
            id: activeDocumentId,
            title: docTitle.trim() || DEFAULT_DOC_TITLE,
          }),
        );
        setDocumentIndexNeedsRetry(false);
      } catch {
        setDocumentIndexNeedsRetry(true);
      }
    },
    [activeDocumentId, docTitle],
  );

  const handleLocalBodySave = useCallback(
    ({ docJson, savedAt }: AutosaveSaveContext) => {
      if (realtimeEnabled) {
        throw new Error('Local body persistence cannot run while realtime is authoritative.');
      }
      const storage = browserLocalStorage();
      let envelope: LocalBodyEnvelope;
      try {
        if (!storage) {
          throw new LocalBodyPersistenceError(
            'storage-unavailable',
            'Browser local storage could not be acquired.',
          );
        }
        envelope = saveLocalDocumentBody({
          storage,
          documentId: activeDocumentId,
          doc: docJson,
          expected: localBodyExpectedRef.current,
          savedAt,
          suggestions: localSuggestionsRef.current,
          divergentHistoryHead: divergentHistoryMarkerRef.current,
          firstHistoryPending: firstHistoryPendingForLocalSave(),
          validateSchema: validateLocalBodySchema,
        });
      } catch (error) {
        if (error instanceof LocalBodyPersistenceError && error.code === 'conflict') {
          setLocalBody({ kind: 'conflict', detail: error.message });
        } else {
          setLocalBody((body) =>
            body.kind === 'ready'
              ? {
                  kind: 'ready',
                  notice: {
                    kind: 'save-error',
                    detail: error instanceof Error ? error.message : String(error),
                  },
                }
              : body,
          );
        }
        throw error;
      }

      publishVerifiedLocalBody(envelope);
      updateLocalDocumentIndex(storage);
    },
    [
      activeDocumentId,
      firstHistoryPendingForLocalSave,
      publishVerifiedLocalBody,
      realtimeEnabled,
      updateLocalDocumentIndex,
      validateLocalBodySchema,
    ],
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
      divergentHistoryMarkerRef.current = promoted.divergentHistoryHead;
      recoveredLocalBodyRef.current = null;
      localBodyMutationsAllowedRef.current = true;
      if (canEditDocument) localRecoveryFocusDocumentRef.current = activeDocumentId;
      setLocalBody({ kind: 'ready' });
      updateLocalDocumentIndex(storage);
    } catch (error) {
      if (error instanceof LocalBodyPersistenceError && error.code === 'conflict') {
        // A newer primary appeared while the recovered backup was awaiting
        // confirmation. Keep this recovery draft transaction-locked and offer
        // reload; do not advertise an editable state while the guard is closed.
        setLocalBody({
          kind: 'recovered-awaiting-confirmation',
          notice: { kind: 'conflict', detail: error.message },
        });
        return;
      }
      localBodyMutationsAllowedRef.current = false;
      editor.setEditable(false);
      setLocalBody({
        kind: 'recovered-awaiting-confirmation',
        notice: {
          kind: 'recovery-error',
          detail: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }, [
    activeDocumentId,
    canEditDocument,
    editor,
    realtimeEnabled,
    updateLocalDocumentIndex,
    validateLocalBodySchema,
  ]);

  useEffect(() => {
    if (realtimeEnabled || localBodyState !== 'ready') return;
    const primaryKey = localDocumentBodyKey(activeDocumentId);
    const handleBodyStorage = (event: StorageEvent) => {
      if (event.key !== primaryKey) return;
      const storage = browserLocalStorage();
      if (!storage) {
        setLocalBody({ kind: 'unavailable' });
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
      setLocalBody({ kind: 'conflict' });
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
      discussionExpanded={railVisible && ['chat', 'history', 'ai'].includes(activeTab)}
      shareExpanded={
        runtimeMode === 'development-loopback'
          ? railVisible && activeTab === 'share'
          : shareDialogOpen || shareCopyOpen
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
      onChange={selectRailTab}
      tabs={namedComment ? railTabs.filter(({ id }) => id === 'chat') : railTabs}
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
          mobileViewport={chrome.viewport === 'mobile'}
          mobileDrawer={
            chrome.drawer === 'rail'
              ? { kind: 'rail', trigger: mobileRailFocusRequest.trigger }
              : chrome.drawer === 'sidebar'
                ? { kind: 'sidebar' }
                : null
          }
          restoreMobileDrawerFocus={mobileRailFocusRequest.restoreFocus}
          onMobileDrawerClose={mobileRailOpen ? closeActivityRail : closeMobileSidebar}
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

                {deviceDraft && !realtimeEnabled ? (
                  <div className="lash-local-body-notice" data-testid="promotion-recovery-notice">
                    <span role="status">Your edits are still in this device draft.</span>
                    <button
                      type="button"
                      className="lash-local-body-notice-action"
                      onClick={(event) => openSharePanel(event.currentTarget)}
                    >
                      Account save options
                    </button>
                  </div>
                ) : null}
                {accountCopyOpen ? (
                  <div className="lash-local-body-notice" data-testid="account-copy-notice">
                    <span role="status">
                      {canReturnToDeviceDraft
                        ? 'You’re editing the account copy. Your device draft is still here.'
                        : 'Wait for the account copy to save before returning to the device draft.'}
                    </span>
                    <button
                      type="button"
                      className="lash-local-body-notice-action"
                      disabled={!canReturnToDeviceDraft}
                      onClick={returnToDeviceDraft}
                    >
                      Return to device draft
                    </button>
                  </div>
                ) : null}

                {documentCreateError ? (
                  <p className="lash-local-body-notice" data-kind="save-error" role="alert">
                    Couldn’t create a document in this browser. Try again.
                  </p>
                ) : null}

                {!realtimeEnabled && documentIndexNeedsRetry ? (
                  <div
                    className="lash-local-body-notice"
                    data-kind="save-error"
                    data-testid="document-index-notice"
                    role="status"
                  >
                    <span>Lash couldn’t update the document list.</span>
                    <button
                      type="button"
                      className="lash-local-body-notice-action"
                      disabled={!canEditDocument}
                      onClick={() =>
                        runDocumentMetadataMutation(() =>
                          updateLocalDocumentIndex(browserLocalStorage()),
                        )
                      }
                    >
                      Retry updating the list
                    </button>
                  </div>
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
                  {remoteCursorMarkers?.length ? (
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
                {editor && !isFocusMode && (canCommentOnSelection || canReviseSelection) ? (
                  <SelectionActions
                    editor={editor}
                    onComment={canCommentOnSelection ? handleSelectionComment : undefined}
                    onRevise={canReviseSelection ? handleSelectionRevision : undefined}
                  />
                ) : null}
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
        adjuncts={ownerShare.phase === 'blocked' ? ownerShare.adjuncts : NO_SHARE_ADJUNCTS}
        detail={ownerShareDetail}
        documentTitle={docTitle.trim() || DEFAULT_DOC_TITLE}
        onClose={closeOwnerShareDialog}
        onPrimary={handleOwnerSharePrimary}
        onShareCopy={
          !staticPreview && deviceCopyEditor
            ? () => {
                if (openShareCopy(shareTriggerRef.current)) setOwnerShare({ phase: 'closed' });
              }
            : undefined
        }
        onCreateDeviceDraft={
          ownerShare.phase === 'promotion-recovery' && ownerShare.mayCreateDeviceDraft
            ? () => void createSeparateDeviceDraft()
            : undefined
        }
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
          setOwnerShare({ phase: 'closed' });
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
        state={shareCopy && !shareCopyOpen ? null : markdownDialogState}
        returnFocusTo={markdownTriggerRef.current}
        canShareCopy={canShareCopy}
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
