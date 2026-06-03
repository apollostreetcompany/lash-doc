import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  REALTIME_RUNTIME,
  isLocalRealtimeFallbackHost,
  normalizeRoomName,
  parseRealtimeRoute,
} from '../../../realtime-worker/src/routing';

const workerRoot = path.resolve(__dirname, '../../../realtime-worker');

describe('realtime runtime skeleton', () => {
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
    expect(wranglerConfig.migrations).toEqual([
      {
        tag: 'v1',
        new_sqlite_classes: ['LashRealtimeRoom'],
      },
    ]);
  });
});
