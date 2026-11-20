/**
 * panels/HistoryPanel — local version timeline + deterministic text diff.
 */
'use client';

import { entryHasHistoryBody } from '@lash/history';
import type { DiffJSON, DiffSpan, HistoryEntry } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { useEffect, useId, useState } from 'react';

export type HistoryTimeFilter = 'last-7-days' | null;
export type HistoryAvailabilityState =
  | 'loading'
  | 'ready'
  | 'empty-baseline'
  | 'capacity-reached'
  | 'body-history-diverged'
  | 'body-saving-unavailable'
  | 'recovery-available'
  | 'unavailable'
  | 'corrupt'
  | 'unsupported-version'
  | 'remote-disabled';

type TextDiffSpan = Extract<DiffSpan, { kind: 'inserted' | 'deleted' }>;
type SuggestionResolutionRecord = {
  id: string;
  entryId: string;
  action: 'accepted' | 'rejected';
  ts: string;
  actorId: string;
};
type SavedHistorySnapshot = { readonly text: string };
type LoadSavedHistoryPreview = () => Promise<SavedHistorySnapshot | null>;
type LoadHistoryDiff = (fromSha: string, toSha: string) => Promise<DiffJSON>;
type HistoryComparison = {
  load: LoadHistoryDiff;
  fromSha: string;
  toSha: string;
  result: { state: 'ready'; diff: DiffJSON } | { state: 'unavailable' };
};

export interface HistoryPanelProps {
  editor: Editor | null;
  entries: HistoryEntry[];
  selectedEntryId: string | null;
  authorFilter: string | null;
  timeFilter: HistoryTimeFilter;
  acceptedSuggestionIds: string[];
  suggestionResolutions: SuggestionResolutionRecord[];
  legacySuggestionError?: string;
  availability: HistoryAvailabilityState;
  canRestore: boolean;
  authorshipVisible: boolean;
  open?: boolean;
  restoreNotice?: string;
  loadSavedHistoryPreview?: LoadSavedHistoryPreview;
  loadDiff: LoadHistoryDiff;
  onSelect: (entryId: string) => void;
  onRestore: (entry: HistoryEntry) => void;
  onToggleAuthorship: () => void;
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

const cleanDiffText = (text: string) => text.replace(/\s+/g, ' ').trim() || 'whitespace';

const isTextDiffSpan = (span: DiffSpan): span is TextDiffSpan =>
  span.kind === 'inserted' || span.kind === 'deleted';

const spanAnnouncement = (span: TextDiffSpan) => {
  const action = span.kind === 'inserted' ? 'Inserted text' : 'Deleted text';
  const actor = span.authorId ? ` by ${span.authorId}` : '';
  const intent = span.intent ? ` as ${span.intent}` : '';
  return `${action}${actor}${intent}: ${cleanDiffText(span.text)}`;
};

const diffAnnouncement = (spans: DiffSpan[]) => {
  const changedSpans = spans.filter(isTextDiffSpan).filter((span) => span.text.length > 0);
  if (!changedSpans.length) return 'Version diff contains no textual changes.';
  return `Version diff contains ${changedSpans
    .map(
      (span) =>
        `${span.kind === 'inserted' ? 'inserted' : 'deleted'} "${cleanDiffText(span.text)}"`,
    )
    .join('; ')}.`;
};

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
        aria-label={spanAnnouncement(span)}
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
        aria-label={spanAnnouncement(span)}
        title={title}
      >
        {span.text}
      </del>
    );
  }
  if (span.kind === 'attrChanged') {
    return <span key={span.id}>Formatting or structure changed.</span>;
  }
  return (
    <span key={span.id} className="history-diff-unchanged">
      {''}
    </span>
  );
};

