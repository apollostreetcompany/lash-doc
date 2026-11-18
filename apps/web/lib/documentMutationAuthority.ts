export type DocumentMutationAuthorityPhase =
  | 'sealed'
  | 'owner-cutover'
  | 'remote-hydrating'
  | 'ready-read'
  | 'ready-edit'
  | 'revoked'
  | 'recovery-available'
  | 'recovery-blocked';

export type DocumentMutationAuthoritySnapshot = {
  /** @deprecated Use routeDocumentId for route/local persistence identity. */
  documentId: string;
  epoch: number;
  phase: DocumentMutationAuthorityPhase;
  bodyWrite: boolean;
  metadataWrite: 'none' | 'document';
  remoteDocumentId: string | null;
  routeDocumentId: string;
};

export type DocumentMutationTicket = Readonly<{
  /** @deprecated Use routeDocumentId for route/local persistence identity. */
  documentId: string;
  epoch: number;
  remoteDocumentId: string | null;
  routeDocumentId: string;
}>;

type TransactionalDocument = {
  transact(callback: () => void, origin?: unknown): void;
};

export type DocumentMutationAuthority = {
  allowsBodyMutation(ticket: DocumentMutationTicket): boolean;
  allowsRemoteBodyApply(documentId: string): boolean;
  allowsTrustedRemoteBodyTransaction(documentId: string, metadata: unknown): boolean;
  capture(): DocumentMutationTicket;
  enterLocalReady(): void;
  enterRemoteHydrating(remoteDocumentId?: string): void;
  enterRemoteReady(input: { canWrite: boolean }): void;
  freezeForOwnerCutover(): boolean;
  getSnapshot(): DocumentMutationAuthoritySnapshot;
  markRecoveryAvailable(): void;
  markRecoveryBlocked(): void;
  registerInitialRemoteProjection(documentId: string, source: object): boolean;
  revoke(): DocumentMutationAuthoritySnapshot;
  restoreLocalAfterOwnerCutover(): boolean;
  runBodyMutation(ticket: DocumentMutationTicket, mutate: () => void): boolean;
  runMetadataMutation(ticket: DocumentMutationTicket, mutate: () => void): boolean;
  runDocumentMetadataMutation(
    ticket: DocumentMutationTicket,
    doc: TransactionalDocument,
    mutate: () => void,
  ): boolean;
  runRemoteBodyApply(documentId: string, apply: () => void): boolean;
  subscribe(listener: (snapshot: DocumentMutationAuthoritySnapshot) => void): () => void;
};

type DocumentBodyTransaction = {
  docChanged: boolean;
  getMeta(key: string): unknown;
};

const DOCUMENT_METADATA_MUTATION_ORIGIN = Symbol('lash-document-metadata-mutation');

class SynchronousDocumentMutationAuthority implements DocumentMutationAuthority {
  private snapshot: DocumentMutationAuthoritySnapshot;
  private readonly listeners = new Set<(snapshot: DocumentMutationAuthoritySnapshot) => void>();
  private initialRemoteProjectionAvailable = false;
  private initialRemoteProjectionSource: object | null = null;
  private remoteApplyDepth = 0;
  private remoteApplyEpoch: number | null = null;
  private ownerCutoverInProgress = false;

  constructor(routeDocumentId: string) {
    this.snapshot = {
      bodyWrite: false,
      documentId: routeDocumentId,
      epoch: 0,
      metadataWrite: 'none',
      phase: 'sealed',
      remoteDocumentId: null,
      routeDocumentId,
    };
  }

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: DocumentMutationAuthoritySnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  capture(): DocumentMutationTicket {
    return {
      documentId: this.snapshot.documentId,
      epoch: this.snapshot.epoch,
      remoteDocumentId: this.snapshot.remoteDocumentId,
      routeDocumentId: this.snapshot.routeDocumentId,
    };
  }

  enterLocalReady() {
    this.ownerCutoverInProgress = false;
    this.initialRemoteProjectionAvailable = false;
    this.initialRemoteProjectionSource = null;
    this.publish({
      ...this.snapshot,
      bodyWrite: true,
      metadataWrite: 'document',
      phase: 'ready-edit',
      remoteDocumentId: null,
    });
  }

