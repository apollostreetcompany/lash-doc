import { Buffer } from 'node:buffer';

export const OWNER_SESSION_LIMITS = {
  requestBytes: 512,
} as const;

const ACTOR_ID = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/u;
const JSON_WHITESPACE = '[\\t\\n\\r ]*';
const VERSION_FIRST = new RegExp(
  `^${JSON_WHITESPACE}\\{${JSON_WHITESPACE}"version"${JSON_WHITESPACE}:${JSON_WHITESPACE}1${JSON_WHITESPACE},${JSON_WHITESPACE}"actorId"${JSON_WHITESPACE}:${JSON_WHITESPACE}"([a-z0-9-]+)"${JSON_WHITESPACE}\\}${JSON_WHITESPACE}$`,
  'u',
);
const ACTOR_FIRST = new RegExp(
  `^${JSON_WHITESPACE}\\{${JSON_WHITESPACE}"actorId"${JSON_WHITESPACE}:${JSON_WHITESPACE}"([a-z0-9-]+)"${JSON_WHITESPACE},${JSON_WHITESPACE}"version"${JSON_WHITESPACE}:${JSON_WHITESPACE}1${JSON_WHITESPACE}\\}${JSON_WHITESPACE}$`,
  'u',
);

export type BrowserOwnerSessionRequestDecision =
  | { ok: true; request: { version: 1; actorId: string } }
  | { ok: false; error: 'invalid-request' };

export const parseBrowserOwnerSessionRequest = (
  raw: string,
): BrowserOwnerSessionRequestDecision => {
  if (Buffer.byteLength(raw, 'utf8') > OWNER_SESSION_LIMITS.requestBytes) {
    return { ok: false, error: 'invalid-request' };
  }
  const actorId = VERSION_FIRST.exec(raw)?.[1] ?? ACTOR_FIRST.exec(raw)?.[1];
  if (!actorId || !ACTOR_ID.test(actorId)) {
    return { ok: false, error: 'invalid-request' };
  }
  return { ok: true, request: { version: 1, actorId } };
};
