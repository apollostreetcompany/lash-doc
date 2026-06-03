/**
 * panels/ChatPanel — selection-anchored doc chat with diff-aware threads.
 */
'use client';

import { createAnchor, mapAnchor, type ChatMessage, type ChatThread } from '@lash/doc-chat';
import type { DocumentId } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';

export interface ChatPanelProps {
  editor: Editor | null;
  docId: DocumentId;
  baseVersion: string | null;
  currentText: string;
  realtimeDoc?: Y.Doc | null;
  open?: boolean;
}

type ChatFilter = 'all' | 'author' | 'ai';
type ThreadStatus = 'open' | 'resolved';
type LocalThread = ChatThread & {
  historyText: string;
  status: ThreadStatus;
  resolvedAt: string | null;
  updatedAt: string;
};

const LOCAL_USER = { type: 'user', id: 'local-user' } as const;
const AI_USER = { type: 'ai', id: 'ai-doc-chat', label: 'AI Doc Chat' } as const;
const CHAT_THREADS_YMAP = 'lash:chat-threads';

const selectedText = (editor: Editor | null): string => {
  if (!editor) return '';
  const { from, to, empty } = editor.state.selection;
  if (empty) return '';
  return editor.state.doc.textBetween(from, to, '\n');
};

const threadMatchesFilter = (thread: LocalThread, filter: ChatFilter) => {
  if (filter === 'all') return true;
  if (filter === 'author') {
    return thread.messages.some((message) => message.author.id === LOCAL_USER.id);
  }
  return thread.messages.some((message) => message.author.type === 'ai');
};

const domId = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '-');
const threadStorageKey = (docId: DocumentId) => `lash:chat-threads:${docId}`;
const threadYMapPrefix = (docId: DocumentId) => `${String(docId)}:`;
const threadYMapKey = (docId: DocumentId, threadId: string) =>
  `${threadYMapPrefix(docId)}${threadId}`;
const nowIso = () => new Date().toISOString();

const createLocalId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
};

const sameThreads = (left: LocalThread[], right: LocalThread[]) =>
  JSON.stringify(left) === JSON.stringify(right);

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const normalizeAuthor = (value: unknown): ChatMessage['author'] | null => {
  if (!isObject(value)) return null;
  const type = value.type;
  const id = value.id;
  if (typeof id !== 'string') return null;
  if (type === 'user' || type === 'system') return { type, id };
  if (type === 'ai') {
    return {
      type,
      id,
      label: typeof value.label === 'string' ? value.label : undefined,
    };
  }
  return null;
};

const normalizeMessage = (value: unknown): ChatMessage | null => {
  if (!isObject(value)) return null;
  const author = normalizeAuthor(value.author);
  if (
    !author ||
    typeof value.id !== 'string' ||
    typeof value.threadId !== 'string' ||
    typeof value.ts !== 'string' ||
    typeof value.body !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    threadId: value.threadId,
    author,
    ts: value.ts,
    body: value.body,
    citations: Array.isArray(value.citations)
      ? (value.citations as ChatMessage['citations'])
      : undefined,
  };
};

const normalizeThread = (value: unknown, docId: DocumentId): LocalThread | null => {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || !isObject(value.anchor) || !Array.isArray(value.messages)) {
    return null;
  }
  const messages = value.messages
    .map(normalizeMessage)
    .filter((item): item is ChatMessage => Boolean(item));
  const status = value.status === 'resolved' ? 'resolved' : 'open';
  return {
    id: value.id,
    docId,
    anchor: value.anchor as unknown as LocalThread['anchor'],
    messages,
    filters: isObject(value.filters) ? (value.filters as LocalThread['filters']) : {},
    historyText: typeof value.historyText === 'string' ? value.historyText : '',
    status,
    resolvedAt:
      status === 'resolved' && typeof value.resolvedAt === 'string' ? value.resolvedAt : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso(),
  };
};

const parseThreads = (value: string | null | undefined, docId: DocumentId): LocalThread[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeThread(item, docId))
      .filter((item): item is LocalThread => Boolean(item));
  } catch {
    return [];
  }
};

const readThreadsFromStorage = (docId: DocumentId) => {
  if (typeof window === 'undefined') return [];
  try {
    return parseThreads(window.localStorage.getItem(threadStorageKey(docId)), docId);
  } catch {
    return [];
  }
};

const writeThreadsToStorage = (docId: DocumentId, threads: LocalThread[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(threadStorageKey(docId), JSON.stringify(threads));
  } catch {
    // Best-effort local durability; realtime persistence still carries online docs.
  }
};

