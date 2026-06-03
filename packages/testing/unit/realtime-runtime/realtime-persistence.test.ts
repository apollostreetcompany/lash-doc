import { describe, expect, it } from 'vitest';

import {
  REALTIME_SNAPSHOT_INTERVAL,
  buildHydrationUpdates,
  shouldCompactRealtimeUpdates,
  type PersistedRealtimeSnapshot,
  type PersistedRealtimeUpdate,
} from '../../../realtime-worker/src/persistence';
import { parseRealtimeRoute } from '../../../realtime-worker/src/routing';

describe('realtime durable persistence', () => {
  it('parses restore as an edit-scoped room endpoint', () => {
    expect(
      parseRealtimeRoute(new URL('https://lash.test/api/realtime/rooms/Doc Alpha/restore')),
    ).toEqual({
      kind: 'room-restore',
      roomId: 'doc-alpha',
    });
  });

  it('hydrates new clients from the latest snapshot followed by later updates', () => {
    const snapshot: PersistedRealtimeSnapshot = {
      sequence: 20,
      update: 'snapshot-20',
      createdAt: '2026-06-03T18:00:00.000Z',
    };
    const updates: PersistedRealtimeUpdate[] = [
      {
        sequence: 21,
        actorId: 'actor-a',
        source: 'client',
        update: 'update-21',
        createdAt: '2026-06-03T18:00:01.000Z',
      },
      {
        sequence: 19,
        actorId: 'actor-a',
        source: 'client',
        update: 'stale-update',
        createdAt: '2026-06-03T17:59:59.000Z',
      },
      {
        sequence: 22,
        actorId: 'actor-b',
        source: 'restore',
        update: 'restore-22',
        createdAt: '2026-06-03T18:00:02.000Z',
      },
    ];

    expect(buildHydrationUpdates(snapshot, updates)).toEqual([
      'snapshot-20',
      'update-21',
      'restore-22',
    ]);
  });

  it('compacts after the configured snapshot interval without deleting history', () => {
    expect(REALTIME_SNAPSHOT_INTERVAL).toBeGreaterThanOrEqual(10);
    expect(shouldCompactRealtimeUpdates(REALTIME_SNAPSHOT_INTERVAL - 1)).toBe(false);
    expect(shouldCompactRealtimeUpdates(REALTIME_SNAPSHOT_INTERVAL)).toBe(true);
  });
});
