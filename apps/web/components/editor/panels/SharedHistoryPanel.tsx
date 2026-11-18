'use client';

import type { SharedHistoryOutcome, SharedHistoryRevision } from '@lash/types';
import { useEffect, useState, useSyncExternalStore } from 'react';

import styles from './SharedHistoryPanel.module.css';
import type { SharedHistoryClient } from '../../../lib/sharedHistoryClient';

type Timeline = Extract<SharedHistoryOutcome, { kind: 'list' }>;
type Comparison = Extract<SharedHistoryOutcome, { kind: 'compare' }>;

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

export function SharedHistoryPanel({
  client,
  open,
  connected,
  canSendRestore,
}: {
  client: SharedHistoryClient;
  open: boolean;
  connected: boolean;
  canSendRestore: boolean;
}) {
  const revision = useSyncExternalStore(client.subscribe, client.getRevision, client.getRevision);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [listError, setListError] = useState(false);
  const [compareError, setCompareError] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [confirmation, setConfirmation] = useState<{ expectedHead: number; target: number } | null>(
    null,
  );
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!connected) {
      setTimeline(null);
      setComparison(null);
      setConfirmation(null);
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

  useEffect(() => {
    setComparison(null);
    setCompareError(false);
    if (!open || !connected || compareFrom === null || compareTo === null) return;
    let active = true;
    void client
      .request({ type: 'shared-history-compare', from: compareFrom, to: compareTo })
      .then((result) => {
        if (!active) return;
        if (result.kind === 'compare') setComparison(result);
        else setCompareError(true);
      });
    return () => {
      active = false;
    };
  }, [client, compareFrom, compareTo, connected, open]);

  const loadOlder = async () => {
    const before = timeline?.nextBefore;
    if (before === null || before === undefined || loadingOlder) return;
    setLoadingOlder(true);
    const result = await client.request({ type: 'shared-history-list', before });
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
    if (!confirmation || !canSendRestore || restoring) return;
    setRestoring(true);
    const result = await client.request({ type: 'shared-history-restore', ...confirmation });
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
          {compareError ? (
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
