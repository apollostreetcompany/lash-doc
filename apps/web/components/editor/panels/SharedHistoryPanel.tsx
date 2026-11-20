'use client';

import type { SharedHistoryOutcome, SharedHistoryRevision } from '@lash/types';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import styles from './SharedHistoryPanel.module.css';
import type { SharedHistoryClient } from '../../../lib/sharedHistoryClient';

type Timeline = Extract<SharedHistoryOutcome, { kind: 'list' }>;
type Comparison = Extract<SharedHistoryOutcome, { kind: 'compare' }>;
type ComparisonResult = { from: number; to: number; comparison: Comparison | null };

const revisionLabel = (revision: SharedHistoryRevision) => {
  const time = new Date(revision.createdAt).toLocaleString();
  switch (revision.kind) {
    case 'baseline':
      return `History started · ${time}`;
    case 'restore':
      return `Restored version ${revision.restoredFrom} · ${time}`;
    case 'suggestion-accept':
      return `Version ${revision.sequence} · Suggestion accepted · ${revision.author} · ${time}`;
    case 'edit':
      return `Version ${revision.sequence} · ${revision.author} · ${time}`;
  }
};

type SharedHistoryPanelProps = {
  client: SharedHistoryClient;
  open: boolean;
  connected: boolean;
  canSendRestore: boolean;
};

export function SharedHistoryPanel(props: SharedHistoryPanelProps) {
  const { client } = props;
  const [scope, setScope] = useState({ client, key: 0 });
  if (scope.client !== client) {
    // A different room client must start without this client's timeline or selection.
    setScope({ client, key: scope.key + 1 });
    return null;
  }
  return <ClientHistoryPanel key={scope.key} {...props} />;
}

