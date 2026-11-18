import { describe, expect, it, vi } from 'vitest';

import { canonicalizePromotionJson, sha256Base64Url } from '../../../realtime-worker/src/promotion';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected readonly ctx: unknown;

    constructor(ctx: unknown) {
      this.ctx = ctx;
    }
  },
}));

const PROMOTION_UPDATE =
  'AQTvjKbdDgAHAQdjb250ZW50AwlwYXJhZ3JhcGgHAO+Mpt0OAAYEAO+Mpt0OAQ1Qcm9tb3RlZCBib2R5KAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';

const makePromotionCommand = async () => {
  const body = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Promoted body' }] }],
  };
  const update = Uint8Array.from(atob(PROMOTION_UPDATE), (character) => character.charCodeAt(0));
  const bodySha256 = await sha256Base64Url(
    new TextEncoder().encode(canonicalizePromotionJson(body)),
  );
  const initialUpdateSha256 = await sha256Base64Url(update);
  const adjuncts = { comments: 0 as const, suggestions: 0 as const };
  const snapshotSha256 = await sha256Base64Url(
    new TextEncoder().encode(
      canonicalizePromotionJson({
        version: 1,
        title: 'Promoted title',
        bodySha256,
        initialUpdateSha256,
        adjuncts,
      }),
    ),
  );
  return {
    version: 1,
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    bodySha256: 'b'.repeat(43),
    promotion: {
      version: 1,
      roomId: 'room-alpha',
      ownerPrincipalId: `account:v1:${'a'.repeat(43)}`,
      idempotencyHash: 'h'.repeat(43),
      createIfMissing: true,
      snapshot: {
        version: 1,
        title: 'Promoted title',
        body,
        bodySha256,
        initialUpdate: PROMOTION_UPDATE,
        initialUpdateSha256,
        adjuncts,
        snapshotSha256,
      },
    },
  };
};

describe('document promotion Durable Object schema', () => {
  it('installs an immutable singleton claim alias and private-only coordinator route', async () => {
    const { LashDocumentClaim } = await import('../../../realtime-worker/src/claimCoordinator');
    const sql = vi.fn((_statement: string, ..._bindings: unknown[]) => ({
      toArray: () => [],
    }));
    const blockConcurrencyWhile = vi.fn(<T>(callback: () => Promise<T> | T) =>
      Promise.resolve(callback()),
    );
    const claim = new LashDocumentClaim(
      {
        blockConcurrencyWhile,
        storage: {
          sql: { exec: sql },
          transactionSync: vi.fn((callback: () => unknown) => callback()),
        },
      } as never,
      { LASH_REALTIME_ROOM: { getByName: vi.fn() } } as never,
    );
    await Promise.all(
      blockConcurrencyWhile.mock.results
        .map((result) => result.value)
        .filter((value): value is Promise<unknown> => value instanceof Promise),
    );

    const setupSql = sql.mock.calls.map(([statement]) =>
      String(statement).replace(/\s+/gu, ' ').trim(),
    );
    expect(setupSql).toContainEqual(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS document_claim_alias_v1'),
    );
    expect(setupSql).toContainEqual(
      expect.stringContaining('CREATE TRIGGER IF NOT EXISTS document_claim_alias_v1_no_update'),
    );
    expect(setupSql).toContainEqual(
      expect.stringContaining('CREATE TRIGGER IF NOT EXISTS document_claim_alias_v1_no_delete'),
    );
    expect(setupSql).toContainEqual(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS document_claim_management_replay_v1'),
    );

    const response = await claim.fetch(
      new Request('https://claim.internal/__lash-document-claim/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(
      sql.mock.calls.some(([statement]) =>
        /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?document_claim_alias_v1/iu.test(String(statement)),
      ),
    ).toBe(false);
  });

  it('adds promotion tables without changing the legacy Yjs update constraint', async () => {
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
      const { LashRealtimeRoom } = await import('../../../realtime-worker/src/room');
      const sql = vi.fn((_statement: string, ..._bindings: unknown[]) => ({
        toArray: () => [],
      }));
      const blockConcurrencyWhile = vi.fn((callback: () => Promise<void>) => callback());
      const room = new LashRealtimeRoom(
        {
          blockConcurrencyWhile,
          getWebSockets: vi.fn(() => []),
          setWebSocketAutoResponse: vi.fn(),
          storage: {
            sql: { exec: sql },
            transactionSync: vi.fn((callback: () => unknown) => callback()),
          },
        } as never,
        {} as never,
      );
      await Promise.all(
        blockConcurrencyWhile.mock.results
          .map((result) => result.value)
          .filter((value): value is Promise<void> => value instanceof Promise),
      );

      const setupSql = sql.mock.calls.map(([statement]) =>
        String(statement).replace(/\s+/gu, ' ').trim(),
      );
      expect(setupSql).toContainEqual(
        expect.stringContaining(
          "CREATE TABLE IF NOT EXISTS yjs_updates ( sequence INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('client', 'restore'))",
        ),
      );
      for (const table of [
        'document_owner_v1',
        'document_public_policy_v1',
        'document_projection_v1',
        'document_promotion_receipt_v1',
        'management_request_replay_v1',
        'document_audit_v1',
      ]) {
        expect(setupSql).toContainEqual(
          expect.stringContaining(`CREATE TABLE IF NOT EXISTS ${table}`),
        );
      }

      const response = await room.fetch(
        new Request('https://room.internal/__lash-room/promote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      );
      expect(response.status).toBe(404);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(
        sql.mock.calls.some(([statement]) =>
          String(statement).includes('INSERT INTO document_owner_v1'),
        ),
      ).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['yjs_updates', 'yjs_snapshots'])(
    'rejects promotion over legacy %s rows without modifying any durable row',
    async (legacyTable) => {
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
        const { LashRealtimeRoom } = await import('../../../realtime-worker/src/room');
        const statements: string[] = [];
        const sql = vi.fn((statement: string, ..._bindings: unknown[]) => {
          const normalized = String(statement).replace(/\s+/gu, ' ').trim();
          statements.push(normalized);
          return {
            toArray: () =>
              normalized.includes(`SELECT COUNT(*) FROM ${legacyTable}`) ? [{ count: 1 }] : [],
          };
        });
        const blockConcurrencyWhile = vi.fn((callback: () => Promise<void>) => callback());
        const room = new LashRealtimeRoom(
          {
            blockConcurrencyWhile,
            getWebSockets: vi.fn(() => []),
            setWebSocketAutoResponse: vi.fn(),
            storage: {
              sql: { exec: sql },
              transactionSync: vi.fn((callback: () => unknown) => callback()),
            },
          } as never,
          {} as never,
        );
        await Promise.all(
          blockConcurrencyWhile.mock.results
            .map((result) => result.value)
            .filter((value): value is Promise<void> => value instanceof Promise),
        );
        const promotionStatementStart = statements.length;

        const response = await room.fetch(
          new Request('https://room.internal/__lash-room/promote', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-lash-internal-management': 'promotion-v1',
            },
            body: JSON.stringify(await makePromotionCommand()),
          }),
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
          ok: false,
          error: 'promotion-conflict',
          retryable: false,
        });
        expect(statements).toContainEqual(
          expect.stringContaining(`SELECT COUNT(*) FROM ${legacyTable}`),
        );
        expect(
          statements
            .slice(promotionStatementStart)
            .filter((statement) => /^(?:INSERT|UPDATE|DELETE)\b/u.test(statement)),
        ).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});
