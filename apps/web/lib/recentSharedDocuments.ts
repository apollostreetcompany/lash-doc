import { hasKeys, isObject, NAMED_EDIT_ROOM_ID } from './namedEdit/contract';

export const RECENT_SHARED_BOOKMARKS_KEY = 'lash:recent-shared-bookmarks';
export const RECENT_SHARED_BOOKMARK_HEADER = 'X-Lash-Recent-Bookmark';
const BOOKMARK_LIMIT = 8;
const MAX_STORED_LENGTH = 9_000;
const BOOKMARK = /^[A-Za-z0-9_-]{39,1015}$/u;
const ACTOR_ID = /^named-[0-9a-f]{32}$/u;
const REQUEST_TIMEOUT_MS = 8_000;
const RECHECK_MS = 15_000;
const MAX_AGE_MS = 30_000;
const REVALIDATION_DELAY_MS = 50;

export const isRecentSharedBookmark = (value: unknown): value is string =>
  typeof value === 'string' && BOOKMARK.exec(value)?.[0] === value;

type Bookmark = { actorId: string; bookmark: string };
type SharedDocument = { id: string; title: string };
export type RecentSharedDocuments =
  | { kind: 'pending' | 'empty' | 'checking' | 'unavailable' }
  | { kind: 'reconnect'; failed?: true }
  | { kind: 'ready'; documents: SharedDocument[] };

function readBookmarks(storage: Storage): Bookmark[] {
  const raw = storage.getItem(RECENT_SHARED_BOOKMARKS_KEY);
  if (!raw || raw.length > MAX_STORED_LENGTH) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isObject(parsed) ||
      !hasKeys(parsed, ['version', 'bookmarks']) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.bookmarks) ||
      parsed.bookmarks.length > BOOKMARK_LIMIT
    )
      return [];

    const actors = new Set<string>();
    return parsed.bookmarks.flatMap((value: unknown) => {
      if (
        !isObject(value) ||
        !hasKeys(value, ['actorId', 'bookmark']) ||
        typeof value.actorId !== 'string' ||
        !ACTOR_ID.test(value.actorId) ||
        !isRecentSharedBookmark(value.bookmark) ||
        actors.has(value.actorId)
      )
        return [];

      actors.add(value.actorId);
      return [{ actorId: value.actorId, bookmark: value.bookmark }];
    });
  } catch {
    return [];
  }
}

export function rememberRecentSharedDocument(actorId: string, bookmark: string) {
  if (!isRecentSharedBookmark(bookmark) || !ACTOR_ID.test(actorId)) return;
  try {
    const storage = window.localStorage;
    const records = readBookmarks(storage);
    if (records[0]?.actorId === actorId && records[0].bookmark === bookmark) return;
    const bookmarks = [{ actorId, bookmark }, ...records.filter((row) => row.actorId !== actorId)];
    storage.setItem(
      RECENT_SHARED_BOOKMARKS_KEY,
      JSON.stringify({ version: 1, bookmarks: bookmarks.slice(0, BOOKMARK_LIMIT) }),
    );
  } catch {
    // Recent documents are optional. The authorized document still opens.
  }
}

async function lookupRecentDocuments(
  bookmarks: string[],
  signal: AbortSignal,
): Promise<RecentSharedDocuments> {
  const unavailable = { kind: 'unavailable' } as const;
  try {
    const response = await fetch('/api/documents/recent', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ version: 1, bookmarks }),
      signal,
    });
    if (response.status === 401 || response.status === 404) return { kind: 'empty' };
    if (response.status !== 200 && response.status !== 409) return unavailable;
    const body: unknown = await response.json();
    if (response.status === 409) {
      return isObject(body) &&
        hasKeys(body, ['ok', 'version', 'error']) &&
        body.ok === false &&
        body.version === 1 &&
        body.error === 'session-refresh-required'
        ? { kind: 'reconnect' }
        : unavailable;
    }
    if (
      !isObject(body) ||
      !hasKeys(body, ['ok', 'version', 'documents']) ||
      body.ok !== true ||
      body.version !== 1 ||
      !Array.isArray(body.documents) ||
      body.documents.length > bookmarks.length
    )
      return unavailable;

    const ids = new Set<string>();
    const documents: SharedDocument[] = [];
    const encoder = new TextEncoder();
    for (const value of body.documents as unknown[]) {
      if (
        !isObject(value) ||
        !hasKeys(value, ['id', 'title']) ||
        typeof value.id !== 'string' ||
        NAMED_EDIT_ROOM_ID.exec(value.id)?.[0] !== value.id ||
        ids.has(value.id) ||
        typeof value.title !== 'string' ||
        !value.title.trim() ||
        value.title.length > 4096 ||
        encoder.encode(value.title).length > 4096
      )
        return unavailable;

      ids.add(value.id);
      documents.push({ id: value.id, title: value.title });
    }
    return documents.length ? { kind: 'ready', documents } : { kind: 'empty' };
  } catch {
    return unavailable;
  }
}

