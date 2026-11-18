/**
 * autosave-latency — agents.md H.1 acceptance.
 *
 * SLO from agents.md §"Performance SLOs":
 *   "Autosave flush: visible within < 500 ms p95 after idle."
 *
 * These tests pin the *deterministic* debounce / coalescing logic in
 * `createAutosaveScheduler`. They do NOT measure wall-clock latency — that
 * would be flaky in CI. Instead we use Vitest fake timers to verify that the
 * scheduler:
 *   1. Coalesces rapid transactions into a single save after the debounce
 *      window elapses.
 *   2. Stays quiet when no transactions arrive (no spurious saves).
 *   3. Re-arms after a save lands when more edits come in.
 *   4. Keeps the default debounce below the SLO so persistence and rendering
 *      have measurable headroom.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createAutosaveScheduler } from '../../../../apps/web/lib/autosave';

describe('autosave-latency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('debounces rapid transactions into exactly one save', async () => {
    const onSave = vi.fn();
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      onSave,
      getDocJson: () => ({ type: 'doc', content: [] }),
    });

    // Five rapid notifications, all within the 500ms window.
    for (let i = 0; i < 5; i += 1) {
      scheduler.notify();
      await vi.advanceTimersByTimeAsync(50); // 5 * 50ms = 250ms total
    }

    // Still inside the window — no save yet.
    expect(onSave).not.toHaveBeenCalled();

    // Advance past the debounce window (600ms total after last notify).
    await vi.advanceTimersByTimeAsync(600);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        savedAt: expect.any(String),
        docJson: { type: 'doc', content: [] },
      }),
    );
  });

  test('does not save when idle (no transactions)', async () => {
    const onSave = vi.fn();
    createAutosaveScheduler({
      debounceMs: 500,
      onSave,
      getDocJson: () => ({ type: 'doc' }),
    });

    // Advance well past any debounce window — no transactions means no save.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onSave).not.toHaveBeenCalled();
  });

  test('reserves persistence and render headroom under the 500 ms SLO by default', async () => {
    const onSave = vi.fn();
    const scheduler = createAutosaveScheduler({
      onSave,
      getDocJson: () => ({ type: 'doc' }),
    });

    scheduler.notify();

    // The default debounce is 350ms, leaving 150ms for the durable write and
    // visible React transition before the strict 500ms product boundary.
    await vi.advanceTimersByTimeAsync(349);
    expect(onSave).not.toHaveBeenCalled();

    // At 351ms, the save has fired.
    await vi.advanceTimersByTimeAsync(2);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test('transitions through pending → saving → saved', async () => {
    const statuses: string[] = [];
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      onSave: () => {
        /* synchronous noop save */
      },
      onStatusChange: (status) => {
        statuses.push(status);
      },
    });

    expect(scheduler.getStatus()).toBe('idle');

    scheduler.notify();
    expect(scheduler.getStatus()).toBe('pending');

    await vi.advanceTimersByTimeAsync(600);
    // After the timer fires, the save runs synchronously through Promise.resolve;
    // flush microtasks so the 'saved' transition lands before we assert.
    await Promise.resolve();
    await Promise.resolve();

    expect(scheduler.getStatus()).toBe('saved');
    expect(statuses).toEqual(['pending', 'saving', 'saved']);
    expect(scheduler.getLastSavedAt()).not.toBeNull();
  });

  test('re-arms after a save lands when more transactions arrive', async () => {
    const onSave = vi.fn();
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      onSave,
      getDocJson: () => ({ type: 'doc' }),
    });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledTimes(1);

    // New transaction after a save.
    scheduler.notify();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  test('cancel() clears a pending debounce without firing onSave', async () => {
    const onSave = vi.fn();
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      onSave,
      getDocJson: () => ({ type: 'doc' }),
    });

    scheduler.notify();
    scheduler.cancel();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onSave).not.toHaveBeenCalled();
    expect(scheduler.getStatus()).toBe('idle');
  });

  test('flushPending() persists dirty work once and leaves idle cleanup quiet', async () => {
    const onSave = vi.fn();
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      onSave,
      getDocJson: () => ({ type: 'doc', content: [] }),
    });

    await scheduler.flushPending();
    expect(onSave).not.toHaveBeenCalled();

    scheduler.notify();
    await scheduler.flushPending();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(scheduler.getStatus()).toBe('saved');

    await scheduler.flushPending();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test('a rejected callback stays in error and preserves the last successful timestamp', async () => {
    let shouldReject = false;
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      now: () => new Date(shouldReject ? '2026-07-18T00:00:01.000Z' : '2026-07-18T00:00:00.000Z'),
      onSave: () => {
        if (shouldReject) throw new Error('storage unavailable');
      },
    });

    scheduler.notify();
    await scheduler.flushPending();
    expect(scheduler.getStatus()).toBe('saved');
    expect(scheduler.getLastSavedAt()).toBe('2026-07-18T00:00:00.000Z');

    shouldReject = true;
    scheduler.notify();
    await scheduler.flushPending();
    expect(scheduler.getStatus()).toBe('error');
    expect(scheduler.getLastSavedAt()).toBe('2026-07-18T00:00:00.000Z');
  });
});
