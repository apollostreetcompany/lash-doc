import { describe, expect, it } from 'vitest';

import {
  canMountSyntheticMentionFixture,
  selectRealtimeRuntime,
  type RealtimeRuntimeSelectionInput,
} from '../../../../apps/web/lib/realtimeCollaboration';

const selectRuntime = (overrides: Partial<RealtimeRuntimeSelectionInput> = {}) =>
  selectRealtimeRuntime({
    configuredSocketUrl: null,
    environment: 'development',
    hostname: 'localhost',
    localRealtimeEnabled: null,
    localSocketUrl: null,
    search: '',
    testHooksEnabled: false,
    ...overrides,
  });

const disabledRuntime = {
  invitationMode: 'unavailable',
  mode: 'disabled',
  socketBaseUrl: null,
} as const;

describe('browser realtime runtime selection', () => {
  it('lets the explicit force-local query override a configured public runtime', () => {
    expect(
      selectRuntime({
        configuredSocketUrl: 'wss://realtime.lash.example',
        environment: 'production',
        hostname: 'lash.example',
        localRealtimeEnabled: 'true',
        localSocketUrl: 'ws://127.0.0.1:9999',
        search: '?realtime=on&realtime=off',
        testHooksEnabled: true,
      }),
    ).toEqual(disabledRuntime);
  });

  it('ignores browser overrides on deployed hosts even in test-tagged builds', () => {
    const browserOverrides = {
      environment: 'production' as const,
      hostname: 'lash.example',
      localRealtimeEnabled: 'true',
      localSocketUrl: 'ws://127.0.0.1:9999',
      search: '?realtime=on',
      testHooksEnabled: true,
    };

    expect(selectRuntime(browserOverrides)).toEqual(disabledRuntime);
    expect(
      selectRuntime({
        ...browserOverrides,
        configuredSocketUrl: 'wss://realtime.lash.example',
      }),
    ).toEqual({
      invitationMode: 'unavailable',
      mode: 'configured',
      socketBaseUrl: 'wss://realtime.lash.example',
    });
  });

  it.each([
    ['malformed', 'not a websocket URL'],
    ['credentialed', 'ws://user:password@localhost:8787'],
    ['non-websocket protocol', 'https://localhost:8787'],
    ['non-loopback host', 'wss://realtime.lash.example'],
  ])('fails closed for a %s storage URL', (_label, localSocketUrl) => {
    expect(
      selectRuntime({
        localRealtimeEnabled: 'true',
        localSocketUrl,
        search: '?realtime=on',
      }),
    ).toEqual(disabledRuntime);
  });

  it.each([
    ['localhost', 'ws://localhost:8787', 'ws://localhost:8787/'],
    ['127.0.0.1', 'wss://127.0.0.1:8787/room', 'wss://127.0.0.1:8787/room'],
    ['[::1]', 'ws://[::1]:8787', 'ws://[::1]:8787/'],
  ])(
    'allows a safe loopback WebSocket override from the exact %s development host',
    (hostname, localSocketUrl, expectedSocketUrl) => {
      expect(selectRuntime({ hostname, localSocketUrl })).toEqual({
        invitationMode: 'development-loopback',
        mode: 'development-loopback',
        socketBaseUrl: expectedSocketUrl,
      });
    },
  );

  it('allows loopback overrides in a production-shaped test build only with test hooks', () => {
    const productionLoopback = {
      environment: 'production' as const,
      hostname: 'localhost',
      localSocketUrl: 'ws://127.0.0.1:9797',
    };

    expect(selectRuntime(productionLoopback)).toEqual(disabledRuntime);
    expect(selectRuntime({ ...productionLoopback, testHooksEnabled: true })).toEqual({
      invitationMode: 'development-loopback',
      mode: 'development-loopback',
      socketBaseUrl: 'ws://127.0.0.1:9797/',
    });
  });

  it('enables the fixed loopback runtime only from an exact permitted host', () => {
    expect(selectRuntime({ hostname: 'localhost.evil.example', search: '?realtime=on' })).toEqual(
      disabledRuntime,
    );
    expect(selectRuntime({ hostname: '127.0.0.2', localRealtimeEnabled: 'true' })).toEqual(
      disabledRuntime,
    );
    expect(selectRuntime({ hostname: 'localhost', search: '?realtime=on' })).toEqual({
      invitationMode: 'development-loopback',
      mode: 'development-loopback',
      socketBaseUrl: 'ws://127.0.0.1:8787',
    });
  });

  it('selects configured transport without carrying invite-issuance capability', () => {
    const selection = selectRuntime({
      configuredSocketUrl: '  wss://realtime.lash.example  ',
      environment: 'production',
      hostname: 'lash.example',
    });

    expect(selection).toEqual({
      invitationMode: 'unavailable',
      mode: 'configured',
      socketBaseUrl: 'wss://realtime.lash.example',
    });
    expect(selection).not.toHaveProperty('canIssueInvites');
  });

  it('mounts synthetic mention identities only for the exact hydrated loopback owner fixture', () => {
    const runtime = selectRuntime({
      localSocketUrl: 'ws://127.0.0.1:8788',
      testHooksEnabled: true,
    });

    expect(
      canMountSyntheticMentionFixture({
        access: {
          authorized: true,
          authoritativeOwner: true,
          hydrated: true,
          phase: 'remote-ready',
        },
        documentId: 'fixture-document',
        marker: {
          version: 1,
          kind: 'synthetic-mention-identities',
          documentId: 'fixture-document',
        },
        runtime,
        testHooksEnabled: true,
      }),
    ).toBe(true);
  });

  it.each([
    {
      label: 'missing test hooks',
      overrides: { testHooksEnabled: false },
    },
    {
      label: 'configured transport that merely points at loopback',
      overrides: {
        runtime: {
          invitationMode: 'unavailable',
          mode: 'configured',
          socketBaseUrl: 'ws://127.0.0.1:8788',
        } as const,
      },
    },
    {
      label: 'missing marker',
      overrides: { marker: null },
    },
    {
      label: 'wrong-room marker',
      overrides: {
        marker: {
          version: 1,
          kind: 'synthetic-mention-identities',
          documentId: 'another-document',
        },
      },
    },
    {
      label: 'local-ready access',
      overrides: {
        access: {
          authorized: false,
          authoritativeOwner: false,
          hydrated: false,
          phase: 'local-ready',
        } as const,
      },
    },
    {
      label: 'unhydrated owner',
      overrides: {
        access: {
          authorized: true,
          authoritativeOwner: true,
          hydrated: false,
          phase: 'remote-hydrating',
        } as const,
      },
    },
    {
      label: 'hydrated invitee',
      overrides: {
        access: {
          authorized: true,
          authoritativeOwner: false,
          hydrated: true,
          phase: 'remote-ready',
        } as const,
      },
    },
  ])('rejects the synthetic mention fixture for $label', ({ overrides }) => {
    const runtime = selectRuntime({
      localSocketUrl: 'ws://127.0.0.1:8788',
      testHooksEnabled: true,
    });
    const input = {
      access: {
        authorized: true,
        authoritativeOwner: true,
        hydrated: true,
        phase: 'remote-ready',
      } as const,
      documentId: 'fixture-document',
      marker: {
        version: 1,
        kind: 'synthetic-mention-identities',
        documentId: 'fixture-document',
      },
      runtime,
      testHooksEnabled: true,
      ...overrides,
    };

    expect(canMountSyntheticMentionFixture(input)).toBe(false);
  });
});
