/**
 * panels/ChatPanel — selection-anchored doc chat with diff-aware threads.
 */
'use client';

import { createAnchor, mapAnchor, type ChatMessage, type ChatThread } from '@lash/doc-chat';
import type { DocumentId } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { useMemo, useState } from 'react';

export interface ChatPanelProps {
  editor: Editor | null;
  docId: DocumentId;
  baseVersion: string | null;
  currentText: string;
  open?: boolean;
}

type ChatFilter = 'all' | 'author' | 'ai';
type LocalThread = ChatThread & {
  historyText: string;
};

const LOCAL_USER = { type: 'user', id: 'local-user' } as const;
const AI_USER = { type: 'ai', id: 'ai-doc-chat', label: 'AI Doc Chat' } as const;

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

export function ChatPanel({
  editor,
  docId,
  baseVersion,
  currentText,
  open = true,
}: ChatPanelProps) {
  const [threads, setThreads] = useState<LocalThread[]>([]);
  const [filter, setFilter] = useState<ChatFilter>('all');

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
    const id = `thread:${threads.length + 1}`;
    const message: ChatMessage = {
      id: `message:${threads.length + 1}:user`,
      threadId: id,
      author: LOCAL_USER,
      ts: new Date().toISOString(),
      body: `Thread on "${selectionText}"`,
    };
    setThreads((items) => [
      ...items,
      {
        id,
        docId,
        anchor,
        messages: [message],
        filters: {},
        historyText: currentText,
      },
    ]);
  };

  const addAiReply = (threadId: string) => {
    setThreads((items) =>
      items.map((thread) => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          messages: [
            ...thread.messages,
            {
              id: `message:${thread.id}:ai:${thread.messages.length + 1}`,
              threadId,
              author: AI_USER,
              ts: new Date().toISOString(),
              body: 'AI reply with current document context.',
            },
          ],
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
                  <button
                    type="button"
                    className="chat-action-button"
                    data-testid="chat-add-ai"
                    aria-label={`Add AI reply to thread on ${thread.anchor.token.text}`}
                    onClick={() => addAiReply(thread.id)}
                  >
                    Add AI reply
                  </button>
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
