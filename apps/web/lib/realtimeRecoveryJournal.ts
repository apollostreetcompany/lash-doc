import type { ShareScope } from '@lash/types';

export const REALTIME_RECOVERY_JOURNAL_V1_PREFIX = 'lash:realtime-recovery:v1:';
export const REALTIME_RECOVERY_JOURNAL_PREFIX = 'lash:realtime-recovery:v2:';
export const REALTIME_RECOVERY_JOURNAL_V3_PREFIX = 'lash:realtime-recovery:v3:';

export type RealtimeRecoveryJournalStorage = {
  getItem(key: string): string | null;
  readonly length?: number;
  key?(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
};

export type RealtimeRecoveryUpdate = {
  updateId: string;
  bytes: Uint8Array;
};

export type RealtimeRecoveryJournalInput = {
  baselineStateVector: Uint8Array;
  documentId: string;
  epoch: number;
  principalId: string;
  remoteDocumentId?: string;
  reason: 'invalid' | 'scope-mismatch' | 'protocol-error' | 'lifecycle';
  routeDocumentId?: string;
  sealedAt?: string;
  scope: ShareScope | null;
  unsyncedMetadata: Record<string, unknown> | null;
  unsyncedTitle: string | null;
  updates: RealtimeRecoveryUpdate[];
};

type RealtimeRecoveryJournalRecordV1 = Omit<RealtimeRecoveryJournalInput, 'reason' | 'sealedAt'> & {
  checksum: string;
  createdAt: string;
  reason: 'invalid' | 'scope-mismatch' | 'protocol-error';
  version: 1;
};

export type RealtimeRecoveryJournalRecordV2 = Omit<RealtimeRecoveryJournalInput, 'sealedAt'> & {
  checksum: string;
  contentDigest: string;
  createdAt: string;
  sealedAt: string;
  updateCount: number;
  version: 2;
};

export type RealtimeRecoveryJournalRecordV3 = Omit<
  RealtimeRecoveryJournalRecordV2,
  'remoteDocumentId' | 'routeDocumentId' | 'version'
> & {
  remoteDocumentId: string;
  routeDocumentId: string;
  version: 3;
};

export type RealtimeRecoveryJournalRecord =
  | RealtimeRecoveryJournalRecordV1
  | RealtimeRecoveryJournalRecordV2
  | RealtimeRecoveryJournalRecordV3;

export type RealtimeRecoveryJournalWriteResult =
  | {
      key: string;
      ok: true;
      record: RealtimeRecoveryJournalRecord;
    }
  | {
      ok: false;
      reason: 'invalid-input' | 'key-collision' | 'readback-mismatch' | 'write-failed';
    };

export type RealtimeRecoveryJournalEntry = {
  key: string;
  record: RealtimeRecoveryJournalRecord;
};

export type RealtimeRecoveryJournalListResult =
  | { ok: true; records: RealtimeRecoveryJournalEntry[] }
  | { ok: false; reason: 'storage-unavailable' };

export type RealtimeRecoveryJournal = {
  discard(key: string): boolean;
  listForDocument(documentId: string): RealtimeRecoveryJournalListResult;
  persistAndVerify(input: RealtimeRecoveryJournalInput): RealtimeRecoveryJournalWriteResult;
  read(key: string): RealtimeRecoveryJournalRecord | null;
};

type SerializedRecoveryRecordV1 = {
  baselineStateVector: string;
  checksum: string;
  createdAt: string;
  documentId: string;
  epoch: number;
  principalId: string;
  reason: RealtimeRecoveryJournalRecordV1['reason'];
  scope: ShareScope | null;
  unsyncedMetadata: Record<string, unknown> | null;
  unsyncedTitle: string | null;
  updates: Array<{ bytes: string; updateId: string }>;
  version: 1;
};

type SerializedRecoveryRecordV2 = Omit<SerializedRecoveryRecordV1, 'reason' | 'version'> & {
  contentDigest: string;
  reason: RealtimeRecoveryJournalInput['reason'];
  sealedAt: string;
  updateCount: number;
  version: 2;
};

type SerializedRecoveryRecordV3 = Omit<SerializedRecoveryRecordV2, 'version'> & {
  remoteDocumentId: string;
  routeDocumentId: string;
  version: 3;
};

const forbiddenMetadataKey = /(?:authorization|credential|ticket|token|secret)/iu;

const containsForbiddenMetadataKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsForbiddenMetadataKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) => forbiddenMetadataKey.test(key) || containsForbiddenMetadataKey(child),
  );
};

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite recovery value.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') {
    throw new Error('Unsupported recovery value.');
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
};

