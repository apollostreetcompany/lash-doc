import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAutosaveScheduler,
  createImeAwareTransactionGate,
} from '../../../../apps/web/lib/autosave';

describe('ime-composition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces composition updates into one final persisted snapshot', async () => {
    const snapshots: unknown[] = [];
    const statuses: string[] = [];
    let text = '';
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      getDocJson: () => ({ text }),
      onSave: ({ docJson }) => snapshots.push(docJson),
      onStatusChange: (status) => statuses.push(status),
    });
    const gate = createImeAwareTransactionGate(scheduler);

    gate.compositionStart();
    text = 'に';
    gate.notifyTransaction();
    text = '日本';
    gate.notifyTransaction();
    text = '日本語';
    gate.notifyTransaction();

    expect(gate.isComposing()).toBe(true);
    expect(scheduler.getStatus()).toBe('idle');

    gate.compositionEnd();
    expect(scheduler.getStatus()).toBe('pending');

    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();

    expect(snapshots).toEqual([{ text: '日本語' }]);
    expect(statuses).toEqual(['pending', 'saving', 'saved']);
  });
});
