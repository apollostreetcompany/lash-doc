/**
 * panels/HistoryPanel — local version timeline + deterministic text diff.
 */
'use client';

import { computeDiff } from '@lash/history';
import type { DiffSpan, HistoryEntry } from '@lash/types';
import type { Editor } from '@tiptap/core';

export type HistoryTimeFilter = 'last-7-days' | null;

export interface HistoryPanelProps {
  editor: Editor | null;
  entries: HistoryEntry[];
  selectedEntryId: string | null;
  authorFilter: string | null;
  timeFilter: HistoryTimeFilter;
  acceptedSuggestionIds: string[];
  open?: boolean;
  onSelect: (entryId: string) => void;
  onRestore: (entry: HistoryEntry) => void;
  onSetAuthorFilter: (authorId: string) => void;
  onClearAuthorFilter: () => void;
  onSetTimeFilter: (filter: HistoryTimeFilter) => void;
  onCopyFilterLink: () => void;
  onAcceptSuggestion: (entry: HistoryEntry) => void;
  onRejectSuggestion: (entry: HistoryEntry) => void;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const matchesTimeFilter = (entry: HistoryEntry, filter: HistoryTimeFilter) => {
  if (!filter) return true;
  const ts = Date.parse(entry.ts);
  if (!Number.isFinite(ts)) return false;
  return ts >= Date.now() - SEVEN_DAYS_MS;
};

const spanTitle = (span: DiffSpan) =>
  [span.authorId, span.intent, span.ts].filter((part): part is string => Boolean(part)).join(' | ');

const renderSpan = (span: DiffSpan) => {
  const title = spanTitle(span) || undefined;
  if (span.kind === 'inserted') {
    return (
      <ins
        key={span.id}
        className="history-diff-insert"
        data-testid="history-diff-insert"
        data-author-id={span.authorId ?? ''}
        data-intent={span.intent ?? ''}
        title={title}
      >
        {span.text}
      </ins>
    );
  }
  if (span.kind === 'deleted') {
    return (
      <del
        key={span.id}
        className="history-diff-delete"
        data-testid="history-diff-delete"
        data-author-id={span.authorId ?? ''}
        data-intent={span.intent ?? ''}
        title={title}
      >
        {span.text}
      </del>
    );
  }
  return (
    <span key={span.id} className="history-diff-unchanged">
      {''}
    </span>
  );
};

export function HistoryPanel({
  editor,
  entries,
  selectedEntryId,
  authorFilter,
  timeFilter,
  acceptedSuggestionIds,
  open = true,
  onSelect,
  onRestore,
  onSetAuthorFilter,
  onClearAuthorFilter,
  onSetTimeFilter,
  onCopyFilterLink,
  onAcceptSuggestion,
  onRejectSuggestion,
}: HistoryPanelProps) {
  if (!open) return null;

  const authorIds = Array.from(new Set(entries.map((entry) => entry.actor.id))).sort();
  const visibleEntries = entries.filter((entry) => {
    if (authorFilter && entry.actor.id !== authorFilter) return false;
    return matchesTimeFilter(entry, timeFilter);
  });
  const selectedEntry =
    visibleEntries.find((entry) => entry.id === selectedEntryId) ?? visibleEntries.at(-1) ?? null;
  const diff = selectedEntry
    ? computeDiff(selectedEntry.parentSha, selectedEntry.resultSha, entries)
    : null;
  const hasActiveFilters = Boolean(authorFilter || timeFilter);
  const selectedSuggestionAccepted = selectedEntry
    ? acceptedSuggestionIds.includes(selectedEntry.id)
    : false;

  return (
    <section className="lash-history-panel" data-testid="history-panel" aria-label="History">
      <div className="history-panel-header">
        <h2 className="history-panel-title">History</h2>
        <span className="history-panel-count" data-testid="history-count">
          {visibleEntries.length} {visibleEntries.length === 1 ? 'version' : 'versions'}
        </span>
      </div>

      <div className="history-filter-controls" data-testid="history-filter-controls">
        {authorIds.map((authorId) => (
          <button
            key={authorId}
            type="button"
            className="history-filter-button"
            data-testid="history-author-filter"
            data-active={authorFilter === authorId ? 'true' : 'false'}
            onClick={() => onSetAuthorFilter(authorId)}
          >
            {authorId}
          </button>
        ))}
        <button
          type="button"
          className="history-filter-button"
          data-testid="history-time-filter-last-7-days"
          data-active={timeFilter === 'last-7-days' ? 'true' : 'false'}
          onClick={() => onSetTimeFilter(timeFilter === 'last-7-days' ? null : 'last-7-days')}
        >
          Last 7 days
        </button>
        <button
          type="button"
          className="history-filter-button"
          data-testid="history-filter-copy-link"
          disabled={!hasActiveFilters}
          onClick={onCopyFilterLink}
        >
          Copy link
        </button>
      </div>

      {authorFilter ? (
        <div className="history-filter" data-testid="history-filter-author">
          <span>Filtered by {authorFilter}</span>
          <button type="button" onClick={onClearAuthorFilter}>
            Clear
          </button>
        </div>
      ) : null}

      {timeFilter ? (
        <div className="history-filter" data-testid="history-filter-time">
          <span>Filtered to last 7 days</span>
          <button type="button" onClick={() => onSetTimeFilter(null)}>
            Clear
          </button>
        </div>
      ) : null}

      {hasActiveFilters ? (
        <span className="history-filter-count" data-testid="history-filtered-counts">
          {visibleEntries.length} matching {visibleEntries.length === 1 ? 'version' : 'versions'}
        </span>
      ) : null}

      {visibleEntries.length ? (
        <ol className="history-version-list" data-testid="history-version-list">
          {visibleEntries.map((entry) => {
            const selected = selectedEntry?.id === entry.id;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className="history-version-button"
                  data-testid="history-version"
                  data-selected={selected ? 'true' : 'false'}
                  aria-pressed={selected ? 'true' : 'false'}
                  onClick={() => onSelect(entry.id)}
                >
                  <span>Version {entry.seq}</span>
                  <span>{entry.restoredFromVersion ? 'Restored' : entry.intent}</span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="history-empty" data-testid="history-empty">
          No edits recorded yet.
        </p>
      )}

      {selectedEntry && diff ? (
        <div className="history-diff-card">
          <div className="history-diff-meta">
            <span data-testid="history-selected-version">Version {selectedEntry.seq}</span>
            <span>{selectedEntry.actor.type === 'ai' ? 'AI' : selectedEntry.actor.id}</span>
          </div>
          {selectedEntry.intent === 'suggest' ? (
            <div className="history-suggestion-status" data-testid="history-suggestion-status">
              {selectedSuggestionAccepted ? 'Accepted suggestion' : 'Pending suggestion'}
            </div>
          ) : null}
          <pre className="history-diff" data-testid="history-diff">
            {diff.spans.map(renderSpan)}
          </pre>
          <div className="history-diff-actions">
            {selectedEntry.intent === 'suggest' && !selectedSuggestionAccepted ? (
              <>
                <button
                  type="button"
                  className="history-suggestion-button"
                  data-testid="suggest-accept-button"
                  onClick={() => onAcceptSuggestion(selectedEntry)}
                  disabled={!editor}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="history-suggestion-button"
                  data-testid="suggest-reject-button"
                  onClick={() => onRejectSuggestion(selectedEntry)}
                  disabled={!editor}
                >
                  Reject
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="history-restore-button"
              data-testid="history-restore-button"
              onClick={() => onRestore(selectedEntry)}
              disabled={!editor}
            >
              Restore
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
