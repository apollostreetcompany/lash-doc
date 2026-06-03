import * as Y from 'yjs';

const REMOTE_UPDATE_ORIGIN = Symbol('lash-remote-yjs-update');

type ProviderStatus = 'disabled' | 'connecting' | 'connected' | 'disconnected';

interface RealtimeProviderOptions {
  actorId: string;
  doc: Y.Doc;
  roomId: string;
  socketBaseUrl: string | null;
}

type RealtimeMessage =
  | { type: 'room-ready' }
  | { type: 'pong' }
  | { type: 'yjs-update'; update: string }
  | { type: 'error'; code?: string };

type SessionResponse =
  | { ok: true; accessToken: string; grant: { actorId: string } }
  | { ok: false; reason?: string };

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const defaultSocketBaseUrl = () => {
  const configured = process.env.NEXT_PUBLIC_LASH_REALTIME_URL?.trim();
  if (configured) return configured;
  if (typeof window === 'undefined') return null;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'ws://127.0.0.1:8787';
  }
  return null;
};

const normalizeActorId = (raw: string | undefined | null) => {
  const normalized = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
  return normalized || 'local-user';
};

const localActorId = () => {
  if (typeof window === 'undefined') return 'local-user';
  try {
    const existing = window.localStorage.getItem('lash:actor-id');
    if (existing) return normalizeActorId(existing);
    const next =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `actor-${crypto.randomUUID().slice(0, 8)}`
        : `actor-${Date.now().toString(36)}`;
    window.localStorage.setItem('lash:actor-id', next);
    return normalizeActorId(next);
  } catch {
    return 'local-user';
  }
};

const httpBaseUrl = (baseUrl: string) =>
  baseUrl.replace(/^wss:/u, 'https:').replace(/^ws:/u, 'http:');

const sessionUrl = (baseUrl: string, roomId: string, actorId: string) => {
  const url = new URL(
    `/api/realtime/rooms/${encodeURIComponent(roomId)}/session`,
    httpBaseUrl(baseUrl),
  );
  url.searchParams.set('actorId', actorId);
  return url.toString();
};

const socketUrl = (baseUrl: string, roomId: string, accessToken: string) => {
  const url = new URL(`/api/realtime/rooms/${encodeURIComponent(roomId)}/socket`, baseUrl);
  url.searchParams.set('accessToken', accessToken);
  return url.toString();
};

export class LashRealtimeYjsProvider {
  private readonly doc: Y.Doc;
  private readonly actorId: string;
  private readonly roomId: string;
  private readonly socketBaseUrl: string | null;
  private queuedUpdates: Uint8Array[] = [];
  private socket: WebSocket | null = null;
  private status: ProviderStatus;

  constructor({ actorId, doc, roomId, socketBaseUrl }: RealtimeProviderOptions) {
    this.doc = doc;
    this.actorId = actorId;
    this.roomId = roomId;
    this.socketBaseUrl = socketBaseUrl;
    this.status = socketBaseUrl ? 'connecting' : 'disabled';
    this.doc.on('update', this.handleLocalUpdate);
    if (socketBaseUrl) {
      void this.authorizeAndConnect();
    }
  }

  getStatus() {
    return this.status;
  }

  destroy() {
    this.doc.off('update', this.handleLocalUpdate);
    this.socket?.close(1000, 'provider destroyed');
    this.socket = null;
    this.queuedUpdates = [];
    this.status = 'disconnected';
  }

  private async authorizeAndConnect() {
    if (!this.socketBaseUrl) return;
    let session: SessionResponse;
    try {
      const response = await fetch(sessionUrl(this.socketBaseUrl, this.roomId, this.actorId), {
        cache: 'no-store',
      });
      session = (await response.json()) as SessionResponse;
    } catch {
      this.status = 'disconnected';
      return;
    }
    if (!session.ok) {
      this.status = 'disconnected';
      return;
    }

    const socket = new WebSocket(socketUrl(this.socketBaseUrl, this.roomId, session.accessToken));
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.status = 'connected';
      this.sendUpdate(Y.encodeStateAsUpdate(this.doc));
      for (const update of this.queuedUpdates.splice(0)) {
        this.sendUpdate(update);
      }
    });

    socket.addEventListener('message', (event) => {
      this.handleMessage(String(event.data));
    });

    socket.addEventListener('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.status = 'disconnected';
      }
    });

    socket.addEventListener('error', () => {
      this.status = 'disconnected';
    });
  }

  private handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_UPDATE_ORIGIN) return;
    this.sendUpdate(update);
  };

  private handleMessage(data: string) {
    let message: RealtimeMessage | null = null;
    try {
      message = JSON.parse(data) as RealtimeMessage;
    } catch {
      return;
    }

    if (message.type === 'yjs-update' && typeof message.update === 'string') {
      Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE_UPDATE_ORIGIN);
    }
  }

  private sendUpdate(update: Uint8Array) {
    if (!update.length) return;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.queuedUpdates.push(update);
      return;
    }
    socket.send(
      JSON.stringify({
        type: 'yjs-update',
        update: bytesToBase64(update),
      }),
    );
  }
}

export const createLashRealtimeCollaboration = (roomId: string) => {
  const doc = new Y.Doc();
  const provider = new LashRealtimeYjsProvider({
    actorId: localActorId(),
    doc,
    roomId,
    socketBaseUrl: defaultSocketBaseUrl(),
  });
  return { doc, provider };
};
