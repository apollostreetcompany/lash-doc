/**
 * panels/ChatPanel — selection-anchored doc chat with diff-aware threads.
 */
'use client';

import {
  createAnchor,
  isReviewId,
  mapAnchor,
  parseChatThreads,
  type ChatAnchor,
  type ChatMessage,
  type ChatThreadStatus,
  type ReviewMutation,
  type StoredChatThread,
} from '@lash/doc-chat';
import type { DocumentId } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  captureChatAnchorRange,
  projectChatDocumentText,
  resolveChatAnchorRange,
  type ChatDocumentText,
} from './chatAnchorPositions';
import type { ChatRealtimeStore, RealtimeChatThread } from '../../../lib/realtimeChatStore';
import { Icon } from '../../shell/Icon';

export type { ChatRealtimeStore } from '../../../lib/realtimeChatStore';

export type RequestDocumentNavigation = (navigateToTarget: () => void) => void;

export type AnchoredCommentRequest = Readonly<{
  editor: Editor;
  docId: DocumentId;
  document: Editor['state']['doc'];
  from: number;
  to: number;
}>;

export interface ChatPanelProps {
  showTestAiReply?: boolean;
  editor: Editor | null;
  docId: DocumentId;
  baseVersion: string | null;
  currentText: string;
  mutationEnabled: boolean;
  mutationUnavailableReason?: string;
  statusChangesEnabled?: boolean;
  realtimeStore?: ChatRealtimeStore | null;
  actorId?: string;
  anchoredCommentRequest?: AnchoredCommentRequest | null;
  onAnchoredCommentRequestHandled?: (request: AnchoredCommentRequest) => void;
  runDocumentMutation(mutate: () => void): boolean;
  requestDocumentNavigation?: RequestDocumentNavigation;
  onThreadCountChange?: (count: number) => void;
  suggestionComposer?: ReactNode;
  renderSuggestion?: (thread: StoredChatThread, stale: boolean) => ReactNode;
  open?: boolean;
}

type ChatFilter = 'all' | 'author' | 'ai';
type LocalThread = RealtimeChatThread;
type ThreadView = {
  thread: LocalThread;
  mappedAnchor: ChatAnchor;
};
type AnchorMarker = {
  threadId: string;
  top: number;
  left: number;
  label: string;
};
type NewThreadDraft = {
  editor: Editor;
  docId: DocumentId;
  document: Editor['state']['doc'];
  store: ChatRealtimeStore | null;
  anchor: ChatAnchor;
  quote: string;
  historyText: string;
};
type EmailDraftCopy = { draft: NewThreadDraft } & (
  | { mode: 'offered' | 'manual' }
  | { mode: 'copied'; body: string }
);

const emailDraftBody = (quote: string, comment: string) => {
  const quoted = quote
    .split(/\r\n|\r|\n/gu)
    .map((line) => `> ${line}`)
    .join('\r\n');
  return `${quoted}\r\n\r\n${comment.replace(/\r\n|\r|\n/gu, '\r\n')}`;
};

const LOCAL_USER = { type: 'user', id: 'local-user' } as const;
const AI_USER = { type: 'ai', id: 'ai-doc-chat', label: 'AI Doc Chat' } as const;

const selectedText = (editor: Editor | null): string => {
  if (!editor) return '';
  const { from, to, empty } = editor.state.selection;
  if (empty) return '';
  return editor.state.doc.textBetween(from, to, '\n');
};

const threadMatchesFilter = (thread: LocalThread, filter: ChatFilter, actorId: string) => {
  if (filter === 'all') return true;
  if (filter === 'author') {
    return thread.messages.some((message) => message.author.id === actorId);
  }
  return thread.messages.some((message) => message.author.type === 'ai');
};

const domId = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '-');
const threadStorageKey = (docId: DocumentId) => `lash:chat-threads:${docId}`;
const nowIso = () => new Date().toISOString();

const createLocalId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
};

const mapThreadAnchor = (
  thread: LocalThread,
  editor: Editor | null,
  projection: ChatDocumentText | null,
  currentText: string,
  baseVersion: string | null,
): ChatAnchor => {
  const { anchor, historyText } = thread;
  if (thread.detached || thread.proposal?.status === 'accepted')
    return { ...anchor, orphaned: true };
  if (anchor.relativeRange) {
    const range = editor && resolveChatAnchorRange(editor, anchor.relativeRange);
    const mapped = range && projection?.toTextRange(range);
    const matchesProjection =
      !thread.projected ||
      (mapped && projection?.text.slice(mapped.from, mapped.to) === anchor.token.text);
    return mapped && matchesProjection
      ? { ...anchor, ...mapped, orphaned: false }
      : { ...anchor, orphaned: true };
  }
  if (
    historyText === currentText &&
    currentText.slice(anchor.from, anchor.to) === anchor.token.text
  ) {
    return { ...anchor, orphaned: false };
  }
  return mapAnchor({
    anchor,
    baseDoc: { text: historyText },
    ops: [],
    currentDoc: { text: currentText },
    targetVersion: baseVersion ?? anchor.baseVersion,
  });
};

