import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected readonly ctx: unknown;
    protected readonly env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const PRINCIPAL = `account:v1:${'p'.repeat(43)}`;
const CREATE_REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const LIST_REQUEST_ID = '223e4567-e89b-42d3-a456-426614174000';

type Row = {
  sequence: number;
  comment_id: string;
  room_id: string;
  author_principal_id: string;
  author_alias: string;
  mutation_id: string;
  mutation_body_sha256: string;
  body: string;
  policy_version: number;
  cutoff_generation: number;
  created_at: string;
  visibility: string;
  hidden_at: string | null;
  hidden_by_principal_id: string | null;
};

const makeHarness = async () => {
  vi.stubGlobal(
    'WebSocketRequestResponsePair',
    class {
      constructor(
        readonly request: string,
        readonly response: string,
      ) {}
    },
  );
  const statements: string[] = [];
  const requests = new Set<string>();
  const comments: Row[] = [];
  const rates = new Map<string, number>();
  const sql = vi.fn((statement: string, ...bindings: unknown[]) => {
    const normalized = statement.replace(/\s+/gu, ' ').trim();
    statements.push(normalized);
    if (
      normalized.includes('SELECT projection.room_id, projection.shareable, policy.mode') &&
      normalized.includes('FROM document_projection_v1 AS projection')
    ) {
      return {
        toArray: () => [
          {
            room_id: ROOM_ID,
            shareable: 1,
            mode: 'comment',
            policy_version: 3,
            cutoff_generation: 2,
          },
        ],
      };
    }
    if (normalized.startsWith('SELECT COUNT(*) AS count FROM public_comment_request_v1')) {
      return { toArray: () => [{ count: requests.has(String(bindings[0])) ? 1 : 0 }] };
    }
    if (normalized.startsWith('INSERT INTO public_comment_request_v1')) {
      requests.add(String(bindings[0]));
      return { toArray: () => [] };
    }
    if (normalized.startsWith('INSERT INTO public_comment_rate_v1')) {
      const key = bindings.slice(0, 4).join(':');
      const count = (rates.get(key) ?? 0) + 1;
      rates.set(key, count);
      return { toArray: () => [{ count }] };
    }
    if (normalized.startsWith('INSERT INTO public_comment_v1')) {
      comments.push({
        sequence: comments.length + 1,
        comment_id: String(bindings[0]),
        room_id: String(bindings[1]),
        author_principal_id: String(bindings[2]),
        author_alias: String(bindings[3]),
        mutation_id: String(bindings[4]),
        mutation_body_sha256: String(bindings[5]),
        body: String(bindings[6]),
        policy_version: Number(bindings[7]),
        cutoff_generation: Number(bindings[8]),
        created_at: String(bindings[9]),
        visibility: 'visible',
        hidden_at: null,
        hidden_by_principal_id: null,
      });
      return { toArray: () => [] };
    }
    if (normalized.includes('FROM public_comment_v1') && normalized.includes('mutation_id = ?')) {
      return {
        toArray: () => comments.filter((comment) => comment.mutation_id === String(bindings[0])),
      };
    }
    if (
      normalized.includes('FROM public_comment_v1') &&
      normalized.includes("visibility = 'visible'")
    ) {
      const before = bindings[0] === null ? null : Number(bindings[0]);
      const limit = Number(bindings[2]);
      return {
        toArray: () =>
          comments
            .filter(
              (comment) =>
                comment.visibility === 'visible' && (before === null || comment.sequence < before),
            )
            .sort((left, right) => right.sequence - left.sequence)
            .slice(0, limit),
      };
    }
    return { toArray: () => [] };
  });
  const { LashRealtimeRoom } = await import('../../../realtime-worker/src/room');
  const createRoom = async () => {
    const blockConcurrencyWhile = vi.fn(<T>(callback: () => Promise<T> | T) =>
      Promise.resolve(callback()),
    );
    const room = new LashRealtimeRoom(
      {
        acceptWebSocket: vi.fn(),
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
        .map((entry) => entry.value)
        .filter((value): value is Promise<unknown> => value instanceof Promise),
    );
    return room;
  };
  return { createRoom, statements, comments };
};

const call = (
  room: { fetch(request: Request): Promise<Response> },
  action: 'list' | 'create',
  requestId: string,
  publicComment: object,
) =>
  room.fetch(
    new Request(`https://room.internal/__lash-room/public-comments/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lash-internal-management': 'public-comment-v1',
      },
      body: JSON.stringify({
        version: 1,
        requestId,
        bodySha256: (action === 'create' ? 'c' : 'l').repeat(43),
        publicComment,
      }),
    }),
  );

describe('public comment room persistence', () => {
  it('persists create across restart, lists filtered DTO, and never mutates document/Yjs state', async () => {
    try {
      const { createRoom, statements, comments } = await makeHarness();
      const createRoomInstance = await createRoom();
      const createStart = statements.length;
      const created = await call(createRoomInstance, 'create', CREATE_REQUEST_ID, {
        version: 1,
        roomId: ROOM_ID,
        commenterPrincipalId: PRINCIPAL,
        commenterAlias: 'Commenter A1b_2-',
        mutationId: '323e4567-e89b-42d3-a456-426614174000',
        expectedPolicyVersion: 3,
        expectedCutoffGeneration: 2,
        body: 'Persisted public note',
      });
      expect(created.status).toBe(201);
      const createResult = (await created.json()) as Record<string, unknown>;
      expect(createResult).toMatchObject({ ok: true, created: true });
      expect(JSON.stringify(createResult)).not.toMatch(/principal|mutation|visibility|hidden/iu);
      expect(comments).toHaveLength(1);

      const createWrites = statements
        .slice(createStart)
        .filter((statement) => /^(?:INSERT|UPDATE|DELETE|REPLACE)\b/u.test(statement));
      expect(createWrites.some((statement) => statement.includes('public_comment_v1'))).toBe(true);
      expect(
        createWrites.some((statement) =>
          /yjs_updates|yjs_snapshots|document_projection_v1|document_owner_v1/iu.test(statement),
        ),
      ).toBe(false);

      const restartedRoom = await createRoom();
      const listed = await call(restartedRoom, 'list', LIST_REQUEST_ID, {
        version: 1,
        roomId: ROOM_ID,
        expectedPolicyVersion: 3,
        expectedCutoffGeneration: 2,
        beforeSequence: null,
        limit: 50,
        rateKey: `rate-v1-${'r'.repeat(43)}`,
      });
      expect(listed.status).toBe(200);
      await expect(listed.json()).resolves.toMatchObject({
        ok: true,
        comments: [
          {
            sequence: 1,
            body: 'Persisted public note',
            author: { label: 'Commenter A1b_2-' },
          },
        ],
      });
      expect(statements).toContainEqual(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS public_comment_v1'),
      );
      expect(statements).toContainEqual(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS public_comment_rate_v1'),
      );
      expect(statements).toContainEqual(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS public_comment_audit_v1'),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
