export type SharedHistoryRevision = {
  sequence: number;
  parentSequence: number | null;
  createdAt: string;
  kind: 'baseline' | 'edit' | 'suggestion-accept' | 'restore';
  author: string;
  restoredFrom: number | null;
};

export type SharedHistoryChange = {
  before: string;
  after: string;
  prefix: string;
  suffix: string;
  structureChanged: boolean;
};

export type SharedHistoryCommand = { requestId: string } & (
  | { type: 'shared-history-list'; before: number | null }
  | { type: 'shared-history-compare'; from: number; to: number }
  | { type: 'shared-history-restore'; expectedHead: number; target: number }
);

export type SharedHistoryOutcome =
  | {
      kind: 'list';
      head: number;
      revisions: SharedHistoryRevision[];
      nextBefore: number | null;
      canRestore: boolean;
    }
  | { kind: 'compare'; changes: SharedHistoryChange[]; truncated: boolean }
  | { kind: 'restored'; sequence: number }
  | { kind: 'error'; code: 'unavailable' | 'forbidden' | 'stale-head' | 'invalid-version' };

export type SharedHistoryFrame = {
  type: 'shared-history-result';
  requestId: string;
  roomId: string;
  outcome: SharedHistoryOutcome;
};

export const SHARED_HISTORY_RESTORE_CLOSE = 4410;