const readThreadsFromYMap = (map: Y.Map<string> | null, docId: DocumentId) =>
  map
    ? Array.from(map.entries())
        .filter(([key]) => key.startsWith(threadYMapPrefix(docId)))
        .map(([, value]) => parseThreads(`[${value}]`, docId)[0])
        .filter((thread): thread is LocalThread => Boolean(thread))
        .sort(
          (left, right) =>
            left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
        )
    : [];

const writeThreadsToYMap = (
  map: Y.Map<string> | null,
  docId: DocumentId,
  threads: LocalThread[],
) => {
  if (!map) return;
  threads.forEach((thread) => {
    map.set(threadYMapKey(docId, thread.id), JSON.stringify(thread));
  });
};

export function ChatPanel({
  editor,
  docId,
  baseVersion,
  currentText,
  realtimeDoc,
  open = true,
}: ChatPanelProps) {
  const [threads, setThreads] = useState<LocalThread[]>([]);
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const threadsRef = useRef<LocalThread[]>([]);
  const yThreadsMap = useMemo(
    () => realtimeDoc?.getMap<string>(CHAT_THREADS_YMAP) ?? null,
    [realtimeDoc],
  );

  const publishThreads = useCallback(
    (nextThreads: LocalThread[], options: { persist: boolean } = { persist: true }) => {
      threadsRef.current = nextThreads;
      setThreads((current) => (sameThreads(current, nextThreads) ? current : nextThreads));
      if (!options.persist) return;
      writeThreadsToStorage(docId, nextThreads);
      writeThreadsToYMap(yThreadsMap, docId, nextThreads);
    },
    [docId, yThreadsMap],
  );

  useEffect(() => {
    const storedThreads = readThreadsFromStorage(docId);
    const yThreadsExist =
      yThreadsMap &&
      Array.from(yThreadsMap.keys()).some((key) => key.startsWith(threadYMapPrefix(docId)));
    const initialThreads = yThreadsExist ? readThreadsFromYMap(yThreadsMap, docId) : storedThreads;
    publishThreads(initialThreads, { persist: false });
    if (yThreadsMap && !yThreadsExist && storedThreads.length) {
      writeThreadsToYMap(yThreadsMap, docId, storedThreads);
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== threadStorageKey(docId) || yThreadsMap) return;
      publishThreads(parseThreads(event.newValue, docId), { persist: false });
    };
    window.addEventListener('storage', handleStorage);

    const handleRemoteThreads = (event: Y.YMapEvent<string>) => {
      if (![...event.keysChanged].some((key) => key.startsWith(threadYMapPrefix(docId)))) return;
      const nextThreads = readThreadsFromYMap(yThreadsMap, docId);
      writeThreadsToStorage(docId, nextThreads);
      publishThreads(nextThreads, { persist: false });
    };
    yThreadsMap?.observe(handleRemoteThreads);

    return () => {
      window.removeEventListener('storage', handleStorage);
      yThreadsMap?.unobserve(handleRemoteThreads);
    };
  }, [docId, publishThreads, yThreadsMap]);

  const updateThreads = useCallback(
    (updater: (current: LocalThread[]) => LocalThread[]) => {
      publishThreads(updater(threadsRef.current));
    },
    [publishThreads],
  );

  const selectionText = selectedText(editor);
  const visibleThreads = threads.filter((thread) => threadMatchesFilter(thread, filter));
  const threadViews = useMemo(
    () =>
      visibleThreads.map((thread) => ({
        thread,
        mappedAnchor: mapAnchor({
          anchor: thread.anchor,
          baseDoc: { text: thread.historyText },
          ops: [],
          currentDoc: { text: currentText },
          targetVersion: baseVersion ?? thread.anchor.baseVersion,
        }),
      })),
    [baseVersion, currentText, visibleThreads],
  );

  if (!open) return null;

  const createThread = () => {
    if (!selectionText || !baseVersion) return;
    const from = currentText.indexOf(selectionText);
    if (from < 0) return;
    const anchor = createAnchor({
      baseVersion,
      docText: currentText,
      from,
      to: from + selectionText.length,
    });
    updateThreads((items) => {
      const id = createLocalId('thread');
      const ts = nowIso();
      const message: ChatMessage = {
        id: createLocalId('message'),
        threadId: id,
        author: LOCAL_USER,
        ts,
        body: `Thread on "${selectionText}"`,
      };
      return [
        ...items,
        {
          id,
          docId,
          anchor,
          messages: [message],
          filters: {},
          historyText: currentText,
          status: 'open',
          resolvedAt: null,
          updatedAt: ts,
        },
      ];
    });
  };

  const addReply = (threadId: string, author: ChatMessage['author'], body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    updateThreads((items) =>
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

  const addUserReply = (threadId: string, body: string) => {
    addReply(threadId, LOCAL_USER, body);
    setReplyDrafts((drafts) => ({ ...drafts, [threadId]: '' }));
  };

  const addAiReply = (threadId: string) => {
    addReply(threadId, AI_USER, 'AI reply with current document context.');
  };

  const setThreadStatus = (threadId: string, status: ThreadStatus) => {
    updateThreads((items) =>
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

  return (
    <section className="lash-chat-panel" data-testid="doc-chat-panel" aria-label="Document chat">
      <div className="chat-panel-header">
        <h2 className="chat-panel-title">Doc Chat</h2>
        <span className="chat-panel-count" data-testid="chat-count">
          {visibleThreads.length} {visibleThreads.length === 1 ? 'thread' : 'threads'}
        </span>
      </div>

      <div className="chat-controls">
        <button
          type="button"
          className="chat-action-button"
          data-testid="chat-create-thread"
          disabled={!selectionText || !baseVersion}
          onClick={createThread}
        >
          New thread
        </button>
        <button
          type="button"
          className="chat-filter-button"
          data-testid="chat-filter-author"
          data-active={filter === 'author' ? 'true' : 'false'}
          onClick={() => setFilter('author')}
        >
          local-user
        </button>
        <button
          type="button"
          className="chat-filter-button"
          data-testid="chat-filter-ai"
          data-active={filter === 'ai' ? 'true' : 'false'}
          onClick={() => setFilter('ai')}
        >
          AI
        </button>
        <button
          type="button"
          className="chat-filter-button"
          data-testid="chat-filter-clear"
          onClick={() => setFilter('all')}
        >
          All
        </button>
      </div>

      {threadViews.length ? (
        <ol
          className="chat-thread-list"
          data-testid="chat-thread-list"
          aria-label="Document chat threads"
        >
          {threadViews.map(({ thread, mappedAnchor }) => {
            const currentContext = mappedAnchor.orphaned
              ? 'Context lost'
              : currentText.slice(mappedAnchor.from, mappedAnchor.to);
            const threadTitleId = `chat-thread-title-${domId(thread.id)}`;
            const threadTitle = `Thread on ${thread.anchor.token.text}`;
            const replyDraft = replyDrafts[thread.id] ?? '';
            return (
              <li key={thread.id}>
                <article
                  className="chat-thread"
                  data-testid="chat-thread"
                  data-orphaned={mappedAnchor.orphaned ? 'true' : 'false'}
                  aria-labelledby={threadTitleId}
                  tabIndex={0}
                >
                  <h3 id={threadTitleId} className="sr-only">
                    {threadTitle}
                  </h3>
                  <div className="chat-thread-meta">
                    <span data-testid="chat-anchor-text">{thread.anchor.token.text}</span>
                    <span className="chat-thread-status" data-testid="chat-thread-status">
                      {thread.status === 'resolved' ? 'Resolved' : 'Open'}
                    </span>
                    {mappedAnchor.orphaned ? (
                      <span className="chat-orphan" data-testid="chat-orphaned">
                        Orphaned
                      </span>
                    ) : (
                      <span className="chat-anchor-status" data-testid="chat-anchor-status">
                        Anchored
                      </span>
                    )}
                  </div>
                  <div className="chat-context-grid">
                    <div>
                      <span className="chat-context-label">History</span>
                      <p data-testid="chat-history-context">{thread.anchor.token.text}</p>
                    </div>
                    <div>
                      <span className="chat-context-label">Current</span>
                      <p data-testid="chat-current-context">{currentContext}</p>
                    </div>
                  </div>
                  <ul
                    className="chat-message-list"
                    aria-label={`Messages for ${thread.anchor.token.text}`}
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
                  <div className="chat-reply-row">
                    <input
                      className="chat-reply-input"
                      data-testid="chat-reply-input"
                      aria-label={`Reply to thread on ${thread.anchor.token.text}`}
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
                      disabled={!replyDraft.trim()}
                      onClick={() => addUserReply(thread.id, replyDraft)}
                    >
                      Reply
                    </button>
                  </div>
                  <div className="chat-thread-actions">
                    {thread.status === 'resolved' ? (
                      <button
                        type="button"
                        className="chat-action-button"
                        data-testid="chat-reopen-thread"
                        onClick={() => setThreadStatus(thread.id, 'open')}
                      >
                        Reopen
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="chat-action-button"
                        data-testid="chat-resolve-thread"
                        onClick={() => setThreadStatus(thread.id, 'resolved')}
                      >
                        Resolve
                      </button>
                    )}
                    <button
                      type="button"
                      className="chat-action-button"
                      data-testid="chat-add-ai"
                      aria-label={`Add AI reply to thread on ${thread.anchor.token.text}`}
                      onClick={() => addAiReply(thread.id)}
                    >
                      Add AI reply
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="chat-empty" data-testid="chat-empty">
          No threads.
        </p>
      )}
    </section>
  );
}
