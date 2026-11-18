import { createHash, createHmac } from 'node:crypto';

const ROOM_DERIVATION_DOMAIN = 'lash-document-room:v1';
const IDEMPOTENCY_DOMAIN = 'lash-document-promotion-idempotency:v1';
const DOCUMENT_CLAIM_DOMAIN = 'lash-document-claim:v1';

export const deriveDocumentRoomId = (
  version: string,
  key: Uint8Array,
  principalId: string,
  canonicalLocalDocumentId: string,
) =>
  `doc-${version}-${createHmac('sha256', key)
    .update(`${ROOM_DERIVATION_DOMAIN}\0${principalId}\0${canonicalLocalDocumentId}`, 'utf8')
    .digest('hex')}`;

export const deriveDocumentPromotionIdempotencyHash = (
  principalId: string,
  canonicalLocalDocumentId: string,
  browserIdempotencyBytes: Uint8Array,
) =>
  createHash('sha256')
    .update(`${IDEMPOTENCY_DOMAIN}\0${principalId}\0${canonicalLocalDocumentId}\0`, 'utf8')
    .update(browserIdempotencyBytes)
    .digest('base64url');

export const deriveDocumentClaimId = (principalId: string, canonicalLocalDocumentId: string) =>
  `claim-v1-${createHash('sha256')
    .update(`${DOCUMENT_CLAIM_DOMAIN}\0${principalId}\0${canonicalLocalDocumentId}`, 'utf8')
    .digest('hex')}`;
