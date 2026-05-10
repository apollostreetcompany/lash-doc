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
  throw new Error('createAuthorshipMap: not implemented (M2/C5)');
};
