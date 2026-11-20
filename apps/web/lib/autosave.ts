/**
 * apps/web/lib/autosave — debounced autosave hook for the Lash editor.
 *
 * Owns M1/B3 acceptance (agents.md H.1):
 *   - 350 ms-after-idle flush triggered by editor `transaction` events
 *   - "All changes saved" status + last-saved timestamp for hover display
 *   - SLO: visible within < 500 ms p95 after idle
 *
 * The hook intentionally lives in apps/web — persistence is app-level concern,
 * not editor-core. The pure debounce/scheduling logic is exported via
 * `createAutosaveScheduler` so it can be unit-tested under fake timers without
 * a React render tree.
 */
'use client';

import type { Editor, EditorEvents } from '@tiptap/core';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  /** Flush only when dirty work is pending; idle cleanup remains a no-op. */
  flushPending: () => Promise<void>;
  /** Suspend queued dirty work and return whether it must be resumed later. */
  suspendPending: () => boolean;
  /** Current status (read-only snapshot). */
  getStatus: () => AutosaveStatus;
  /** Last successful save ISO timestamp, or null. */
  getLastSavedAt: () => string | null;
}

export interface ImeAwareTransactionGate {
  notifyTransaction: () => void;
  compositionStart: () => void;
  compositionEnd: () => void;
  /** Release the visible composing snapshot when the page is leaving. */
  flushPendingForLifecycle: () => void;
  isComposing: () => boolean;
}

const DEFAULT_DEBOUNCE_MS = 350;

type SaveTimer = ReturnType<typeof setTimeout>;
type SaveWork =
  | { phase: 'idle' }
  | { phase: 'debouncing'; timer: SaveTimer }
  | { phase: 'saving'; timer: SaveTimer | null; followUpDue: boolean };

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

  let work: SaveWork = { phase: 'idle' };
  let status: AutosaveStatus = 'idle';
  let lastSavedAt: string | null = null;

  const clearTimer = () => {
    if (work.phase === 'debouncing') {
      clearTimeout(work.timer);
      work = { phase: 'idle' };
      return true;
    }
    if (work.phase === 'saving' && work.timer !== null) {
      clearTimeout(work.timer);
      work.timer = null;
      return true;
    }
    return false;
  };

  const setStatus = (next: AutosaveStatus) => {
    if (status === next) return;
    status = next;
    opts.onStatusChange?.(next, { savedAt: lastSavedAt });
  };

  const performSave = async (): Promise<void> => {
    const inFlight: Extract<SaveWork, { phase: 'saving' }> = {
      phase: 'saving',
      timer: null,
      followUpDue: false,
    };
    work = inFlight;
    try {
      setStatus('saving');
      const savedAt = now().toISOString();
      const docJson = opts.getDocJson ? opts.getDocJson() : {};
      await Promise.resolve(opts.onSave({ savedAt, docJson }));
      lastSavedAt = savedAt;
      setStatus(inFlight.timer !== null || inFlight.followUpDue ? 'pending' : 'saved');
    } catch {
      setStatus('error');
    } finally {
      work =
        inFlight.timer === null
          ? { phase: 'idle' }
          : { phase: 'debouncing', timer: inFlight.timer };
      if (inFlight.followUpDue) {
        // Re-arm the debounce so we don't tight-loop on saves.
        notify();
      }
    }
  };

  const fire = () => {
    if (work.phase === 'saving') {
      // A save is in-flight; mark that another flush is queued.
      work.timer = null;
      work.followUpDue = true;
      return;
    }
    void performSave();
  };

  const notify = () => {
    clearTimer();
    setStatus('pending');
    const timer = setTimeout(fire, debounceMs);
    if (work.phase === 'saving') {
      work.timer = timer;
    } else {
      work = { phase: 'debouncing', timer };
    }
  };

  const cancel = () => {
    clearTimer();
    if (work.phase === 'saving') {
      work.followUpDue = false;
    } else if (status === 'pending') {
      setStatus(lastSavedAt ? 'saved' : 'idle');
    }
  };

  const flush = async () => {
    clearTimer();
    if (work.phase === 'saving') {
      work.followUpDue = true;
      return;
    }
    await performSave();
  };

  const flushPending = async () => {
    const hasPendingWork =
      status === 'pending' ||
      work.phase === 'debouncing' ||
      (work.phase === 'saving' && (work.timer !== null || work.followUpDue));
    if (!hasPendingWork) return;
    await flush();
  };

  const suspendPending = () => {
    const suspendedTimer = clearTimer();
    if (work.phase !== 'saving') return suspendedTimer;
    const suspendedFollowUp = work.followUpDue;
    work.followUpDue = false;
    return suspendedTimer || suspendedFollowUp;
  };

  return {
    notify,
    cancel,
    flush,
    flushPending,
    suspendPending,
    getStatus: () => status,
    getLastSavedAt: () => lastSavedAt,
  };
}

