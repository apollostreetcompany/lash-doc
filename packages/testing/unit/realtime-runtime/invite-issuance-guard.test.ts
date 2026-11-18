import { describe, expect, it, vi } from 'vitest';

import { createInviteRecord, type InviteRecord } from '../../../../apps/web/lib/inviteAccess';

type CreateInviteResult =
  | { ok: true; record: InviteRecord }
  | { ok: false; reason: 'commit-rejected' | 'storage-conflict' };

type GuardedCreateInviteRecord = (
  input: Parameters<typeof createInviteRecord>[0],
  options: { commitGuard: () => boolean },
) => Promise<CreateInviteResult>;

const guardedCreateInviteRecord = createInviteRecord as unknown as GuardedCreateInviteRecord;
const recordsKey = 'lash:invite-records:v1';

const createStorage = () => {
  const values = new Map<string, string>();
  const writes: Array<{ key: string; value: string }> = [];
  const storage = {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => {
      writes.push({ key, value });
      values.set(key, value);
    }),
  } as unknown as Storage;
  return { storage, values, writes };
};

const inviteInput = (storage: Storage) => ({
  storage,
  docId: 'fixture-document',
  email: 'collaborator@example.com',
  scope: 'edit' as const,
  expiresAt: null,
  origin: 'https://lash.example',
  authority: 'development-loopback' as const,
});

describe('invite issuance commit guard', () => {
  it('publishes no durable bearer after the captured issuance epoch is revoked', async () => {
    const { storage, values, writes } = createStorage();
    let allowed = true;

    const pending = guardedCreateInviteRecord(inviteInput(storage), {
      commitGuard: () => allowed,
    });
    allowed = false;

    await expect(pending).resolves.toEqual({ ok: false, reason: 'commit-rejected' });
    expect(values.has(recordsKey)).toBe(false);
    expect(writes).toEqual([]);
  });

  it('does not overwrite a concurrent invite-record revision after signing', async () => {
    const { storage, values, writes } = createStorage();

    const pending = guardedCreateInviteRecord(inviteInput(storage), {
      commitGuard: () => true,
    });
    values.set(
      recordsKey,
      JSON.stringify([
        {
          jti: 'concurrent',
          docId: 'fixture-document',
          email: 'other@example.com',
          scope: 'view',
          token: 'existing-token',
          link: 'https://lash.example/doc/fixture-document#invite=existing-token',
          expiresAt: null,
          createdAt: '2026-07-18T08:00:00.000Z',
          revokedAt: null,
          status: 'active',
        },
      ]),
    );

    await expect(pending).resolves.toEqual({ ok: false, reason: 'storage-conflict' });
    expect(writes).toEqual([]);
    expect(JSON.parse(values.get(recordsKey) ?? '[]')).toEqual([
      expect.objectContaining({ jti: 'concurrent' }),
    ]);
  });

  it('captures the original guard identity before signing', async () => {
    const { storage, writes } = createStorage();
    const capturedGuard = vi.fn(() => true);
    const replacementGuard = vi.fn(() => false);
    let guard = capturedGuard;
    const options = {
      get commitGuard() {
        return guard;
      },
    };

    const pending = guardedCreateInviteRecord(inviteInput(storage), options);
    guard = replacementGuard;

    const result = await pending;
    expect(result).toMatchObject({ ok: true });
    expect(capturedGuard).toHaveBeenCalledOnce();
    expect(replacementGuard).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
  });
});
