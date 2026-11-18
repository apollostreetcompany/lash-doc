import type { PublicControlSessionSuccessV1 } from '@lash/types';

export type PublicDocumentBrowserSessionSuccessV1 = Omit<
  PublicControlSessionSuccessV1,
  'socket'
> & {
  socket: {
    url: string;
    protocol: 'lash-realtime-v4';
    ticketProtocol: string;
    expiresAt: string;
  };
};

export type PublicDocumentBrowserSessionFailureV1 = {
  ok: false;
  version: 1;
  error: 'invalid-request' | 'document-unavailable' | 'rate-limited' | 'temporarily-unavailable';
  retryable: boolean;
};

export type PublicDocumentBrowserSessionResultV1 =
  | PublicDocumentBrowserSessionSuccessV1
  | PublicDocumentBrowserSessionFailureV1;
