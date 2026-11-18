'use client';

import { MAX_SUGGESTION_TEXT, type SuggestionDecision } from '@lash/doc-chat';
import { useEffect, useRef, useState } from 'react';

type Result = { ok: true } | { ok: false; message: string };

export function SuggestionComposer({
  quote,
  onCancel,
  onSubmit,
}: {
  quote: string;
  onCancel(): void;
  onSubmit(replacement: string, note: string): Promise<Result> | Result;
}) {
  const [replacement, setReplacement] = useState(quote);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return (
    <form
      className="chat-new-thread-composer"
      data-testid="suggestion-composer"
      onSubmit={async (event) => {
        event.preventDefault();
        if (replacement === quote || pending.current) return;
        pending.current = true;
        setSubmitting(true);
        setError('');
        try {
          const result = await onSubmit(replacement, note);
          if (!result.ok) setError(result.message);
        } catch {
          setError('Lash could not save your suggestion. Try again.');
        } finally {
          pending.current = false;
          setSubmitting(false);
        }
      }}
    >
      <div className="chat-new-thread-context">
        <span className="chat-context-label">Selected text</span>
        <blockquote className="chat-new-thread-quote">{quote}</blockquote>
      </div>
      <label className="chat-new-thread-label" htmlFor="suggestion-replacement">
        Proposed wording
      </label>
      <input
        ref={input}
        id="suggestion-replacement"
        className="chat-new-thread-textarea"
        value={replacement}
        maxLength={MAX_SUGGESTION_TEXT}
        disabled={submitting}
        onChange={(event) => setReplacement(event.target.value)}
      />
      <label className="chat-new-thread-label" htmlFor="suggestion-note">
        Comment (optional)
      </label>
      <textarea
        id="suggestion-note"
        className="chat-new-thread-textarea"
        rows={2}
        maxLength={2_000}
        value={note}
        disabled={submitting}
        onChange={(event) => setNote(event.target.value)}
      />
      {error ? <p role="alert">{error}</p> : null}
      <div className="chat-new-thread-actions">
        <button
          type="button"
          className="chat-action-button"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel suggestion
        </button>
        <button
          type="submit"
          className="chat-action-button"
          disabled={submitting || replacement === quote}
        >
          {submitting ? 'Sending suggestion…' : 'Post suggestion'}
        </button>
      </div>
    </form>
  );
}

export function SuggestionCard({
  author,
  createdAt,
  quote,
  replacement,
  status,
  stale,
  onDecide,
}: {
  author: string;
  createdAt: string;
  quote: string;
  replacement: string;
  status: 'pending' | SuggestionDecision;
  stale?: boolean;
  onDecide?: (decision: SuggestionDecision) => Promise<Result> | Result;
}) {
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const pending = useRef(false);
  const decide = async (decision: SuggestionDecision) => {
    if (!onDecide || pending.current) return;
    pending.current = true;
    setSending(true);
    setError('');
    try {
      const result = await onDecide(decision);
      if (!result.ok) setError(result.message);
    } catch {
      setError('Lash could not save this decision. Try again.');
    } finally {
      pending.current = false;
      setSending(false);
    }
  };
  return (
    <div className="chat-new-thread-context" data-testid="suggestion-card">
      <p className="chat-context-label" role="status" data-testid="suggestion-status">
        {status === 'accepted'
          ? 'Suggestion accepted'
          : status === 'rejected'
            ? 'Suggestion rejected'
            : 'Suggestion pending'}
      </p>
      <p className="chat-new-thread-quote">
        <del
          className="history-diff-delete"
          data-intent="suggest"
          title={`Removed text by ${author} · ${createdAt}`}
        >
          {quote}
        </del>
        {replacement ? (
          <>
            {' '}
            <ins
              className="history-diff-insert"
              data-intent="suggest"
              title={`Inserted text by ${author} · ${createdAt}`}
            >
              {replacement}
            </ins>
          </>
        ) : null}
      </p>
      {stale && status === 'pending' ? (
        <p role="status">The selected text changed. Select it again to make a new suggestion.</p>
      ) : null}
      {onDecide && status === 'pending' ? (
        <div className="chat-new-thread-actions">
          <button
            type="button"
            className="chat-action-button"
            onClick={() => void decide('rejected')}
            disabled={sending}
          >
            Reject suggestion
          </button>
          <button
            type="button"
            className="chat-action-button"
            onClick={() => void decide('accepted')}
            disabled={sending || stale}
          >
            Accept suggestion
          </button>
        </div>
      ) : null}
      {error && status === 'pending' ? <p role="alert">{error}</p> : null}
    </div>
  );
}
