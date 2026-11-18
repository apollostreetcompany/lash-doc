import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

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

const PRINCIPAL = `account:v1:${'a'.repeat(43)}`;
const CLAIM_ID = 'claim-v1-9d05c49f61f58ffa69b8c098851879494c21aea1988e336055c1f646e9ad5543';
const ROOM_ID = `doc-v1-${'a'.repeat(64)}`;
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const MUTATION_ID = '223e4567-e89b-42d3-a456-426614174000';
const INITIAL_UPDATE =
  'AQTvjKbdDgAHAQdjb250ZW50AwlwYXJhZ3JhcGgHAO+Mpt0OAAYEAO+Mpt0OAQ1Qcm9tb3RlZCBib2R5KAEZbGFzaDpkb2N1bWVudC1tZXRhZGF0YTp2MQV0aXRsZQF3DlByb21vdGVkIHRpdGxlAA==';

const withPrivateDocumentChip = () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(INITIAL_UPDATE, 'base64'));
  const paragraph = doc.getXmlFragment('content').get(0) as Y.XmlElement;
  const chip = new Y.XmlElement('chip');
  chip.setAttribute('kind', 'doc');
  chip.setAttribute('refId', 'private-document');
  chip.setAttribute('href', '/doc/private-document');
  paragraph.push([chip]);
  const projection = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  doc.destroy();
  return projection;
};

const readRequest = {
  version: 1,
  claimId: CLAIM_ID,
  ownerPrincipalId: PRINCIPAL,
  localDocumentId: 'doc-alpha',
  roomId: ROOM_ID,
};

const updateRequest = {
  ...readRequest,
  mode: 'comment',
  expectedPolicyVersion: 1,
  mutationId: MUTATION_ID,
};

type PolicyRow = {
  mode: string;
  policy_version: number;
  cutoff_generation: number;
};

type MutationRow = {
  mutation_id: string;
  request_body_sha256: string;
  owner_principal_id: string;
  requested_mode: string;
  expected_policy_version: number;
  result_mode: string;
  result_policy_version: number;
  result_cutoff_generation: number;
  result_changed: number;
  created_at: string;
};

const makeRoom = async (options: { shareable?: boolean; privateChip?: boolean } = {}) => {
  vi.stubGlobal(
    'WebSocketRequestResponsePair',
    class {
      constructor(
        readonly request: string,
        readonly response: string,
      ) {}
    },
  );
  let policy: PolicyRow | null = null;
  const mutations = new Map<string, MutationRow>();
  const statements: string[] = [];
  const auditEvents: string[] = [];
  const sql = vi.fn((statement: string, ...bindings: unknown[]) => {
    const normalized = statement.replace(/\s+/gu, ' ').trim();
    statements.push(normalized);

    if (normalized.startsWith('INSERT OR IGNORE INTO document_public_policy_v2')) {
      policy ??= { mode: 'restricted', policy_version: 1, cutoff_generation: 0 };
      return { toArray: () => [] };
    }
    if (
      normalized.includes('FROM document_owner_v1 AS owner') &&
      normalized.includes('JOIN document_projection_v1 AS projection')
    ) {
      return {
        toArray: () => [
          {
            room_id: ROOM_ID,
            owner_principal_id: PRINCIPAL,
            shareable: options.shareable === false ? 0 : 1,
          },
        ],
      };
    }
    if (normalized.startsWith('SELECT initial_update_b64 FROM document_projection_v1')) {
      return {
        toArray: () => [
          { initial_update_b64: options.privateChip ? withPrivateDocumentChip() : INITIAL_UPDATE },
        ],
      };
    }
    if (
      normalized.startsWith(
        'SELECT mode, policy_version, cutoff_generation FROM document_public_policy_v2',
      )
    ) {
      return { toArray: () => (policy ? [structuredClone(policy)] : []) };
    }
    if (normalized.startsWith('UPDATE document_public_policy_v2 SET')) {
      policy = {
        mode: String(bindings[0]),
        policy_version: Number(bindings[1]),
        cutoff_generation: Number(bindings[2]),
      };
      return { toArray: () => [] };
    }
    if (
      normalized.includes('FROM document_public_policy_mutation_v1') &&
      normalized.includes('WHERE mutation_id = ?')
    ) {
      const mutation = mutations.get(String(bindings[0]));
      return { toArray: () => (mutation ? [structuredClone(mutation)] : []) };
    }
    if (normalized.startsWith('INSERT INTO document_public_policy_mutation_v1')) {
      const row: MutationRow = {
        mutation_id: String(bindings[0]),
        request_body_sha256: String(bindings[1]),
        owner_principal_id: String(bindings[2]),
        requested_mode: String(bindings[3]),
        expected_policy_version: Number(bindings[4]),
        result_mode: String(bindings[5]),
        result_policy_version: Number(bindings[6]),
        result_cutoff_generation: Number(bindings[7]),
        result_changed: Number(bindings[8]),
        created_at: String(bindings[9]),
      };
      mutations.set(row.mutation_id, row);
      return { toArray: () => [] };
    }
    if (normalized.startsWith('INSERT INTO document_audit_v1')) {
      auditEvents.push(String(bindings[0] ?? 'document.public-policy.updated'));
      return { toArray: () => [] };
    }
    return { toArray: () => [] };
  });
  const blockConcurrencyWhile = vi.fn(<T>(callback: () => Promise<T> | T) =>
    Promise.resolve(callback()),
  );
  const { LashRealtimeRoom } = await import('../../../realtime-worker/src/room');
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
      .filter((value): value is Promise<unknown> => value instanceof Promise),
  );
  return {
    room,
    statements,
    auditEvents,
    getPolicy: () => policy,
    getMutation: () => mutations.get(MUTATION_ID) ?? null,
  };
};

