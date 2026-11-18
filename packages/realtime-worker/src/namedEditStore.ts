import {
  NAMED_COMMENT_CAPABILITIES,
  NAMED_COMMENT_PROTOCOL_VERSION,
  NAMED_COMMENT_SOCKET_PROTOCOL,
  NAMED_EDIT_CAPABILITIES,
  NAMED_EDIT_PROTOCOL_VERSION,
  NAMED_EDIT_SOCKET_PROTOCOL,
  namedEditFailure,
  type NamedEditCommand,
  type NamedEditInvite,
  type NamedEditResult,
  type NamedInviteRole,
} from './namedEdit';
import { sha256Base64Url } from './promotion';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TICKET_TTL_MS = 60_000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const REPLAY_TTL_MS = 70_000;
const MAX_INVITES = 500;
const MAX_SESSION_REQUESTS_PER_ACCOUNT = 30;
const MAX_SESSION_REQUESTS_PER_ROOM = 300;
const encoder = new TextEncoder();

type InviteRow = {
  invite_id: string;
  email_digest: string;
  email_ciphertext: string;
  token_hash: string;
  expires_at_ms: number;
  accepted_principal_id: string | null;
  revoked_at_ms: number | null;
};

type TicketRow = {
  invite_id: string;
  actor_id: string;
  browser_origin: string;
  expires_at_ms: number;
  consumed_at_ms: number | null;
};

export type NamedEditGrant = {
  inviteId: string;
  expiresAtMs: number;
};

export type NamedCommentGrant = {
  inviteId: string;
  expiresAtMs: number;
};

const roles = ['edit', 'comment'] as const;
const inviteTable = (role: NamedInviteRole) => `named_${role}_invite_v1`;
const ticketTable = (role: NamedInviteRole) => `named_${role}_ticket_v1`;

export const initializeNamedEditStorage = (storage: DurableObjectStorage) => {
  // Keep v5 data and its schema intact so a rollback cannot admit v6 credentials.
  for (const role of roles) {
    storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${inviteTable(role)} (
        invite_id TEXT PRIMARY KEY,
        email_digest TEXT NOT NULL,
        email_ciphertext TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at_ms INTEGER NOT NULL,
        accepted_principal_id TEXT,
        revoked_at_ms INTEGER
      )
    `);
    storage.sql.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS named_${role}_active_member_v1
      ON ${inviteTable(role)}(accepted_principal_id)
      WHERE accepted_principal_id IS NOT NULL AND revoked_at_ms IS NULL
    `);
    storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${ticketTable(role)} (
        token_hash TEXT PRIMARY KEY,
        invite_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        browser_origin TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        consumed_at_ms INTEGER
      )
    `);
    storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS named_${role}_ticket_expiry_v1
      ON ${ticketTable(role)}(expires_at_ms)
    `);
    storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS named_${role}_audit_v1 (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        invite_id TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        at_ms INTEGER NOT NULL
      )
    `);
  }
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS named_edit_replay_v1 (
      request_id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      action TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL
    )
  `);
  storage.sql.exec(`
    CREATE INDEX IF NOT EXISTS named_edit_replay_expiry_v1
    ON named_edit_replay_v1(expires_at_ms)
  `);
};

const authority = (storage: DurableObjectStorage, roomId: string) =>
  storage.sql
    .exec<{ owner_principal_id: string; block_new_sessions: number }>(
      `SELECT owner.owner_principal_id, COALESCE(control.block_new_sessions, 0) AS block_new_sessions
       FROM document_owner_v1 AS owner
       JOIN document_projection_v1 AS projection ON projection.singleton = owner.singleton
       JOIN document_promotion_receipt_v1 AS receipt ON receipt.singleton = owner.singleton
       LEFT JOIN owner_session_control_v1 AS control ON control.singleton = owner.singleton
       WHERE owner.singleton = 1 AND projection.room_id = ? AND projection.shareable = 1
         AND projection.snapshot_sha256 = receipt.snapshot_sha256
         AND owner.owner_principal_id = receipt.owner_principal_id
         AND COALESCE(control.frozen, 0) = 0`,
      roomId,
    )
    .toArray()[0];

