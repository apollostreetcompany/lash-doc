'use client';

import { DEFAULT_SELECT_CELL_OPTIONS, DEFAULT_STATUS_CELL_OPTIONS } from '@lash/editor-core';
import type {
  PublicCommentAuthorizationV1,
  PublicCommentDtoV1,
  PublicDocumentAccessModeV1,
} from '@lash/types';
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './page.module.css';
import {
  requestPublicDocumentSession,
  type PublicDocumentSessionBrowserResult,
} from '../../../lib/publicDocumentAccess/browserClient';
import {
  createPublicDocumentProvider,
  type PublicDocumentBrowserSession,
  type PublicDocumentProjection,
  type PublicDocumentProvider,
} from '../../../lib/publicDocumentAccess/provider';
import {
  canonicalizePublicCommentBody,
  createPublicComment,
  listPublicComments,
  requestPublicCommentAuthoringSession,
  type PublicCommentAuthoringSessionResult,
  type PublicCommentCreateBrowserResult,
  type PublicCommentListBrowserResult,
} from '../../../lib/publicDocumentComments/browserClient';
import { getOrCreateLocalActorId } from '../../../lib/realtimeCollaboration';

type PublicNode = Readonly<{
  type?: unknown;
  text?: unknown;
  attrs?: unknown;
  marks?: unknown;
  content?: unknown;
}>;

export type PublicDocumentClientDependencies = Readonly<{
  getActorId(): string;
  requestSession(input: {
    roomId: string;
    actorId: string;
    signal: AbortSignal;
  }): Promise<PublicDocumentSessionBrowserResult>;
  createProvider(session: PublicDocumentBrowserSession): PublicDocumentProvider;
  listComments?(input: {
    roomId: string;
    expectedPolicyVersion: number;
    expectedCutoffGeneration: number;
    beforeSequence: number | null;
    signal?: AbortSignal;
  }): Promise<PublicCommentListBrowserResult>;
  requestAuthoringSession?(input: {
    roomId: string;
    signal?: AbortSignal;
  }): Promise<PublicCommentAuthoringSessionResult>;
  createComment?(input: {
    roomId: string;
    mutationId: string;
    expectedPolicyVersion: number;
    expectedCutoffGeneration: number;
    body: string;
    csrfProof: string;
    signal?: AbortSignal;
  }): Promise<PublicCommentCreateBrowserResult>;
}>;

const defaultDependencies: PublicDocumentClientDependencies = {
  getActorId: getOrCreateLocalActorId,
  requestSession: (input) => requestPublicDocumentSession(input),
  createProvider: createPublicDocumentProvider,
  listComments: (input) => listPublicComments(input),
  requestAuthoringSession: (input) => requestPublicCommentAuthoringSession(input),
  createComment: (input) => createPublicComment(input),
};

type ClientState =
  | Readonly<{ phase: 'authorizing' | 'hydrating' }>
  | Readonly<{ phase: 'unavailable' }>
  | Readonly<{
      phase: 'ready';
      mode: PublicDocumentAccessModeV1;
      projection: PublicDocumentProjection;
      authorization: PublicDocumentBrowserSession['authorization'];
    }>;

type CommentState =
  | Readonly<{ phase: 'idle' | 'loading' }>
  | Readonly<{
      phase: 'ready';
      authorization: PublicCommentAuthorizationV1;
      comments: readonly PublicCommentDtoV1[];
    }>
  | Readonly<{ phase: 'error'; message: string }>;

type AuthoringState =
  | Readonly<{ phase: 'idle' | 'checking' | 'anonymous' }>
  | Readonly<{ phase: 'authenticated'; csrfProof: string }>
  | Readonly<{ phase: 'error'; message: string }>;

type CommentSubmission = { phase: 'idle' | 'posting' } | { phase: 'notice'; message: string };
type PublicCommentAttempt = {
  authorization: PublicCommentAuthorizationV1;
  body: string;
  mutationId: string;
};

const PUBLIC_COMMENT_DRAFT_MAX_AGE_MS = 30 * 60 * 1_000;

