import type { OutlinePersistenceAdapter } from '../plugins/outline';

export const createLocalStorageOutlinePersistence = (
  storage: Storage | undefined,
  baseKey = 'lash-outline',
): OutlinePersistenceAdapter => {
  const safeStorage = storage;
  return {
    load(docId: string) {
      if (!safeStorage) {
        return [];
      }
      try {
        const raw = safeStorage.getItem(`${baseKey}:${docId}`);
        if (!raw) {
          return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed.filter((value) => typeof value === 'string') as string[]) : [];
      } catch (error) {
        console.warn('Failed to load outline state', error);
        return [];
      }
    },
    save(docId: string, collapsedIds: string[]) {
      if (!safeStorage) {
        return;
      }
      try {
        safeStorage.setItem(`${baseKey}:${docId}`, JSON.stringify(collapsedIds));
      } catch (error) {
        console.warn('Failed to persist outline state', error);
      }
    },
  };
};

export const createMemoryOutlinePersistence = (): OutlinePersistenceAdapter => {
  const store = new Map<string, string[]>();
  return {
    load(docId: string) {
      return store.get(docId)?.slice() ?? [];
    },
    save(docId: string, collapsedIds: string[]) {
      store.set(docId, collapsedIds.slice());
    },
  };
};