const reconnectFailed = { kind: 'reconnect', failed: true } as const;

async function reconnectRecentDocuments(
  bookmarks: string[],
  signal: AbortSignal,
): Promise<RecentSharedDocuments> {
  try {
    const response = await fetch('/api/account/session', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (response.status === 401) return { kind: 'empty' };
    if (
      signal.aborted ||
      response.status !== 204 ||
      response.headers.get('x-lash-account-status') !== 'authenticated'
    )
      return reconnectFailed;
    return lookupRecentDocuments(bookmarks, signal);
  } catch {
    return reconnectFailed;
  }
}

export function watchRecentSharedDocuments(
  onChange: (state: RecentSharedDocuments, immediate: boolean) => void,
) {
  let current: AbortController | undefined;
  let requestTimeout: number | undefined;
  let recheck: number | undefined;
  let expiry: number | undefined;
  let revalidation: number | undefined;
  let expiresAt = 0;

  const clearRequest = () => {
    current?.abort();
    current = undefined;
    window.clearTimeout(requestTimeout);
    window.clearTimeout(recheck);
  };
  const clearExpiry = () => {
    window.clearTimeout(expiry);
    expiresAt = 0;
  };
  const clearRevalidation = () => {
    window.clearTimeout(revalidation);
    revalidation = undefined;
  };
  const reset = () => {
    clearRevalidation();
    clearRequest();
    clearExpiry();
    onChange({ kind: 'empty' }, true);
  };

  function check(mode: 'passive' | 'scheduled' | 'reconnect' = 'passive') {
    clearRequest();
    if (document.visibilityState === 'hidden') {
      clearExpiry();
      onChange({ kind: 'empty' }, false);
      return;
    }
    let bookmarks: string[];
    try {
      bookmarks = readBookmarks(window.localStorage).map(({ bookmark }) => bookmark);
    } catch {
      bookmarks = [];
    }
    if (!bookmarks.length) {
      clearExpiry();
      onChange({ kind: 'empty' }, false);
      return;
    }
    const started = performance.now();
    if (mode !== 'scheduled' || started >= expiresAt) {
      clearExpiry();
      onChange({ kind: 'checking' }, false);
    }
    const controller = new AbortController();
    current = controller;
    const failure = mode === 'reconnect' ? reconnectFailed : ({ kind: 'unavailable' } as const);
    requestTimeout = window.setTimeout(() => {
      if (current !== controller) return;
      clearRequest();
      clearExpiry();
      onChange(failure, false);
    }, REQUEST_TIMEOUT_MS);
    const lookup = mode === 'reconnect' ? reconnectRecentDocuments : lookupRecentDocuments;
    void lookup(bookmarks, controller.signal).then((result) => {
      if (current !== controller) return;
      if (document.visibilityState === 'hidden') {
        reset();
        return;
      }
      current = undefined;
      window.clearTimeout(requestTimeout);
      clearExpiry();
      const elapsed = performance.now() - started;
      if (elapsed >= REQUEST_TIMEOUT_MS) {
        onChange(failure, false);
        return;
      }

      onChange(result, false);
      if (result.kind === 'ready') {
        expiresAt = started + MAX_AGE_MS;
        expiry = window.setTimeout(() => {
          expiresAt = 0;
          onChange({ kind: 'checking' }, false);
        }, MAX_AGE_MS - elapsed);
        recheck = window.setTimeout(() => check('scheduled'), RECHECK_MS - elapsed);
      }
    });
  }

  const revalidate = () => {
    if (document.visibilityState === 'hidden') {
      reset();
      return;
    }
    clearRequest();
    clearExpiry();
    if (revalidation !== undefined) return;
    // Discard the previous account's titles now. The three foreground events
    // can arrive together when returning to a background or cached page.
    onChange({ kind: 'pending' }, true);
    revalidation = window.setTimeout(() => {
      revalidation = undefined;
      check();
    }, REVALIDATION_DELAY_MS);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') reset();
    else revalidate();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) revalidate();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === RECENT_SHARED_BOOKMARKS_KEY) revalidate();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', revalidate);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', reset);
  window.addEventListener('storage', onStorage);
  check();

  return {
    retry() {
      clearRevalidation();
      check();
    },
    reconnect() {
      clearRevalidation();
      check('reconnect');
    },
    dispose() {
      clearRevalidation();
      clearRequest();
      clearExpiry();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', reset);
      window.removeEventListener('storage', onStorage);
    },
  };
}