const readDraft = (key: string): string => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return '';
    const value = JSON.parse(raw) as unknown;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'body,savedAt'
    ) {
      window.localStorage.removeItem(key);
      return '';
    }
    const draft = value as { body?: unknown; savedAt?: unknown };
    const now = Date.now();
    if (
      typeof draft.body !== 'string' ||
      draft.body.length > 4_096 ||
      !Number.isSafeInteger(draft.savedAt) ||
      Number(draft.savedAt) > now + 60_000 ||
      now - Number(draft.savedAt) > PUBLIC_COMMENT_DRAFT_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(key);
      return '';
    }
    return draft.body;
  } catch {
    return '';
  }
};

const nodeContent = (node: PublicNode): PublicNode[] =>
  Array.isArray(node.content)
    ? node.content.filter(
        (value): value is PublicNode =>
          value !== null && typeof value === 'object' && !Array.isArray(value),
      )
    : [];

const typedCellLabel = (attrs: unknown): string | null => {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return null;
  const { cellType, options, value } = attrs as {
    cellType?: unknown;
    options?: unknown;
    value?: unknown;
  };
  if (cellType !== 'status' && cellType !== 'select') return null;
  const provided = Array.isArray(options)
    ? options.filter((option): option is string => typeof option === 'string')
    : [];
  const defaults =
    cellType === 'status' ? DEFAULT_STATUS_CELL_OPTIONS : DEFAULT_SELECT_CELL_OPTIONS;
  const choices = provided.length ? provided : defaults;
  return typeof value === 'string' && choices.includes(value) ? value : (choices[0] ?? '');
};

const markText = (text: React.ReactNode, marks: unknown, key: string): React.ReactNode => {
  if (!Array.isArray(marks)) return text;
  return marks.reduce<React.ReactNode>((child, mark, index) => {
    if (!mark || typeof mark !== 'object' || Array.isArray(mark)) return child;
    const value = mark as { type?: unknown; attrs?: unknown };
    const markKey = `${key}-mark-${index}`;
    if (value.type === 'bold') return <strong key={markKey}>{child}</strong>;
    if (value.type === 'italic') return <em key={markKey}>{child}</em>;
    if (value.type === 'strike') return <s key={markKey}>{child}</s>;
    if (value.type === 'underline') return <u key={markKey}>{child}</u>;
    if (value.type === 'code') return <code key={markKey}>{child}</code>;
    if (value.type === 'link' && value.attrs && typeof value.attrs === 'object') {
      const href = (value.attrs as { href?: unknown }).href;
      if (
        typeof href === 'string' &&
        (href.startsWith('https://') || href.startsWith('http://') || href.startsWith('mailto:'))
      ) {
        return (
          <a href={href} key={markKey} rel="noreferrer">
            {child}
          </a>
        );
      }
    }
    return child;
  }, text);
};

const renderNode = (node: PublicNode, key: string): React.ReactNode => {
  if (node.type === 'text' && typeof node.text === 'string') {
    return <span key={key}>{markText(node.text, node.marks, key)}</span>;
  }
  if (node.type === 'hardBreak') return <br key={key} />;
  if (node.type === 'horizontalRule') return <hr key={key} />;
  const children = nodeContent(node).map((child, index) => renderNode(child, `${key}-${index}`));
  if (node.type === 'doc') return <div key={key}>{children}</div>;
  if (node.type === 'paragraph') return <p key={key}>{children}</p>;
  if (node.type === 'heading') {
    const level =
      node.attrs &&
      typeof node.attrs === 'object' &&
      Number.isInteger((node.attrs as { level?: unknown }).level)
        ? Math.min(6, Math.max(2, Number((node.attrs as { level: number }).level) + 1))
        : 2;
    return React.createElement(`h${level}`, { key }, children);
  }
  if (node.type === 'bulletList') return <ul key={key}>{children}</ul>;
  if (node.type === 'orderedList') return <ol key={key}>{children}</ol>;
  if (node.type === 'listItem') return <li key={key}>{children}</li>;
  if (node.type === 'blockquote') return <blockquote key={key}>{children}</blockquote>;
  if (node.type === 'codeBlock')
    return (
      <pre key={key}>
        <code>{children}</code>
      </pre>
    );
  if (node.type === 'table')
    return (
      <div className={styles.tableScroller} key={key}>
        <table>
          <tbody>{children}</tbody>
        </table>
      </div>
    );
  if (node.type === 'tableRow') return <tr key={key}>{children}</tr>;
  if (node.type === 'tableHeader') return <th key={key}>{children}</th>;
  if (node.type === 'tableCell') return <td key={key}>{typedCellLabel(node.attrs) ?? children}</td>;
  if (node.type === 'image' && node.attrs && typeof node.attrs === 'object') {
    const alt = (node.attrs as { alt?: unknown }).alt;
    return (
      <p className={styles.mediaPlaceholder} key={key}>
        {typeof alt === 'string' && alt ? alt : 'Image'}
      </p>
    );
  }
  return <div key={key}>{children}</div>;
};

