import { describe, expect, it } from 'vitest';

import { documentRecoveryPresentation } from '../../../../apps/web/lib/documentRecoveryPresentation';

describe('document recovery presentation', () => {
  it('offers export and explicit verified discard for durable recovery', () => {
    expect(documentRecoveryPresentation('recovery-available', 2, true)).toMatchObject({
      canDiscardAndLeave: true,
      canExport: true,
      detail: expect.stringContaining('2 unsynced updates'),
    });
  });

  it('keeps blocked recovery exportable without a destructive navigation action', () => {
    expect(documentRecoveryPresentation('recovery-blocked', 1, true)).toMatchObject({
      canDiscardAndLeave: false,
      canExport: true,
      detail: expect.stringMatching(/retained.*navigation remains blocked/u),
    });
  });

  it('omits a dead export action when exact blocked bytes are not snapshot-addressable', () => {
    expect(documentRecoveryPresentation('recovery-blocked', 1, false)).toMatchObject({
      canDiscardAndLeave: false,
      canExport: false,
      detail: expect.stringMatching(/exact export snapshot is unavailable.*Keep this tab open/u),
    });
  });
});