const canonicalStringify = (value: unknown) => JSON.stringify(canonicalize(value));

const checksum = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const base64ToBytes = (encoded: string) => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const recoveryKey = (
  prefix: string,
  documentId: string,
  principalId: string,
  epoch: number,
  contentChecksum: string,
  receiptId: string,
) =>
  `${prefix}${encodeURIComponent(documentId)}:${encodeURIComponent(
    principalId,
  )}:${epoch}:${contentChecksum}:${encodeURIComponent(receiptId)}`;

const createDefaultReceiptId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to an isolated best-effort identifier for restricted runtimes.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const validInput = (input: RealtimeRecoveryJournalInput) => {
  const hasRouteDocumentId = input.routeDocumentId !== undefined;
  const hasRemoteDocumentId = input.remoteDocumentId !== undefined;
  if (
    !input.documentId ||
    !input.principalId ||
    hasRouteDocumentId !== hasRemoteDocumentId ||
    (hasRouteDocumentId &&
      (!input.routeDocumentId ||
        !input.remoteDocumentId ||
        input.documentId !== input.routeDocumentId)) ||
    !Number.isSafeInteger(input.epoch) ||
    input.epoch < 0 ||
    (input.reason !== 'invalid' &&
      input.reason !== 'scope-mismatch' &&
      input.reason !== 'protocol-error' &&
      input.reason !== 'lifecycle') ||
    (input.sealedAt !== undefined && !input.sealedAt) ||
    containsForbiddenMetadataKey(input.unsyncedMetadata)
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const update of input.updates) {
    if (!update.updateId || !update.bytes.length || ids.has(update.updateId)) return false;
    ids.add(update.updateId);
  }
  return true;
};

const serialize = (
  input: RealtimeRecoveryJournalInput,
  createdAt: string,
): SerializedRecoveryRecordV2 | SerializedRecoveryRecordV3 => {
  const sealedAt = input.sealedAt ?? createdAt;
  const baseContent = {
    baselineStateVector: bytesToBase64(input.baselineStateVector),
    documentId: input.documentId,
    epoch: input.epoch,
    principalId: input.principalId,
    reason: input.reason,
    sealedAt,
    scope: input.scope,
    unsyncedMetadata: input.unsyncedMetadata,
    unsyncedTitle: input.unsyncedTitle,
    updates: input.updates.map(({ bytes, updateId }) => ({
      bytes: bytesToBase64(bytes),
      updateId,
    })),
    updateCount: input.updates.length,
  };
  const content =
    input.routeDocumentId !== undefined && input.remoteDocumentId !== undefined
      ? {
          ...baseContent,
          remoteDocumentId: input.remoteDocumentId,
          routeDocumentId: input.routeDocumentId,
        }
      : baseContent;
  const withoutChecksum = {
    ...content,
    contentDigest: checksum(canonicalStringify(content)),
    createdAt,
    version: input.routeDocumentId === undefined ? (2 as const) : (3 as const),
  };
  return {
    ...withoutChecksum,
    checksum: checksum(canonicalStringify(withoutChecksum)),
  } as SerializedRecoveryRecordV2 | SerializedRecoveryRecordV3;
};