const PublicBody = ({ body }: { body: unknown }) =>
  body && typeof body === 'object' && !Array.isArray(body)
    ? renderNode(body as PublicNode, 'public-document-root')
    : null;

export function PublicDocumentClient({
  roomId,
  dependencies = defaultDependencies,
}: Readonly<{
  roomId: string;
  dependencies?: PublicDocumentClientDependencies;
}>) {
  const [state, setState] = useState<ClientState>({ phase: 'authorizing' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [commentState, setCommentState] = useState<CommentState>({ phase: 'idle' });
  const [authoringState, setAuthoringState] = useState<AuthoringState>({ phase: 'idle' });
  const [draft, setDraft] = useState('');
  const [submission, setSubmission] = useState<CommentSubmission>({ phase: 'idle' });
  const postRequest = useRef<AbortController | null>(null);
  const postAttempt = useRef<PublicCommentAttempt | null>(null);
  const posting = submission.phase === 'posting';
  const draftKey = `lash:public-comment-draft:v1:${roomId}`;

  const retirePost = useCallback(() => {
    postRequest.current?.abort();
    postRequest.current = null;
    setSubmission({ phase: 'idle' });
  }, []);

  const showCommentNotice = (message: string) => setSubmission({ phase: 'notice', message });

  useEffect(() => {
    setDraft(readDraft(draftKey));
  }, [draftKey]);

  useEffect(() => {
    const controller = new AbortController();
    let provider: PublicDocumentProvider | null = null;
    let unsubscribe: (() => void) | null = null;
    void (async () => {
      const result = await dependencies.requestSession({
        roomId,
        actorId: dependencies.getActorId(),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setState({ phase: 'unavailable' });
        return;
      }
      provider = dependencies.createProvider(result.session);
      unsubscribe = provider.subscribe((snapshot) => {
        if (controller.signal.aborted) return;
        if (snapshot.phase !== 'ready' || snapshot.mode !== 'comment') retirePost();
        if (snapshot.phase === 'ready') {
          setState({
            phase: 'ready',
            mode: snapshot.mode,
            projection: snapshot.projection,
            authorization: result.session.authorization,
          });
        } else if (snapshot.phase === 'unavailable') {
          setState({ phase: 'unavailable' });
        } else {
          setState({ phase: snapshot.phase });
        }
      });
      try {
        await provider.start();
      } catch {
        if (!controller.signal.aborted) setState({ phase: 'unavailable' });
      }
    })();
    return () => {
      controller.abort();
      postRequest.current?.abort();
      postRequest.current = null;
      unsubscribe?.();
      provider?.destroy();
    };
  }, [dependencies, refreshKey, retirePost, roomId]);

  const readyAuthorization = state.phase === 'ready' ? state.authorization : null;
  const readyMode = state.phase === 'ready' ? state.mode : null;

  useEffect(() => {
    if (!readyAuthorization || readyMode !== 'comment') {
      setCommentState({ phase: 'idle' });
      setAuthoringState({ phase: 'idle' });
      retirePost();
      return;
    }

    const controller = new AbortController();
    const listComments = dependencies.listComments ?? defaultDependencies.listComments!;
    const requestAuthoringSession =
      dependencies.requestAuthoringSession ?? defaultDependencies.requestAuthoringSession!;
    setCommentState({ phase: 'loading' });
    setAuthoringState({ phase: 'checking' });

    void listComments({
      roomId,
      expectedPolicyVersion: readyAuthorization.policyVersion,
      expectedCutoffGeneration: readyAuthorization.cutoffGeneration,
      beforeSequence: null,
      signal: controller.signal,
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setCommentState({
          phase: 'ready',
          authorization: result.authorization,
          comments: result.comments,
        });
      } else if (
        result.error === 'public-access-changed' ||
        result.error === 'document-unavailable'
      ) {
        retirePost();
        setState({ phase: 'unavailable' });
      } else {
        setCommentState({ phase: 'error', message: 'Comments are temporarily unavailable.' });
      }
    });

    void requestAuthoringSession({ roomId, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        if (!result.authenticated) postAttempt.current = null;
        setAuthoringState(
          result.authenticated
            ? { phase: 'authenticated', csrfProof: result.csrfProof }
            : { phase: 'anonymous' },
        );
      } else if (
        result.error === 'public-access-changed' ||
        result.error === 'document-unavailable'
      ) {
        retirePost();
        setState({ phase: 'unavailable' });
      } else if (result.error === 'authentication-required') {
        postAttempt.current = null;
        setAuthoringState({ phase: 'anonymous' });
      } else {
        setAuthoringState({
          phase: 'error',
          message: 'Commenting is temporarily unavailable.',
        });
      }
    });

    return () => controller.abort();
  }, [dependencies, readyAuthorization, readyMode, retirePost, roomId]);

  const rememberDraft = (value: string) => {
    if (postAttempt.current && canonicalizePublicCommentBody(value) !== postAttempt.current.body) {
      postAttempt.current = null;
    }
    setDraft(value);
    try {
      if (value) {
        window.localStorage.setItem(
          draftKey,
          JSON.stringify({
            body: value,
            savedAt: Date.now(),
          }),
        );
      } else {
        window.localStorage.removeItem(draftKey);
      }
    } catch {
      // The in-memory draft still works when local storage is unavailable.
    }
  };

  const retry = () => {
    retirePost();
    setState({ phase: 'authorizing' });
    setCommentState({ phase: 'idle' });
    setAuthoringState({ phase: 'idle' });
    setRefreshKey((value) => value + 1);
  };

  const postComment = async () => {
    const body = canonicalizePublicCommentBody(draft);
    if (!body) {
      showCommentNotice('Write a comment before posting.');
      return;
    }
    if (
      postRequest.current ||
      readyMode !== 'comment' ||
      authoringState.phase !== 'authenticated' ||
      commentState.phase !== 'ready'
    )
      return;

    const request = new AbortController();
    postRequest.current = request;
    setSubmission({ phase: 'posting' });
    const authorization = commentState.authorization;
    const previous = postAttempt.current;
    const sameAttempt =
      previous?.body === body &&
      previous.authorization.roomId === roomId &&
      previous.authorization.policyVersion === authorization.policyVersion &&
      previous.authorization.cutoffGeneration === authorization.cutoffGeneration;
    const attempt = sameAttempt
      ? previous
      : { authorization, body, mutationId: crypto.randomUUID() };
    postAttempt.current = attempt;
    const createComment = dependencies.createComment ?? defaultDependencies.createComment!;
    let result: PublicCommentCreateBrowserResult;
    try {
      result = await createComment({
        roomId,
        mutationId: attempt.mutationId,
        expectedPolicyVersion: authorization.policyVersion,
        expectedCutoffGeneration: authorization.cutoffGeneration,
        body,
        csrfProof: authoringState.csrfProof,
        signal: request.signal,
      });
    } catch {
      if (postRequest.current === request) {
        postRequest.current = null;
        showCommentNotice('Commenting is temporarily unavailable.');
      }
      return;
    }
    if (postRequest.current !== request || request.signal.aborted) return;
    postRequest.current = null;
    if (result.ok || !result.retryable) postAttempt.current = null;

    if (result.ok) {
      setCommentState((current) => {
        if (current.phase !== 'ready') return current;
        const comments = [
          ...current.comments.filter((comment) => comment.id !== result.comment.id),
        ];
        comments.push(result.comment);
        comments.sort((left, right) => left.sequence - right.sequence);
        return {
          phase: 'ready',
          authorization: result.authorization,
          comments,
        };
      });
      rememberDraft('');
      showCommentNotice('Comment posted.');
    } else if (result.error === 'authentication-required') {
      setAuthoringState({ phase: 'anonymous' });
      showCommentNotice('Sign in to post this comment.');
    } else if (
      result.error === 'public-access-changed' ||
      result.error === 'document-unavailable'
    ) {
      retirePost();
      setState({ phase: 'unavailable' });
    } else if (result.error === 'rate-limited') {
      showCommentNotice('You’re commenting quickly. Please try again shortly.');
    } else if (result.error === 'comment-conflict') {
      showCommentNotice('This comment could not be posted. Please try again.');
    } else {
      showCommentNotice('Commenting is temporarily unavailable.');
    }
  };

  if (state.phase === 'unavailable') {
    return (
      <main className={styles.shell} data-public-document-phase="unavailable">
        <div className={styles.statusCard} role="status">
          <p>This document isn&apos;t available.</p>
          <button className={styles.retryButton} onClick={retry} type="button">
            Try again
          </button>
        </div>
      </main>
    );
  }
  if (state.phase !== 'ready') {
    return (
      <main className={styles.shell} data-public-document-phase={state.phase}>
        <p aria-busy="true" aria-live="polite" className={styles.statusCard} role="status">
          Opening public document…
        </p>
      </main>
    );
  }

  return (
    <main className={styles.documentShell} data-public-document-phase="ready">
      <header className={styles.publicHeader}>
        <span className={styles.brand}>Lash</span>
        <span className={styles.accessStatus}>
          Public access · {state.mode === 'comment' ? 'Can comment' : 'Can read'}
        </span>
      </header>
      <div className={styles.contentColumn}>
        <article className={styles.document}>
          <h1 className={styles.title} data-public-document-title>
            {state.projection.title}
          </h1>
          <div className={styles.body} data-public-document-body>
            <PublicBody body={state.projection.body} />
          </div>
        </article>
        {state.mode === 'comment' ? (
          <section aria-labelledby="public-comments-title" className={styles.comments}>
            <div className={styles.commentsHeading}>
              <h2 id="public-comments-title">Public comments</h2>
              {commentState.phase === 'ready' ? (
                <span>
                  {commentState.comments.length}{' '}
                  {commentState.comments.length === 1 ? 'comment' : 'comments'}
                </span>
              ) : null}
            </div>
            {commentState.phase === 'loading' ? (
              <p aria-live="polite" className={styles.commentMuted}>
                Loading comments…
              </p>
            ) : null}
            {commentState.phase === 'error' ? (
              <p className={styles.commentMuted} role="status">
                {commentState.message}
              </p>
            ) : null}
            {commentState.phase === 'ready' && commentState.comments.length === 0 ? (
              <p className={styles.commentMuted}>No comments yet.</p>
            ) : null}
            {commentState.phase === 'ready' && commentState.comments.length > 0 ? (
              <ol className={styles.commentList}>
                {commentState.comments.map((comment) => (
                  <li className={styles.comment} key={comment.id}>
                    <div className={styles.commentMeta}>
                      <strong>{comment.author.label}</strong>
                      <time dateTime={comment.createdAt}>{comment.createdAt.slice(0, 10)}</time>
                    </div>
                    <p>{comment.body}</p>
                  </li>
                ))}
              </ol>
            ) : null}
            <div className={styles.composer}>
              <label className={styles.commentLabel} htmlFor="public-comment-draft">
                Comment
              </label>
              <textarea
                aria-label="Comment"
                disabled={posting}
                id="public-comment-draft"
                maxLength={4096}
                onChange={(event) => rememberDraft(event.currentTarget.value)}
                placeholder="Add to the discussion"
                rows={4}
                value={draft}
              />
              {authoringState.phase === 'authenticated' ? (
                <button
                  className={styles.primaryButton}
                  disabled={posting || commentState.phase !== 'ready'}
                  onClick={() => void postComment()}
                  type="button"
                >
                  {posting ? 'Posting…' : 'Post comment'}
                </button>
              ) : authoringState.phase === 'anonymous' ? (
                <a
                  className={styles.primaryButton}
                  href={`/auth/sign-in?next=${encodeURIComponent(`/public/${roomId}`)}`}
                  onClick={() => rememberDraft(draft)}
                >
                  Sign in to comment
                </a>
              ) : authoringState.phase === 'error' ? (
                <p className={styles.commentMuted}>{authoringState.message}</p>
              ) : (
                <span className={styles.commentMuted}>Checking sign-in…</span>
              )}
              {submission.phase === 'notice' ? (
                <p aria-live="polite" className={styles.commentStatus} role="status">
                  {submission.message}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
