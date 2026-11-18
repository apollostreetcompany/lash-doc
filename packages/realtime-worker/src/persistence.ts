import * as Y from 'yjs';

export const REALTIME_SNAPSHOT_INTERVAL = 20;
export const REALTIME_UPDATE_BYTES_LIMIT = 1024 * 1024;
export const REALTIME_UPDATE_BASE64_LIMIT = Math.ceil(REALTIME_UPDATE_BYTES_LIMIT / 3) * 4;
// Leave room for row metadata under the older, smaller SQLite runtime limit.
export const REALTIME_CHECKPOINT_BASE64_LIMIT = 1_750_000;

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

export const buildPromotedHydrationUpdates = (
  initialUpdate: string | null,
  snapshot: PersistedRealtimeSnapshot | null,
  updates: PersistedRealtimeUpdate[],
) => {
  const hydrated = buildHydrationUpdates(snapshot, updates);
  return !snapshot && initialUpdate ? [initialUpdate, ...hydrated] : hydrated;
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

export const hasPendingYjsData = (doc: Y.Doc) =>
  Boolean(doc.store.pendingStructs || doc.store.pendingDs);

export const loadRealtimeProjection = (updates: readonly string[]): Y.Doc | null => {
  const doc = new Y.Doc({ gc: true });
  try {
    for (const update of updates) Y.applyUpdate(doc, base64ToBytes(update));
    if (!hasPendingYjsData(doc)) return doc;
  } catch {
    // A malformed stored projection cannot serve as an authoritative base.
  }
  doc.destroy();
  return null;
};

export const encodeRealtimeCheckpoint = (doc: Y.Doc): Uint8Array | null => {
  if (!doc.gc || hasPendingYjsData(doc)) return null;
  try {
    const update = Y.encodeStateAsUpdate(doc);
    return Math.ceil(update.length / 3) * 4 <= REALTIME_CHECKPOINT_BASE64_LIMIT ? update : null;
  } catch {
    return null;
  }
};

export const buildRealtimeCheckpoint = (updates: readonly string[]): string | null => {
  if (updates.length === 0) return null;
  const doc = loadRealtimeProjection(updates);
  if (!doc) return null;
  try {
    const checkpoint = encodeRealtimeCheckpoint(doc);
    return checkpoint && bytesToBase64(checkpoint);
  } finally {
    doc.destroy();
  }
};

export const isRealtimeUpdatePayload = (update: string) => {
  if (
    update.length === 0 ||
    update.length > REALTIME_UPDATE_BASE64_LIMIT ||
    update.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(update)
  ) {
    return false;
  }
  try {
    const bytes = base64ToBytes(update);
    if (bytes.length > REALTIME_UPDATE_BYTES_LIMIT) return false;
    const { structs, ds } = Y.decodeUpdate(bytes);
    const validRange = (clock: number, length: number) =>
      Number.isSafeInteger(clock) &&
      clock >= 0 &&
      Number.isSafeInteger(length) &&
      length > 0 &&
      Number.isSafeInteger(clock + length);
    const validClient = (client: number) =>
      Number.isInteger(client) && client >= 0 && client <= 0xffffffff;
    return (
      structs.every(
        (part) => validClient(part.id.client) && validRange(part.id.clock, part.length),
      ) &&
      [...ds.clients].every(
        ([client, ranges]) =>
          validClient(client) && ranges.every((range) => validRange(range.clock, range.len)),
      )
    );
  } catch {
    return false;
  }
};