const parseV1 = (parsed: Partial<SerializedRecoveryRecordV1>) => {
  if (
    parsed.version !== 1 ||
    typeof parsed.createdAt !== 'string' ||
    typeof parsed.documentId !== 'string' ||
    typeof parsed.principalId !== 'string' ||
    !Number.isSafeInteger(parsed.epoch) ||
    (parsed.reason !== 'invalid' &&
      parsed.reason !== 'scope-mismatch' &&
      parsed.reason !== 'protocol-error') ||
    (parsed.scope !== null &&
      parsed.scope !== 'view' &&
      parsed.scope !== 'comment' &&
      parsed.scope !== 'suggest' &&
      parsed.scope !== 'edit') ||
    typeof parsed.baselineStateVector !== 'string' ||
    typeof parsed.checksum !== 'string' ||
    (parsed.unsyncedTitle !== null && typeof parsed.unsyncedTitle !== 'string') ||
    (parsed.unsyncedMetadata !== null &&
      (!parsed.unsyncedMetadata || typeof parsed.unsyncedMetadata !== 'object')) ||
    !Array.isArray(parsed.updates) ||
    parsed.updates.some(
      (update) =>
        !update || typeof update.updateId !== 'string' || typeof update.bytes !== 'string',
    )
  ) {
    return null;
  }
  const { checksum: storedChecksum, ...withoutChecksum } = parsed as SerializedRecoveryRecordV1;
  if (checksum(canonicalStringify(withoutChecksum)) !== storedChecksum) return null;
  const record: RealtimeRecoveryJournalRecordV1 = {
    baselineStateVector: base64ToBytes(withoutChecksum.baselineStateVector),
    checksum: storedChecksum,
    createdAt: withoutChecksum.createdAt,
    documentId: withoutChecksum.documentId,
    epoch: withoutChecksum.epoch,
    principalId: withoutChecksum.principalId,
    reason: withoutChecksum.reason,
    scope: withoutChecksum.scope,
    unsyncedMetadata: withoutChecksum.unsyncedMetadata,
    unsyncedTitle: withoutChecksum.unsyncedTitle,
    updates: withoutChecksum.updates.map(({ bytes, updateId }) => ({
      bytes: base64ToBytes(bytes),
      updateId,
    })),
    version: 1,
  };
  return validInput(record) ? record : null;
};

const parseV2 = (parsed: Partial<SerializedRecoveryRecordV2>) => {
  if (
    parsed.version !== 2 ||
    typeof parsed.createdAt !== 'string' ||
    typeof parsed.sealedAt !== 'string' ||
    typeof parsed.contentDigest !== 'string' ||
    typeof parsed.documentId !== 'string' ||
    typeof parsed.principalId !== 'string' ||
    !Number.isSafeInteger(parsed.epoch) ||
    (parsed.reason !== 'invalid' &&
      parsed.reason !== 'scope-mismatch' &&
      parsed.reason !== 'protocol-error' &&
      parsed.reason !== 'lifecycle') ||
    (parsed.scope !== null &&
      parsed.scope !== 'view' &&
      parsed.scope !== 'comment' &&
      parsed.scope !== 'suggest' &&
      parsed.scope !== 'edit') ||
    typeof parsed.baselineStateVector !== 'string' ||
    typeof parsed.checksum !== 'string' ||
    (parsed.unsyncedTitle !== null && typeof parsed.unsyncedTitle !== 'string') ||
    (parsed.unsyncedMetadata !== null &&
      (!parsed.unsyncedMetadata || typeof parsed.unsyncedMetadata !== 'object')) ||
    !Number.isSafeInteger(parsed.updateCount) ||
    !Array.isArray(parsed.updates) ||
    parsed.updateCount !== parsed.updates.length ||
    parsed.updates.some(
      (update) =>
        !update || typeof update.updateId !== 'string' || typeof update.bytes !== 'string',
    )
  ) {
    return null;
  }
  const { checksum: storedChecksum, ...withoutChecksum } = parsed as SerializedRecoveryRecordV2;
  if (checksum(canonicalStringify(withoutChecksum)) !== storedChecksum) return null;
  const { contentDigest, createdAt: _createdAt, version: _version, ...content } = withoutChecksum;
  if (checksum(canonicalStringify(content)) !== contentDigest) return null;
  const record: RealtimeRecoveryJournalRecordV2 = {
    baselineStateVector: base64ToBytes(withoutChecksum.baselineStateVector),
    checksum: storedChecksum,
    contentDigest,
    createdAt: withoutChecksum.createdAt,
    documentId: withoutChecksum.documentId,
    epoch: withoutChecksum.epoch,
    principalId: withoutChecksum.principalId,
    reason: withoutChecksum.reason,
    sealedAt: withoutChecksum.sealedAt,
    scope: withoutChecksum.scope,
    unsyncedMetadata: withoutChecksum.unsyncedMetadata,
    unsyncedTitle: withoutChecksum.unsyncedTitle,
    updateCount: withoutChecksum.updateCount,
    updates: withoutChecksum.updates.map(({ bytes, updateId }) => ({
      bytes: base64ToBytes(bytes),
      updateId,
    })),
    version: 2,
  };
  return validInput(record) ? record : null;
};

