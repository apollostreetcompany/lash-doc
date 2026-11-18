import { describe, expect, it } from 'vitest';

import {
  parsePublicPolicyReadRequest,
  parsePublicPolicyUpdateRequest,
  readOwnerPublicPolicy,
  updateOwnerPublicPolicy,
  type PublicPolicyAuthoritySnapshot,
  type PublicPolicyMutationReceipt,
  type PublicPolicyState,
  type PublicPolicyStore,
} from '../../../realtime-worker/src/publicPolicy';

const PRINCIPAL = `account:v1:${'a'.repeat(43)}`;
const OTHER_PRINCIPAL = `account:v1:${'b'.repeat(43)}`;
const LOCAL_DOCUMENT_ID = 'doc-alpha';
const CLAIM_ID = 'claim-v1-9d05c49f61f58ffa69b8c098851879494c21aea1988e336055c1f646e9ad5543';
const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const MUTATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const NOW = '2026-07-30T00:00:00.000Z';

const readRequest = {
  version: 1 as const,
  claimId: CLAIM_ID,
  ownerPrincipalId: PRINCIPAL,
  localDocumentId: LOCAL_DOCUMENT_ID,
};

const updateRequest = (
  mode: 'restricted' | 'read' | 'comment',
  expectedPolicyVersion: number,
  mutationId = MUTATION_ID,
) => ({
  ...readRequest,
  mode,
  expectedPolicyVersion,
  mutationId,
});

class MemoryPublicPolicyStore implements PublicPolicyStore {
  authority: PublicPolicyAuthoritySnapshot | null = {
    roomId: ROOM_ID,
    ownerPrincipalId: PRINCIPAL,
    shareable: true,
  };
  policy: PublicPolicyState | null = {
    mode: 'restricted',
    policyVersion: 1,
    cutoffGeneration: 0,
  };
  receipts = new Map<string, PublicPolicyMutationReceipt>();
  updateCalls = 0;
  corruptReadback = false;

  transaction<T>(callback: () => T): T {
    return callback();
  }

  readAuthority() {
    return this.authority ? structuredClone(this.authority) : null;
  }

  readPolicy() {
    if (!this.policy) return null;
    return this.corruptReadback && this.updateCalls > 0
      ? { ...structuredClone(this.policy), policyVersion: this.policy.policyVersion + 1 }
      : structuredClone(this.policy);
  }

  readMutation(mutationId: string) {
    const receipt = this.receipts.get(mutationId);
    return receipt ? structuredClone(receipt) : null;
  }

  updatePolicy(next: PublicPolicyState) {
    this.updateCalls += 1;
    this.policy = structuredClone(next);
  }

  createMutation(receipt: PublicPolicyMutationReceipt) {
    if (this.receipts.has(receipt.mutationId)) throw new Error('mutation collision');
    this.receipts.set(receipt.mutationId, structuredClone(receipt));
  }
}

const update = (
  store: MemoryPublicPolicyStore,
  request = updateRequest('read', 1),
  bodySha256 = 'h'.repeat(43),
) =>
  updateOwnerPublicPolicy({
    store,
    request,
    roomId: ROOM_ID,
    bodySha256,
    changedAt: NOW,
  });

