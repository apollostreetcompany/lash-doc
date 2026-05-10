/**
 * @lash/authorship — interval-tree attribution that maps stably under inserts/deletes/joins/splits.
 * Status: SCAFFOLD — implement in M2/C5.
 */

import type { AuthorshipInterval, EditorOp } from '@lash/types';

export interface AuthorshipMap {
  put(interval: AuthorshipInterval): void;
  /** dominant author for a position */
  authorAt(pos: number): string | null;
  /** all intervals overlapping [from, to) */
  intervalsIn(from: number, to: number): AuthorshipInterval[];
  /** map all intervals through a sequence of ops; mutates in place */
  applyOps(ops: EditorOp[]): void;
  /** dominant author per visual line; used by gutter */
  blameByLine(docText: string): { line: number; authorId: string | null }[];
}

export const createAuthorshipMap = (): AuthorshipMap => {
  throw new Error('createAuthorshipMap: not implemented (M2/C5)');
};