const parseV3 = (parsed: Partial<SerializedRecoveryRecordV3>) => {
  if (
    parsed.version !== 3 ||
    typeof parsed.createdAt !== 'string' ||
    typeof parsed.sealedAt !== 'string' ||
    typeof parsed.contentDigest !== 'string' ||
    typeof parsed.documentId !== 'string' ||
    typeof parsed.routeDocumentId !== 'string' ||
    typeof parsed.remoteDocumentId !== 'string' ||
    parsed.documentId !== parsed.routeDocumentId ||
    typeof parsed.principalId !== 'string' ||
    !Number.isSafeInteger(parsed.epoch) ||
    (parsed.reason !== 'invalid' &&
      parsed.reason !== 'scope-mismatch' &&
      parsed.reason !== 'protocol-error' &&
      parsed.reason !== 'lifecycle') ||
    (parsed.scope !== null &&
      parsed.scope !== 'view' &&
      parsed.scope !== 'comment' &&
      parsed.scope !== 'suggest' &&
      parsed.scope !== 'edit') ||
    typeof parsed.baselineStateVector !== 'string' ||
    typeof parsed.checksum !== 'string' ||
    (parsed.unsyncedTitle !== null && typeof parsed.unsyncedTitle !== 'string') ||
    (parsed.unsyncedMetadata !== null &&
      (!parsed.unsyncedMetadata || typeof parsed.unsyncedMetadata !== 'object')) ||
    !Number.isSafeInteger(parsed.updateCount) ||
    !Array.isArray(parsed.updates) ||
    parsed.updateCount !== parsed.updates.length ||
    parsed.updates.some(
      (update) =>
        !update || typeof update.updateId !== 'string' || typeof update.bytes !== 'string',
    )
  ) {
    return null;
  }
  const { checksum: storedChecksum, ...withoutChecksum } = parsed as SerializedRecoveryRecordV3;
  if (checksum(canonicalStringify(withoutChecksum)) !== storedChecksum) return null;
  const { contentDigest, createdAt: _createdAt, version: _version, ...content } = withoutChecksum;
  if (checksum(canonicalStringify(content)) !== contentDigest) return null;
  const record: RealtimeRecoveryJournalRecordV3 = {
    baselineStateVector: base64ToBytes(withoutChecksum.baselineStateVector),
    checksum: storedChecksum,
    contentDigest,
    createdAt: withoutChecksum.createdAt,
    documentId: withoutChecksum.documentId,
    epoch: withoutChecksum.epoch,
    principalId: withoutChecksum.principalId,
    reason: withoutChecksum.reason,
    remoteDocumentId: withoutChecksum.remoteDocumentId,
    routeDocumentId: withoutChecksum.routeDocumentId,
    sealedAt: withoutChecksum.sealedAt,
    scope: withoutChecksum.scope,
    unsyncedMetadata: withoutChecksum.unsyncedMetadata,
    unsyncedTitle: withoutChecksum.unsyncedTitle,
    updateCount: withoutChecksum.updateCount,
    updates: withoutChecksum.updates.map(({ bytes, updateId }) => ({
      bytes: base64ToBytes(bytes),
      updateId,
    })),
    version: 3,
  };
  return validInput(record) ? record : null;
};

const parse = (raw: string): RealtimeRecoveryJournalRecord | null => {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (parsed.version === 1) return parseV1(parsed as Partial<SerializedRecoveryRecordV1>);
    if (parsed.version === 2) return parseV2(parsed as Partial<SerializedRecoveryRecordV2>);
    if (parsed.version === 3) return parseV3(parsed as Partial<SerializedRecoveryRecordV3>);
    return null;
  } catch {
    return null;
  }
};

