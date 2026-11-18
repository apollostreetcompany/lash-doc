import type { ShareScope } from '@lash/types';

import type { RealtimeSyncState } from './realtimeCollaboration';

const realtimeSyncLabels: Record<RealtimeSyncState, string> = {
  disabled: 'Local only',
  connecting: 'Connecting',
  hydrating: 'Loading shared document',
  reconnecting: 'Reconnecting',
  syncing: 'Saving',
  saved: 'Saved',
  offline: 'Offline',
};

const scopeLabel = (scope: ShareScope | null) =>
  scope ? `${scope.charAt(0).toUpperCase()}${scope.slice(1)} access` : 'Shared access';

export const realtimeSyncLabelForAccess = ({
  canWrite,
  scope,
  syncState,
}: {
  canWrite: boolean;
  scope: ShareScope | null;
  syncState: RealtimeSyncState;
}) => {
  if (canWrite) return realtimeSyncLabels[syncState];
  if (
    syncState === 'connecting' ||
    syncState === 'hydrating' ||
    syncState === 'reconnecting' ||
    syncState === 'offline'
  ) {
    return `Read only · ${realtimeSyncLabels[syncState]}`;
  }
  return `Read only · ${scopeLabel(scope)}`;
};
