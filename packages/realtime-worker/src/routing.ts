import {
  NAMED_COMMENT_PROTOCOL_VERSION,
  NAMED_EDIT_PROTOCOL_VERSION,
  type NamedEditAction,
} from './namedEdit';

export const REALTIME_RUNTIME = {
  provider: 'cloudflare',
  coordination: 'durable-object-room',
  transport: 'websocket',
} as const;

export type RealtimeRoute =
  | { kind: 'service-health' }
  | { kind: 'room-session'; roomId: string }
  | { kind: 'room-health'; roomId: string }
  | { kind: 'room-restore'; roomId: string }
  | { kind: 'room-socket'; roomId: string }
  | { kind: 'public-control-document-session'; roomId: string }
  | { kind: 'public-comment-control'; roomId: string; action: 'list' | 'create' }
  | { kind: 'management-document-claim-public-comment-moderate'; claimId: string }
  | {
      kind: 'management-document-claim-public-policy';
      claimId: string;
      action: 'read' | 'update';
    }
  | { kind: 'management-document-claim-owner-session'; claimId: string }
  | { kind: 'management-named-edit'; roomId: string; action: NamedEditAction }
  | { kind: 'management-document-claim-promotion'; claimId: string }
  | { kind: 'management-document-promotion'; roomId: string }
  | { kind: 'not-found' };

const MAX_ROOM_NAME_LENGTH = 128;

const decodePathSegment = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const normalizeRoomName = (raw: string | undefined | null): string | null => {
  const normalized = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_ROOM_NAME_LENGTH);

  return /[a-z0-9]/.test(normalized) ? normalized : null;
};

export const isLocalRealtimeFallbackHost = (url: URL) =>
  url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';

export const namedSocketVersion = (url: URL) => {
  const version = url.searchParams.get('protocolVersion');
  if (version === String(NAMED_EDIT_PROTOCOL_VERSION)) return NAMED_EDIT_PROTOCOL_VERSION;
  if (version === String(NAMED_COMMENT_PROTOCOL_VERSION)) return NAMED_COMMENT_PROTOCOL_VERSION;
  return null;
};

export const parseRealtimeRoute = (url: URL): RealtimeRoute => {
  const pathname = url.pathname.replace(/\/+$/u, '') || '/';
  if (pathname === '/api/realtime/health') {
    return { kind: 'service-health' };
  }

  const publicSessionMatch =
    /^\/api\/public-control\/documents\/(doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64})\/session$/u.exec(
      url.pathname,
    );
  if (publicSessionMatch && url.search === '') {
    return {
      kind: 'public-control-document-session',
      roomId: publicSessionMatch[1]!,
    };
  }

  const publicCommentMatch =
    /^\/api\/public-comment-control\/documents\/(doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64})\/comments\/(list|create)$/u.exec(
      url.pathname,
    );
  if (publicCommentMatch && url.search === '') {
    return {
      kind: 'public-comment-control',
      roomId: publicCommentMatch[1]!,
      action: publicCommentMatch[2] as 'list' | 'create',
    };
  }

  const publicCommentModerationMatch =
    /^\/api\/management\/document-claims\/(claim-v1-[0-9a-f]{64})\/public-comments\/moderate$/u.exec(
      url.pathname,
    );
  if (publicCommentModerationMatch && url.search === '') {
    return {
      kind: 'management-document-claim-public-comment-moderate',
      claimId: publicCommentModerationMatch[1]!,
    };
  }

  const claimPublicPolicyMatch =
    /^\/api\/management\/document-claims\/(claim-v1-[0-9a-f]{64})\/public-policy\/(read|update)$/u.exec(
      url.pathname,
    );
  if (claimPublicPolicyMatch) {
    return {
      kind: 'management-document-claim-public-policy',
      claimId: claimPublicPolicyMatch[1]!,
      action: claimPublicPolicyMatch[2] as 'read' | 'update',
    };
  }

  const claimOwnerSessionMatch =
    /^\/api\/management\/document-claims\/(claim-v1-[0-9a-f]{64})\/owner-session$/u.exec(
      url.pathname,
    );
  if (claimOwnerSessionMatch) {
    return {
      kind: 'management-document-claim-owner-session',
      claimId: claimOwnerSessionMatch[1]!,
    };
  }

  const claimPromotionMatch =
    /^\/api\/management\/document-claims\/(claim-v1-[0-9a-f]{64})\/promote$/u.exec(url.pathname);
  if (claimPromotionMatch) {
    return {
      kind: 'management-document-claim-promotion',
      claimId: claimPromotionMatch[1]!,
    };
  }

  const namedEditMatch =
    /^\/api\/management\/documents\/(doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64})\/named-edit\/(issue|list|revoke|session)$/u.exec(
      url.pathname,
    );
  if (namedEditMatch && url.search === '') {
    return {
      kind: 'management-named-edit',
      roomId: namedEditMatch[1]!,
      action: namedEditMatch[2] as NamedEditAction,
    };
  }

  const promotionMatch = /^\/api\/management\/documents\/([^/]+)\/promote$/u.exec(url.pathname);
  if (promotionMatch) {
    const decoded = decodePathSegment(promotionMatch[1]);
    const roomId = normalizeRoomName(decoded);
    if (roomId && decoded === roomId && promotionMatch[1] === roomId) {
      return { kind: 'management-document-promotion', roomId };
    }
    return { kind: 'not-found' };
  }

  const match = /^\/api\/realtime\/rooms\/([^/]+)(?:\/(session|health|restore|socket))?$/u.exec(
    pathname,
  );
  if (!match) {
    return { kind: 'not-found' };
  }

  const roomId = normalizeRoomName(decodePathSegment(match[1]));
  if (!roomId) {
    return { kind: 'not-found' };
  }

  if (match[2] === 'session') return { kind: 'room-session', roomId };
  if (match[2] === 'restore') return { kind: 'room-restore', roomId };
  return match[2] === 'socket' ? { kind: 'room-socket', roomId } : { kind: 'room-health', roomId };
};
