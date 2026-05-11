/**
 * apps/web/lib/autosave — debounced autosave hook for the Lash editor.
 *
 * Owns M1/B3 acceptance (agents.md H.1):
 *   - 500 ms-after-idle flush triggered by editor `transaction` events
 *   - "All changes saved" status + last-saved timestamp for hover display
 *   - SLO: visible within < 500 ms p95 after idle
 *
 * The hook intentionally lives in apps/web — persistence is app-level concern,
 * not editor-core. The pure debounce/scheduling logic is exported via
 * `createAutosaveScheduler` so it can be unit-tested under fake timers without
 * a React render tree.
 */
'use client';

import type { Editor } from '@tiptap/core';
import { useEffect, useRef, useState } from 'react';

/** All states an autosave indicator can be in. */
export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/** Snapshot the editor produces for `onSave`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AutosaveDocJson = Record<string, any>;

export interface AutosaveSaveContext {
  /** ISO timestamp captured at flush time. */
  savedAt: string;
  /** Document JSON snapshot. */
  docJson: AutosaveDocJson;
}

export type AutosaveSaveResult = void | Promise<void>;

export interface AutosaveSchedulerOptions {
  /** Debounce window in ms — flush fires this long after the last transaction. */
  debounceMs?: number;
  /** Called with the snapshot when the debounce window elapses. */
  onSave: (ctx: AutosaveSaveContext) => AutosaveSaveResult;
  /** Optional clock for ISO timestamps; defaults to `() => new Date()`. */
  now?: () => Date;
  /** Optional snapshot factory — receives the editor and returns the doc JSON. */
  getDocJson?: () => AutosaveDocJson;
  /** Optional status callback for UI / tests. */
  onStatusChange?: (status: AutosaveStatus, ctx: { savedAt: string | null }) => void;
}

export interface AutosaveSchedulerHandle {
  /** Call this after every editor transaction. */
  notify: () => void;
  /** Cancel any pending flush; does not invoke onSave. */
  cancel: () => void;
  /** Force an immediate flush (for tests / explicit Save). */
  flush: () => Promise<void>;
  /** Current status (read-only snapshot). */
  getStatus: () => AutosaveStatus;
  /** Last successful save ISO timestamp, or null. */
  getLastSavedAt: () => string | null;
}

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Pure scheduler: no React, no editor. Tested under vitest fake timers.
 *
 * Contract:
 *   - `notify()` (re)arms a debounce timer. Multiple rapid calls coalesce into
 *     ONE save callback after `debounceMs` of quiet.
 *   - `flush()` skips the timer and triggers the save callback immediately.
 *   - On flush success: status becomes 'saved'; failure: 'error'.
 *   - Concurrent flushes are coalesced — if a save is in-flight when notify()
 *     fires again, the next save is rescheduled (no overlap).
 */
export function createAutosaveScheduler(opts: AutosaveSchedulerOptions): AutosaveSchedulerHandle {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const now = opts.now ?? (() => new Date());

  let timer: ReturnType<typeof setTimeout> | null = null;
  let status: AutosaveStatus = 'idle';
  let lastSavedAt: string | null = null;
  let saving = false;
  let pendingAfterSave = false;

  const setStatus = (next: AutosaveStatus) => {
    if (status === next) return;
    status = next;
    opts.onStatusChange?.(next, { savedAt: lastSavedAt });
  };

  const performSave = async (): Promise<void> => {
    saving = true;
    setStatus('saving');
    const savedAt = now().toISOString();
    const docJson = opts.getDocJson ? opts.getDocJson() : {};
    try {
      await Promise.resolve(opts.onSave({ savedAt, docJson }));
      lastSavedAt = savedAt;
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      saving = false;
      if (pendingAfterSave) {
        pendingAfterSave = false;
        // Re-arm the debounce so we don't tight-loop on saves.
        notify();
      }
    }
  };

  const fire = () => {
    timer = null;
    if (saving) {
      // A save is in-flight; mark that another flush is queued.
      pendingAfterSave = true;
      return;
    }
    void performSave();
  };

  const notify = () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    setStatus('pending');
    timer = setTimeout(fire, debounceMs);
  };

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pendingAfterSave = false;
    if (!saving && status === 'pending') {
      setStatus(lastSavedAt ? 'saved' : 'idle');
    }
  };

  const flush = async () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (saving) {
      pendingAfterSave = true;
      return;
    }
    await performSave();
  };

  return {
    notify,
    cancel,
    flush,
    getStatus: () => status,
    getLastSavedAt: () => lastSavedAt,
  };
}