const inviteById = (storage: DurableObjectStorage, role: NamedInviteRole, inviteId: string) =>
  storage.sql
    .exec<InviteRow>(`SELECT * FROM ${inviteTable(role)} WHERE invite_id = ?`, inviteId)
    .toArray()[0];

const member = (storage: DurableObjectStorage, role: NamedInviteRole, principalId: string) =>
  storage.sql
    .exec<InviteRow>(
      `SELECT * FROM ${inviteTable(role)}
       WHERE accepted_principal_id = ? AND revoked_at_ms IS NULL`,
      principalId,
    )
    .toArray()[0];

type RoleInvite = { role: NamedInviteRole; row: InviteRow };

const findRoleInvite = (find: (role: NamedInviteRole) => InviteRow | undefined) => {
  for (const role of roles) {
    const row = find(role);
    if (row) return { role, row };
  }
  return undefined;
};

const audit = (
  storage: DurableObjectStorage,
  role: NamedInviteRole,
  event: 'issued' | 'accepted' | 'revoked',
  inviteId: string,
  principalId: string,
  nowMs: number,
) => {
  storage.sql.exec(
    `INSERT INTO named_${role}_audit_v1 (event, invite_id, principal_id, at_ms) VALUES (?, ?, ?, ?)`,
    event,
    inviteId,
    principalId,
    nowMs,
  );
};

const inviteDto = ({ role, row }: RoleInvite, nowMs: number): NamedEditInvite => {
  let status: NamedEditInvite['status'] = 'pending';
  if (row.revoked_at_ms !== null) status = 'revoked';
  else if (row.accepted_principal_id !== null) status = 'accepted';
  else if (row.expires_at_ms <= nowMs) status = 'expired';
  return {
    inviteId: row.invite_id,
    emailCiphertext: row.email_ciphertext,
    expiresAt: new Date(row.expires_at_ms).toISOString(),
    role,
    status,
  };
};

const commentProjectionFailure = (
  role: NamedInviteRole,
  options: Pick<ExecuteInput, 'commentEnabled' | 'commentProjectionAvailable'>,
) => {
  if (role !== 'comment') return undefined;
  if (options.commentEnabled !== true) return namedEditFailure('named-comment-disabled');
  if (options.commentProjectionAvailable?.() !== true) {
    return namedEditFailure('comment-projection-unavailable');
  }
  return undefined;
};