export function createImeAwareTransactionGate(
  scheduler: Pick<AutosaveSchedulerHandle, 'notify' | 'suspendPending'>,
): ImeAwareTransactionGate {
  let composition: { phase: 'idle' } | { phase: 'composing'; dirty: boolean } = { phase: 'idle' };
  const finishComposition = () => {
    if (composition.phase === 'idle') return;
    const { dirty } = composition;
    composition = { phase: 'idle' };
    if (dirty) scheduler.notify();
  };

  return {
    notifyTransaction() {
      if (composition.phase === 'composing') {
        composition.dirty = true;
        return;
      }
      scheduler.notify();
    },
    compositionStart() {
      if (composition.phase === 'composing') return;
      composition = { phase: 'composing', dirty: scheduler.suspendPending() };
    },
    compositionEnd: finishComposition,
    flushPendingForLifecycle: finishComposition,
    isComposing: () => composition.phase === 'composing',
  };
}

export interface UseAutosaveOptions {
  /** Debounce window in ms (default 350, reserving write/render headroom under the 500 ms SLO). */
  debounceMs?: number;
  /** Persistence callback. Receives the doc JSON + ISO timestamp. */
  onSave: (ctx: AutosaveSaveContext) => AutosaveSaveResult;
  /** When true, also publish state to `window.__lashLastSave` for e2e tests. */
  exposeOnWindow?: boolean;
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  lastSavedAt: string | null;
  /** Imperative flush; primarily for tests. */
  flush: () => Promise<void>;
  /**
   * Persist the current editor JSON and confirm no document transaction
   * changed it before the verified save completed.
   */
  flushVerified: () => Promise<boolean>;
}

export interface AutosaveFlushController {
  getStatus: () => AutosaveStatus;
  flushVerified: () => Promise<boolean>;
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
export function useAutosave(editor: Editor | null, opts: UseAutosaveOptions): UseAutosaveResult {
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
        await onSaveRef.current(ctx);
        if (typeof window !== 'undefined' && opts.exposeOnWindow !== false) {
          window.__lashLastSave = { savedAt: ctx.savedAt, docJson: ctx.docJson };
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

    const imeGate = createImeAwareTransactionGate(scheduler);
    const handler = ({ transaction }: EditorEvents['transaction']) => {
      // Cursor, selection, and focus transactions do not change the durable
      // document and must not move a failed save back to pending or retry a
      // storage write.
      if (!transaction.docChanged) return;
      imeGate.notifyTransaction();
    };
    const onCompositionStart = () => imeGate.compositionStart();
    const onCompositionEnd = () => imeGate.compositionEnd();
    const editorDom = editor.view.dom;
    const flushPending = () => {
      // Leaving the page is the one point where preserving the visible
      // composing snapshot is safer than waiting for compositionend, which
      // browsers do not guarantee before teardown.
      imeGate.flushPendingForLifecycle();
      // The persistence callback is required to complete its localStorage
      // write synchronously before returning. Starting this Promise is enough
      // to preserve the final sub-debounce edit during pagehide/teardown.
      void scheduler.flushPending();
    };
    editor.on('transaction', handler);
    editorDom.addEventListener('compositionstart', onCompositionStart);
    editorDom.addEventListener('compositionend', onCompositionEnd);
    window.addEventListener('pagehide', flushPending);

    return () => {
      editor.off('transaction', handler);
      editorDom.removeEventListener('compositionstart', onCompositionStart);
      editorDom.removeEventListener('compositionend', onCompositionEnd);
      window.removeEventListener('pagehide', flushPending);
      flushPending();
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

  const flushVerified = useCallback(async () => {
    const scheduler = schedulerRef.current;
    if (!scheduler || !editor || editor.isDestroyed) return false;
    const before = JSON.stringify(editor.getJSON());
    await scheduler.flush();
    return (
      scheduler.getStatus() === 'saved' &&
      !editor.isDestroyed &&
      JSON.stringify(editor.getJSON()) === before
    );
  }, [editor]);

  return {
    status: state.status,
    lastSavedAt: state.lastSavedAt,
    flush: async () => {
      await schedulerRef.current?.flush();
    },
    flushVerified,
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