  freezeForOwnerCutover() {
    if (
      this.snapshot.phase !== 'ready-edit' ||
      this.snapshot.remoteDocumentId !== null ||
      this.ownerCutoverInProgress
    ) {
      return false;
    }
    this.ownerCutoverInProgress = true;
    this.initialRemoteProjectionAvailable = false;
    this.initialRemoteProjectionSource = null;
    this.publish({
      ...this.snapshot,
      bodyWrite: false,
      epoch: this.snapshot.epoch + 1,
      metadataWrite: 'none',
      phase: 'owner-cutover',
    });
    return true;
  }

  restoreLocalAfterOwnerCutover() {
    if (
      !this.ownerCutoverInProgress ||
      (this.snapshot.phase !== 'owner-cutover' && this.snapshot.phase !== 'remote-hydrating')
    ) {
      return false;
    }
    this.ownerCutoverInProgress = false;
    this.initialRemoteProjectionAvailable = false;
    this.initialRemoteProjectionSource = null;
    this.remoteApplyDepth = 0;
    this.remoteApplyEpoch = null;
    this.publish({
      ...this.snapshot,
      bodyWrite: true,
      epoch: this.snapshot.epoch + 1,
      metadataWrite: 'document',
      phase: 'ready-edit',
      remoteDocumentId: null,
    });
    return true;
  }

  enterRemoteHydrating(remoteDocumentId = this.snapshot.routeDocumentId) {
    this.initialRemoteProjectionAvailable = false;
    this.initialRemoteProjectionSource = null;
    this.publish({
      ...this.snapshot,
      bodyWrite: false,
      metadataWrite: 'none',
      phase: 'remote-hydrating',
      remoteDocumentId,
    });
  }

  enterRemoteReady({ canWrite }: { canWrite: boolean }) {
    // y-prosemirror projects the already-hydrated Y.XmlFragment into its initial
    // ProseMirror state using one `_forceRerender` transaction. It carries a
    // binding marker, unlike later Y.Doc-origin changes.
    this.ownerCutoverInProgress = false;
    this.initialRemoteProjectionAvailable = this.initialRemoteProjectionSource !== null;
    this.publish({
      ...this.snapshot,
      bodyWrite: canWrite,
      metadataWrite: canWrite ? 'document' : 'none',
      phase: canWrite ? 'ready-edit' : 'ready-read',
    });
  }

  revoke() {
    if (
      this.snapshot.phase === 'revoked' ||
      this.snapshot.phase === 'recovery-available' ||
      this.snapshot.phase === 'recovery-blocked'
    ) {
      return this.snapshot;
    }
    this.ownerCutoverInProgress = false;
    this.initialRemoteProjectionAvailable = false;
    this.initialRemoteProjectionSource = null;
    this.publish({
      ...this.snapshot,
      bodyWrite: false,
      epoch: this.snapshot.epoch + 1,
      metadataWrite: 'none',
      phase: 'revoked',
    });
    return this.snapshot;
  }

  markRecoveryAvailable() {
    this.publish({
      ...this.snapshot,
      bodyWrite: false,
      metadataWrite: 'none',
      phase: 'recovery-available',
    });
  }

  markRecoveryBlocked() {
    this.publish({
      ...this.snapshot,
      bodyWrite: false,
      metadataWrite: 'none',
      phase: 'recovery-blocked',
    });
  }

  allowsRemoteBodyApply(documentId: string) {
    if (documentId !== this.snapshot.remoteDocumentId) return false;
    return (
      this.snapshot.phase === 'remote-hydrating' ||
      this.snapshot.phase === 'ready-read' ||
      this.snapshot.phase === 'ready-edit'
    );
  }

  registerInitialRemoteProjection(documentId: string, source: object) {
    if (
      documentId !== this.snapshot.remoteDocumentId ||
      this.snapshot.phase !== 'remote-hydrating' ||
      this.initialRemoteProjectionSource !== null
    ) {
      return false;
    }
    this.initialRemoteProjectionSource = source;
    return true;
  }

