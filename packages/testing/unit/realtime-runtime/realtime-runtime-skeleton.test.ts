import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  REALTIME_RUNTIME,
  isLocalRealtimeFallbackHost,
  normalizeRoomName,
  parseRealtimeRoute,
} from '../../../realtime-worker/src/routing';

const workerRoot = path.resolve(__dirname, '../../../realtime-worker');

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected readonly ctx: unknown;

    constructor(ctx: unknown) {
      this.ctx = ctx;
    }
  },
}));

describe('realtime runtime skeleton', () => {
  it('versions hydration completion and rejects legacy socket attachments', async () => {
    const room = (await import('../../../realtime-worker/src/room')) as unknown as {
      REALTIME_PROTOCOL_VERSION?: number;
      buildRoomHydrationFrames?: (input: {
        roomId: string;
        updates: string[];
      }) => Array<Record<string, unknown>>;
      isCurrentSocketAttachment?: (value: unknown) => boolean;
    };

    expect(room.REALTIME_PROTOCOL_VERSION).toBe(2);
    expect(
      room.buildRoomHydrationFrames?.({
        roomId: 'doc-alpha',
        updates: ['update-1', 'update-2'],
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'room-ready',
        roomId: 'doc-alpha',
        protocolVersion: 2,
      }),
      expect.objectContaining({
        type: 'yjs-update',
        roomId: 'doc-alpha',
        source: 'hydrate',
        update: 'update-1',
      }),
      expect.objectContaining({
        type: 'yjs-update',
        roomId: 'doc-alpha',
        source: 'hydrate',
        update: 'update-2',
      }),
      expect.objectContaining({
        type: 'room-hydration-complete',
        roomId: 'doc-alpha',
        protocolVersion: 2,
        persistedUpdates: 2,
      }),
    ]);
    expect(
      room.buildRoomHydrationFrames?.({
        roomId: 'empty-room',
        updates: [],
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'room-ready',
        roomId: 'empty-room',
        protocolVersion: 2,
      }),
      expect.objectContaining({
        type: 'room-hydration-complete',
        roomId: 'empty-room',
        protocolVersion: 2,
        persistedUpdates: 0,
      }),
    ]);
    expect(
      room.isCurrentSocketAttachment?.({
        actorId: 'actor-a',
        roomId: 'doc-alpha',
        capabilities: ['doc.read', 'doc.edit'],
        connectedAt: 1,
        hydrated: true,
        protocolVersion: 2,
      }),
    ).toBe(true);
    expect(
      room.isCurrentSocketAttachment?.({
        actorId: 'legacy',
        roomId: 'doc-alpha',
        capabilities: ['doc.edit'],
        connectedAt: 1,
      }),
    ).toBe(false);
    for (const malformed of [
      {
        protocolVersion: 2,
        hydrated: true,
        actorId: '',
        roomId: 'doc-alpha',
        capabilities: ['doc.read'],
        connectedAt: 1,
      },
      {
        protocolVersion: 2,
        hydrated: true,
        actorId: 'actor-a',
        roomId: '',
        capabilities: ['doc.read'],
        connectedAt: 1,
      },
      {
        protocolVersion: 2,
        hydrated: true,
        actorId: 'Actor A',
        roomId: 'doc-alpha',
        capabilities: ['doc.read'],
        connectedAt: 1,
      },
      {
        protocolVersion: 2,
        hydrated: true,
        actorId: 'actor-a',
        roomId: 'doc-alpha',
        capabilities: [],
        connectedAt: 1,
      },
      {
        protocolVersion: 2,
        hydrated: true,
        actorId: 'actor-a',
        roomId: 'doc-alpha',
        capabilities: ['doc.read', 'doc.read'],
        connectedAt: 1,
      },
      {
        protocolVersion: 2,
        hydrated: true,
        actorId: 'actor-a',
        roomId: 'doc-alpha',
        capabilities: ['doc.read', 'doc.edit'],
        scope: 'view',
        connectedAt: 1,
      },
      {
        protocolVersion: 2,
        hydrated: true,
        actorId: 'actor-a',
        roomId: 'doc-alpha',
        capabilities: ['doc.read'],
        scope: 'edit',
        connectedAt: 1,
      },
    ]) {
      expect(room.isCurrentSocketAttachment?.(malformed)).toBe(false);
    }
  });

  it('excludes legacy, pre-hydration, and closing sockets from messages and mutation', async () => {
    vi.stubGlobal(
      'WebSocketRequestResponsePair',
      class {
        constructor(
          readonly request: string,
          readonly response: string,
        ) {}
      },
    );

    try {
      const room = (await import('../../../realtime-worker/src/room')) as unknown as {
        LashRealtimeRoom: new (
          ctx: unknown,
          env: unknown,
        ) => {
          webSocketMessage: (ws: WebSocket, message: string | ArrayBuffer) => Promise<void>;
        };
      };
      const sqlExec = vi.fn(() => ({ toArray: () => [] }));
      const getWebSockets = vi.fn<() => WebSocket[]>(() => []);
      const ctx = {
        acceptWebSocket: vi.fn(),
        blockConcurrencyWhile: vi.fn((callback: () => Promise<void>) => callback()),
        getWebSockets,
        setWebSocketAutoResponse: vi.fn(),
        storage: { sql: { exec: sqlExec }, transactionSync: <T>(commit: () => T) => commit() },
      };
      const realtimeRoom = new room.LashRealtimeRoom(ctx, {});
      await ctx.blockConcurrencyWhile.mock.results[0]?.value;
      const setupSqlCalls = sqlExec.mock.calls.length;

      const socket = (attachment: unknown, readyState = 1) => {
        const close = vi.fn();
        const send = vi.fn();
        const serializeAttachment = vi.fn();
        return {
          close,
          send,
          serializeAttachment,
          ws: {
            close,
            deserializeAttachment: vi.fn(() => attachment),
            readyState,
            send,
            serializeAttachment,
          } as unknown as WebSocket,
        };
      };

      const legacy = socket({
        actorId: 'legacy-editor',
        roomId: 'doc-alpha',
        capabilities: ['doc.edit'],
        connectedAt: 1,
      });
      const hydrating = socket({
        protocolVersion: 2,
        hydrated: false,
        actorId: 'hydrating-editor',
        roomId: 'doc-alpha',
        capabilities: ['doc.read', 'doc.edit'],
        connectedAt: 2,
      });
      const current = socket({
        protocolVersion: 2,
        hydrated: true,
        actorId: 'current-editor',
        roomId: 'doc-alpha',
        capabilities: ['doc.read', 'doc.edit'],
        connectedAt: 3,
      });
      const closing = socket(
        {
          protocolVersion: 2,
          hydrated: true,
          actorId: 'closing-editor',
          roomId: 'doc-alpha',
          capabilities: ['doc.read', 'doc.edit'],
          connectedAt: 4,
        },
        2,
      );

      const mutationAttempt = JSON.stringify({
        type: 'yjs-update',
        update: 'must-not-be-parsed-or-persisted',
      });
      await realtimeRoom.webSocketMessage(legacy.ws, mutationAttempt);
      await realtimeRoom.webSocketMessage(hydrating.ws, mutationAttempt);
      await realtimeRoom.webSocketMessage(closing.ws, mutationAttempt);

      expect(legacy.close).toHaveBeenCalledWith(4409, 'protocol-upgrade-required');
      expect(hydrating.close).toHaveBeenCalledWith(4409, 'protocol-upgrade-required');
      expect(legacy.send).not.toHaveBeenCalled();
      expect(hydrating.send).not.toHaveBeenCalled();
      expect(closing.send).not.toHaveBeenCalled();
      expect(legacy.serializeAttachment).not.toHaveBeenCalled();
      expect(hydrating.serializeAttachment).not.toHaveBeenCalled();
      expect(closing.serializeAttachment).not.toHaveBeenCalled();
      expect(sqlExec).toHaveBeenCalledTimes(setupSqlCalls);

      legacy.close.mockClear();
      hydrating.close.mockClear();
      getWebSockets.mockReturnValue([legacy.ws, hydrating.ws, closing.ws, current.ws]);
      await realtimeRoom.webSocketMessage(
        current.ws,
        JSON.stringify({
          type: 'broadcast',
          requestId: 'current-only',
          payload: { marker: 'safe' },
        }),
      );

      expect(legacy.send).not.toHaveBeenCalled();
      expect(hydrating.send).not.toHaveBeenCalled();
      expect(closing.send).not.toHaveBeenCalled();
      expect(legacy.close).toHaveBeenCalledWith(4409, 'protocol-upgrade-required');
      expect(hydrating.close).not.toHaveBeenCalled();
      expect(current.send).toHaveBeenCalledOnce();
      expect(JSON.parse(String(current.send.mock.calls[0]?.[0]))).toEqual({
        type: 'broadcast',
        actorId: 'current-editor',
        requestId: 'current-only',
        roomId: 'doc-alpha',
        payload: { marker: 'safe' },
      });
      expect(sqlExec).toHaveBeenCalledTimes(setupSqlCalls);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('chooses Cloudflare Durable Objects as the room runtime', () => {
    expect(REALTIME_RUNTIME).toEqual({
      provider: 'cloudflare',
      coordination: 'durable-object-room',
      transport: 'websocket',
    });
  });

  it('normalizes and scopes document room routes', () => {
    expect(normalizeRoomName('Doc Alpha 123')).toBe('doc-alpha-123');
    expect(normalizeRoomName('../')).toBeNull();

    expect(parseRealtimeRoute(new URL('https://lash.test/api/realtime/health'))).toEqual({
      kind: 'service-health',
    });
    expect(
      parseRealtimeRoute(new URL('https://lash.test/api/realtime/rooms/Doc Alpha/socket')),
    ).toEqual({
      kind: 'room-socket',
      roomId: 'doc-alpha',
    });
    expect(
      parseRealtimeRoute(new URL('https://lash.test/api/realtime/rooms/doc-alpha/health')),
    ).toEqual({
      kind: 'room-health',
      roomId: 'doc-alpha',
    });
    expect(parseRealtimeRoute(new URL('https://lash.test/api/realtime/rooms/doc-alpha'))).toEqual({
      kind: 'room-health',
      roomId: 'doc-alpha',
    });
    expect(parseRealtimeRoute(new URL('https://lash.test/doc/doc-alpha'))).toEqual({
      kind: 'not-found',
    });
  });

  it('allows local fallback realtime grants only on loopback hosts', () => {
    expect(isLocalRealtimeFallbackHost(new URL('http://127.0.0.1:8787/api/realtime/health'))).toBe(
      true,
    );
    expect(isLocalRealtimeFallbackHost(new URL('http://localhost:8787/api/realtime/health'))).toBe(
      true,
    );
    expect(isLocalRealtimeFallbackHost(new URL('https://lash-realtime.example.com'))).toBe(false);
    expect(isLocalRealtimeFallbackHost(new URL('https://lash-9xx.pages.dev'))).toBe(false);
  });

  it('has deploy-shaped Wrangler configuration for the room Durable Object', () => {
    const wranglerConfig = JSON.parse(
      fs.readFileSync(path.join(workerRoot, 'wrangler.jsonc'), 'utf8'),
    );

    expect(wranglerConfig.main).toBe('src/index.ts');
    expect(wranglerConfig.compatibility_date).toMatch(/^2026-06-/);
    expect(wranglerConfig.compatibility_flags).toContain('nodejs_compat');
    expect(wranglerConfig.observability).toMatchObject({
      enabled: true,
      head_sampling_rate: 1,
    });
    expect(wranglerConfig.durable_objects.bindings).toContainEqual({
      name: 'LASH_REALTIME_ROOM',
      class_name: 'LashRealtimeRoom',
    });
    expect(wranglerConfig.durable_objects.bindings).toContainEqual({
      name: 'LASH_DOCUMENT_CLAIM',
      class_name: 'LashDocumentClaim',
    });
    expect(wranglerConfig.migrations).toEqual([
      {
        tag: 'v1',
        new_sqlite_classes: ['LashRealtimeRoom'],
      },
      {
        tag: 'v2',
        new_sqlite_classes: ['LashDocumentClaim'],
      },
    ]);
  });
});
