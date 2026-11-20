// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RECENT_SHARED_BOOKMARKS_KEY,
  rememberRecentSharedDocument,
  watchRecentSharedDocuments,
} from '../../../../apps/web/lib/recentSharedDocuments';

const actor = (index: number) => `named-${index.toString(16).padStart(32, '0')}`;
const seal = (index: number) => `${'a'.repeat(80)}${index}`;
const shared = { id: `doc-v1-${'a'.repeat(64)}`, title: 'Private draft title' };
const response = (documents = [shared]) => Response.json({ ok: true, version: 1, documents });
const drain = () => vi.advanceTimersByTimeAsync(0);
let observer: ReturnType<typeof watchRecentSharedDocuments> | undefined;

function start(fetcher: typeof fetch) {
  vi.stubGlobal('fetch', fetcher);
  const publish = vi.fn();
  observer = watchRecentSharedDocuments(publish);
  return publish;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  window.localStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
  observer?.dispose();
  observer = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('recent shared documents in a browser', () => {
  it('stores only eight opaque bookmarks, deduplicated by actor even when the seal changes', () => {
    for (let index = 0; index < 9; index++) rememberRecentSharedDocument(actor(index), seal(index));
    rememberRecentSharedDocument(actor(3), seal(30));
    rememberRecentSharedDocument(actor(2), 'not a sealed bookmark');

    const indices = [3, 8, 7, 6, 5, 4, 2, 1];
    expect(JSON.parse(window.localStorage.getItem(RECENT_SHARED_BOOKMARKS_KEY)!)).toEqual({
      version: 1,
      bookmarks: indices.map((index) => ({
        actorId: actor(index),
        bookmark: seal(index === 3 ? 30 : index),
      })),
    });
  });

  it('stays device-only without readable bookmarks', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError');
    });
    const fetcher = vi.fn();
    const publish = start(fetcher);

    expect(fetcher).not.toHaveBeenCalled();
    expect(publish).toHaveBeenLastCalledWith({ kind: 'empty' }, false);
    expect(() => rememberRecentSharedDocument(actor(1), seal(1))).not.toThrow();
  });

  it('only renders currently authorized rows, and never persists their title or room ID', async () => {
    rememberRecentSharedDocument(actor(1), seal(1));
    rememberRecentSharedDocument(actor(2), seal(2));
    const fetcher = vi.fn(async () => response());
    const publish = start(fetcher);
    await drain();

    expect(fetcher).toHaveBeenCalledWith(
      '/api/documents/recent',
      expect.objectContaining({
        body: JSON.stringify({ version: 1, bookmarks: [seal(2), seal(1)] }),
        credentials: 'same-origin',
        cache: 'no-store',
      }),
    );
    expect(publish).toHaveBeenLastCalledWith({ kind: 'ready', documents: [shared] }, false);
    const stored = window.localStorage.getItem(RECENT_SHARED_BOOKMARKS_KEY);
    expect(stored).not.toContain(shared.title);
    expect(stored).not.toContain(shared.id);
  });

  it('clears a cached page before it hides and coalesces foreground events without revealing an old response', async () => {
    rememberRecentSharedDocument(actor(1), seal(1));
    let resolveStale!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const publish = start(fetcher);
    await drain();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetcher).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event('pagehide'));
    expect(publish).toHaveBeenLastCalledWith({ kind: 'empty' }, true);
    expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(publish).toHaveBeenLastCalledWith({ kind: 'pending' }, true);
    await vi.advanceTimersByTimeAsync(50);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenLastCalledWith({ kind: 'empty' }, false);

    resolveStale(response());
    await drain();
    expect(publish).toHaveBeenLastCalledWith({ kind: 'empty' }, false);
  });

  it('clears visible titles and allows retry even if a background request never settles', async () => {
    rememberRecentSharedDocument(actor(1), seal(1));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValueOnce(response([]));
    const publish = start(fetcher);
    await drain();
    await vi.advanceTimersByTimeAsync(23_000);
    expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
    expect(publish).toHaveBeenLastCalledWith({ kind: 'unavailable' }, false);

    observer!.retry();
    await drain();
    expect(publish).toHaveBeenLastCalledWith({ kind: 'empty' }, false);
  });

  it('refreshes an expired account session only after a deliberate reconnect and checks access again', async () => {
    rememberRecentSharedDocument(actor(1), seal(1));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { ok: false, version: 1, error: 'session-refresh-required' },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 204, headers: { 'x-lash-account-status': 'authenticated' } }),
      )
      .mockResolvedValueOnce(response());
    const publish = start(fetcher);
    await drain();
    expect(publish).toHaveBeenLastCalledWith({ kind: 'reconnect' }, false);
    expect(fetcher).toHaveBeenCalledTimes(1);

    observer!.reconnect();
    await drain();
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/account/session',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      '/api/documents/recent',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(publish).toHaveBeenLastCalledWith({ kind: 'ready', documents: [shared] }, false);
  });
});
