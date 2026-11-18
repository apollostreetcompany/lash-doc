import { listDocuments, type LashDocumentRecord } from './documentRegistry';
import { NAMED_EDIT_ROOM_ID } from './namedEdit/contract';

export type DocumentReference = Pick<LashDocumentRecord, 'id' | 'title'>;

type ReferenceCatalogScope =
  | { kind: 'local'; storage: () => Storage | undefined }
  | { kind: 'shared'; readCurrent: () => DocumentReference | null };

export const createDocumentReferenceCatalog = (scope: ReferenceCatalogScope) => {
  const read = (): DocumentReference[] => {
    if (scope.kind === 'shared') {
      const current = scope.readCurrent();
      return current ? [current] : [];
    }

    try {
      const storage = scope.storage();
      if (!storage) return [];
      return listDocuments(storage)
        .filter(({ id }) => !NAMED_EDIT_ROOM_ID.test(id))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch {
      return [];
    }
  };

  return {
    resolve: (id: string) => read().find((document) => document.id === id) ?? null,
    search: (query: string) => {
      const needle = query.trim().toLocaleLowerCase();
      return read()
        .filter(({ title }) => title.toLocaleLowerCase().includes(needle))
        .slice(0, 5);
    },
  };
};
