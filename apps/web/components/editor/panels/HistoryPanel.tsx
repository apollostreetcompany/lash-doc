/**
 * panels/HistoryPanel — local version timeline + deterministic text diff.
 */
'use client';

import { computeDiff } from '@lash/history';
import type { DiffSpan, HistoryEntry } from '@lash/types';
import type { Editor } from '@tiptap/core';

export interface HistoryPanelProps {
  editor: Editor | null;
  entries: HistoryEntry[];
  selectedEntryId: string | null;
  authorFilter: string | null;
  open?: boolean;
  onSelect: (entryId: string) => void;
  onRestore: (entry: HistoryEntry) => void;
  onClearAuthorFilter: () => void;
}

const renderSpan = (span: DiffSpan) => {
  if (span.kind === 'inserted') {
    return (
      <ins key={span.id} className="history-diff-insert" data-testid="history-diff-insert">
        {span.text}
      </ins>
    );
  }
  if (span.kind === 'deleted') {
    return (
      <del key={span.id} className="history-diff-delete" data-testid="history-diff-delete">
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
  open = true,
  onSelect,
  onRestore,
  onClearAuthorFilter,
}: HistoryPanelProps) {
  if (!open) return null;

  const visibleEntries = authorFilter
    ? entries.filter((entry) => entry.actor.id === authorFilter)
    : entries;
  const selectedEntry =
    visibleEntries.find((entry) => entry.id === selectedEntryId) ?? visibleEntries.at(-1) ?? null;
  const diff = selectedEntry
    ? computeDiff(selectedEntry.parentSha, selectedEntry.resultSha, entries)
    : null;

  return (
    <section className="lash-history-panel" data-testid="history-panel" aria-label="History">
      <div className="history-panel-header">
        <h2 className="history-panel-title">History</h2>
        <span className="history-panel-count" data-testid="history-count">
          {visibleEntries.length} {visibleEntries.length === 1 ? 'version' : 'versions'}
        </span>
      </div>

      {authorFilter ? (
        <div className="history-filter" data-testid="history-filter-author">
          <span>Filtered by {authorFilter}</span>
          <button type="button" onClick={onClearAuthorFilter}>
            Clear
          </button>
        </div>
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
          <pre className="history-diff" data-testid="history-diff">
            {diff.spans.map(renderSpan)}
          </pre>
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
      ) : null}
    </section>
  );
}
