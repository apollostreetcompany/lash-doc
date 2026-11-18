import { describe, expect, it } from 'vitest';

import { realtimeSyncLabelForAccess } from '../../../../apps/web/lib/realtimeAccessPresentation';

describe('realtime access presentation', () => {
  it.each([
    ['view', 'Read only · View access'],
    ['comment', 'Read only · Comment access'],
    ['suggest', 'Read only · Suggest access'],
  ] as const)('does not claim Saved for a hydrated %s grant', (scope, expected) => {
    expect(
      realtimeSyncLabelForAccess({
        canWrite: false,
        scope,
        syncState: 'saved',
      }),
    ).toBe(expected);
  });

  it('retains durability feedback for an edit grant', () => {
    expect(
      realtimeSyncLabelForAccess({
        canWrite: true,
        scope: 'edit',
        syncState: 'saved',
      }),
    ).toBe('Saved');
  });

  it.each([
    ['connecting', 'Read only · Connecting'],
    ['hydrating', 'Read only · Loading shared document'],
    ['reconnecting', 'Read only · Reconnecting'],
    ['offline', 'Read only · Offline'],
  ] as const)('preserves truthful %s transport state for read access', (syncState, expected) => {
    expect(
      realtimeSyncLabelForAccess({
        canWrite: false,
        scope: 'view',
        syncState,
      }),
    ).toBe(expected);
  });
});
