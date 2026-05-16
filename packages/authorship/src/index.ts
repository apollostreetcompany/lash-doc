/**
 * @lash/authorship — interval-tree attribution that maps stably under inserts/deletes/joins/splits.
 * Status: SCAFFOLD — implement in M2/C5.
 *
 * Intervals are kept non-overlapping by the implementation so consumers may
 * index by `from`/`to` without de-duplication.
 */

import type { AuthorshipInterval, EditorOp, HistoryEntry } from '@lash/types';

export interface AuthorshipMap {
  /** Insert/replace an interval; trims/splits overlapping neighbours. */
  put(interval: AuthorshipInterval): void;
  /** Dominant author for a position, or null if unattributed. */
  authorAt(pos: number): string | null;
  /** All intervals overlapping [from, to). */
  intervalsIn(from: number, to: number): AuthorshipInterval[];
  /** Map all intervals through a sequence of ops; mutates in place. */
  applyOps(ops: EditorOp[]): void;
  /** Dominant author per visual line; used by the gutter. */
  blameByLine(docText: string): { line: number; authorId: string | null }[];
  /** Replay a HistoryEntry's ops to derive intervals from `entry.actor`. */
  recordEntry(entry: HistoryEntry): void;
}

export const createAuthorshipMap = (): AuthorshipMap => {
  let intervals: AuthorshipInterval[] = [];

  const normalize = () => {
    intervals = intervals
      .filter((interval) => interval.to > interval.from)
      .sort((a, b) => a.from - b.from || a.to - b.to);
  };

  const put = (interval: AuthorshipInterval) => {
    if (interval.to <= interval.from) return;
    const next: AuthorshipInterval[] = [];
    for (const current of intervals) {
      if (current.to <= interval.from || current.from >= interval.to) {
        next.push(current);
        continue;
      }
      if (current.from < interval.from) {
        next.push({ ...current, to: interval.from });
      }
      if (current.to > interval.to) {
        next.push({ ...current, from: interval.to });
      }
    }
    next.push({ ...interval });
    intervals = next;
    normalize();
  };

  const applyTextReplace = (from: number, to: number, insertedLength: number) => {
    const deletedLength = to - from;
    const delta = insertedLength - deletedLength;
    const next: AuthorshipInterval[] = [];

    for (const interval of intervals) {
      if (interval.to <= from) {
        next.push(interval);
        continue;
      }
      if (interval.from >= to) {
        next.push({ ...interval, from: interval.from + delta, to: interval.to + delta });
        continue;
      }

      if (interval.from < from) {
        next.push({ ...interval, to: from });
      }
      if (interval.to > to) {
        next.push({
          ...interval,
          from: from + insertedLength,
          to: interval.to + delta,
        });
      }
    }

    intervals = next;
    normalize();
  };

  const applyOps: AuthorshipMap['applyOps'] = (ops) => {
    for (const op of ops) {
      if (op.op === 'replace_text') {
        applyTextReplace(op.from, op.to, op.text.length);
      } else if (op.op === 'delete_range') {
        applyTextReplace(op.from, op.to, 0);
      }
    }
  };

  const intervalsIn: AuthorshipMap['intervalsIn'] = (from, to) =>
    intervals
      .filter((interval) => interval.to > from && interval.from < to)
      .map((interval) => ({ ...interval }));

  const authorAt: AuthorshipMap['authorAt'] = (pos) =>
    intervals.find((interval) => interval.from <= pos && pos < interval.to)?.authorId ?? null;

  const dominantAuthor = (from: number, to: number): string | null => {
    const weights = new Map<string, number>();
    for (const interval of intervalsIn(from, to)) {
      const overlap = Math.max(0, Math.min(to, interval.to) - Math.max(from, interval.from));
      if (!overlap) continue;
      weights.set(interval.authorId, (weights.get(interval.authorId) ?? 0) + overlap);
    }
    let best: { authorId: string; weight: number } | null = null;
    for (const [authorId, weight] of weights) {
      if (!best || weight > best.weight || (weight === best.weight && authorId < best.authorId)) {
        best = { authorId, weight };
      }
    }
    return best?.authorId ?? null;
  };

  const blameByLine: AuthorshipMap['blameByLine'] = (docText) => {
    const lines = docText.split('\n');
    let offset = 0;
    return lines.map((line, index) => {
      const from = offset;
      const to = offset + line.length;
      const authorId = line.length ? dominantAuthor(from, to) : authorAt(from);
      offset = to + 1;
      return { line: index + 1, authorId };
    });
  };

  const recordEntry: AuthorshipMap['recordEntry'] = (entry) => {
    applyOps(entry.ops);
    entry.ops.forEach((op, sourceOpIndex) => {
      if (op.op !== 'replace_text' || !op.text.length) return;
      put({
        from: op.from,
        to: op.from + op.text.length,
        authorId: entry.actor.id,
        ts: entry.ts,
        sourceEntryId: entry.id,
        sourceOpIndex,
      });
    });
  };

  return {
    put,
    authorAt,
    intervalsIn,
    applyOps,
    blameByLine,
    recordEntry,
  };
};
