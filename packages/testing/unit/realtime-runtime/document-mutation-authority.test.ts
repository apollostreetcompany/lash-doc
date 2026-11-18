import { describe, expect, it, vi } from 'vitest';

import {
  allowsDocumentBodyTransaction,
  createDocumentMutationAuthority,
  type DocumentMutationAuthority,
} from '../../../../apps/web/lib/documentMutationAuthority';

describe('document mutation authority', () => {
  it('starts sealed and invalidates every captured mutation ticket synchronously on revoke', () => {
    const authority = createDocumentMutationAuthority('fixture-document');

    expect(authority.getSnapshot()).toMatchObject({
      bodyWrite: false,
      documentId: 'fixture-document',
      epoch: 0,
      metadataWrite: 'none',
      phase: 'sealed',
      remoteDocumentId: null,
      routeDocumentId: 'fixture-document',
    });

    authority.enterRemoteHydrating();
    authority.enterRemoteReady({ canWrite: true });
    const editTicket = authority.capture();
    expect(authority.runBodyMutation(editTicket, vi.fn())).toBe(true);

    authority.revoke();
    authority.revoke();

    const staleMutation = vi.fn();
    expect(authority.runBodyMutation(editTicket, staleMutation)).toBe(false);
    expect(staleMutation).not.toHaveBeenCalled();
    expect(authority.getSnapshot()).toMatchObject({
      bodyWrite: false,
      epoch: editTicket.epoch + 1,
      metadataWrite: 'none',
      phase: 'revoked',
    });
  });

  it.each([
    ['view', false],
    ['comment', false],
    ['suggest', false],
    ['edit', true],
  ] as const)('keeps a hydrated %s grant capability-bound', (_scope, canWrite) => {
    const authority = createDocumentMutationAuthority('fixture-document');
    authority.enterRemoteHydrating();

    expect(authority.allowsRemoteBodyApply('fixture-document')).toBe(true);

    authority.enterRemoteReady({ canWrite });
    const ticket = authority.capture();
    const mutateBody = vi.fn();
    const mutateMetadata = vi.fn();
    const mutateLocalMetadata = vi.fn();
    const doc = {
      transact(callback: () => void) {
        callback();
      },
    };

    expect(authority.runBodyMutation(ticket, mutateBody)).toBe(canWrite);
    expect(authority.runMetadataMutation(ticket, mutateLocalMetadata)).toBe(canWrite);
    expect(authority.runDocumentMetadataMutation(ticket, doc, mutateMetadata)).toBe(canWrite);
    expect(mutateBody).toHaveBeenCalledTimes(canWrite ? 1 : 0);
    expect(mutateLocalMetadata).toHaveBeenCalledTimes(canWrite ? 1 : 0);
    expect(mutateMetadata).toHaveBeenCalledTimes(canWrite ? 1 : 0);
    expect(authority.allowsRemoteBodyApply('fixture-document')).toBe(true);
    expect(authority.allowsRemoteBodyApply('different-document')).toBe(false);
  });

  it('rechecks the epoch inside a metadata transaction before calling the mutator', () => {
    const authority = createDocumentMutationAuthority('fixture-document');
    authority.enterRemoteHydrating();
    authority.enterRemoteReady({ canWrite: true });
    const ticket = authority.capture();
    const mutate = vi.fn();
    const doc = {
      transact(callback: () => void) {
        authority.revoke();
        callback();
      },
    };

    expect(authority.runDocumentMetadataMutation(ticket, doc, mutate)).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('allows local-owner writes without granting a stale async completion', () => {
    const authority: DocumentMutationAuthority =
      createDocumentMutationAuthority('fixture-document');
    authority.enterLocalReady();
    const uploadTicket = authority.capture();

    expect(authority.runBodyMutation(uploadTicket, vi.fn())).toBe(true);

    authority.revoke();
    authority.enterLocalReady();

    const staleUploadCompletion = vi.fn();
    expect(authority.runBodyMutation(uploadTicket, staleUploadCompletion)).toBe(false);
    expect(staleUploadCompletion).not.toHaveBeenCalled();
    expect(authority.runBodyMutation(authority.capture(), vi.fn())).toBe(true);
  });

  it('freezes local body and metadata together during owner cutover and restores only fresh local tickets', () => {
    const authority = createDocumentMutationAuthority('local-weekly-plan');
    authority.enterLocalReady();
    const beforeFreeze = authority.capture();
    const localBody = vi.fn();
    const localMetadata = vi.fn();

    expect(authority.freezeForOwnerCutover()).toBe(true);
    expect(authority.getSnapshot()).toMatchObject({
      bodyWrite: false,
      metadataWrite: 'none',
      phase: 'owner-cutover',
      remoteDocumentId: null,
      routeDocumentId: 'local-weekly-plan',
    });
    expect(authority.runBodyMutation(beforeFreeze, localBody)).toBe(false);
    expect(authority.runMetadataMutation(beforeFreeze, localMetadata)).toBe(false);

    const duringFreeze = authority.capture();
    expect(authority.restoreLocalAfterOwnerCutover()).toBe(true);
    expect(authority.getSnapshot()).toMatchObject({
      bodyWrite: true,
      metadataWrite: 'document',
      phase: 'ready-edit',
      remoteDocumentId: null,
      routeDocumentId: 'local-weekly-plan',
    });
    expect(authority.runBodyMutation(beforeFreeze, localBody)).toBe(false);
    expect(authority.runBodyMutation(duringFreeze, localBody)).toBe(false);
    expect(authority.runBodyMutation(authority.capture(), localBody)).toBe(true);
    expect(localBody).toHaveBeenCalledOnce();
    expect(localMetadata).not.toHaveBeenCalled();
  });

  it('binds trusted remote projection and mutation tickets to the opaque remote document ID', () => {
    const authority = createDocumentMutationAuthority('local-weekly-plan');
    const remoteDocumentId = `doc-v7-${'a'.repeat(64)}`;
    const trustedContentType = {};
    authority.enterLocalReady();

    expect(authority.freezeForOwnerCutover()).toBe(true);
    authority.enterRemoteHydrating(remoteDocumentId);

    expect(authority.getSnapshot()).toMatchObject({
      phase: 'remote-hydrating',
      remoteDocumentId,
      routeDocumentId: 'local-weekly-plan',
    });
    expect(authority.allowsRemoteBodyApply('local-weekly-plan')).toBe(false);
    expect(authority.allowsRemoteBodyApply(remoteDocumentId)).toBe(true);
    expect(authority.registerInitialRemoteProjection('local-weekly-plan', trustedContentType)).toBe(
      false,
    );
    expect(authority.registerInitialRemoteProjection(remoteDocumentId, trustedContentType)).toBe(
      true,
    );

    authority.enterRemoteReady({ canWrite: true });
    const remoteTicket = authority.capture();
    expect(remoteTicket).toMatchObject({
      remoteDocumentId,
      routeDocumentId: 'local-weekly-plan',
    });
    expect(authority.runBodyMutation(remoteTicket, vi.fn())).toBe(true);
    const localTransaction = {
      docChanged: true,
      getMeta: vi.fn(() => undefined),
    };
    expect(
      allowsDocumentBodyTransaction({
        authority,
        documentId: 'local-weekly-plan',
        localBodyMutationsAllowed: true,
        transaction: localTransaction,
      }),
    ).toBe(false);
    expect(
      allowsDocumentBodyTransaction({
        authority,
        documentId: remoteDocumentId,
        localBodyMutationsAllowed: true,
        transaction: localTransaction,
      }),
    ).toBe(true);
  });

  it('uses a provider-owned synchronous window for remote projection and rejects spoofed Yjs origins', () => {
    const authority = createDocumentMutationAuthority('fixture-document');
    const trustedContentType = {};
    authority.enterRemoteHydrating();
    authority.registerInitialRemoteProjection('fixture-document', trustedContentType);
    authority.enterRemoteReady({ canWrite: false });
    const changed = {
      docChanged: true,
      getMeta: vi.fn(() => undefined),
    };
    const selectionOnly = {
      docChanged: false,
      getMeta: vi.fn(() => undefined),
    };
    const remoteYjs = {
      docChanged: true,
      getMeta: vi.fn((key: string) => (key === 'y-sync$' ? { isChangeOrigin: true } : undefined)),
    };
    const initialBinding = {
      docChanged: true,
      getMeta: vi.fn((key: string) =>
        key === 'y-sync$'
          ? { binding: { type: trustedContentType }, isChangeOrigin: true }
          : undefined,
      ),
    };
    const spoofedBinding = {
      docChanged: true,
      getMeta: vi.fn((key: string) =>
        key === 'y-sync$' ? { binding: { type: {} }, isChangeOrigin: true } : undefined,
      ),
    };

    expect(
      allowsDocumentBodyTransaction({
        authority,
        documentId: 'fixture-document',
        localBodyMutationsAllowed: true,
        transaction: selectionOnly,
      }),
    ).toBe(true);
    expect(
      allowsDocumentBodyTransaction({
        authority,
        documentId: 'fixture-document',
        localBodyMutationsAllowed: true,
        transaction: changed,
      }),
    ).toBe(false);
    expect(
      allowsDocumentBodyTransaction({
        authority,
        documentId: 'fixture-document',
        localBodyMutationsAllowed: true,
        transaction: remoteYjs,
      }),
    ).toBe(false);
    expect(
      allowsDocumentBodyTransaction({
        authority,
        documentId: 'fixture-document',
        localBodyMutationsAllowed: true,
        transaction: spoofedBinding,
      }),
    ).toBe(false);
    expect(
      allowsDocumentBodyTransaction({
        authority,
        documentId: 'fixture-document',
        localBodyMutationsAllowed: true,
        transaction: initialBinding,
      }),
    ).toBe(true);
    expect(
      allowsDocumentBodyTransaction({
        authority,
        documentId: 'fixture-document',
        localBodyMutationsAllowed: true,
        transaction: initialBinding,
      }),
    ).toBe(false);

    let trustedRemoteProjectionAllowed = false;
    expect(
      authority.runRemoteBodyApply('fixture-document', () => {
        trustedRemoteProjectionAllowed = allowsDocumentBodyTransaction({
          authority,
          documentId: 'fixture-document',
          localBodyMutationsAllowed: false,
          transaction: remoteYjs,
        });
      }),
    ).toBe(true);
    expect(trustedRemoteProjectionAllowed).toBe(true);
    expect(
      allowsDocumentBodyTransaction({
        authority,
        documentId: 'fixture-document',
        localBodyMutationsAllowed: false,
        transaction: remoteYjs,
      }),
    ).toBe(false);
    expect(
      allowsDocumentBodyTransaction({
        authority,
        documentId: 'different-document',
        localBodyMutationsAllowed: true,
        transaction: remoteYjs,
      }),
    ).toBe(false);

    authority.revoke();
    authority.enterRemoteHydrating();
    authority.enterRemoteReady({ canWrite: true });
    expect(
      allowsDocumentBodyTransaction({
        authority,
        documentId: 'fixture-document',
        localBodyMutationsAllowed: true,
        transaction: changed,
      }),
    ).toBe(true);
    expect(
      allowsDocumentBodyTransaction({
        authority,
        documentId: 'fixture-document',
        localBodyMutationsAllowed: false,
        transaction: changed,
      }),
    ).toBe(false);
  });
});
