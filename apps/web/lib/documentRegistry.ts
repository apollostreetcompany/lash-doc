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

export const normalizeDocumentId = (raw: string | undefined | null): string => {
  const normalized = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_DOCUMENT_ID_LENGTH);

  return normalized || DEFAULT_DOCUMENT_ID;
};

export const documentPath = (documentId: string) => `/doc/${normalizeDocumentId(documentId)}`;

export const documentTitleStorageKey = (documentId: string) =>
  `lash:title:${normalizeDocumentId(documentId)}`;

const normalizeTitle = (title: string | undefined | null) => title?.trim() || DEFAULT_DOC_TITLE;

const parseRegistry = (raw: string | null): LashDocumentRecord[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Partial<LashDocumentRecord> & { id: string } =>
        Boolean(item && typeof item === 'object' && typeof item.id === 'string'),
      )
      .map((item) => ({
        id: normalizeDocumentId(item.id),
        title: normalizeTitle(item.title),
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date(0).toISOString(),
      }))
      .filter((item) => item.id);
  } catch {
    return [];
  }
};

const writeRegistry = (storage: Storage, records: LashDocumentRecord[]) => {
  storage.setItem(DOCUMENT_REGISTRY_STORAGE_KEY, JSON.stringify(records));
};

export const listDocuments = (storage: Storage | undefined): LashDocumentRecord[] => {
  const now = new Date(0).toISOString();
  const demo: LashDocumentRecord = {
    id: DEFAULT_DOCUMENT_ID,
    title: readDocumentTitle(storage, DEFAULT_DOCUMENT_ID),
    createdAt: now,
    updatedAt: now,
  };

  if (!storage) return [demo];

  const byId = new Map<string, LashDocumentRecord>();
  byId.set(demo.id, demo);
  for (const record of parseRegistry(storage.getItem(DOCUMENT_REGISTRY_STORAGE_KEY))) {
    byId.set(record.id, {
      ...record,
      title: readDocumentTitle(storage, record.id),
    });
  }

  return [...byId.values()].sort((left, right) => {
    if (left.id === DEFAULT_DOCUMENT_ID) return -1;
    if (right.id === DEFAULT_DOCUMENT_ID) return 1;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
};

export const readDocumentTitle = (storage: Storage | undefined, documentId: string) => {
  if (!storage) return DEFAULT_DOC_TITLE;
  try {
    return normalizeTitle(storage.getItem(documentTitleStorageKey(documentId)));
  } catch {
    return DEFAULT_DOC_TITLE;
  }
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
  const records = listDocuments(storage);
  const existing = records.find((record) => record.id === id);
  const nextRecord: LashDocumentRecord = {
    id,
    title: normalizeTitle(input.title ?? existing?.title),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const nextRecords = [nextRecord, ...records.filter((record) => record.id !== id)];
  writeRegistry(storage, nextRecords);
  return listDocuments(storage);
};

export const createNewDocumentId = () => {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return normalizeDocumentId(`doc-${Date.now().toString(36)}-${random}`);
};