const scrollSelectionIntoView = () => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const { startContainer } = selection.getRangeAt(0);
  const element =
    startContainer.nodeType === Node.ELEMENT_NODE
      ? (startContainer as Element)
      : startContainer.parentElement;
  element?.scrollIntoView({ block: 'center', inline: 'nearest' });
};

const selectReadOnlyDocumentTarget = (editor: Editor, range: { from: number; to: number }) => {
  const { view } = editor;
  const { dom } = view;
  const document = dom.ownerDocument;
  const selection = document.getSelection();
  if (!selection || !editor.commands.setTextSelection(range)) return false;

  // ProseMirror does not focus a read-only editor when its model selection changes.
  // Show still needs a native selection so readers can see the targeted text.
  const previousFocus = document.activeElement;
  let selected = false;
  let applied = false;
  try {
    dom.focus({ preventScroll: true });
    if (document.activeElement !== dom) return false;
    const start = view.domAtPos(range.from, 1);
    const end = view.domAtPos(range.to, -1);
    if (!dom.contains(start.node) || !dom.contains(end.node)) return false;
    const target = document.createRange();
    target.setStart(start.node, start.offset);
    target.setEnd(end.node, end.offset);
    if (target.collapsed) return false;
    selection.removeAllRanges();
    selection.addRange(target);
    applied = true;
    const observed = selection.rangeCount === 1 ? selection.getRangeAt(0) : null;
    selected =
      !!observed &&
      !observed.collapsed &&
      view.posAtDOM(observed.startContainer, observed.startOffset) === range.from &&
      view.posAtDOM(observed.endContainer, observed.endOffset) === range.to;
    return selected;
  } catch {
    return false;
  } finally {
    if (!selected && applied) selection.removeAllRanges();
    if (!selected && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  }
};

const sameThreads = (left: LocalThread[], right: LocalThread[]) =>
  JSON.stringify(left) === JSON.stringify(right);

const readThreadsFromStorage = (docId: DocumentId) => {
  if (typeof window === 'undefined') return [];
  try {
    return parseChatThreads(window.localStorage.getItem(threadStorageKey(docId)), docId);
  } catch {
    return [];
  }
};

const writeThreadsToStorage = (docId: DocumentId, threads: LocalThread[]) => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(threadStorageKey(docId), JSON.stringify(threads));
    return true;
  } catch {
    return false;
  }
};

