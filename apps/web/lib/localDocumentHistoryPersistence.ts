'use client';

import {
  HISTORY_DATABASE_NAME,
  HISTORY_DATABASE_VERSION,
  type HistoryPersistenceAdapter,
  type HistoryPersistenceCommitInput,
  type HistoryPersistenceCommitResult,
  type HistoryPersistenceReadResult,
} from '@lash/history';

const PRIMARY_STORE = 'primary';
const BACKUP_STORE = 'backup';
const PENDING_STORE = 'pending';
const PENDING_DOCUMENT_INDEX = 'byDocument';

type HistoryRecord = Readonly<{
  documentId: string;
  raw: string;
}>;

export type LocalDocumentHistoryPersistenceOptions = Readonly<{
  indexedDB?: IDBFactory;
}>;

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed.')),
      { once: true },
    );
  });

const transactionResult = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')),
      { once: true },
    );
  });

const openHistoryDatabase = (factory: IDBFactory) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(HISTORY_DATABASE_NAME, HISTORY_DATABASE_VERSION);
    request.addEventListener(
      'upgradeneeded',
      () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PRIMARY_STORE)) {
          database.createObjectStore(PRIMARY_STORE, { keyPath: 'documentId' });
        }
        if (!database.objectStoreNames.contains(BACKUP_STORE)) {
          database.createObjectStore(BACKUP_STORE, { keyPath: 'documentId' });
        }
        if (!database.objectStoreNames.contains(PENDING_STORE)) {
          const pending = database.createObjectStore(PENDING_STORE, {
            keyPath: ['documentId', 'writerId'],
          });
          pending.createIndex(PENDING_DOCUMENT_INDEX, 'documentId', { unique: false });
        }
      },
      { once: true },
    );
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not open local version history.')),
      { once: true },
    );
    request.addEventListener(
      'blocked',
      () => reject(new Error('Local version history upgrade is blocked by another tab.')),
      { once: true },
    );
  });

const assertDatabaseShape = (database: IDBDatabase) => {
  for (const store of [PRIMARY_STORE, BACKUP_STORE, PENDING_STORE]) {
    if (!database.objectStoreNames.contains(store)) {
      throw new Error(`Local version history store ${store} is missing.`);
    }
  }
  const transaction = database.transaction(
    [PRIMARY_STORE, BACKUP_STORE, PENDING_STORE],
    'readonly',
  );
  if (transaction.objectStore(PRIMARY_STORE).keyPath !== 'documentId') {
    throw new Error('Local version history primary key is invalid.');
  }
  if (transaction.objectStore(BACKUP_STORE).keyPath !== 'documentId') {
    throw new Error('Local version history backup key is invalid.');
  }
  const pending = transaction.objectStore(PENDING_STORE);
  if (
    !Array.isArray(pending.keyPath) ||
    pending.keyPath[0] !== 'documentId' ||
    pending.keyPath[1] !== 'writerId' ||
    !pending.indexNames.contains(PENDING_DOCUMENT_INDEX)
  ) {
    throw new Error('Local version history pending store is invalid.');
  }
};

const parseRecord = (value: unknown, documentId: string): string | null => {
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    (value as { documentId?: unknown }).documentId !== documentId ||
    typeof (value as { raw?: unknown }).raw !== 'string'
  ) {
    throw new Error('Local version history record is malformed.');
  }
  return (value as HistoryRecord).raw;
};

const readStores = async (
  database: IDBDatabase,
  documentId: string,
): Promise<HistoryPersistenceReadResult> => {
  const transaction = database.transaction([PRIMARY_STORE, BACKUP_STORE], 'readonly');
  const primaryRequest = transaction.objectStore(PRIMARY_STORE).get(documentId);
  const backupRequest = transaction.objectStore(BACKUP_STORE).get(documentId);
  const [primary, backup] = await Promise.all([
    requestResult(primaryRequest),
    requestResult(backupRequest),
    transactionResult(transaction),
  ]);
  return {
    primaryRaw: parseRecord(primary, documentId),
    backupRaw: parseRecord(backup, documentId),
  };
};

const currentFactory = (provided?: IDBFactory) => {
  if (provided) return provided;
  if (typeof window === 'undefined' || !window.indexedDB) {
    throw new Error('IndexedDB is unavailable.');
  }
  return window.indexedDB;
};

const commitHistory = async (
  factory: IDBFactory,
  input: HistoryPersistenceCommitInput,
): Promise<HistoryPersistenceCommitResult> => {
  let database: IDBDatabase;
  try {
    database = await openHistoryDatabase(factory);
    assertDatabaseShape(database);
  } catch (error) {
    return {
      ok: false,
      reason: 'unavailable',
      details: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const transaction = database.transaction([PRIMARY_STORE, BACKUP_STORE], 'readwrite');
    const primary = transaction.objectStore(PRIMARY_STORE);
    const backup = transaction.objectStore(BACKUP_STORE);
    const currentValue = await requestResult(primary.get(input.documentId));
    const currentRaw = parseRecord(currentValue, input.documentId);
    if (currentRaw !== input.expectedPrimaryRaw) {
      transaction.abort();
      try {
        await transactionResult(transaction);
      } catch {
        // Expected abort: no publication occurred.
      }
      return { ok: false, reason: 'cas-mismatch', currentRaw };
    }

    let guardResult: unknown;
    try {
      guardResult = input.commitGuard();
    } catch {
      transaction.abort();
      try {
        await transactionResult(transaction);
      } catch {
        // Expected abort: no publication occurred.
      }
      return { ok: false, reason: 'guard-threw' };
    }
    if (guardResult !== true) {
      transaction.abort();
      try {
        await transactionResult(transaction);
      } catch {
        // Expected abort: no publication occurred.
      }
      return { ok: false, reason: 'guard-denied' };
    }

    if (currentRaw !== null) {
      backup.put({ documentId: input.documentId, raw: currentRaw } satisfies HistoryRecord);
    }
    primary.put({
      documentId: input.documentId,
      raw: input.nextPrimaryRaw,
    } satisfies HistoryRecord);
    transaction.commit();
    await transactionResult(transaction);

    const readback = await readStores(database, input.documentId);
    if (readback.primaryRaw !== input.nextPrimaryRaw) {
      return {
        ok: false,
        reason: 'commit-uncertain',
        details: 'Committed local version history did not match exact readback.',
      };
    }
    return { ok: true, primaryRaw: readback.primaryRaw };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      return { ok: false, reason: 'history-capacity' };
    }
    return {
      ok: false,
      reason: 'commit-uncertain',
      details: error instanceof Error ? error.message : String(error),
    };
  } finally {
    database.close();
  }
};

export const createLocalDocumentHistoryPersistence = (
  options: LocalDocumentHistoryPersistenceOptions = {},
): HistoryPersistenceAdapter => ({
  async read(documentId) {
    const database = await openHistoryDatabase(currentFactory(options.indexedDB));
    try {
      assertDatabaseShape(database);
      return await readStores(database, documentId);
    } finally {
      database.close();
    }
  },
  async commit(input) {
    return commitHistory(currentFactory(options.indexedDB), input);
  },
});
