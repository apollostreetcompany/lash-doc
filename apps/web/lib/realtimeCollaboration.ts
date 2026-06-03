import * as Y from 'yjs';

const REMOTE_UPDATE_ORIGIN = Symbol('lash-remote-yjs-update');

type ProviderStatus = 'disabled' | 'connecting' | 'connected' | 'disconnected';

interface RealtimeProviderOptions {
  doc: Y.Doc;
  roomId: string;
  socketBaseUrl: string | null;
}

type RealtimeMessage =
  | { type: 'room-ready' }
  | { type: 'pong' }
  | { type: 'yjs-update'; update: string }
  | { type: 'error'; code?: string };

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

const socketUrl = (baseUrl: string, roomId: string) =>
  new URL(`/api/realtime/rooms/${encodeURIComponent(roomId)}/socket`, baseUrl).toString();

export class LashRealtimeYjsProvider {
  private readonly doc: Y.Doc;
  private readonly roomId: string;
  private readonly socketBaseUrl: string | null;
  private queuedUpdates: Uint8Array[] = [];
  private socket: WebSocket | null = null;
  private status: ProviderStatus;

  constructor({ doc, roomId, socketBaseUrl }: RealtimeProviderOptions) {
    this.doc = doc;
    this.roomId = roomId;
    this.socketBaseUrl = socketBaseUrl;
    this.status = socketBaseUrl ? 'connecting' : 'disabled';
    this.doc.on('update', this.handleLocalUpdate);
    if (socketBaseUrl) {
      this.connect();
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

  private connect() {
    if (!this.socketBaseUrl) return;
    const socket = new WebSocket(socketUrl(this.socketBaseUrl, this.roomId));
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
    doc,
    roomId,
    socketBaseUrl: defaultSocketBaseUrl(),
  });
  return { doc, provider };
};
