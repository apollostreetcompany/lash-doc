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

export const parseRealtimeRoute = (url: URL): RealtimeRoute => {
  const pathname = url.pathname.replace(/\/+$/u, '') || '/';
  if (pathname === '/api/realtime/health') {
    return { kind: 'service-health' };
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
