export const DEFAULT_DOCUMENT_ID = 'demo-document';
export const DEFAULT_DOC_TITLE = 'Untitled document';
export const DOCUMENT_REGISTRY_STORAGE_KEY = 'lash:documents';

export interface LashDocumentRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

const MAX_DOCUMENT_ID_LENGTH = 96;
const UNKNOWN_DATE = new Date(0).toISOString();

const canonicalizeDocumentId = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_DOCUMENT_ID_LENGTH);

export const normalizeDocumentId = (raw: string | undefined | null): string =>
  canonicalizeDocumentId(raw ?? '') || DEFAULT_DOCUMENT_ID;

export const documentPath = (documentId: string) => `/doc/${normalizeDocumentId(documentId)}`;

export const documentTitleStorageKey = (documentId: string) =>
  `lash:title:${normalizeDocumentId(documentId)}`;

const normalizeTitle = (title: string | undefined | null) => title?.trim() || DEFAULT_DOC_TITLE;

const readTitleKey = (storage: Storage | undefined, id: string) => {
  try {
    return storage?.getItem(documentTitleStorageKey(id)) ?? null;
  } catch {
    return null;
  }
};

const parseRegistryRows = (raw: string | null): unknown[] => {
  if (raw === null) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('The document list is unreadable.');
  return rows;
};

const parseRegistryRecord = (row: unknown): LashDocumentRecord | null => {
  if (!row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string') return null;
  const id = canonicalizeDocumentId(row.id);
  const title = 'title' in row ? row.title : undefined;
  if (!id || (title != null && typeof title !== 'string')) return null;
  return {
    id,
    title: normalizeTitle(title),
    createdAt:
      'createdAt' in row && typeof row.createdAt === 'string' ? row.createdAt : UNKNOWN_DATE,
    updatedAt:
      'updatedAt' in row && typeof row.updatedAt === 'string' ? row.updatedAt : UNKNOWN_DATE,
  };
};

const buildDocumentList = (storage: Storage | undefined, raw: string | null) => {
  const byId = new Map<string, LashDocumentRecord>();
  for (const row of parseRegistryRows(raw)) {
    const record = parseRegistryRecord(row);
    if (!record || byId.has(record.id)) throw new Error('The document list is unreadable.');
    byId.set(record.id, record);
  }

  const demo: LashDocumentRecord = {
    id: DEFAULT_DOCUMENT_ID,
    title: DEFAULT_DOC_TITLE,
    createdAt: UNKNOWN_DATE,
    updatedAt: UNKNOWN_DATE,
  };
  if (!byId.has(demo.id)) byId.set(demo.id, demo);

  return [...byId.values()]
    .map((record) => ({
      ...record,
      title: normalizeTitle(readTitleKey(storage, record.id) ?? record.title),
    }))
    .sort((left, right) => {
      if (left.id === DEFAULT_DOCUMENT_ID) return -1;
      if (right.id === DEFAULT_DOCUMENT_ID) return 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
};

export const listDocuments = (storage: Storage | undefined): LashDocumentRecord[] =>
  buildDocumentList(storage, storage?.getItem(DOCUMENT_REGISTRY_STORAGE_KEY) ?? null);

export const readDocumentTitle = (storage: Storage | undefined, documentId: string) => {
  if (!storage) return DEFAULT_DOC_TITLE;
  const id = normalizeDocumentId(documentId);
  const title = readTitleKey(storage, id);
  if (title !== null) return normalizeTitle(title);
  try {
    // A direct link still opens a valid legacy title when an unrelated row is malformed.
    const rows = parseRegistryRows(storage.getItem(DOCUMENT_REGISTRY_STORAGE_KEY));
    for (let i = rows.length - 1; i >= 0; i--) {
      const record = parseRegistryRecord(rows[i]);
      if (record?.id === id) return record.title;
    }
  } catch {
    // A new or unavailable library can still open an untitled document.
  }
  return DEFAULT_DOC_TITLE;
};

export const saveDocumentTitle = (
  storage: Storage | undefined,
  documentId: string,
  title: string,
): string => {
  const id = normalizeDocumentId(documentId);
  const normalizedTitle = normalizeTitle(title);
  if (!storage) return normalizedTitle;

  try {
    storage.setItem(documentTitleStorageKey(id), normalizedTitle);
    upsertDocument(storage, { id, title: normalizedTitle });
  } catch {
    // Local document metadata is best-effort for private browsing.
  }

  return normalizedTitle;
};

export const upsertDocument = (
  storage: Storage | undefined,
  input: { id: string; title?: string },
): LashDocumentRecord[] => {
  if (!storage) {
    return [
      {
        id: normalizeDocumentId(input.id),
        title: normalizeTitle(input.title),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }

  const id = normalizeDocumentId(input.id);
  const now = new Date().toISOString();
  const raw = storage.getItem(DOCUMENT_REGISTRY_STORAGE_KEY);
  const records = buildDocumentList(storage, raw);
  const existing = records.find((record) => record.id === id);
  const nextRecord: LashDocumentRecord = {
    id,
    title: normalizeTitle(input.title ?? existing?.title),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const nextRecords = [nextRecord, ...records.filter((record) => record.id !== id)];
  if (storage.getItem(DOCUMENT_REGISTRY_STORAGE_KEY) !== raw) {
    throw new Error('The document list changed before saving.');
  }
  storage.setItem(DOCUMENT_REGISTRY_STORAGE_KEY, JSON.stringify(nextRecords));
  return listDocuments(storage);
};

export const createNewDocumentId = () => {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return normalizeDocumentId(`doc-${Date.now().toString(36)}-${random}`);
};