  allowsTrustedRemoteBodyTransaction(documentId: string, metadata: unknown) {
    if (!this.allowsRemoteBodyApply(documentId)) return false;
    if (this.remoteApplyDepth > 0 && this.remoteApplyEpoch === this.snapshot.epoch) {
      return true;
    }
    if (
      this.initialRemoteProjectionAvailable &&
      metadata &&
      typeof metadata === 'object' &&
      (metadata as { binding?: { type?: unknown } }).binding?.type ===
        this.initialRemoteProjectionSource
    ) {
      this.initialRemoteProjectionAvailable = false;
      this.initialRemoteProjectionSource = null;
      return true;
    }
    return false;
  }

  allowsBodyMutation(ticket: DocumentMutationTicket) {
    return this.allowsTicket(ticket, 'body');
  }

  runBodyMutation(ticket: DocumentMutationTicket, mutate: () => void) {
    if (!this.allowsTicket(ticket, 'body')) return false;
    mutate();
    return true;
  }

  runMetadataMutation(ticket: DocumentMutationTicket, mutate: () => void) {
    if (!this.allowsTicket(ticket, 'metadata')) return false;
    mutate();
    return true;
  }

  runDocumentMetadataMutation(
    ticket: DocumentMutationTicket,
    doc: TransactionalDocument,
    mutate: () => void,
  ) {
    if (!this.allowsTicket(ticket, 'metadata')) return false;
    let applied = false;
    doc.transact(() => {
      if (!this.allowsTicket(ticket, 'metadata')) return;
      mutate();
      applied = true;
    }, DOCUMENT_METADATA_MUTATION_ORIGIN);
    return applied;
  }

  runRemoteBodyApply(documentId: string, apply: () => void) {
    if (!this.allowsRemoteBodyApply(documentId)) return false;
    const epoch = this.snapshot.epoch;
    if (this.remoteApplyDepth === 0) this.remoteApplyEpoch = epoch;
    if (this.remoteApplyEpoch !== epoch) return false;
    this.remoteApplyDepth += 1;
    try {
      apply();
      return true;
    } finally {
      this.remoteApplyDepth -= 1;
      if (this.remoteApplyDepth === 0) this.remoteApplyEpoch = null;
    }
  }

  private allowsTicket(ticket: DocumentMutationTicket, kind: 'body' | 'metadata') {
    if (
      ticket.documentId !== this.snapshot.routeDocumentId ||
      ticket.routeDocumentId !== this.snapshot.routeDocumentId ||
      ticket.remoteDocumentId !== this.snapshot.remoteDocumentId ||
      ticket.epoch !== this.snapshot.epoch
    ) {
      return false;
    }
    return kind === 'body' ? this.snapshot.bodyWrite : this.snapshot.metadataWrite === 'document';
  }

  private publish(next: DocumentMutationAuthoritySnapshot) {
    this.snapshot = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        // One observer cannot interrupt a synchronous authority transition.
      }
    }
  }
}

export const createDocumentMutationAuthority = (documentId: string): DocumentMutationAuthority =>
  new SynchronousDocumentMutationAuthority(documentId);

export const allowsDocumentBodyTransaction = ({
  authority,
  documentId,
  localBodyMutationsAllowed,
  transaction,
}: {
  authority: DocumentMutationAuthority;
  documentId: string;
  localBodyMutationsAllowed: boolean;
  transaction: DocumentBodyTransaction;
}) => {
  if (!transaction.docChanged) return true;
  const authoritySnapshot = authority.getSnapshot();
  const activeDocumentId = authoritySnapshot.remoteDocumentId ?? authoritySnapshot.routeDocumentId;
  if (documentId !== activeDocumentId) return false;
  const ySyncMetadata = transaction.getMeta('y-sync$');
  if (
    ySyncMetadata &&
    typeof ySyncMetadata === 'object' &&
    (ySyncMetadata as { isChangeOrigin?: unknown }).isChangeOrigin === true
  ) {
    return authority.allowsTrustedRemoteBodyTransaction(documentId, ySyncMetadata);
  }
  return localBodyMutationsAllowed && authority.allowsBodyMutation(authority.capture());
};