function ClientHistoryPanel({ client, open, connected, canSendRestore }: SharedHistoryPanelProps) {
  const revision = useSyncExternalStore(client.subscribe, client.getRevision, client.getRevision);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [listError, setListError] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [confirmation, setConfirmation] = useState<{ expectedHead: number; target: number } | null>(
    null,
  );
  const [notice, setNotice] = useState('');
  const sessionRef = useRef<object | null>(null);

  useLayoutEffect(() => {
    if (!open || !connected) {
      setLoadingOlder(false);
      setRestoring(false);
      setConfirmation(null);
      setNotice('');
      return;
    }
    sessionRef.current = {};
    return () => {
      sessionRef.current = null;
    };
  }, [connected, open]);

  useEffect(() => {
    if (!connected) {
      setTimeline(null);
      setComparisonResult(null);
      return;
    }
    if (!open) return;
    let active = true;
    const timer = setTimeout(() => {
      void client.request({ type: 'shared-history-list', before: null }).then((result) => {
        if (!active) return;
        setListError(result.kind !== 'list');
        if (result.kind === 'list') {
          setTimeline((previous) => {
            const older =
              previous?.revisions.filter(
                (entry) => entry.sequence < (result.revisions.at(-1)?.sequence ?? 0),
              ) ?? [];
            return {
              ...result,
              revisions: [...result.revisions, ...older],
              nextBefore: older.length ? (previous?.nextBefore ?? null) : result.nextBefore,
            };
          });
        } else {
          setTimeline(null);
        }
      });
    }, 240);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, connected, open, revision]);

  const selectedVersion =
    timeline?.revisions.find((entry) => entry.sequence === selected) ??
    timeline?.revisions[0] ??
    null;
  const compareFrom = fromVersion ?? selectedVersion?.parentSequence ?? null;
  const compareTo = selectedVersion?.sequence ?? null;
  const currentComparison =
    comparisonResult?.from === compareFrom && comparisonResult.to === compareTo
      ? comparisonResult
      : null;
  const comparison = currentComparison?.comparison;

  useEffect(() => {
    if (!open || !connected || compareFrom === null || compareTo === null) return;
    let active = true;
    void client
      .request({ type: 'shared-history-compare', from: compareFrom, to: compareTo })
      .then((result) => {
        if (!active) return;
        setComparisonResult({
          from: compareFrom,
          to: compareTo,
          comparison: result.kind === 'compare' ? result : null,
        });
      });
    return () => {
      active = false;
    };
  }, [client, compareFrom, compareTo, connected, open]);

  const loadOlder = async () => {
    const before = timeline?.nextBefore;
    const session = sessionRef.current;
    if (!session || before === null || before === undefined || loadingOlder) return;
    setLoadingOlder(true);
    const result = await client.request({ type: 'shared-history-list', before });
    if (sessionRef.current !== session) return;
    setLoadingOlder(false);
    if (result.kind !== 'list') {
      setNotice('Older versions could not be loaded. Try again.');
      return;
    }
    setTimeline(
      (previous) =>
        previous && {
          ...previous,
          revisions: [
            ...previous.revisions,
            ...result.revisions.filter(
              (entry) => !previous.revisions.some((listed) => listed.sequence === entry.sequence),
            ),
          ],
          nextBefore: result.nextBefore,
        },
    );
  };

  const restore = async () => {
    const session = sessionRef.current;
    if (!session || !confirmation || !canSendRestore || restoring) return;
    setRestoring(true);
    const result = await client.request({ type: 'shared-history-restore', ...confirmation });
    if (sessionRef.current !== session) return;
    setConfirmation(null);
    setRestoring(false);
    if (result.kind === 'restored') {
      setNotice('Version restored. The previous version is still in History.');
      setSelected(null);
      setFromVersion(null);
    } else if (result.kind === 'error' && result.code === 'stale-head') {
      setNotice('The document changed. Review the newest version before restoring.');
    } else {
      setNotice(
        'Lash could not confirm the restore. Check the newest version before trying again.',
      );
    }
    client.refresh();
  };

  if (!open) return null;
  return (
    <section className="lash-history-panel" aria-label="Shared version history">
      {notice ? (
        <p className="history-empty" role="status">
          {notice}
        </p>
      ) : null}
      {!connected ? <p className="history-empty">Reconnect to see shared history.</p> : null}
      {connected && listError ? (
        <>
          <p className="history-empty" role="status">
            Shared history could not be loaded.
          </p>
          <button type="button" onClick={() => client.refresh()}>
            Try again
          </button>
        </>
      ) : null}
      {connected && !listError && !timeline ? (
        <p className="history-empty">Loading version history…</p>
      ) : null}
      {connected && timeline && selectedVersion ? (
        <>
          <label className={styles.control}>
            Version
            <select
              value={selectedVersion.sequence}
              onChange={(event) => {
                setSelected(Number(event.currentTarget.value));
                setFromVersion(null);
                setConfirmation(null);
              }}
            >
              {timeline.revisions.map((entry) => (
                <option key={entry.sequence} value={entry.sequence}>
                  {revisionLabel(entry)}
                </option>
              ))}
            </select>
          </label>
          {timeline.nextBefore !== null ? (
            <button type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>
              Load older versions
            </button>
          ) : null}
          <label className={styles.control}>
            Compare with
            <select
              value={fromVersion ?? ''}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setFromVersion(value === '' ? null : Number(value));
              }}
            >
              <option value="">Previous version</option>
              {timeline.revisions
                .filter((entry) => entry.sequence !== selectedVersion.sequence)
                .map((entry) => (
                  <option key={entry.sequence} value={entry.sequence}>
                    {revisionLabel(entry)}
                  </option>
                ))}
            </select>
          </label>
          {compareFrom === null ? <p>This is the first version in shared history.</p> : null}
          {currentComparison && !comparison ? (
            <p role="status">This comparison is unavailable. Choose another version.</p>
          ) : null}
          {comparison ? (
            <div className={styles.comparison} aria-label="Version comparison">
              {comparison.changes.length === 0 ? <p>These versions are identical.</p> : null}
              {comparison.changes.map((change, index) => (
                <p key={index} className="history-diff-summary">
                  {change.prefix}
                  {change.before ? (
                    <del className="history-diff-delete">{change.before}</del>
                  ) : null}
                  {change.after ? <ins className="history-diff-insert">{change.after}</ins> : null}
                  {change.suffix}
                  {change.structureChanged ? <span> Formatting or structure changed.</span> : null}
                </p>
              ))}
              {comparison.truncated ? (
                <p>This preview shows the beginning of the changes.</p>
              ) : null}
            </div>
          ) : null}
          {timeline.canRestore && selectedVersion.sequence !== timeline.head && !confirmation ? (
            <button
              className="history-restore-button"
              type="button"
              disabled={!canSendRestore || restoring}
              onClick={() => {
                setNotice('');
                setConfirmation({ expectedHead: timeline.head, target: selectedVersion.sequence });
              }}
            >
              Restore this version
            </button>
          ) : null}
          {confirmation ? (
            <div role="group" aria-label="Confirm version restore">
              <p>Restore the selected text and formatting? The current version stays in History.</p>
              <div className={styles.actions}>
                <button
                  className="history-restore-button"
                  type="button"
                  disabled={restoring || !canSendRestore}
                  onClick={() => void restore()}
                >
                  Restore version
                </button>
                <button type="button" disabled={restoring} onClick={() => setConfirmation(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
