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
    let text = '';
    const scheduler = createAutosaveScheduler({
      debounceMs: 500,
      getDocJson: () => ({ text }),
      onSave: ({ docJson }) => saves.push(docJson),
    });
    const gate = createImeAwareTransactionGate(scheduler);

    gate.compositionStart();
    text = 'に';
    gate.notifyTransaction();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saves).toEqual([]);

    text = '日本';
    gate.notifyTransaction();
    gate.compositionEnd();
    await vi.advanceTimersByTimeAsync(499);
    expect(saves).toEqual([]);

    await vi.advanceTimersByTimeAsync(2);
    expect(saves).toEqual([{ text: '日本' }]);
  });
});
