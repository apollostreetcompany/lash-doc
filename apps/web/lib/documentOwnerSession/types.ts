export interface OwnerSessionBrowserSuccessV1 {
  ok: true;
  version: 1;
  localDocumentId: string;
  remoteDocumentId: string;
  promotionSnapshotSha256: string;
  access: {
    source: 'owner';
    capabilities: readonly ['doc.read', 'doc.edit'];
    protocolVersion: 3;
  };
  socket: {
    url: string;
    protocol: 'lash-realtime-v3';
    ticketProtocol: string;
    expiresAt: string;
  };
}

export type OwnerSessionBrowserFailureV1 =
  | {
      ok: false;
      version: 1;
      error: 'invalid-request' | 'unauthenticated' | 'document-unavailable';
      retryable: false;
    }
  | {
      ok: false;
      version: 1;
      error: 'temporarily-unavailable';
      retryable: true;
    };