export interface UseAutosaveOptions {
  /** Debounce window in ms (default 500 per agents.md H.1 SLO). */
  debounceMs?: number;
  /** Persistence callback. Receives the doc JSON + ISO timestamp. */
  onSave?: (ctx: AutosaveSaveContext) => AutosaveSaveResult;
  /** When true, also publish state to `window.__lashLastSave` for e2e tests. */
  exposeOnWindow?: boolean;
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  lastSavedAt: string | null;
  /** Imperative flush; primarily for tests. */
  flush: () => Promise<void>;
}

declare global {
  interface Window {
    __lashLastSave?: {
      savedAt: string;
      docJson: AutosaveDocJson;
    };
    __lashAutosave?: {
      status: AutosaveStatus;
      lastSavedAt: string | null;
      flush: () => Promise<void>;
    };
  }
}

/**
 * React hook: wires the scheduler to a TipTap `Editor`.
 * Subscribes to `transaction` events; debounces flushes.
 *
 * Initial state is `idle` (renders nothing). After the first transaction the
 * status moves through `pending` → `saving` → `saved`.
 */
export function useAutosave(
  editor: Editor | null,
  opts: UseAutosaveOptions = {},
): UseAutosaveResult {
  // Use a single state object so `status` and `lastSavedAt` always commit
  // together. React 18 auto-batches multiple setters, but a single state
  // shape makes the invariant impossible to violate (status='saved' with
  // null lastSavedAt would be a render-tearing bug otherwise).
  const [state, setState] = useState<{
    status: AutosaveStatus;
    lastSavedAt: string | null;
  }>({ status: 'idle', lastSavedAt: null });
  const schedulerRef = useRef<AutosaveSchedulerHandle | null>(null);

  // Keep the latest onSave in a ref so we don't re-subscribe on every render.
  const onSaveRef = useRef(opts.onSave);
  useEffect(() => {
    onSaveRef.current = opts.onSave;
  }, [opts.onSave]);

  useEffect(() => {
    if (!editor) {
      schedulerRef.current = null;
      setState({ status: 'idle', lastSavedAt: null });
      return;
    }

    const scheduler = createAutosaveScheduler({
      debounceMs: opts.debounceMs,
      getDocJson: () => editor.getJSON(),
      onSave: async (ctx) => {
        if (typeof window !== 'undefined' && opts.exposeOnWindow !== false) {
          window.__lashLastSave = { savedAt: ctx.savedAt, docJson: ctx.docJson };
        }
        if (onSaveRef.current) {
          await onSaveRef.current(ctx);
        }
      },
      onStatusChange: (next, ctx) => {
        setState((prev) => ({
          status: next,
          // Preserve the prior timestamp when transitioning into states that
          // don't carry one (e.g. 'pending' before the first save lands).
          lastSavedAt: ctx.savedAt ?? prev.lastSavedAt,
        }));
      },
    });
    schedulerRef.current = scheduler;

    const handler = () => scheduler.notify();
    editor.on('transaction', handler);

    return () => {
      editor.off('transaction', handler);
      scheduler.cancel();
      schedulerRef.current = null;
    };
  }, [editor, opts.debounceMs, opts.exposeOnWindow]);

  // Expose imperative handle on `window` for e2e tests when requested.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (opts.exposeOnWindow === false) return;
    window.__lashAutosave = {
      status: state.status,
      lastSavedAt: state.lastSavedAt,
      flush: async () => {
        await schedulerRef.current?.flush();
      },
    };
    return () => {
      if (typeof window === 'undefined') return;
      if (window.__lashAutosave?.status === state.status) {
        delete window.__lashAutosave;
      }
    };
  }, [state.status, state.lastSavedAt, opts.exposeOnWindow]);

  return {
    status: state.status,
    lastSavedAt: state.lastSavedAt,
    flush: async () => {
      await schedulerRef.current?.flush();
    },
  };
}

/**
 * Format an absolute ISO timestamp as a short relative phrase (e.g. "just now",
 * "12s ago", "3m ago"). Used for the indicator copy.
 */
export function formatRelativeSavedAt(
  isoTimestamp: string | null,
  nowMs: number = Date.now(),
): string {
  if (!isoTimestamp) return '';
  const then = Date.parse(isoTimestamp);
  if (Number.isNaN(then)) return '';
  const deltaMs = Math.max(0, nowMs - then);
  if (deltaMs < 5_000) return 'just now';
  if (deltaMs < 60_000) return `${Math.floor(deltaMs / 1000)}s ago`;
  if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  return `${Math.floor(deltaMs / 3_600_000)}h ago`;
}