const command = (action: 'read' | 'update', bodySha256 = 'h'.repeat(43)) => ({
  version: 1,
  requestId: REQUEST_ID,
  bodySha256,
  publicPolicy: action === 'read' ? readRequest : updateRequest,
});

const call = (room: { fetch(request: Request): Promise<Response> }, action: 'read' | 'update') =>
  room.fetch(
    new Request(`https://room.internal/__lash-room/public-policy/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lash-internal-management': 'public-policy-v1',
      },
      body: JSON.stringify(command(action)),
    }),
  );

describe('public-policy room Durable Object', () => {
  it('blocks public enabling on a private reference while keeping Restricted available to the owner', async () => {
    try {
      const { room } = await makeRoom({ privateChip: true });
      const read = await call(room, 'read');
      expect(read.status).toBe(200);
      await expect(read.json()).resolves.toMatchObject({
        ok: true,
        mode: 'restricted',
        policyVersion: 1,
        publicProjectionBlocked: true,
        publicPath: null,
      });
      const enable = await call(room, 'update');
      expect(enable.status).toBe(409);
      await expect(enable.json()).resolves.toEqual({
        ok: false,
        version: 1,
        error: 'not-shareable',
        retryable: false,
      });
      const restrict = await room.fetch(
        new Request('https://room.internal/__lash-room/public-policy/update', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-lash-internal-management': 'public-policy-v1',
          },
          body: JSON.stringify({
            ...command('update'),
            publicPolicy: { ...updateRequest, mode: 'restricted' },
          }),
        }),
      );
      expect(restrict.status).toBe(200);
      await expect(restrict.json()).resolves.toMatchObject({
        ok: true,
        changed: false,
        mode: 'restricted',
        publicPath: null,
        publicProjectionBlocked: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('adds exact v2/mutation tables and migrates the restricted v1 singleton in place', async () => {
    try {
      const { statements, getPolicy } = await makeRoom();
      expect(statements).toContainEqual(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS document_public_policy_v2'),
      );
      expect(statements).toContainEqual(
        expect.stringContaining("CHECK (mode IN ('restricted', 'read', 'comment'))"),
      );
      expect(statements).toContainEqual(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS document_public_policy_mutation_v1'),
      );
      expect(statements).toContainEqual(
        expect.stringContaining('INSERT OR IGNORE INTO document_public_policy_v2'),
      );
      expect(getPolicy()).toEqual({
        mode: 'restricted',
        policy_version: 1,
        cutoff_generation: 0,
      });
      expect(
        statements.filter((statement) =>
          statement.startsWith('CREATE TABLE IF NOT EXISTS document_public_policy_v2'),
        )[0],
      ).not.toContain("'edit'");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads restricted, commits comment with one cutoff, and returns one stable mutation receipt', async () => {
    try {
      const { room, getPolicy, getMutation } = await makeRoom();
      const read = await call(room, 'read');
      expect(read.status).toBe(200);
      await expect(read.json()).resolves.toEqual({
        ok: true,
        version: 1,
        roomId: ROOM_ID,
        ownerPrincipalId: PRINCIPAL,
        mode: 'restricted',
        policyVersion: 1,
        cutoffGeneration: 0,
        publicPath: null,
      });

      const updated = await call(room, 'update');
      expect(updated.status).toBe(200);
      const result = await updated.json();
      expect(result).toEqual({
        ok: true,
        version: 1,
        roomId: ROOM_ID,
        ownerPrincipalId: PRINCIPAL,
        mode: 'comment',
        policyVersion: 2,
        cutoffGeneration: 1,
        publicPath: `/public/${ROOM_ID}`,
        changed: true,
      });
      expect(getPolicy()).toEqual({
        mode: 'comment',
        policy_version: 2,
        cutoff_generation: 1,
      });
      expect(getMutation()).toMatchObject({
        mutation_id: MUTATION_ID,
        request_body_sha256: 'h'.repeat(43),
        requested_mode: 'comment',
        result_policy_version: 2,
        result_cutoff_generation: 1,
        result_changed: 1,
      });

      const replay = await call(room, 'update');
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toEqual(result);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects conflicting mutation bytes, public Edit, and unshareable authority', async () => {
    try {
      const firstRoom = await makeRoom();
      expect((await call(firstRoom.room, 'update')).status).toBe(200);
      const conflict = await firstRoom.room.fetch(
        new Request('https://room.internal/__lash-room/public-policy/update', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-lash-internal-management': 'public-policy-v1',
          },
          body: JSON.stringify(command('update', 'x'.repeat(43))),
        }),
      );
      expect(conflict.status).toBe(409);
      await expect(conflict.json()).resolves.toMatchObject({
        ok: false,
        error: 'replay-detected',
      });

      const edit = await firstRoom.room.fetch(
        new Request('https://room.internal/__lash-room/public-policy/update', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-lash-internal-management': 'public-policy-v1',
          },
          body: JSON.stringify({
            ...command('update'),
            publicPolicy: { ...updateRequest, mode: 'edit' },
          }),
        }),
      );
      expect(edit.status).toBe(400);

      vi.unstubAllGlobals();
      const unshareable = await makeRoom({ shareable: false });
      const denied = await call(unshareable.room, 'update');
      expect(denied.status).toBe(409);
      await expect(denied.json()).resolves.toMatchObject({
        ok: false,
        error: 'not-shareable',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