function SavedHistorySnapshotContent({ load }: { load: LoadSavedHistoryPreview }) {
  const fieldId = useId();
  const helpId = useId();
  const [result, setResult] = useState<{
    load: LoadSavedHistoryPreview;
    snapshot: SavedHistorySnapshot | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void load().then(
      (snapshot) => {
        if (active) setResult({ load, snapshot });
      },
      () => {
        if (active) setResult({ load, snapshot: null });
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  if (result?.load !== load) {
    return (
      <p className="history-empty" role="status">
        Checking the saved version…
      </p>
    );
  }
  if (!result.snapshot) {
    return (
      <p className="history-empty" role="status">
        This saved version is no longer available to preview.
      </p>
    );
  }
  if (!result.snapshot.text) {
    return (
      <p className="history-empty" role="status">
        This saved version has no plain text.
      </p>
    );
  }

  return (
    <div className="history-diff-card">
      <label className="history-diff-meta" htmlFor={fieldId}>
        Saved version text
      </label>
      <p className="history-empty" id={helpId}>
        This read-only snapshot omits formatting and non-text content. Select and copy the text you
        need.
      </p>
      <textarea
        aria-describedby={helpId}
        className="history-diff"
        id={fieldId}
        readOnly
        rows={6}
        value={result.snapshot.text}
      />
    </div>
  );
}

function SavedHistoryPreview({ load }: { load: LoadSavedHistoryPreview }) {
  const previewId = useId();
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <button
        type="button"
        className="history-filter-button"
        aria-controls={previewId}
        aria-expanded={expanded}
        onClick={() => setExpanded((visible) => !visible)}
      >
        {expanded ? 'Hide saved version' : 'Preview saved version'}
      </button>
      <div id={previewId} hidden={!expanded}>
        {expanded ? <SavedHistorySnapshotContent load={load} /> : null}
      </div>
    </>
  );
}

export function HistoryPanel({
  editor,
  entries,
  selectedEntryId,
  authorFilter,
  timeFilter,
  acceptedSuggestionIds,
  suggestionResolutions,
  legacySuggestionError,
  availability,
  canRestore,
  authorshipVisible,
  open = true,
  restoreNotice,
  loadSavedHistoryPreview,
  loadDiff,
  onSelect,
  onRestore,
  onToggleAuthorship,
  onSetAuthorFilter,
  onClearAuthorFilter,
  onSetTimeFilter,
  onCopyFilterLink,
  onAcceptSuggestion,
  onRejectSuggestion,
}: HistoryPanelProps) {
  const [loaded, setLoaded] = useState<HistoryComparison | null>(null);
  const historyVerified =
    availability === 'ready' ||
    availability === 'empty-baseline' ||
    availability === 'capacity-reached';
  const visibleEntries =
    open && historyVerified
      ? entries.filter((entry) => {
          if (authorFilter && entry.actor.id !== authorFilter) return false;
          return matchesTimeFilter(entry, timeFilter);
        })
      : [];
  const selectedEntry =
    visibleEntries.find((entry) => entry.id === selectedEntryId) ?? visibleEntries.at(-1) ?? null;
  const fromSha = selectedEntry?.parentSha;
  const toSha = selectedEntry?.resultSha;
  useEffect(() => {
    if (!fromSha || !toSha) return;
    let active = true;
    const publish = (result: HistoryComparison['result']) => {
      if (active) setLoaded({ load: loadDiff, fromSha, toSha, result });
    };
    const compare = async () => {
      try {
        publish({ state: 'ready', diff: await loadDiff(fromSha, toSha) });
      } catch {
        publish({ state: 'unavailable' });
      }
    };
    void compare();
    return () => {
      active = false;
    };
  }, [fromSha, loadDiff, toSha]);
  if (!open) return null;
  const authorIds = historyVerified
    ? Array.from(new Set(entries.map((entry) => entry.actor.id))).sort()
    : [];
  const comparison =
    loaded?.load === loadDiff && loaded.fromSha === fromSha && loaded.toSha === toSha
      ? loaded.result
      : null;
  const diff = comparison?.state === 'ready' ? comparison.diff : null;
  const canRestoreSelected = selectedEntry ? entryHasHistoryBody(selectedEntry) : false;
  const hasActiveFilters = Boolean(authorFilter || timeFilter);
  const selectedSuggestionAccepted = selectedEntry
    ? acceptedSuggestionIds.includes(selectedEntry.id)
    : false;
  const selectedSuggestionResolution = selectedEntry
    ? suggestionResolutions.find((record) => record.entryId === selectedEntry.id)
    : null;
  const diffDescriptionId = selectedEntry
    ? `history-diff-announcement-${selectedEntry.id}`
    : undefined;

  return (
    <section className="lash-history-panel" data-testid="history-panel" aria-label="History">
      {restoreNotice ? <p role="status">{restoreNotice}</p> : null}
      {availability === 'capacity-reached' ? (
        <p className="history-empty" role="status">
          Version history is full. You can keep editing and saving this document.
        </p>
      ) : null}
      {availability === 'body-saving-unavailable' ? (
        <p className="history-empty">Version history is paused while local saving is unavailable.</p>
      ) : null}
      {availability === 'body-history-diverged' ? (
        <p className="history-empty" role="status">
          Version history is paused because it does not match the saved draft. You can keep editing
          and saving the draft.
        </p>
      ) : null}
      {availability === 'body-history-diverged' && loadSavedHistoryPreview ? (
        <SavedHistoryPreview load={loadSavedHistoryPreview} />
      ) : null}
      <div className="history-panel-header">
        <div className="history-panel-header-actions">
          {historyVerified ? (
            <>
              <button
                type="button"
                className="history-authorship-toggle"
                data-testid="history-authorship-toggle"
                aria-label={`${authorshipVisible ? 'Hide' : 'Show'} authorship in document`}
                aria-pressed={authorshipVisible ? 'true' : 'false'}
                data-active={authorshipVisible ? 'true' : 'false'}
                onClick={onToggleAuthorship}
              >
                {authorshipVisible ? 'Hide authorship' : 'Show authorship'}
              </button>
              <span className="history-panel-count" data-testid="history-count">
                {visibleEntries.length} {visibleEntries.length === 1 ? 'version' : 'versions'}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {availability === 'loading' ? (
        <p className="history-empty" data-testid="history-loading">
          Loading version history… Restore is unavailable until history is verified.
        </p>
      ) : null}
      {availability === 'recovery-available' ? (
        <p className="history-empty" data-testid="history-recovery-available">
          A verified earlier history copy is available. Review it before recovering.
        </p>
      ) : null}
      {availability === 'unavailable' ? (
        <p className="history-empty" data-testid="history-unavailable">
          Version history is unavailable. Lash has not changed it. Reload to try again.
        </p>
      ) : null}
      {availability === 'corrupt' || availability === 'unsupported-version' ? (
        <p className="history-empty" data-testid="history-corrupt">
          Version history could not be verified. Editing and Restore are paused to protect your
          document.
        </p>
      ) : null}
      {availability === 'remote-disabled' ? (
        <p className="history-empty" data-testid="history-remote-disabled">
          Version history is unavailable for this access link.
        </p>
      ) : null}

      {historyVerified ? (
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
      ) : null}

      {historyVerified && authorFilter ? (
        <div className="history-filter" data-testid="history-filter-author">
          <span>Filtered by {authorFilter}</span>
          <button type="button" onClick={onClearAuthorFilter}>
            Clear
          </button>
        </div>
      ) : null}

      {historyVerified && timeFilter ? (
        <div className="history-filter" data-testid="history-filter-time">
          <span>Filtered to last 7 days</span>
          <button type="button" onClick={() => onSetTimeFilter(null)}>
            Clear
          </button>
        </div>
      ) : null}

      {historyVerified && hasActiveFilters ? (
        <span className="history-filter-count" data-testid="history-filtered-counts">
          {visibleEntries.length} matching {visibleEntries.length === 1 ? 'version' : 'versions'}
        </span>
      ) : null}

      {historyVerified && suggestionResolutions.length ? (
        <ol className="suggestion-resolution-list" data-testid="suggestion-resolution-list">
          {suggestionResolutions.map((record) => (
            <li
              key={record.id}
              className="suggestion-resolution-row"
              data-testid="suggestion-resolution-row"
              data-entry-id={record.entryId}
              data-action={record.action}
            >
              <span>{record.action} suggestion</span>
              <span>{record.actorId}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {historyVerified && visibleEntries.length ? (
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
      ) : availability === 'empty-baseline' ? (
        <p className="history-empty" data-testid="history-empty">
          No versions yet. History records saved edits after a short pause.
        </p>
      ) : null}

      {historyVerified && selectedEntry && comparison?.state === 'unavailable' ? (
        <p role="status">This version comparison is unavailable.</p>
      ) : null}

      {historyVerified && selectedEntry && diff ? (
        <div className="history-diff-card">
          <div className="history-diff-meta">
            <span data-testid="history-selected-version">Version {selectedEntry.seq}</span>
            <span>{selectedEntry.actor.type === 'ai' ? 'AI' : selectedEntry.actor.id}</span>
          </div>
          {selectedEntry.intent === 'suggest' ? (
            <div className="history-suggestion-status" data-testid="history-suggestion-status">
              {selectedSuggestionResolution?.action === 'rejected'
                ? 'Rejected suggestion'
                : selectedSuggestionAccepted
                  ? 'Accepted suggestion'
                  : 'Pending suggestion'}
            </div>
          ) : null}
          <pre
            className="history-diff"
            data-testid="history-diff"
            aria-label="Version diff"
            aria-describedby={diffDescriptionId}
            aria-live="polite"
          >
            {diff.spans.map(renderSpan)}
          </pre>
          <p id={diffDescriptionId} className="sr-only" data-testid="history-diff-announcement">
            {diffAnnouncement(diff.spans)}
          </p>
          <div className="history-diff-actions">
            {selectedEntry.intent === 'suggest' &&
            !selectedSuggestionAccepted &&
            selectedSuggestionResolution?.action !== 'rejected' ? (
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
              disabled={!editor || !canRestore || !canRestoreSelected}
            >
              Restore
            </button>
          </div>
          {!canRestoreSelected ? (
            <p>This version saved text only. Its original formatting is unavailable.</p>
          ) : null}
          {legacySuggestionError && selectedEntry.intent === 'suggest' ? (
            <p role="alert">{legacySuggestionError}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
