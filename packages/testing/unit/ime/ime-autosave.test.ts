import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAutosaveScheduler,
  createImeAwareTransactionGate,
} from '../../../../apps/web/lib/autosave';

describe('ime-autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits until compositionend before scheduling an autosave', async () => {
    const saves: unknown[] = [];
    const statuses: string[] = [];
    let text = '';
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      getDocJson: () => ({ text }),
      onSave: ({ docJson }) => saves.push(docJson),
      onStatusChange: (status) => statuses.push(status),
    });
    const gate = createImeAwareTransactionGate(scheduler);

    gate.compositionStart();
    text = 'に';
    gate.notifyTransaction();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saves).toEqual([]);
    expect(gate.isComposing()).toBe(true);
    expect(scheduler.getStatus()).toBe('idle');

    text = '日本';
    gate.notifyTransaction();
    text = '日本語';
    gate.notifyTransaction();
    gate.compositionEnd();
    expect(scheduler.getStatus()).toBe('pending');
    await vi.advanceTimersByTimeAsync(499);
    expect(saves).toEqual([]);

    await vi.advanceTimersByTimeAsync(2);
    expect(saves).toEqual([{ text: '日本語' }]);
    expect(statuses).toEqual(['pending', 'saving', 'saved']);
  });

  it('suspends an armed dirty timer through composition and saves only the final snapshot', async () => {
    const saves: unknown[] = [];
    const statuses: string[] = [];
    let text = 'dirty before composition';
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      getDocJson: () => ({ text }),
      onSave: ({ docJson }) => saves.push(docJson),
      onStatusChange: (status) => statuses.push(status),
    });
    const gate = createImeAwareTransactionGate(scheduler);

    scheduler.notify();
    gate.compositionStart();
    text = 'に';
    gate.notifyTransaction();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(saves).toEqual([]);
    expect(scheduler.getStatus()).not.toBe('saved');
    expect(statuses).not.toContain('saved');
    expect(gate.isComposing()).toBe(true);

    text = '日本語';
    gate.notifyTransaction();
    gate.compositionEnd();
    await vi.advanceTimersByTimeAsync(501);

    expect(saves).toEqual([{ text: '日本語' }]);
    expect(scheduler.getStatus()).toBe('saved');
  });

  it('does not manufacture a save for an idle composition', async () => {
    const saves: unknown[] = [];
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      getDocJson: () => ({ text: 'unchanged' }),
      onSave: ({ docJson }) => saves.push(docJson),
    });
    const gate = createImeAwareTransactionGate(scheduler);

    gate.compositionStart();
    gate.compositionEnd();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(saves).toEqual([]);
    expect(scheduler.getStatus()).toBe('idle');
  });

  it('flushes composition and resumes normal autosave when lifecycle teardown preempts compositionend', async () => {
    const saves: unknown[] = [];
    let text = 'before composition';
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      getDocJson: () => ({ text }),
      onSave: ({ docJson }) => saves.push(docJson),
    });
    const gate = createImeAwareTransactionGate(scheduler);

    scheduler.notify();
    gate.compositionStart();
    text = '日本';
    gate.notifyTransaction();

    gate.flushPendingForLifecycle();
    await scheduler.flushPending();

    expect(saves).toEqual([{ text: '日本' }]);
    expect(scheduler.getStatus()).toBe('saved');
    expect(gate.isComposing()).toBe(false);

    text = 'after BFCache restore';
    gate.notifyTransaction();
    await vi.advanceTimersByTimeAsync(501);
    expect(saves).toEqual([{ text: '日本' }, { text: 'after BFCache restore' }]);
  });

  it('ends lifecycle composition gating even when no composing transaction arrived', async () => {
    const saves: unknown[] = [];
    let text = 'before BFCache';
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      getDocJson: () => ({ text }),
      onSave: ({ docJson }) => saves.push(docJson),
    });
    const gate = createImeAwareTransactionGate(scheduler);

    gate.compositionStart();
    gate.flushPendingForLifecycle();
    expect(gate.isComposing()).toBe(false);

    text = 'ordinary edit after BFCache';
    gate.notifyTransaction();
    await vi.advanceTimersByTimeAsync(501);
    expect(saves).toEqual([{ text: 'ordinary edit after BFCache' }]);
  });
});