const issueInvite = (
  input: ExecuteInput,
  command: Extract<NamedEditCommand, { action: 'issue' }>,
): NamedEditResult => {
  const { storage, principalId, nowMs } = input;
  const role = command.role ?? 'edit';
  if (role === 'comment' && input.commentEnabled !== true) {
    return namedEditFailure('named-comment-disabled');
  }
  const existing = findRoleInvite((currentRole) =>
    inviteById(storage, currentRole, command.inviteId),
  );
  if (existing) {
    if (
      existing.role !== role ||
      existing.row.email_digest !== command.emailDigest ||
      existing.row.token_hash !== command.tokenHash
    ) {
      return namedEditFailure('conflict');
    }
    return (
      commentProjectionFailure(role, input) ?? {
        ok: true,
        version: 1,
        invite: inviteDto(existing, nowMs),
      }
    );
  }

  const conflictingInvite = roles.some(
    (currentRole) =>
      storage.sql
        .exec(
          `SELECT 1 FROM ${inviteTable(currentRole)}
         WHERE token_hash = ? OR (email_digest = ? AND revoked_at_ms IS NULL
           AND (accepted_principal_id IS NOT NULL OR expires_at_ms > ?))
         LIMIT 1`,
          command.tokenHash,
          command.emailDigest,
          nowMs,
        )
        .toArray().length > 0,
  );
  const inviteCount =
    storage.sql
      .exec<{ count: number }>(
        `SELECT ((SELECT COUNT(*) FROM named_edit_invite_v1) +
        (SELECT COUNT(*) FROM named_comment_invite_v1)) AS count`,
      )
      .toArray()[0]?.count ?? MAX_INVITES;
  if (conflictingInvite || inviteCount >= MAX_INVITES) return namedEditFailure('conflict');

  const projectionFailure = commentProjectionFailure(role, input);
  if (projectionFailure) return projectionFailure;
  const row: InviteRow = {
    invite_id: command.inviteId,
    email_digest: command.emailDigest,
    email_ciphertext: command.emailCiphertext,
    token_hash: command.tokenHash,
    expires_at_ms: nowMs + INVITE_TTL_MS,
    accepted_principal_id: null,
    revoked_at_ms: null,
  };
  storage.sql.exec(
    `INSERT INTO ${inviteTable(role)}
       (invite_id, email_digest, email_ciphertext, token_hash, expires_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
    row.invite_id,
    row.email_digest,
    row.email_ciphertext,
    row.token_hash,
    row.expires_at_ms,
  );
  audit(storage, role, 'issued', row.invite_id, principalId, nowMs);
  return { ok: true, version: 1, invite: inviteDto({ role, row }, nowMs) };
};

const readInvites = (storage: DurableObjectStorage, includeComment: boolean, nowMs: number) => {
  if (!includeComment) {
    // Older web runtimes strictly parse the original Edit-only inventory.
    return storage.sql
      .exec<InviteRow>('SELECT * FROM named_edit_invite_v1 ORDER BY rowid DESC')
      .toArray()
      .map((row) => inviteDto({ role: 'edit', row }, nowMs));
  }
  return storage.sql
    .exec<InviteRow & { role: NamedInviteRole }>(
      `SELECT *, 'edit' AS role, rowid AS order_in_role FROM named_edit_invite_v1
       UNION ALL
       SELECT *, 'comment' AS role, rowid AS order_in_role FROM named_comment_invite_v1
       ORDER BY expires_at_ms DESC, order_in_role DESC, role ASC`,
    )
    .toArray()
    .map((row) => inviteDto({ role: row.role, row }, nowMs));
};

const revokeInvite = (
  storage: DurableObjectStorage,
  command: Extract<NamedEditCommand, { action: 'revoke' }>,
  principalId: string,
  nowMs: number,
): NamedEditResult => {
  const { inviteId, role = 'edit' } = command;
  const row = inviteById(storage, role, inviteId);
  if (!row) return namedEditFailure('forbidden');
  if (row.revoked_at_ms === null) {
    storage.sql.exec(
      `UPDATE ${inviteTable(role)} SET revoked_at_ms = ? WHERE invite_id = ?`,
      nowMs,
      inviteId,
    );
    audit(storage, role, 'revoked', inviteId, principalId, nowMs);
    row.revoked_at_ms = nowMs;
  }
  return { ok: true, version: 1, invite: inviteDto({ role, row }, nowMs) };
};

const resolveMembership = (
  storage: DurableObjectStorage,
  command: Extract<NamedEditCommand, { action: 'session' }>,
  principalId: string,
  nowMs: number,
) => {
  const current = findRoleInvite((role) => member(storage, role, principalId));
  const { tokenHash } = command;
  if (tokenHash === null) return current;
  const candidate = findRoleInvite(
    (role) =>
      storage.sql
        .exec<InviteRow>(
          `SELECT * FROM ${inviteTable(role)} WHERE token_hash = ? AND revoked_at_ms IS NULL`,
          tokenHash,
        )
        .toArray()[0],
  );
  if (!candidate || (candidate.role === 'comment' && current?.role === 'edit')) return undefined;
  const { row } = candidate;
  if (row.accepted_principal_id !== null) {
    return row.accepted_principal_id === principalId ? candidate : undefined;
  }
  return !current && row.expires_at_ms > nowMs && row.email_digest === command.emailDigest
    ? candidate
    : undefined;
};

const randomBearer = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');

const actorForPrincipal = async (roomId: string, principalId: string) => {
  const identity = encoder.encode(`lash-named-editor:v1\0${roomId}\0${principalId}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', identity));
  const actorSuffix = Array.from(digest.subarray(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  );
  return `named-${actorSuffix.join('')}`;
};

type ExecuteInput = {
  storage: DurableObjectStorage;
  command: NamedEditCommand;
  principalId: string;
  roomId: string;
  requestId: string;
  nowMs: number;
  commentEnabled?: boolean;
  commentProjectionAvailable?: () => boolean;
};

const isSessionRateLimited = (storage: DurableObjectStorage, principalId: string) => {
  const roomRequests = storage.sql
    .exec<{
      count: number;
    }>("SELECT COUNT(*) AS count FROM named_edit_replay_v1 WHERE action = 'session'")
    .toArray()[0]?.count;
  const accountRequests = storage.sql
    .exec<{
      count: number;
    }>(
      "SELECT COUNT(*) AS count FROM named_edit_replay_v1 WHERE action = 'session' AND principal_id = ?",
      principalId,
    )
    .toArray()[0]?.count;
  return (
    (roomRequests ?? 0) >= MAX_SESSION_REQUESTS_PER_ROOM ||
    (accountRequests ?? 0) >= MAX_SESSION_REQUESTS_PER_ACCOUNT
  );
};

export const executeNamedEdit = async (input: ExecuteInput): Promise<NamedEditResult> => {
  const { storage, command, principalId, roomId, requestId, nowMs } = input;
  const ticket = command.action === 'session' ? randomBearer() : '';
  const [ticketHash, actorId] = ticket
    ? await Promise.all([
        sha256Base64Url(encoder.encode(ticket)),
        actorForPrincipal(roomId, principalId),
      ])
    : ['', ''];
  return storage.transactionSync(() => {
    const access = authority(storage, roomId);
    if (!access) return namedEditFailure('forbidden');
    const isOwner = access.owner_principal_id === principalId;
    if (command.action === 'session' ? isOwner || access.block_new_sessions !== 0 : !isOwner) {
      return namedEditFailure('forbidden');
    }

    storage.sql.exec('DELETE FROM named_edit_replay_v1 WHERE expires_at_ms <= ?', nowMs);
    if (
      storage.sql
        .exec('SELECT 1 FROM named_edit_replay_v1 WHERE request_id = ?', requestId)
        .toArray().length
    ) {
      return namedEditFailure('conflict');
    }
    if (command.action === 'session' && isSessionRateLimited(storage, principalId)) {
      return namedEditFailure('rate-limited');
    }
    storage.sql.exec(
      'INSERT INTO named_edit_replay_v1 VALUES (?, ?, ?, ?)',
      requestId,
      principalId,
      command.action,
      nowMs + REPLAY_TTL_MS,
    );

    switch (command.action) {
      case 'issue':
        return issueInvite(input, command);
      case 'list':
        return {
          ok: true,
          version: 1,
          invites: readInvites(storage, command.includeComment === true, nowMs),
        };
      case 'revoke':
        return revokeInvite(storage, command, principalId, nowMs);
      case 'session': {
        const invitation = resolveMembership(storage, command, principalId, nowMs);
        if (!invitation) return namedEditFailure('forbidden');
        const { role, row } = invitation;
        const projectionFailure = commentProjectionFailure(role, input);
        if (projectionFailure) return projectionFailure;
        if (row.accepted_principal_id === null) {
          storage.sql.exec(
            `UPDATE ${inviteTable(role)} SET accepted_principal_id = ? WHERE invite_id = ?`,
            principalId,
            row.invite_id,
          );
          audit(storage, role, 'accepted', row.invite_id, principalId, nowMs);
        }
        const expiresAtMs = nowMs + TICKET_TTL_MS;
        storage.sql.exec(`DELETE FROM ${ticketTable(role)} WHERE expires_at_ms <= ?`, nowMs);
        storage.sql.exec(
          `INSERT INTO ${ticketTable(role)}
           (token_hash, invite_id, actor_id, browser_origin, expires_at_ms) VALUES (?, ?, ?, ?, ?)`,
          ticketHash,
          row.invite_id,
          actorId,
          command.browserOrigin,
          expiresAtMs,
        );
        const session = {
          source: 'named' as const,
          roomId,
          actorId,
          expiresAt: new Date(expiresAtMs).toISOString(),
        };
        return {
          ok: true,
          version: 1,
          session:
            role === 'comment'
              ? {
                  ...session,
                  role,
                  protocolVersion: NAMED_COMMENT_PROTOCOL_VERSION,
                  capabilities: NAMED_COMMENT_CAPABILITIES,
                  socketProtocol: NAMED_COMMENT_SOCKET_PROTOCOL,
                  ticketProtocol: `lash-named-comment-ticket.${ticket}`,
                }
              : {
                  ...session,
                  role,
                  protocolVersion: NAMED_EDIT_PROTOCOL_VERSION,
                  capabilities: NAMED_EDIT_CAPABILITIES,
                  socketProtocol: NAMED_EDIT_SOCKET_PROTOCOL,
                  ticketProtocol: `lash-named-ticket.${ticket}`,
                },
        };
      }
    }
  });
};

type GrantInput = {
  storage: DurableObjectStorage;
  roomId: string;
  grant: NamedEditGrant;
  nowMs: number;
};

const isCurrentNamedGrant = (role: NamedInviteRole, input: GrantInput) => {
  const { storage, roomId, grant, nowMs } = input;
  if (grant.expiresAtMs <= nowMs || !authority(storage, roomId)) return false;
  const invite = inviteById(storage, role, grant.inviteId);
  if (!invite || invite.revoked_at_ms !== null || invite.accepted_principal_id === null) {
    return false;
  }
  // An older v5 Worker may issue Edit while rolled back and unaware of Comment.
  // Prefer existing Edit authority if that creates overlapping memberships.
  return role === 'edit' || !member(storage, 'edit', invite.accepted_principal_id);
};

export const isCurrentNamedEditGrant = (input: GrantInput) => isCurrentNamedGrant('edit', input);
export const isCurrentNamedCommentGrant = (input: GrantInput) =>
  isCurrentNamedGrant('comment', input);

type ConsumeInput = {
  storage: DurableObjectStorage;
  roomId: string;
  actorId: string;
  browserOrigin: string;
  token: string;
  nowMs: number;
};

const consumeNamedTicket = async (role: NamedInviteRole, input: ConsumeInput) => {
  const { storage, roomId, actorId, browserOrigin, nowMs } = input;
  const tokenHash = await sha256Base64Url(encoder.encode(input.token));
  return storage.transactionSync(() => {
    const ticket = storage.sql
      .exec<TicketRow>(`SELECT * FROM ${ticketTable(role)} WHERE token_hash = ?`, tokenHash)
      .toArray()[0];
    if (
      !ticket ||
      ticket.expires_at_ms <= nowMs ||
      ticket.actor_id !== actorId ||
      ticket.browser_origin !== browserOrigin ||
      ticket.consumed_at_ms !== null ||
      authority(storage, roomId)?.block_new_sessions !== 0
    ) {
      return null;
    }
    const grant = { inviteId: ticket.invite_id, expiresAtMs: nowMs + SESSION_TTL_MS };
    if (!isCurrentNamedGrant(role, { storage, roomId, grant, nowMs })) return null;
    storage.sql.exec(
      `UPDATE ${ticketTable(role)} SET consumed_at_ms = ? WHERE token_hash = ?`,
      nowMs,
      tokenHash,
    );
    return grant;
  });
};

export const consumeNamedEditTicket = (input: ConsumeInput): Promise<NamedEditGrant | null> =>
  consumeNamedTicket('edit', input);
export const consumeNamedCommentTicket = (input: ConsumeInput): Promise<NamedCommentGrant | null> =>
  consumeNamedTicket('comment', input);
