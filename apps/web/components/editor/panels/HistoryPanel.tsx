/**
 * panels/HistoryPanel — local version timeline + deterministic text diff.
 */
'use client';

import { entryHasHistoryBody } from '@lash/history';
import type { DiffJSON, DiffSpan, HistoryEntry } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { HistoryVersionReader, type LoadHistoryVersion } from './HistoryVersionReader';

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
type HistoryComparisonChoice = {
  baselineId: string;
  destinationId: string;
  load: LoadHistoryDiff;
  authorFilter: string | null;
  timeFilter: HistoryTimeFilter;
};
type HistoryComparison = {
  load: LoadHistoryDiff;
  fromSha: string;
  toSha: string;
  versionKey: string;
  result: { state: 'ready'; diff: DiffJSON } | { state: 'unavailable' };
};

export interface HistoryPanelProps {
  editor: Editor | null;
  entries: HistoryEntry[];
  selectedEntryId: string | null;
  verifiedHeadSha?: string | null;
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
  loadVersion?: LoadHistoryVersion;
  onReturnToDocument?: () => void;
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
const FORMATTING_CHANGE_NOTICE = 'Formatting or structure changed.';

const matchesTimeFilter = (entry: HistoryEntry, filter: HistoryTimeFilter) => {
  if (!filter) return true;
  const ts = Date.parse(entry.ts);
  if (!Number.isFinite(ts)) return false;
  return ts >= Date.now() - SEVEN_DAYS_MS;
};

const previousDistinctDraft = (entries: readonly HistoryEntry[], headSha: string) => {
  for (let index = entries.length - 2; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.intent !== 'suggest' && entry.resultSha !== headSha) return entry;
  }
  return undefined;
};

const spanTitle = (span: DiffSpan) =>
  [span.authorId, span.intent, span.ts].filter((part): part is string => Boolean(part)).join(' | ');

const cleanDiffText = (text: string) => text.replace(/\s+/g, ' ').trim() || 'whitespace';

const isTextDiffSpan = (span: DiffSpan): span is TextDiffSpan =>
  span.kind === 'inserted' || span.kind === 'deleted';

const spanAnnouncement = (span: TextDiffSpan, showAttribution: boolean) => {
  const action = span.kind === 'inserted' ? 'Inserted text' : 'Deleted text';
  const actor = showAttribution && span.authorId ? ` by ${span.authorId}` : '';
  const intent = showAttribution && span.intent ? ` as ${span.intent}` : '';
  return `${action}${actor}${intent}: ${cleanDiffText(span.text)}`;
};

const diffAnnouncement = (changedSpans: TextDiffSpan[], formattingChanged: boolean) => {
  const textChanges = changedSpans
    .slice(0, 2)
    .map((span) => {
      const excerpt = span.text.match(/^.{1,80}/su)?.[0] ?? '';
      const more = excerpt.length < span.text.length ? '…' : '';
      return `${span.kind === 'inserted' ? 'inserted' : 'deleted'} "${cleanDiffText(excerpt)}${more}"`;
    })
    .join(' and ');
  const summary = `Version diff contains ${textChanges || 'no textual changes'}.`;
  const formattingSummary = formattingChanged ? `${FORMATTING_CHANGE_NOTICE} ` : '';
  const moreChanges = changedSpans.length > 2 ? ' More changes are in the version diff.' : '';
  return `${formattingSummary}${summary}${moreChanges}`;
};

