import * as Y from 'yjs';

const REMOTE_UPDATE_ORIGIN = Symbol('lash-remote-yjs-update');

export type RealtimeConnectionState =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline';
export type RealtimeSyncState =
  | 'disabled'
  | 'connecting'
  | 'reconnecting'
  | 'syncing'
  | 'saved'
  | 'offline';

export type RealtimeSelection = { from: number; to: number };

export type RealtimePresencePeer = {
  actorId: string;
  label: string;
  color: string;
  selection: RealtimeSelection | null;
  updatedAt: number;
  connection: 'online';
};

export type RealtimeSnapshot = {
  enabled: boolean;
  actorId: string;
  connectionState: RealtimeConnectionState;
  syncState: RealtimeSyncState;
  peers: RealtimePresencePeer[];
};

interface RealtimeProviderOptions {
  actorId: string;
  doc: Y.Doc;
  inviteToken: string | null;
  roomId: string;
  socketBaseUrl: string | null;
}

type RealtimeMessage =
  | { type: 'room-ready' }
  | { type: 'pong' }
  | { type: 'sync-ack'; updateId?: string }
  | { type: 'awareness-state'; peers?: RealtimePresencePeer[] }
  | { type: 'yjs-update'; update: string }
  | { type: 'error'; code?: string };