export function ChatPanel({
  editor,
  docId,
  baseVersion,
  currentText,
  mutationEnabled,
  mutationUnavailableReason = 'This shared access is read-only. Existing threads remain available to read and navigate.',
  statusChangesEnabled = true,
  realtimeStore = null,
  actorId = LOCAL_USER.id,
  anchoredCommentRequest,
  onAnchoredCommentRequestHandled,
  runDocumentMutation,
  requestDocumentNavigation,
  onThreadCountChange,
  suggestionComposer,
  renderSuggestion,
  showTestAiReply = false,
  open = true,
}: ChatPanelProps) {
  const [threads, setThreads] = useState<LocalThread[]>([]);
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [anchorJumpStatus, setAnchorJumpStatus] = useState('');
  const [postStatus, setPostStatus] = useState('');
  const [postError, setPostError] = useState('');
  const [reviewReady, setReviewReady] = useState(false);
  const [sendingReview, setSendingReview] = useState(false);
  const [newThreadDraft, setNewThreadDraft] = useState<NewThreadDraft | null>(null);
  const [newThreadBody, setNewThreadBody] = useState('');
  const [emailDraftCopy, setEmailDraftCopy] = useState<EmailDraftCopy | null>(null);
  const threadsRef = useRef<LocalThread[]>([]);
  const createThreadButtonRef = useRef<HTMLButtonElement>(null);
  const newThreadTextareaRef = useRef<HTMLTextAreaElement>(null);
  const manualEmailCopyRef = useRef<HTMLTextAreaElement>(null);
  const handledCommentRequestRef = useRef<AnchoredCommentRequest | null>(null);
  const pendingThreadFocusRef = useRef<string | null>(null);
  const pendingThreadIdRef = useRef<string | null>(null);
  const reviewInFlightRef = useRef(false);

  const publishThreads = useCallback((nextThreads: LocalThread[]) => {
    threadsRef.current = nextThreads;
    setThreads((current) => (sameThreads(current, nextThreads) ? current : nextThreads));
  }, []);

  useEffect(() => {
    if (realtimeStore) {
      const handleRemoteThreads = () => {
        publishThreads(realtimeStore.readThreads(docId));
        setReviewReady(realtimeStore.isReady());
      };
      handleRemoteThreads();
      return realtimeStore.subscribe(handleRemoteThreads);
    }
    setReviewReady(false);
    publishThreads(readThreadsFromStorage(docId));
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== threadStorageKey(docId)) return;
      publishThreads(parseChatThreads(event.newValue, docId));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [docId, publishThreads, realtimeStore]);

  useEffect(() => {
    onThreadCountChange?.(threads.length);
  }, [onThreadCountChange, threads.length]);

  const updateLocalThreads = (update: (current: LocalThread[]) => LocalThread[]) => {
    const nextThreads = update(threadsRef.current);
    let saved = false;
    const applied = runDocumentMutation(() => {
      saved = writeThreadsToStorage(docId, nextThreads);
    });
    if (applied && saved) publishThreads(nextThreads);
    else setPostError('Lash could not save this discussion change. Try again.');
    return applied && saved;
  };

  const submitReview = async (mutation: ReviewMutation) => {
    if (!realtimeStore || !mutationEnabled || reviewInFlightRef.current) return false;
    reviewInFlightRef.current = true;
    setSendingReview(true);
    setPostError('');
    try {
      const result = await realtimeStore.submit(mutation);
      if (!result.ok) setPostError(result.message);
      return result.ok;
    } finally {
      reviewInFlightRef.current = false;
      setSendingReview(false);
    }
  };

  const canMutateThreads = mutationEnabled && (!realtimeStore || reviewReady);
  const chatActionsDisabled = !canMutateThreads || sendingReview;
  const selectionText = selectedText(editor);
  const showSelectionGuide =
    canMutateThreads && Boolean(editor && !editor.isDestroyed) && !selectionText && !newThreadDraft;
  const visibleThreads = useMemo(
    () => threads.filter((thread) => threadMatchesFilter(thread, filter, actorId)),
    [actorId, filter, threads],
  );
  const editorDoc = editor?.state.doc;
  const hasVisibleThreads = visibleThreads.length > 0;
  const projection = useMemo(
    () =>
      open && hasVisibleThreads && editor && editorDoc ? projectChatDocumentText(editor) : null,
    [editor, editorDoc, hasVisibleThreads, open],
  );
  const threadViews = useMemo(
    () =>
      visibleThreads.map((thread) => ({
        thread,
        mappedAnchor: mapThreadAnchor(
          thread,
          editor,
          projection,
          projection?.text ?? currentText,
          baseVersion,
        ),
      })),
    [baseVersion, currentText, editor, projection, visibleThreads],
  ) satisfies ThreadView[];
  const [anchorMarkers, setAnchorMarkers] = useState<AnchorMarker[]>([]);

  useEffect(() => {
    if (newThreadDraft) {
      newThreadTextareaRef.current?.focus();
    }
  }, [newThreadDraft]);

  useEffect(() => {
    if (emailDraftCopy?.draft === newThreadDraft && emailDraftCopy.mode === 'manual') {
      manualEmailCopyRef.current?.focus();
      manualEmailCopyRef.current?.select();
    }
  }, [emailDraftCopy, newThreadDraft]);

  useEffect(() => {
    setNewThreadDraft(null);
    setNewThreadBody('');
    setEmailDraftCopy(null);
    setPostStatus('');
    setPostError('');
    setReplyDrafts({});
    pendingThreadFocusRef.current = null;
    pendingThreadIdRef.current = null;
  }, [docId]);

  useEffect(() => {
    if (!editor || !projection || !open || !threadViews.length) {
      setAnchorMarkers([]);
      return;
    }
    let frame: number | null = null;
    const updateMarkers = () => {
      if (editor.isDestroyed || editor.state.doc !== editorDoc) return;
      const gutterLeft = editor.view.dom.getBoundingClientRect().right + 6;
      const nextMarkers = threadViews.flatMap(({ thread, mappedAnchor }) => {
        if (mappedAnchor.orphaned) return [];
        const range = projection.toEditorRange(mappedAnchor);
        if (!range) return [];
        try {
          const coords = editor.view.coordsAtPos(range.from);
          return [
            {
              threadId: thread.id,
              top: coords.top - 2,
              left: gutterLeft,
              label: thread.anchor.token.text,
            },
          ];
        } catch {
          return [];
        }
      });
      nextMarkers.sort((first, second) => first.top - second.top);
      for (let index = 1; index < nextMarkers.length; index += 1) {
        const marker = nextMarkers[index];
        const previous = nextMarkers[index - 1];
        if (marker && previous) marker.top = Math.max(marker.top, previous.top + 28);
      }
      setAnchorMarkers(nextMarkers);
    };
    const scheduleUpdate = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(updateMarkers);
    };
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleUpdate) : null;
    resize?.observe(editor.view.dom);
    scheduleUpdate();
    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);
    editor.on('transaction', scheduleUpdate);
    editor.on('selectionUpdate', scheduleUpdate);
    return () => {
      resize?.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
      editor.off('transaction', scheduleUpdate);
      editor.off('selectionUpdate', scheduleUpdate);
    };
  }, [editor, editorDoc, open, projection, threadViews]);
  const threadViewsById = useMemo(
    () => new Map(threadViews.map((view) => [view.thread.id, view])),
    [threadViews],
  );

  useEffect(() => {
    const threadId = pendingThreadFocusRef.current;
    if (!threadId) return;
    const thread = document.getElementById(`chat-thread-${domId(threadId)}`);
    if (!thread) return;
    pendingThreadFocusRef.current = null;
    thread.focus();
  }, [activeThreadId, threadViews]);

  const openThreadDraft = useCallback(
    (range: { from: number; to: number }, exact = false) => {
      if (
        !editor ||
        editor.isDestroyed ||
        !mutationEnabled ||
        reviewInFlightRef.current ||
        (realtimeStore ? !realtimeStore.isReady() : !baseVersion)
      ) {
        setPostError('Commenting is unavailable right now.');
        return;
      }
      const documentText = projectChatDocumentText(editor);
      const textRange = documentText.toTextRange(range);
      const editorRange = textRange && documentText.toEditorRange(textRange);
      const relativeRange =
        realtimeStore && editorRange ? captureChatAnchorRange(editor, editorRange) : null;
      if (
        !textRange ||
        !editorRange ||
        (exact && (editorRange.from !== range.from || editorRange.to !== range.to)) ||
        (realtimeStore && !relativeRange)
      ) {
        setPostError('This selection is unavailable. Select the text again.');
        return;
      }
      setNewThreadDraft({
        editor,
        docId,
        document: editor.state.doc,
        store: realtimeStore,
        anchor: {
          ...createAnchor({
            baseVersion: realtimeStore ? null : baseVersion,
            docText: documentText.text,
            ...textRange,
          }),
          ...(relativeRange ? { relativeRange } : {}),
        },
        quote: documentText.text.slice(textRange.from, textRange.to),
        historyText: realtimeStore ? '' : documentText.text,
      });
      setNewThreadBody('');
      setEmailDraftCopy(null);
      setPostError('');
      setPostStatus('');
    },
    [baseVersion, docId, editor, mutationEnabled, realtimeStore],
  );

  useEffect(() => {
    const request = anchoredCommentRequest;
    if (!open || !request || handledCommentRequestRef.current === request) return;
    handledCommentRequestRef.current = request;

    if (newThreadDraft) {
      setPostError('Finish or cancel this comment before starting another.');
      newThreadTextareaRef.current?.focus();
    } else if (
      !editor ||
      editor.isDestroyed ||
      request.editor !== editor ||
      request.docId !== docId ||
      request.document !== editor.state.doc
    ) {
      setPostError('This selection is unavailable. Select the text again.');
    } else {
      openThreadDraft(request, true);
    }
    onAnchoredCommentRequestHandled?.(request);
  }, [
    anchoredCommentRequest,
    docId,
    editor,
    newThreadDraft,
    onAnchoredCommentRequestHandled,
    open,
    openThreadDraft,
  ]);

  if (!open) return null;

  const cancelThreadDraft = () => {
    setNewThreadDraft(null);
    setNewThreadBody('');
    setEmailDraftCopy(null);
    setPostError('');
    pendingThreadIdRef.current = null;
    window.requestAnimationFrame(() => createThreadButtonRef.current?.focus());
  };

  const focusDocumentForSelection = () => {
    if (!editor || editor.isDestroyed) return;
    const focusEditor = () => {
      if (editor.isDestroyed) return;
      editor.commands.focus();
    };
    if (requestDocumentNavigation) {
      requestDocumentNavigation(focusEditor);
      return;
    }
    focusEditor();
  };

  const getDeliverableDraft = () => {
    const draft = newThreadDraft;
    if (!draft || !newThreadBody.trim() || chatActionsDisabled || reviewInFlightRef.current) {
      return null;
    }
    if (realtimeStore && !realtimeStore.isReady()) {
      setPostError('Reconnect to the document to use this comment.');
      return null;
    }
    if (
      !editor ||
      editor.isDestroyed ||
      draft.editor !== editor ||
      draft.docId !== docId ||
      draft.store !== realtimeStore
    ) {
      setPostError('This comment belongs to a different document.');
      return null;
    }
    const relativeRange = draft.anchor.relativeRange;
    if (relativeRange) {
      const range = resolveChatAnchorRange(editor, relativeRange);
      const projection = projectChatDocumentText(editor);
      const textRange = range && projection.toTextRange(range);
      if (textRange && projection.text.slice(textRange.from, textRange.to) === draft.quote) {
        return draft;
      }
    } else if (draft.document === editor.state.doc) {
      return draft;
    }
    setPostError('The selected text changed. Select the text again to start a new comment.');
    return null;
  };

  const openEmailDraft = () => {
    const draft = getDeliverableDraft();
    if (!draft) return;
    setEmailDraftCopy({ draft, mode: 'offered' });
    try {
      const subject = encodeURIComponent('Comment on a passage');
      const body = encodeURIComponent(emailDraftBody(draft.quote, newThreadBody));
      const email = document.createElement('a');
      email.href = `mailto:?subject=${subject}&body=${body}`;
      email.click();
      setPostError('');
    } catch {
      setPostError('Lash could not open this email draft. Copy the quote and comment instead.');
    }
  };

  const copyEmailDraft = async () => {
    const draft = getDeliverableDraft();
    if (!draft) return;
    const body = emailDraftBody(draft.quote, newThreadBody);
    let result: EmailDraftCopy = { draft, mode: 'manual' };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(body);
        result = { draft, mode: 'copied', body };
      }
    } catch {
      // A selectable copy is still available when clipboard permission is denied.
    }
    setEmailDraftCopy((current) => (current?.draft === draft ? result : current));
  };

  const createThread = async () => {
    const draft = getDeliverableDraft();
    if (!draft) return;
    const body = newThreadBody.trim();
    const id =
      pendingThreadIdRef.current ?? (realtimeStore ? crypto.randomUUID() : createLocalId('thread'));
    pendingThreadIdRef.current = id;
    const ts = nowIso();
    const createLocalThread = (items: LocalThread[]): LocalThread[] => {
      const message: ChatMessage = {
        id: createLocalId('message'),
        threadId: id,
        author: LOCAL_USER,
        ts,
        body,
      };
      return [
        ...items,
        {
          id,
          docId,
          anchor: draft.anchor,
          messages: [message],
          filters: {},
          historyText: draft.historyText,
          status: 'open',
          resolvedAt: null,
          updatedAt: ts,
        },
      ];
    };
    const created = realtimeStore
      ? await submitReview({
          type: 'create',
          threadId: id,
          anchor: { ...draft.anchor, baseVersion: null },
          body,
        })
      : updateLocalThreads(createLocalThread);
    if (!created) return;
    pendingThreadFocusRef.current = id;
    setActiveThreadId(id);
    setFilter('all');
    setPostStatus('Comment posted.');
    setNewThreadDraft(null);
    setNewThreadBody('');
    setEmailDraftCopy(null);
    pendingThreadIdRef.current = null;
  };

  const addLocalReply = (threadId: string, author: ChatMessage['author'], body: string) => {
    const trimmed = body.trim();
    if (!trimmed || chatActionsDisabled || realtimeStore) return false;
    return updateLocalThreads((items) =>
      items.map((thread) => {
        if (thread.id !== threadId) return thread;
        const ts = nowIso();
        return {
          ...thread,
          messages: [
            ...thread.messages,
            {
              id: createLocalId('message'),
              threadId,
              author,
              ts,
              body: trimmed,
            },
          ],
          updatedAt: ts,
        };
      }),
    );
  };

  const addUserReply = async (threadId: string, body: string) => {
    if (
      chatActionsDisabled ||
      !body.trim() ||
      threadsRef.current.find(({ id }) => id === threadId)?.detached
    )
      return;
    const added = realtimeStore
      ? await submitReview({ type: 'reply', threadId, body })
      : addLocalReply(threadId, LOCAL_USER, body);
    if (added) setReplyDrafts((drafts) => ({ ...drafts, [threadId]: '' }));
  };

  const addAiReply = (threadId: string) => {
    if (showTestAiReply && !realtimeStore) addLocalReply(threadId, AI_USER, 'Fixture AI reply.');
  };

  const setThreadStatus = async (threadId: string, status: ChatThreadStatus) => {
    if (chatActionsDisabled || !statusChangesEnabled) return;
    if (realtimeStore) {
      await submitReview({ type: 'status', threadId, status });
      return;
    }
    updateLocalThreads((items) =>
      items.map((thread) => {
        if (thread.id !== threadId) return thread;
        const ts = nowIso();
        return {
          ...thread,
          status,
          resolvedAt: status === 'resolved' ? ts : null,
          updatedAt: ts,
        };
      }),
    );
  };

  const jumpToMappedAnchor = (
    mappedAnchor: { from: number; to: number; orphaned?: boolean },
    thread: LocalThread,
  ) => {
    setActiveThreadId(thread.id);
    if (!editor || mappedAnchor.orphaned) {
      setAnchorJumpStatus(`Document target for ${thread.anchor.token.text} is unavailable.`);
      return;
    }
    const selectDocumentTarget = () => {
      if (editor.isDestroyed) return;
      const documentText =
        editor.state.doc === editorDoc && projection ? projection : projectChatDocumentText(editor);
      const liveAnchor = mapThreadAnchor(
        thread,
        editor,
        documentText,
        documentText.text,
        baseVersion,
      );
      const range = !liveAnchor.orphaned && documentText.toEditorRange(liveAnchor);
      const selected =
        range &&
        (editor.isEditable
          ? editor.chain().focus().setTextSelection(range).run()
          : selectReadOnlyDocumentTarget(editor, range));
      if (!selected) {
        setAnchorJumpStatus(`Document target for ${thread.anchor.token.text} is unavailable.`);
        return;
      }
      scrollSelectionIntoView();
      setAnchorJumpStatus(`Selected ${thread.anchor.token.text} in the document.`);
    };
    if (requestDocumentNavigation) {
      requestDocumentNavigation(selectDocumentTarget);
      return;
    }
    selectDocumentTarget();
  };

  return (
    <section className="lash-chat-panel" data-testid="doc-chat-panel" aria-label="Document chat">
      {anchorMarkers.map((marker) => {
        const view = threadViewsById.get(marker.threadId);
        if (!view) return null;
        return (
          <button
            key={marker.threadId}
            type="button"
            className="chat-document-anchor-marker"
            data-testid="chat-document-anchor-marker"
            data-active={activeThreadId === marker.threadId ? 'true' : 'false'}
            style={{ top: marker.top, left: marker.left }}
            aria-label={`Comment thread on ${marker.label}`}
            onClick={() => {
              jumpToMappedAnchor(view.mappedAnchor, view.thread);
              document
                .getElementById(`chat-thread-${domId(marker.threadId)}`)
                ?.scrollIntoView({ block: 'nearest' });
            }}
          >
            <Icon name="message" />
          </button>
        );
      })}
      <div className="chat-panel-header">
        <span className="chat-panel-count" data-testid="chat-count">
          {visibleThreads.length} {visibleThreads.length === 1 ? 'thread' : 'threads'}
        </span>
      </div>

      {!mutationEnabled ? (
        <p role="status" data-testid="chat-mutation-unavailable">
          {mutationUnavailableReason}
        </p>
      ) : realtimeStore && !reviewReady ? (
        <p role="status" data-testid="chat-connection-unavailable">
          Shared discussion is unavailable on this connection.
        </p>
      ) : null}

      <div className="chat-controls">
        {showSelectionGuide ? (
          <div className="chat-selection-guide" data-testid="chat-selection-guide">
            <p>Select text in the document to start a comment.</p>
            <button
              type="button"
              className="chat-action-button chat-selection-action"
              data-testid="chat-select-document-text"
              onClick={focusDocumentForSelection}
            >
              Select text in document
            </button>
          </div>
        ) : (
          <button
            ref={createThreadButtonRef}
            type="button"
            className="chat-action-button"
            data-testid="chat-create-thread"
            disabled={
              chatActionsDisabled ||
              !selectionText ||
              (!realtimeStore && !baseVersion) ||
              Boolean(newThreadDraft)
            }
            aria-expanded={Boolean(newThreadDraft)}
            aria-controls="chat-new-thread-composer"
            onClick={() => editor && openThreadDraft(editor.state.selection)}
          >
            Add comment
          </button>
        )}
        {threads.length ? (
          <>
            <button
              type="button"
              className="chat-filter-button"
              data-testid="chat-filter-author"
              data-active={filter === 'author' ? 'true' : 'false'}
              onClick={() => setFilter('author')}
            >
              {realtimeStore ? 'My threads' : LOCAL_USER.id}
            </button>
            {threads.some((thread) => !thread.projected) ? (
              <button
                type="button"
                className="chat-filter-button"
                data-testid="chat-filter-ai"
                data-active={filter === 'ai' ? 'true' : 'false'}
                onClick={() => setFilter('ai')}
              >
                AI
              </button>
            ) : null}
            <button
              type="button"
              className="chat-filter-button"
              data-testid="chat-filter-clear"
              onClick={() => setFilter('all')}
            >
              All
            </button>
          </>
        ) : null}
      </div>
      {newThreadDraft ? (
        <form
          id="chat-new-thread-composer"
          className="chat-new-thread-composer"
          data-testid="chat-new-thread-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void createThread();
          }}
        >
          <div className="chat-new-thread-context">
            <span className="chat-context-label">Selected text</span>
            <blockquote
              id="chat-new-thread-quote"
              className="chat-new-thread-quote"
              data-testid="chat-new-thread-quote"
            >
              {newThreadDraft.quote}
            </blockquote>
          </div>
          <label className="chat-new-thread-label" htmlFor="chat-new-thread-comment">
            Comment
          </label>
          <textarea
            ref={newThreadTextareaRef}
            id="chat-new-thread-comment"
            className="chat-new-thread-textarea"
            data-testid="chat-new-thread-textarea"
            aria-describedby="chat-new-thread-quote"
            placeholder="Write your comment"
            rows={3}
            disabled={chatActionsDisabled}
            value={newThreadBody}
            onChange={(event) => setNewThreadBody(event.target.value)}
          />
          <p className="chat-new-thread-quote">
            {realtimeStore ? 'Post to shared discussion.' : 'Post on this device.'} Email opens a
            draft for you to address and send.
          </p>
          <div className="chat-new-thread-actions">
            <button
              type="button"
              className="chat-action-button"
              data-testid="chat-cancel-thread"
              disabled={sendingReview}
              onClick={cancelThreadDraft}
            >
              Cancel
            </button>
            <button
              type="button"
              className="chat-action-button"
              data-testid="chat-open-email-draft"
              disabled={chatActionsDisabled || !newThreadBody.trim()}
              onClick={openEmailDraft}
            >
              Open email draft
            </button>
            <button
              type="submit"
              className="chat-action-button"
              data-testid="chat-post-thread"
              disabled={chatActionsDisabled || !newThreadBody.trim()}
            >
              {sendingReview ? 'Posting…' : 'Post comment'}
            </button>
          </div>
          {emailDraftCopy?.draft === newThreadDraft ? (
            <>
              <button
                type="button"
                className="chat-action-button"
                data-testid="chat-copy-email-draft"
                disabled={chatActionsDisabled || !newThreadBody.trim()}
                onClick={() => void copyEmailDraft()}
              >
                Copy quote and comment
              </button>
              {emailDraftCopy.mode === 'copied' &&
              emailDraftCopy.body === emailDraftBody(newThreadDraft.quote, newThreadBody) ? (
                <p role="status" className="chat-new-thread-quote">
                  Quote and comment copied.
                </p>
              ) : emailDraftCopy.mode === 'manual' && !chatActionsDisabled ? (
                <textarea
                  ref={manualEmailCopyRef}
                  className="chat-new-thread-textarea"
                  aria-label="Quote and comment to copy"
                  rows={4}
                  readOnly
                  value={emailDraftBody(newThreadDraft.quote, newThreadBody)}
                />
              ) : null}
            </>
          ) : null}
        </form>
      ) : null}
      {suggestionComposer}
      {postError ? (
        <p role="alert" data-testid="chat-post-error">
          {postError}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite" data-testid="chat-anchor-jump-status">
        {anchorJumpStatus}
      </p>
      <p className="sr-only" role="status" aria-live="polite" data-testid="chat-post-status">
        {postStatus}
      </p>

      {threadViews.length ? (
        <ol
          className="chat-thread-list"
          data-testid="chat-thread-list"
          aria-label="Document chat threads"
        >
          {threadViews.map(({ thread, mappedAnchor }) => {
            const accepted = thread.proposal?.status === 'accepted';
            const detached = thread.detached || (thread.projected && mappedAnchor.orphaned);
            const currentContext = accepted
              ? thread.proposal?.replacement || 'Original text removed'
              : mappedAnchor.orphaned
                ? 'Context lost'
                : (projection?.text ?? currentText).slice(mappedAnchor.from, mappedAnchor.to);
            const threadDomId = `chat-thread-${domId(thread.id)}`;
            const threadTitleId = `chat-thread-title-${domId(thread.id)}`;
            const threadTitle = detached
              ? 'Discussion thread'
              : `Thread on ${thread.anchor.token.text}`;
            const replyDraft = replyDrafts[thread.id] ?? '';
            const threadActionsDisabled =
              chatActionsDisabled || Boolean(realtimeStore && !isReviewId(thread.id));
            return (
              <li key={thread.id}>
                <article
                  id={threadDomId}
                  className="chat-thread"
                  data-testid="chat-thread"
                  data-orphaned={mappedAnchor.orphaned ? 'true' : 'false'}
                  data-active={activeThreadId === thread.id ? 'true' : 'false'}
                  aria-labelledby={threadTitleId}
                  tabIndex={0}
                  onFocus={() => setActiveThreadId(thread.id)}
                >
                  <h3 id={threadTitleId} className="sr-only">
                    {threadTitle}
                  </h3>
                  <div className="chat-thread-meta">
                    <span data-testid="chat-anchor-text">
                      {detached ? 'Selected text changed' : thread.anchor.token.text}
                    </span>
                    <span className="chat-thread-status" data-testid="chat-thread-status">
                      {thread.status === 'resolved' ? 'Resolved' : 'Open'}
                    </span>
                    {accepted || detached ? null : mappedAnchor.orphaned ? (
                      <span className="chat-orphan" data-testid="chat-orphaned">
                        Orphaned
                      </span>
                    ) : (
                      <span className="chat-anchor-status" data-testid="chat-anchor-status">
                        Anchored
                      </span>
                    )}
                  </div>
                  {!detached && (
                    <div className="chat-anchor-row" data-testid="chat-anchor-row">
                      <span className="chat-anchor-glyph" aria-hidden="true">
                        <Icon name="message" />
                      </span>
                      <div className="chat-anchor-copy">
                        <span className="chat-context-label">
                          {accepted
                            ? 'Accepted wording'
                            : mappedAnchor.orphaned
                              ? 'Detached target'
                              : 'Current target'}
                        </span>
                        <p className="chat-anchor-quote" data-testid="chat-current-target">
                          {currentContext}
                        </p>
                      </div>
                      {!accepted ? (
                        <button
                          type="button"
                          className="chat-anchor-jump"
                          data-testid="chat-jump-anchor"
                          disabled={mappedAnchor.orphaned}
                          aria-label={`Show document target for thread on ${thread.anchor.token.text}`}
                          onClick={() => jumpToMappedAnchor(mappedAnchor, thread)}
                        >
                          <Icon name="eye" />
                          <span>Show</span>
                        </button>
                      ) : null}
                    </div>
                  )}
                  {renderSuggestion?.(
                    thread,
                    Boolean(mappedAnchor.orphaned) || currentContext !== thread.anchor.token.text,
                  )}
                  {!accepted && !detached ? (
                    <div className="chat-context-grid" data-testid="chat-context-grid">
                      <div>
                        <span className="chat-context-label">
                          {thread.anchor.baseVersion ? 'History' : 'Original selection'}
                        </span>
                        <p data-testid="chat-history-context">{thread.anchor.token.text}</p>
                      </div>
                      <div>
                        <span className="chat-context-label">Current</span>
                        <p data-testid="chat-current-context">{currentContext}</p>
                      </div>
                    </div>
                  ) : null}
                  <ul
                    className="chat-message-list"
                    aria-label={
                      detached ? 'Discussion messages' : `Messages for ${thread.anchor.token.text}`
                    }
                  >
                    {thread.messages.map((message) => (
                      <li
                        key={message.id}
                        data-testid="chat-message"
                        data-author-id={message.author.id}
                        data-author-type={message.author.type}
                      >
                        {message.body}
                      </li>
                    ))}
                  </ul>
                  {!detached && (
                    <div className="chat-reply-row">
                      <input
                        className="chat-reply-input"
                        data-testid="chat-reply-input"
                        aria-label={`Reply to thread on ${thread.anchor.token.text}`}
                        disabled={threadActionsDisabled}
                        value={replyDraft}
                        onChange={(event) =>
                          setReplyDrafts((drafts) => ({
                            ...drafts,
                            [thread.id]: event.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="chat-action-button"
                        data-testid="chat-add-reply"
                        disabled={threadActionsDisabled || !replyDraft.trim()}
                        onClick={() => void addUserReply(thread.id, replyDraft)}
                      >
                        Reply
                      </button>
                    </div>
                  )}
                  <div className="chat-thread-actions">
                    {statusChangesEnabled &&
                      (thread.status === 'resolved' ? (
                        <button
                          type="button"
                          className="chat-action-button"
                          data-testid="chat-reopen-thread"
                          disabled={threadActionsDisabled}
                          onClick={() => void setThreadStatus(thread.id, 'open')}
                        >
                          Reopen
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="chat-action-button"
                          data-testid="chat-resolve-thread"
                          disabled={threadActionsDisabled}
                          onClick={() => void setThreadStatus(thread.id, 'resolved')}
                        >
                          Resolve
                        </button>
                      ))}
                    {showTestAiReply && !realtimeStore ? (
                      <button
                        type="button"
                        className="chat-action-button"
                        data-testid="chat-add-ai"
                        aria-label={`Add AI reply to thread on ${thread.anchor.token.text}`}
                        disabled={threadActionsDisabled}
                        onClick={() => addAiReply(thread.id)}
                      >
                        Add test AI reply
                      </button>
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      ) : showSelectionGuide ? null : (
        <p className="chat-empty" data-testid="chat-empty">
          No threads.
        </p>
      )}
    </section>
  );
}