const renderSpan = (span: DiffSpan, showAttribution: boolean) => {
  const title = showAttribution ? spanTitle(span) || undefined : undefined;
  const authorId = (showAttribution && span.authorId) || '';
  const intent = (showAttribution && span.intent) || '';
  if (span.kind === 'inserted') {
    return (
      <ins
        key={span.id}
        className="history-diff-insert"
        data-testid="history-diff-insert"
        data-author-id={authorId}
        data-intent={intent}
        aria-label={spanAnnouncement(span, showAttribution)}
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
        data-author-id={authorId}
        data-intent={intent}
        aria-label={spanAnnouncement(span, showAttribution)}
        title={title}
      >
        {span.text}
      </del>
    );
  }
  if (span.kind === 'attrChanged') return null;
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
  verifiedHeadSha,
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
  loadVersion,
  onReturnToDocument,
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
  const baselineFieldId = useId();
  const selectedVersionLabelId = useId();
  const [choice, setChoice] = useState<HistoryComparisonChoice | null>(null);
  const [loaded, setLoaded] = useState<HistoryComparison | null>(null);
  const versionListRef = useRef<HTMLOListElement>(null);
  const selectedVersionRef = useRef<HTMLButtonElement>(null);
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
  const requestedIndex = visibleEntries.findIndex((entry) => entry.id === selectedEntryId);
  const selectedVersionIndex = requestedIndex < 0 ? visibleEntries.length - 1 : requestedIndex;
  const selectedEntry = visibleEntries[selectedVersionIndex] ?? null;
  const selectedVersionId = selectedEntry?.id;
  const baselines =
    selectedEntry && selectedEntry.intent !== 'suggest'
      ? visibleEntries.filter(
          (entry) => entry.id !== selectedVersionId && entry.intent !== 'suggest',
        )
      : [];
  const comparisonBaseline =
    choice &&
    choice.destinationId === selectedVersionId &&
    choice.load === loadDiff &&
    choice.authorFilter === authorFilter &&
    choice.timeFilter === timeFilter
      ? baselines.find((entry) => entry.id === choice.baselineId)
      : undefined;
  const fromSha = comparisonBaseline?.resultSha ?? selectedEntry?.parentSha;
  const toSha = selectedEntry?.resultSha;
  // A restored snapshot can reuse either content hash while referring to a different saved row.
  const versionKey =
    fromSha && toSha
      ? JSON.stringify([
          selectedVersionId,
          comparisonBaseline?.id,
          entries
            .filter((entry) => entry.resultSha === fromSha || entry.resultSha === toSha)
            .map((entry) => entry.id),
        ])
      : null;
  const showAttribution =
    !comparisonBaseline ||
    (comparisonBaseline.resultSha === selectedEntry?.parentSha &&
      comparisonBaseline.seq + 1 === selectedEntry.seq);

  useEffect(() => {
    // Clear retired choices even if the same filter or version is opened again later.
    if (choice && !comparisonBaseline)
      setChoice((current) => (current === choice ? null : current));
  }, [choice, comparisonBaseline]);

  useLayoutEffect(() => {
    const list = versionListRef.current;
    const selected = selectedVersionRef.current;
    if (selectedVersionIndex < 0 || !list || !selected) return;
    const listBounds = list.getBoundingClientRect();
    const selectedBounds = selected.getBoundingClientRect();
    // Scroll the version list itself to avoid moving the rail or writing surface.
    if (selectedBounds.top < listBounds.top) {
      list.scrollTop -= Math.ceil(listBounds.top - selectedBounds.top);
    } else if (selectedBounds.bottom > listBounds.bottom) {
      list.scrollTop += Math.ceil(selectedBounds.bottom - listBounds.bottom);
    }
  }, [selectedVersionId, selectedVersionIndex]);

  useEffect(() => {
    if (!fromSha || !toSha || !versionKey) return;
    let active = true;
    const publish = (result: HistoryComparison['result']) => {
      if (active) setLoaded({ load: loadDiff, fromSha, toSha, versionKey, result });
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
  }, [fromSha, loadDiff, toSha, versionKey]);
  if (!open) return null;
  const authorIds = historyVerified
    ? Array.from(new Set(entries.map((entry) => entry.actor.id))).sort()
    : [];
  const comparison =
    loaded?.load === loadDiff &&
    loaded.fromSha === fromSha &&
    loaded.toSha === toSha &&
    loaded.versionKey === versionKey
      ? loaded.result
      : null;
  const diff = comparison?.state === 'ready' ? comparison.diff : null;
  const formattingChanged = Boolean(diff?.spans.some((span) => span.kind === 'attrChanged'));
  const textChanges =
    diff?.spans.filter(isTextDiffSpan).filter((span) => span.text.length > 0) ?? [];
  const readSelectedVersion = selectedEntry?.intent === 'suggest' ? undefined : loadVersion;
  const canRestoreSelected = selectedEntry ? entryHasHistoryBody(selectedEntry) : false;
  const hasActiveFilters = Boolean(authorFilter || timeFilter);
  const previousDraft =
    readSelectedVersion &&
    selectedEntry &&
    selectedEntryId === null &&
    !hasActiveFilters &&
    availability === 'ready' &&
    selectedEntry.resultSha === verifiedHeadSha
      ? previousDistinctDraft(entries, verifiedHeadSha)
      : undefined;
  const readEntry = previousDraft ?? selectedEntry;
  const selectedSuggestionAccepted = selectedEntry
    ? acceptedSuggestionIds.includes(selectedEntry.id)
    : false;
  const selectedSuggestionResolution = selectedEntry
    ? suggestionResolutions.find((record) => record.entryId === selectedEntry.id)
    : null;
  const diffDescriptionId = selectedEntry
    ? `history-diff-announcement-${selectedEntry.id}`
    : undefined;
  const versionReader =
    readSelectedVersion && readEntry ? (
      <div className="history-diff-actions">
        <HistoryVersionReader
          key={previousDraft ? 'previous-draft' : `${readEntry.id}:${readEntry.resultSha}`}
          load={readSelectedVersion}
          previousDraft={Boolean(previousDraft)}
          sequence={readEntry.seq}
          sha={readEntry.resultSha}
          onReturnToDocument={onReturnToDocument}
        />
      </div>
    ) : null;

  return (
    <section className="lash-history-panel" data-testid="history-panel" aria-label="History">
      {restoreNotice ? <p role="status">{restoreNotice}</p> : null}
      {availability === 'capacity-reached' ? (
        <p className="history-empty" role="status">
          Version history is full. You can keep editing and saving this document.
        </p>
      ) : null}
      {availability === 'body-saving-unavailable' ? (
        <p className="history-empty">
          Version history is paused while local saving is unavailable.
        </p>
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

      {previousDraft ? versionReader : null}

      {selectedEntry && baselines.length ? (
        <div className="history-compare-control">
          <label htmlFor={baselineFieldId}>Compare with</label>
          <select
            id={baselineFieldId}
            aria-describedby={selectedVersionLabelId}
            value={comparisonBaseline?.id ?? ''}
            onChange={(event) => {
              const baselineId = event.currentTarget.value;
              if (baselineId && selectedEntryId !== selectedEntry.id) onSelect(selectedEntry.id);
              setChoice(
                baselineId
                  ? {
                      baselineId,
                      destinationId: selectedEntry.id,
                      load: loadDiff,
                      authorFilter,
                      timeFilter,
                    }
                  : null,
              );
            }}
          >
            <option value="">Previous version</option>
            {baselines.map((entry) => (
              <option key={entry.id} value={entry.id}>
                Version {entry.seq}
              </option>
            ))}
          </select>
        </div>
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

      {historyVerified && visibleEntries.length ? (
        <ol
          ref={versionListRef}
          className="history-version-list"
          data-testid="history-version-list"
        >
          {visibleEntries.map((entry) => {
            const selected = selectedEntry?.id === entry.id;
            return (
              <li key={entry.id}>
                <button
                  ref={selected ? selectedVersionRef : undefined}
                  type="button"
                  className="history-version-button"
                  data-testid="history-version"
                  data-selected={selected ? 'true' : 'false'}
                  aria-pressed={selected ? 'true' : 'false'}
                  onClick={() => {
                    if (!selected) setChoice(null);
                    onSelect(entry.id);
                  }}
                >
                  <span id={selected ? selectedVersionLabelId : undefined}>
                    Version {entry.seq}
                  </span>
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

      {historyVerified && selectedEntry && (diff || readSelectedVersion || comparisonBaseline) ? (
        <div className="history-diff-card">
          <div className="history-diff-meta">
            <span data-testid="history-selected-version">Version {selectedEntry.seq}</span>
            <span>
              {comparisonBaseline
                ? `Changes from Version ${comparisonBaseline.seq}`
                : selectedEntry.actor.type === 'ai'
                  ? 'AI'
                  : selectedEntry.actor.id}
            </span>
          </div>
          {previousDraft ? null : versionReader}
          {selectedEntry.intent === 'suggest' ? (
            <div className="history-suggestion-status" data-testid="history-suggestion-status">
              {selectedSuggestionResolution?.action === 'rejected'
                ? 'Rejected suggestion'
                : selectedSuggestionAccepted
                  ? 'Accepted suggestion'
                  : 'Pending suggestion'}
            </div>
          ) : null}
          {formattingChanged ? (
            <p className="history-diff-formatting">{FORMATTING_CHANGE_NOTICE}</p>
          ) : null}
          {diff && (textChanges.length || !formattingChanged) ? (
            <pre
              className="history-diff"
              data-testid="history-diff"
              role="region"
              tabIndex={0}
              aria-label={
                comparisonBaseline
                  ? `Version diff, Version ${comparisonBaseline.seq} to Version ${selectedEntry.seq}`
                  : 'Version diff'
              }
              aria-describedby={diffDescriptionId}
            >
              {comparisonBaseline && !textChanges.length
                ? 'No textual changes.'
                : diff.spans.map((span) => renderSpan(span, showAttribution))}
            </pre>
          ) : comparisonBaseline && !comparison ? (
            <p className="history-empty" role="status">
              Comparing versions…
            </p>
          ) : null}
          <p
            aria-atomic="true"
            aria-live="polite"
            id={diffDescriptionId}
            className="sr-only"
            data-testid="history-diff-announcement"
          >
            {diff ? diffAnnouncement(textChanges, formattingChanged) : ''}
          </p>
          <div className="history-diff-actions">
            {diff &&
            selectedEntry.intent === 'suggest' &&
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
            {diff || comparisonBaseline ? (
              <button
                type="button"
                className="history-restore-button"
                data-testid="history-restore-button"
                aria-describedby={selectedVersionLabelId}
                onClick={() => onRestore(selectedEntry)}
                disabled={!editor || !canRestore || !canRestoreSelected}
              >
                Restore
              </button>
            ) : null}
          </div>
          {!canRestoreSelected ? (
            <p>This version saved text only. Its original formatting is unavailable.</p>
          ) : null}
          {legacySuggestionError && selectedEntry.intent === 'suggest' ? (
            <p role="alert">{legacySuggestionError}</p>
          ) : null}
        </div>
      ) : null}

      {historyVerified && selectedEntry && comparison?.state === 'unavailable' ? (
        <p role="status">This version comparison is unavailable.</p>
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
    </section>
  );
}
