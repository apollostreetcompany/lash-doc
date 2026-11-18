import { describe, expect, it, vi } from 'vitest';

import {
  createRealtimeRecoveryJournal,
  type RealtimeRecoveryJournalStorage,
} from '../../../../apps/web/lib/realtimeRecoveryJournal';

const createStorage = () => {
  const values = new Map<string, string>();
  const storage: RealtimeRecoveryJournalStorage = {
    get length() {
      return values.size;
    },
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  return { storage, values };
};

const recoveryInput = {
  baselineStateVector: new Uint8Array([7, 8, 9]),
  documentId: 'fixture-document',
  epoch: 4,
  principalId: 'actor-owner',
  reason: 'scope-mismatch' as const,
  scope: 'edit' as const,
  unsyncedMetadata: { suggestionResolutionIds: ['suggestion-2'] },
  unsyncedTitle: 'Unsynced exact title',
  updates: [
    { bytes: new Uint8Array([0, 1, 2, 255]), updateId: 'update-a' },
    { bytes: new Uint8Array([9, 8, 7]), updateId: 'update-b' },
  ],
};

const ownerRecoveryInput = {
  ...recoveryInput,
  documentId: 'local-route-document',
  routeDocumentId: 'local-route-document',
  remoteDocumentId: 'opaque-room-47',
};

describe('realtime recovery journal', () => {
  it('writes v3 owner recovery with explicit route and remote identities and indexes by route', () => {
    const { storage, values } = createStorage();
    const journal = createRealtimeRecoveryJournal(
      storage,
      () => '2026-07-30T00:00:00.000Z',
      () => 'owner-receipt',
    );

    const result = journal.persistAndVerify(ownerRecoveryInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.key).toContain('lash:realtime-recovery:v3:local-route-document:');
    expect(result.key).not.toContain('opaque-room-47');
    expect(result.record).toMatchObject({
      version: 3,
      documentId: 'local-route-document',
      routeDocumentId: 'local-route-document',
      remoteDocumentId: 'opaque-room-47',
    });
    expect(journal.listForDocument('local-route-document')).toMatchObject({
      ok: true,
      records: [{ key: result.key }],
    });
    expect(journal.listForDocument('opaque-room-47')).toEqual({ ok: true, records: [] });
    expect(values.get(result.key)).not.toMatch(
      /lash-ticket|ticketProtocol|accessToken|providerToken/u,
    );
  });

  it.each(['ticketProtocol', 'providerToken', 'authorization'])(
    'rejects owner recovery metadata containing the forbidden %s credential key',
    (forbiddenKey) => {
      const { storage } = createStorage();
      const journal = createRealtimeRecoveryJournal(storage);

      expect(
        journal.persistAndVerify({
          ...ownerRecoveryInput,
          unsyncedMetadata: { [forbiddenKey]: 'must-never-persist' },
        }),
      ).toEqual({ ok: false, reason: 'invalid-input' });
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it('reads a verified v1 receipt without rewriting the legacy record', () => {
    const { storage, values } = createStorage();
    const key = 'lash:realtime-recovery:v1:fixture-document:actor-owner:2:aed4dca6:legacy-receipt';
    values.set(
      key,
      JSON.stringify({
        baselineStateVector: 'CQ==',
        checksum: 'aed4dca6',
        createdAt: '2026-07-17T00:00:00.000Z',
        documentId: 'fixture-document',
        epoch: 2,
        principalId: 'actor-owner',
        reason: 'scope-mismatch',
        scope: 'edit',
        unsyncedMetadata: null,
        unsyncedTitle: 'Legacy title',
        updates: [{ bytes: 'AQID', updateId: 'legacy-update' }],
        version: 1,
      }),
    );
    const journal = createRealtimeRecoveryJournal(storage);

    const result = journal.listForDocument('fixture-document');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records).toEqual([
      {
        key,
        record: expect.objectContaining({
          baselineStateVector: new Uint8Array([9]),
          version: 1,
          updates: [{ bytes: new Uint8Array([1, 2, 3]), updateId: 'legacy-update' }],
        }),
      },
    ]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('writes a v2 lifecycle receipt with sealed-time, count, and content digest', () => {
    const { storage } = createStorage();
    const journal = createRealtimeRecoveryJournal(storage, () => '2026-07-18T05:00:00.000Z');

    const result = journal.persistAndVerify({
      ...recoveryInput,
      reason: 'lifecycle',
      sealedAt: '2026-07-18T04:59:59.000Z',
    } as Parameters<typeof journal.persistAndVerify>[0]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.key).toContain('lash:realtime-recovery:v2:');
    expect(result.record).toMatchObject({
      version: 2,
      reason: 'lifecycle',
      sealedAt: '2026-07-18T04:59:59.000Z',
      updateCount: 2,
      contentDigest: expect.any(String),
    });
  });

  it('readback-verifies every exact update id and byte without storing credentials', () => {
    const { storage, values } = createStorage();
    const journal = createRealtimeRecoveryJournal(storage, () => '2026-07-18T05:00:00.000Z');

    const result = journal.persistAndVerify(recoveryInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toMatchObject({
      documentId: 'fixture-document',
      epoch: 4,
      principalId: 'actor-owner',
      reason: 'scope-mismatch',
      scope: 'edit',
      unsyncedTitle: 'Unsynced exact title',
    });
    expect(
      result.record.updates.map(({ bytes, updateId }) => ({
        bytes: [...bytes],
        updateId,
      })),
    ).toEqual([
      { bytes: [0, 1, 2, 255], updateId: 'update-a' },
      { bytes: [9, 8, 7], updateId: 'update-b' },
    ]);
    const serialized = values.get(result.key) ?? '';
    expect(serialized).not.toMatch(/accessToken|inviteToken|credential|short-lived-session/u);
  });

  it('is isolated from Bead 39 local-body storage keys', () => {
    const { storage } = createStorage();
    const journal = createRealtimeRecoveryJournal(storage);

    const result = journal.persistAndVerify(recoveryInput);

    expect(result.ok).toBe(true);
    const touchedKeys = [
      ...vi.mocked(storage.getItem).mock.calls,
      ...vi.mocked(storage.setItem).mock.calls,
      ...vi.mocked(storage.removeItem).mock.calls,
    ].map(([key]) => key);
    expect(touchedKeys.every((key) => key.startsWith('lash:realtime-recovery:v2:'))).toBe(true);
    expect(touchedKeys.every((key) => !key.startsWith('lash:body'))).toBe(true);
  });

  it('fails closed when storage throws or exact readback differs', () => {
    const throwingStorage = createStorage().storage;
    vi.mocked(throwingStorage.setItem).mockImplementation(() => {
      throw new Error('quota denied');
    });
    expect(createRealtimeRecoveryJournal(throwingStorage).persistAndVerify(recoveryInput)).toEqual({
      ok: false,
      reason: 'write-failed',
    });

    const corruptingStorage = createStorage().storage;
    vi.mocked(corruptingStorage.getItem)
      .mockImplementationOnce(() => null)
      .mockImplementation(() => '{"version":1}');
    expect(
      createRealtimeRecoveryJournal(corruptingStorage).persistAndVerify(recoveryInput),
    ).toEqual({
      ok: false,
      reason: 'readback-mismatch',
    });
  });

  it.each([
    [
      'length',
      (storage: RealtimeRecoveryJournalStorage) => {
        Object.defineProperty(storage, 'length', {
          configurable: true,
          get() {
            throw new DOMException('Storage length denied.', 'SecurityError');
          },
        });
      },
    ],
    [
      'key',
      (storage: RealtimeRecoveryJournalStorage) => {
        vi.mocked(storage.key!).mockImplementation(() => {
          throw new DOMException('Storage key denied.', 'SecurityError');
        });
      },
    ],
    [
      'getItem',
      (storage: RealtimeRecoveryJournalStorage) => {
        vi.mocked(storage.getItem).mockImplementation(() => {
          throw new DOMException('Storage read denied.', 'SecurityError');
        });
      },
    ],
  ])('distinguishes %s enumeration failure from an empty journal', (_label, breakStorage) => {
    const { storage, values } = createStorage();
    values.set(
      'lash:realtime-recovery:v2:fixture-document:actor-owner:4:unknown:receipt',
      '{"version":2}',
    );
    breakStorage(storage);

    expect(createRealtimeRecoveryJournal(storage).listForDocument('fixture-document')).toEqual({
      ok: false,
      reason: 'storage-unavailable',
    });
  });

  it('discovers verified receipts for only the requested document without applying them', () => {
    const { storage } = createStorage();
    const journal = createRealtimeRecoveryJournal(storage, () => '2026-07-18T05:00:00.000Z');
    expect(journal.persistAndVerify(recoveryInput).ok).toBe(true);
    expect(
      journal.persistAndVerify({
        ...recoveryInput,
        documentId: 'different-document',
        epoch: 5,
      }).ok,
    ).toBe(true);

    const result = journal.listForDocument('fixture-document');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      key: expect.stringContaining('fixture-document'),
      record: expect.objectContaining({
        documentId: 'fixture-document',
        updates: [
          expect.objectContaining({ updateId: 'update-a' }),
          expect.objectContaining({ updateId: 'update-b' }),
        ],
      }),
    });
  });

  it('keeps distinct same-document same-epoch receipts collision-safe and independently discardable', () => {
    const { storage } = createStorage();
    const receiptIds = ['receipt-a', 'receipt-b'][Symbol.iterator]();
    const journal = createRealtimeRecoveryJournal(
      storage,
      () => '2026-07-18T05:00:00.000Z',
      () => receiptIds.next().value ?? 'unexpected-receipt',
    );

    const first = journal.persistAndVerify(recoveryInput);
    const second = journal.persistAndVerify({
      ...recoveryInput,
      updates: [{ bytes: new Uint8Array([99, 100]), updateId: 'other-tab-update' }],
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.key).not.toBe(second.key);
    expect(first.key).toContain(encodeURIComponent(recoveryInput.principalId));
    const beforeDiscard = journal.listForDocument(recoveryInput.documentId);
    expect(beforeDiscard.ok && beforeDiscard.records).toHaveLength(2);

    expect(journal.discard(first.key)).toBe(true);
    expect(journal.read(first.key)).toBeNull();
    expect(journal.read(second.key)?.updates[0]).toEqual({
      bytes: new Uint8Array([99, 100]),
      updateId: 'other-tab-update',
    });
    const afterDiscard = journal.listForDocument(recoveryInput.documentId);
    expect(afterDiscard.ok && afterDiscard.records).toHaveLength(1);
  });
});
