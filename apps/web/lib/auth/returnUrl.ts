import { NAMED_EDIT_ROOM_ID } from '../namedEdit/contract';

const DOCUMENT_PATH_PATTERN = /^\/doc\/([^/]+)$/u;
const PUBLIC_COMMENT_PATH_PATTERN = /^\/public\/doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const NAMED_EDIT_JOIN_PREFIX = '/join/';
const UNSAFE_DECODED_DOCUMENT_SEGMENT = /[\/\\\u0000-\u001f\u007f]/u;

export const isPublicCommentReturnPath = (
  candidate: string | null | undefined,
): candidate is string =>
  typeof candidate === 'string' && PUBLIC_COMMENT_PATH_PATTERN.test(candidate);

export function isNamedMemberJoinReturnPath(
  candidate: string | null | undefined,
): candidate is string {
  if (typeof candidate !== 'string' || !candidate.startsWith(NAMED_EDIT_JOIN_PREFIX)) return false;
  const roomId = candidate.slice(NAMED_EDIT_JOIN_PREFIX.length);
  return NAMED_EDIT_ROOM_ID.exec(roomId)?.[0] === roomId;
}

export function safeDocumentReturnPath(
  candidate: string | null | undefined,
  requestOrigin: string,
): string | null {
  if (!candidate || candidate.startsWith('//') || candidate.includes('#')) {
    return null;
  }

  let origin: URL;
  let target: URL;
  try {
    origin = new URL(requestOrigin);
    target = new URL(candidate, origin);
  } catch {
    return null;
  }

  if (target.origin !== origin.origin || target.username || target.password || target.hash) {
    return null;
  }

  if (isNamedMemberJoinReturnPath(target.pathname)) {
    return candidate === target.pathname || candidate === `${origin.origin}${target.pathname}`
      ? target.pathname
      : null;
  }

  if (isPublicCommentReturnPath(target.pathname)) {
    return !candidate.includes('?') && target.search === '' ? target.pathname : null;
  }

  const documentMatch = DOCUMENT_PATH_PATTERN.exec(target.pathname);
  if (!documentMatch?.[1]) return null;
  try {
    const decodedDocumentId = decodeURIComponent(documentMatch[1]);
    if (!decodedDocumentId || UNSAFE_DECODED_DOCUMENT_SEGMENT.test(decodedDocumentId)) {
      return null;
    }
  } catch {
    return null;
  }

  return `${target.pathname}${target.search}`;
}

export function authCallbackUrl(
  documentReturnPath: string,
  siteOrigin: string,
  state: string,
): URL {
  const safeReturnPath = safeDocumentReturnPath(documentReturnPath, siteOrigin);
  if (!safeReturnPath) {
    throw new TypeError('Auth callback requires a safe document return path.');
  }
  if (!state || state.length > 256) {
    throw new TypeError('Auth callback requires bounded request state.');
  }

  const callback = new URL('/auth/confirm', siteOrigin);
  callback.searchParams.set('next', safeReturnPath);
  callback.searchParams.set('state', state);
  return callback;
}