describe('owner public-policy domain', () => {
  it('parses only exact claim-bound read and exhaustive three-mode update bodies', async () => {
    await expect(parsePublicPolicyReadRequest(readRequest, CLAIM_ID)).resolves.toEqual({
      ok: true,
      request: readRequest,
    });
    await expect(
      parsePublicPolicyUpdateRequest(updateRequest('comment', 1), CLAIM_ID),
    ).resolves.toEqual({
      ok: true,
      request: updateRequest('comment', 1),
    });

    for (const invalid of [
      { ...readRequest, extra: true },
      { ...readRequest, claimId: `claim-v1-${'0'.repeat(64)}` },
      { ...readRequest, ownerPrincipalId: OTHER_PRINCIPAL },
      { ...readRequest, localDocumentId: ' padded' },
    ]) {
      await expect(parsePublicPolicyReadRequest(invalid, CLAIM_ID)).resolves.toEqual({
        ok: false,
        error: 'invalid-request',
      });
    }
    for (const invalid of [
      { ...updateRequest('read', 1), mode: 'edit' },
      { ...updateRequest('read', 1), mode: 'unknown' },
      { ...updateRequest('read', 1), mode: null },
      { ...updateRequest('read', 1), mode: 1 },
      { ...updateRequest('read', 1), expectedPolicyVersion: 0 },
      { ...updateRequest('read', 1), expectedPolicyVersion: 1.5 },
      { ...updateRequest('read', 1), mutationId: 'not-a-uuid' },
      { ...updateRequest('read', 1), capabilities: ['doc.edit'] },
    ]) {
      await expect(parsePublicPolicyUpdateRequest(invalid, CLAIM_ID)).resolves.toEqual({
        ok: false,
        error: 'invalid-request',
      });
    }
  });

  it('reads the seeded restricted policy without representing public Edit', () => {
    const store = new MemoryPublicPolicyStore();
    expect(readOwnerPublicPolicy({ store, request: readRequest, roomId: ROOM_ID })).toEqual({
      ok: true,
      version: 1,
      roomId: ROOM_ID,
      ownerPrincipalId: PRINCIPAL,
      mode: 'restricted',
      policyVersion: 1,
      cutoffGeneration: 0,
      publicPath: null,
    });
    expect(JSON.stringify(store.policy)).not.toContain('edit');
  });

  it('supports exactly restricted, read, and comment with monotonic change cutoffs', () => {
    const store = new MemoryPublicPolicyStore();
    expect(update(store, updateRequest('restricted', 1), 'a'.repeat(43))).toMatchObject({
      ok: true,
      mode: 'restricted',
      policyVersion: 1,
      cutoffGeneration: 0,
      publicPath: null,
      changed: false,
    });
    expect(
      update(store, updateRequest('read', 1, crypto.randomUUID()), 'b'.repeat(43)),
    ).toMatchObject({
      ok: true,
      mode: 'read',
      policyVersion: 2,
      cutoffGeneration: 1,
      publicPath: `/public/${ROOM_ID}`,
      changed: true,
    });
    expect(
      update(store, updateRequest('comment', 2, crypto.randomUUID()), 'c'.repeat(43)),
    ).toMatchObject({
      ok: true,
      mode: 'comment',
      policyVersion: 3,
      cutoffGeneration: 2,
      publicPath: `/public/${ROOM_ID}`,
      changed: true,
    });
    expect(
      update(store, updateRequest('restricted', 3, crypto.randomUUID()), 'd'.repeat(43)),
    ).toMatchObject({
      ok: true,
      mode: 'restricted',
      policyVersion: 4,
      cutoffGeneration: 3,
      publicPath: null,
      changed: true,
    });
    expect(store.updateCalls).toBe(3);
  });

  it('returns one stable receipt for an idempotent mutation and rejects a changed body', () => {
    const store = new MemoryPublicPolicyStore();
    const first = update(store);
    expect(first).toMatchObject({ ok: true, mode: 'read', changed: true });
    expect(update(store)).toEqual(first);
    expect(store.updateCalls).toBe(1);
    expect(update(store, updateRequest('read', 1), 'x'.repeat(43))).toMatchObject({
      ok: false,
      error: 'replay-detected',
      retryable: false,
    });
  });

  it('rejects stale versions, wrong authority, unshareable rooms, and literal readback mismatch', () => {
    const stale = new MemoryPublicPolicyStore();
    expect(update(stale, updateRequest('read', 2))).toMatchObject({
      ok: false,
      error: 'policy-conflict',
      retryable: false,
      state: {
        mode: 'restricted',
        policyVersion: 1,
        cutoffGeneration: 0,
        publicPath: null,
      },
    });
    expect(stale.updateCalls).toBe(0);

    const wrongOwner = new MemoryPublicPolicyStore();
    wrongOwner.authority = {
      roomId: ROOM_ID,
      ownerPrincipalId: OTHER_PRINCIPAL,
      shareable: true,
    };
    expect(update(wrongOwner)).toMatchObject({
      ok: false,
      error: 'owner-mismatch',
      retryable: false,
    });

    const unshareable = new MemoryPublicPolicyStore();
    unshareable.authority = { ...unshareable.authority!, shareable: false };
    expect(update(unshareable)).toMatchObject({
      ok: false,
      error: 'not-shareable',
      retryable: false,
    });

    const corrupt = new MemoryPublicPolicyStore();
    corrupt.corruptReadback = true;
    expect(update(corrupt)).toMatchObject({
      ok: false,
      error: 'readback-failed',
      retryable: true,
    });

    const publicEdit = new MemoryPublicPolicyStore();
    publicEdit.policy = {
      mode: 'edit' as never,
      policyVersion: 1,
      cutoffGeneration: 0,
    };
    expect(
      readOwnerPublicPolicy({ store: publicEdit, request: readRequest, roomId: ROOM_ID }),
    ).toEqual({
      ok: false,
      version: 1,
      error: 'readback-failed',
      retryable: true,
    });
  });
});
