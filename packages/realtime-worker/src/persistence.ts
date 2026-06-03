import * as Y from 'yjs';

export const REALTIME_SNAPSHOT_INTERVAL = 20;

export type RealtimeUpdateSource = 'client' | 'restore';

export interface PersistedRealtimeUpdate {
  sequence: number;
  actorId: string;
  source: RealtimeUpdateSource;
  update: string;
  createdAt: string;
}

export interface PersistedRealtimeSnapshot {
  sequence: number;
  update: string;
  createdAt: string;
}

export const shouldCompactRealtimeUpdates = (updatesSinceSnapshot: number) =>
  updatesSinceSnapshot >= REALTIME_SNAPSHOT_INTERVAL;

export const buildHydrationUpdates = (
  snapshot: PersistedRealtimeSnapshot | null,
  updates: PersistedRealtimeUpdate[],
) => {
  const snapshotSequence = snapshot?.sequence ?? 0;
  const laterUpdates = updates
    .filter((update) => update.sequence > snapshotSequence)
    .sort((left, right) => left.sequence - right.sequence)
    .map((update) => update.update);

  return snapshot ? [snapshot.update, ...laterUpdates] : laterUpdates;
};

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

export const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const mergeRealtimeUpdates = (updates: string[]) => {
  if (!updates.length) return null;
  return bytesToBase64(Y.mergeUpdates(updates.map(base64ToBytes)));
};

export const isRealtimeUpdatePayload = (update: string) => {
  try {
    Y.decodeUpdate(base64ToBytes(update));
    return true;
  } catch {
    return false;
  }
};
