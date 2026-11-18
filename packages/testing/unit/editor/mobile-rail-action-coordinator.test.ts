import { describe, expect, it, vi } from 'vitest';

import { createMobileRailActionCoordinator } from '../../../../apps/web/lib/mobileRailActionCoordinator';

describe('mobile rail post-close action coordinator', () => {
  it('waits for both inert release and body unlock before consuming once', () => {
    const coordinator = createMobileRailActionCoordinator();
    const run = vi.fn();
    const cancel = vi.fn();
    coordinator.queue({ documentId: 'doc-a', run, cancel });

    expect(
      coordinator.notifyRelease({
        documentId: 'doc-a',
        canvasAvailable: false,
        bodyScrollLocked: true,
      }),
    ).toBe(false);
    expect(
      coordinator.notifyRelease({
        documentId: 'doc-a',
        canvasAvailable: true,
        bodyScrollLocked: true,
      }),
    ).toBe(false);
    expect(run).not.toHaveBeenCalled();

    expect(
      coordinator.notifyRelease({
        documentId: 'doc-a',
        canvasAvailable: true,
        bodyScrollLocked: false,
      }),
    ).toBe(true);
    expect(
      coordinator.notifyRelease({
        documentId: 'doc-a',
        canvasAvailable: true,
        bodyScrollLocked: false,
      }),
    ).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels the previous action when a new close action replaces it', () => {
    const coordinator = createMobileRailActionCoordinator();
    const firstCancel = vi.fn();
    const secondRun = vi.fn();
    coordinator.queue({ documentId: 'doc-a', run: vi.fn(), cancel: firstCancel });
    coordinator.queue({ documentId: 'doc-a', run: secondRun, cancel: vi.fn() });

    expect(firstCancel).toHaveBeenCalledTimes(1);
    coordinator.notifyRelease({
      documentId: 'doc-a',
      canvasAvailable: true,
      bodyScrollLocked: false,
    });
    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it('cancels pending work on unmount cleanup without later consumption', () => {
    const coordinator = createMobileRailActionCoordinator();
    const run = vi.fn();
    const cancel = vi.fn();
    coordinator.queue({ documentId: 'doc-a', run, cancel });

    expect(coordinator.cancel()).toBe(true);
    expect(coordinator.cancel()).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(
      coordinator.notifyRelease({
        documentId: 'doc-a',
        canvasAvailable: true,
        bodyScrollLocked: false,
      }),
    ).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed and cancels when the active document changes', () => {
    const coordinator = createMobileRailActionCoordinator();
    const run = vi.fn();
    const cancel = vi.fn();
    coordinator.queue({ documentId: 'doc-a', run, cancel });

    expect(
      coordinator.notifyRelease({
        documentId: 'doc-b',
        canvasAvailable: true,
        bodyScrollLocked: false,
      }),
    ).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(coordinator.hasPending()).toBe(false);
  });
});