type SessionResponse =
  | {
      ok: true;
      accessToken: string;
      grant: { actorId: string; capabilities?: string[] };
    }
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
  const params = new URLSearchParams(window.location.search);
  if (params.get('realtime') === 'off') return null;
  const localUrlOverride = window.localStorage.getItem('lash:realtime-url')?.trim();
  if (localUrlOverride) return localUrlOverride;
  const localRealtimeEnabled =
    params.get('realtime') === 'on' ||
    window.localStorage.getItem('lash:realtime-enabled') === 'true';
  if (
    localRealtimeEnabled &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ) {
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

const inviteStorageKey = (roomId: string) => `lash:invite-token:${roomId}`;

const inviteTokenFromCurrentLocation = (roomId: string) => {
  if (typeof window === 'undefined') return null;
  try {
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const token = new URLSearchParams(hash).get('invite');
    if (token) {
      window.sessionStorage.setItem(inviteStorageKey(roomId), token);
      return token;
    }
    return window.sessionStorage.getItem(inviteStorageKey(roomId));
  } catch {
    return null;
  }
};

const sessionUrl = (
  baseUrl: string,
  roomId: string,
  actorId: string,
  inviteToken: string | null,
) => {
  const url = new URL(
    `/api/realtime/rooms/${encodeURIComponent(roomId)}/session`,
    httpBaseUrl(baseUrl),
  );
  url.searchParams.set('actorId', actorId);
  if (inviteToken) {
    url.searchParams.set('inviteToken', inviteToken);
  }
  return url.toString();
};

const socketUrl = (baseUrl: string, roomId: string, accessToken: string) => {
  const url = new URL(`/api/realtime/rooms/${encodeURIComponent(roomId)}/socket`, baseUrl);
  url.searchParams.set('accessToken', accessToken);
  return url.toString();
};

const actorLabel = (actorId: string) =>
  actorId
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || actorId;

const actorColor = (actorId: string) => {
  const colors = ['#2563eb', '#16a34a', '#9333ea', '#c2410c', '#0f766e', '#be123c'];
  let hash = 0;
  for (let index = 0; index < actorId.length; index += 1) {
    hash = (hash * 31 + actorId.charCodeAt(index)) >>> 0;
  }
  return colors[hash % colors.length];
};

const sameSelection = (left: RealtimeSelection | null, right: RealtimeSelection | null) => {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.from === right.from && left.to === right.to;
};

const isPresencePeer = (value: unknown): value is RealtimePresencePeer => {
  if (!value || typeof value !== 'object') return false;
  const peer = value as Partial<RealtimePresencePeer>;
  const selection = peer.selection;
  return (
    typeof peer.actorId === 'string' &&
    typeof peer.label === 'string' &&
    typeof peer.color === 'string' &&
    typeof peer.updatedAt === 'number' &&
    peer.connection === 'online' &&
    (selection === null ||
      (typeof selection === 'object' &&
        typeof selection.from === 'number' &&
        typeof selection.to === 'number'))
  );
};

export class LashRealtimeYjsProvider {
  private readonly doc: Y.Doc;
  private readonly actorId: string;
  private readonly actorLabel: string;
  private readonly actorColor: string;
  private readonly inviteToken: string | null;
  private readonly roomId: string;
  private readonly socketBaseUrl: string | null;
  private readonly listeners = new Set<(snapshot: RealtimeSnapshot) => void>();
  private readonly pendingUpdateIds = new Set<string>();
  private peers = new Map<string, RealtimePresencePeer>();
  private queuedUpdates: Array<{ update: Uint8Array; updateId: string }> = [];
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: RealtimeConnectionState;
  private localSelection: RealtimeSelection | null = null;
  private updateCounter = 0;
  private canWrite: boolean | null = null;
  private destroyed = false;

  constructor({ actorId, doc, inviteToken, roomId, socketBaseUrl }: RealtimeProviderOptions) {
    this.doc = doc;
    this.actorId = actorId;
    this.actorLabel = actorLabel(actorId);
    this.actorColor = actorColor(actorId);
    this.inviteToken = inviteToken;
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

  getSnapshot(): RealtimeSnapshot {
    return {
      enabled: Boolean(this.socketBaseUrl),
      actorId: this.actorId,
      connectionState: this.status,
      syncState: this.syncState(),
      peers: [...this.peers.values()].sort((left, right) =>
        left.actorId.localeCompare(right.actorId),
      ),
    };
  }

  subscribe(listener: (snapshot: RealtimeSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  setLocalSelection(selection: RealtimeSelection | null) {
    const normalized = selection
      ? {
          from: Math.max(0, Math.floor(selection.from)),
          to: Math.max(0, Math.floor(selection.to)),
        }
      : null;
    if (sameSelection(this.localSelection, normalized)) return;
    this.localSelection = normalized;
    this.sendAwareness();
  }

  disconnectForTest() {
    if (!this.socketBaseUrl || this.destroyed) return;
    const socket = this.socket;
    this.socket = null;
    this.pendingUpdateIds.clear();
    this.setConnectionState('reconnecting');
    socket?.close(4000, 'test disconnect');
    this.scheduleReconnect(1_500);
  }

  reconnectForTest() {
    this.reconnectNow();
  }

  reconnectNow() {
    if (!this.socketBaseUrl || this.destroyed) return;
    this.clearReconnectTimer();
    void this.authorizeAndConnect();
  }

  destroy() {
    this.destroyed = true;
    this.clearReconnectTimer();
    this.doc.off('update', this.handleLocalUpdate);
    this.socket?.close(1000, 'provider destroyed');
    this.socket = null;
    this.queuedUpdates = [];
    this.pendingUpdateIds.clear();
    this.peers.clear();
    this.setConnectionState(this.socketBaseUrl ? 'offline' : 'disabled');
  }

  private async authorizeAndConnect() {
    if (!this.socketBaseUrl || this.destroyed) return;
    this.setConnectionState(this.status === 'reconnecting' ? 'reconnecting' : 'connecting');
    let session: SessionResponse;
    try {
      const response = await fetch(
        sessionUrl(this.socketBaseUrl, this.roomId, this.actorId, this.inviteToken),
        {
          cache: 'no-store',
        },
      );
      session = (await response.json()) as SessionResponse;
    } catch {
      this.handleConnectFailure();
      return;
    }
    if (!session.ok) {
      this.handleConnectFailure();
      return;
    }
    this.canWrite = Array.isArray(session.grant.capabilities)
      ? session.grant.capabilities.includes('doc.edit')
      : false;
    if (!this.canWrite) {
      this.queuedUpdates = [];
      this.pendingUpdateIds.clear();
    }

    const socket = new WebSocket(socketUrl(this.socketBaseUrl, this.roomId, session.accessToken));
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.clearReconnectTimer();
      this.setConnectionState('connected');
      if (this.canWrite) {
        this.sendUpdate(Y.encodeStateAsUpdate(this.doc));
        for (const queued of this.queuedUpdates.splice(0)) {
          this.sendUpdatePayload(queued.update, queued.updateId);
        }
      }
      this.sendAwareness();
    });

    socket.addEventListener('message', (event) => {
      this.handleMessage(String(event.data));
    });

    socket.addEventListener('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.pendingUpdateIds.clear();
        this.peers.clear();
        this.setConnectionState(this.destroyed ? 'offline' : 'reconnecting');
        if (!this.destroyed) {
          this.scheduleReconnect();
        }
      }
    });

    socket.addEventListener('error', () => {
      if (this.socket === socket) {
        this.setConnectionState('reconnecting');
      }
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
      return;
    }

    if (message.type === 'sync-ack' && typeof message.updateId === 'string') {
      this.pendingUpdateIds.delete(message.updateId);
      this.emit();
      return;
    }

    if (message.type === 'error' && message.code === 'scope_mismatch') {
      this.canWrite = false;
      this.queuedUpdates = [];
      this.pendingUpdateIds.clear();
      this.emit();
      return;
    }

    if (message.type === 'awareness-state' && Array.isArray(message.peers)) {
      const nextPeers = new Map<string, RealtimePresencePeer>();
      for (const peer of message.peers) {
        if (isPresencePeer(peer) && peer.actorId !== this.actorId) {
          nextPeers.set(peer.actorId, peer);
        }
      }
      this.peers = nextPeers;
      this.emit();
    }
  }

  private sendUpdate(update: Uint8Array) {
    if (!update.length) return;
    if (this.canWrite === false) return;
    const updateId = this.nextUpdateId();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.queuedUpdates.push({ update, updateId });
      this.emit();
      return;
    }
    this.sendUpdatePayload(update, updateId);
  }

  private sendUpdatePayload(update: Uint8Array, updateId: string) {
    if (!update.length) return;
    if (this.canWrite === false) return;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.queuedUpdates.push({ update, updateId });
      this.emit();
      return;
    }
    this.pendingUpdateIds.add(updateId);
    socket.send(
      JSON.stringify({
        type: 'yjs-update',
        updateId,
        update: bytesToBase64(update),
      }),
    );
    this.emit();
  }

  private sendAwareness() {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: 'awareness-update',
        awareness: {
          label: this.actorLabel,
          color: this.actorColor,
          selection: this.localSelection,
        },
      }),
    );
  }

  private nextUpdateId() {
    this.updateCounter += 1;
    return `${this.actorId}-${Date.now().toString(36)}-${this.updateCounter}`;
  }

  private syncState(): RealtimeSyncState {
    if (!this.socketBaseUrl) return 'disabled';
    if (this.status === 'connecting') return 'connecting';
    if (this.status === 'reconnecting') return 'reconnecting';
    if (this.status === 'offline') return 'offline';
    if (this.queuedUpdates.length || this.pendingUpdateIds.size) return 'syncing';
    return 'saved';
  }

  private setConnectionState(status: RealtimeConnectionState) {
    if (this.status === status) {
      this.emit();
      return;
    }
    this.status = status;
    this.emit();
  }

  private handleConnectFailure() {
    if (this.destroyed) return;
    this.setConnectionState('reconnecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(delayMs = 750) {
    if (!this.socketBaseUrl || this.destroyed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.authorizeAndConnect();
    }, delayMs);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private emit() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export const createLashRealtimeCollaboration = (roomId: string) => {
  const doc = new Y.Doc();
  const socketBaseUrl = defaultSocketBaseUrl();
  const provider = new LashRealtimeYjsProvider({
    actorId: localActorId(),
    doc,
    inviteToken: inviteTokenFromCurrentLocation(roomId),
    roomId,
    socketBaseUrl,
  });
  return { doc, enabled: Boolean(socketBaseUrl), provider };
};