export const createRealtimeRecoveryJournal = (
  storage: RealtimeRecoveryJournalStorage,
  now: () => string = () => new Date().toISOString(),
  createReceiptId: () => string = createDefaultReceiptId,
): RealtimeRecoveryJournal => ({
  discard(key) {
    if (
      !key.startsWith(REALTIME_RECOVERY_JOURNAL_PREFIX) &&
      !key.startsWith(REALTIME_RECOVERY_JOURNAL_V1_PREFIX) &&
      !key.startsWith(REALTIME_RECOVERY_JOURNAL_V3_PREFIX)
    ) {
      return false;
    }
    try {
      storage.removeItem(key);
      return storage.getItem(key) === null;
    } catch {
      return false;
    }
  },
  listForDocument(documentId) {
    try {
      const length = storage.length;
      if (
        !documentId ||
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        !storage.key
      ) {
        return { ok: false, reason: 'storage-unavailable' };
      }
      const prefixes = [
        `${REALTIME_RECOVERY_JOURNAL_V3_PREFIX}${encodeURIComponent(documentId)}:`,
        `${REALTIME_RECOVERY_JOURNAL_PREFIX}${encodeURIComponent(documentId)}:`,
        `${REALTIME_RECOVERY_JOURNAL_V1_PREFIX}${encodeURIComponent(documentId)}:`,
      ];
      const records: RealtimeRecoveryJournalEntry[] = [];
      for (let index = 0; index < length; index += 1) {
        const key = storage.key(index);
        if (key === null) return { ok: false, reason: 'storage-unavailable' };
        if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
        const raw = storage.getItem(key);
        if (raw === null) return { ok: false, reason: 'storage-unavailable' };
        const record = parse(raw);
        const routeDocumentId = record?.version === 3 ? record.routeDocumentId : record?.documentId;
        if (!record || routeDocumentId !== documentId) {
          return { ok: false, reason: 'storage-unavailable' };
        }
        records.push({ key, record });
      }
      records.sort(
        (left, right) =>
          right.record.epoch - left.record.epoch ||
          right.record.createdAt.localeCompare(left.record.createdAt) ||
          left.key.localeCompare(right.key),
      );
      return { ok: true, records };
    } catch {
      return { ok: false, reason: 'storage-unavailable' };
    }
  },
  persistAndVerify(input) {
    if (!validInput(input)) return { ok: false, reason: 'invalid-input' };
    let serializedRecord: SerializedRecoveryRecordV2 | SerializedRecoveryRecordV3;
    let receiptId: string;
    try {
      serializedRecord = serialize(input, now());
      receiptId = createReceiptId();
    } catch {
      return { ok: false, reason: 'write-failed' };
    }
    if (!receiptId) return { ok: false, reason: 'write-failed' };
    const key = recoveryKey(
      serializedRecord.version === 3
        ? REALTIME_RECOVERY_JOURNAL_V3_PREFIX
        : REALTIME_RECOVERY_JOURNAL_PREFIX,
      input.documentId,
      input.principalId,
      input.epoch,
      serializedRecord.checksum,
      receiptId,
    );
    const serialized = canonicalStringify(serializedRecord);
    try {
      const existing = storage.getItem(key);
      if (existing !== null) {
        return { ok: false, reason: 'key-collision' };
      }
      storage.setItem(key, serialized);
    } catch {
      return { ok: false, reason: 'write-failed' };
    }
    try {
      const readback = storage.getItem(key);
      if (readback !== serialized) return { ok: false, reason: 'readback-mismatch' };
      const record = parse(readback);
      if (!record) return { ok: false, reason: 'readback-mismatch' };
      return { key, ok: true, record };
    } catch {
      return { ok: false, reason: 'readback-mismatch' };
    }
  },
  read(key) {
    if (
      !key.startsWith(REALTIME_RECOVERY_JOURNAL_PREFIX) &&
      !key.startsWith(REALTIME_RECOVERY_JOURNAL_V1_PREFIX) &&
      !key.startsWith(REALTIME_RECOVERY_JOURNAL_V3_PREFIX)
    ) {
      return null;
    }
    try {
      const raw = storage.getItem(key);
      return raw === null ? null : parse(raw);
    } catch {
      return null;
    }
  },
});
