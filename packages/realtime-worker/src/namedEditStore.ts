import {
  NAMED_EDIT_CAPABILITIES,
  NAMED_EDIT_PROTOCOL_VERSION,
  NAMED_EDIT_SOCKET_PROTOCOL,
  namedEditFailure,
  type NamedEditCommand,
  type NamedEditInvite,
  type NamedEditResult,
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

export const initializeNamedEditStorage = (storage: DurableObjectStorage) => {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS named_edit_invite_v1 (
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
    CREATE UNIQUE INDEX IF NOT EXISTS named_edit_active_member_v1
    ON named_edit_invite_v1(accepted_principal_id)
    WHERE accepted_principal_id IS NOT NULL AND revoked_at_ms IS NULL
  `);
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS named_edit_ticket_v1 (
      token_hash TEXT PRIMARY KEY,
      invite_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      browser_origin TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      consumed_at_ms INTEGER
    )
  `);
  storage.sql.exec(`
    CREATE INDEX IF NOT EXISTS named_edit_ticket_expiry_v1
    ON named_edit_ticket_v1(expires_at_ms)
  `);
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
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS named_edit_audit_v1 (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      invite_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      at_ms INTEGER NOT NULL
    )
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

const inviteById = (storage: DurableObjectStorage, inviteId: string) =>
  storage.sql
    .exec<InviteRow>('SELECT * FROM named_edit_invite_v1 WHERE invite_id = ?', inviteId)
    .toArray()[0];

const member = (storage: DurableObjectStorage, principalId: string) =>
  storage.sql
    .exec<InviteRow>(
      `SELECT * FROM named_edit_invite_v1
       WHERE accepted_principal_id = ? AND revoked_at_ms IS NULL`,
      principalId,
    )
    .toArray()[0];

const audit = (
  storage: DurableObjectStorage,
  event: 'issued' | 'accepted' | 'revoked',
  inviteId: string,
  principalId: string,
  nowMs: number,
) => {
  storage.sql.exec(
    'INSERT INTO named_edit_audit_v1 (event, invite_id, principal_id, at_ms) VALUES (?, ?, ?, ?)',
    event,
    inviteId,
    principalId,
    nowMs,
  );
};

const inviteDto = (row: InviteRow, nowMs: number): NamedEditInvite => {
  let status: NamedEditInvite['status'] = 'pending';
  if (row.revoked_at_ms !== null) status = 'revoked';
  else if (row.accepted_principal_id !== null) status = 'accepted';
  else if (row.expires_at_ms <= nowMs) status = 'expired';
  return {
    inviteId: row.invite_id,
    emailCiphertext: row.email_ciphertext,
    expiresAt: new Date(row.expires_at_ms).toISOString(),
    role: 'edit',
    status,
  };
};

const issueInvite = (
  storage: DurableObjectStorage,
  command: Extract<NamedEditCommand, { action: 'issue' }>,
  principalId: string,
  nowMs: number,
): NamedEditResult => {
  const existing = inviteById(storage, command.inviteId);
  if (existing) {
    if (
      existing.email_digest !== command.emailDigest ||
      existing.token_hash !== command.tokenHash
    ) {
      return namedEditFailure('conflict');
    }
    return { ok: true, version: 1, invite: inviteDto(existing, nowMs) };
  }
  const conflictingInvite = storage.sql
    .exec(
      `SELECT 1 FROM named_edit_invite_v1
       WHERE token_hash = ? OR (email_digest = ? AND revoked_at_ms IS NULL
         AND (accepted_principal_id IS NOT NULL OR expires_at_ms > ?))
       LIMIT 1`,
      command.tokenHash,
      command.emailDigest,
      nowMs,
    )
    .toArray().length;
  const inviteCount =
    storage.sql
      .exec<{ count: number }>('SELECT COUNT(*) AS count FROM named_edit_invite_v1')
      .toArray()[0]?.count ?? MAX_INVITES;
  if (conflictingInvite || inviteCount >= MAX_INVITES) return namedEditFailure('conflict');

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
    `INSERT INTO named_edit_invite_v1
       (invite_id, email_digest, email_ciphertext, token_hash, expires_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
    row.invite_id,
    row.email_digest,
    row.email_ciphertext,
    row.token_hash,
    row.expires_at_ms,
  );
  audit(storage, 'issued', row.invite_id, principalId, nowMs);
  return { ok: true, version: 1, invite: inviteDto(row, nowMs) };
};

const revokeInvite = (
  storage: DurableObjectStorage,
  inviteId: string,
  principalId: string,
  nowMs: number,
): NamedEditResult => {
  const row = inviteById(storage, inviteId);
  if (!row) return namedEditFailure('forbidden');
  if (row.revoked_at_ms === null) {
    storage.sql.exec(
      'UPDATE named_edit_invite_v1 SET revoked_at_ms = ? WHERE invite_id = ?',
      nowMs,
      inviteId,
    );
    audit(storage, 'revoked', inviteId, principalId, nowMs);
    row.revoked_at_ms = nowMs;
  }
  return { ok: true, version: 1, invite: inviteDto(row, nowMs) };
};

const resolveMembership = (
  storage: DurableObjectStorage,
  command: Extract<NamedEditCommand, { action: 'session' }>,
  principalId: string,
  nowMs: number,
) => {
  const current = member(storage, principalId);
  if (command.tokenHash === null) return current;
  const invite = storage.sql
    .exec<InviteRow>(
      'SELECT * FROM named_edit_invite_v1 WHERE token_hash = ? AND revoked_at_ms IS NULL',
      command.tokenHash,
    )
    .toArray()[0];
  if (!invite) return undefined;
  if (invite.accepted_principal_id !== null) {
    return invite.accepted_principal_id === principalId ? invite : undefined;
  }
  if (current || invite.expires_at_ms <= nowMs || invite.email_digest !== command.emailDigest) {
    return undefined;
  }
  storage.sql.exec(
    'UPDATE named_edit_invite_v1 SET accepted_principal_id = ? WHERE invite_id = ?',
    principalId,
    invite.invite_id,
  );
  audit(storage, 'accepted', invite.invite_id, principalId, nowMs);
  return invite;
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
        return issueInvite(storage, command, principalId, nowMs);
      case 'list':
        return {
          ok: true,
          version: 1,
          invites: storage.sql
            .exec<InviteRow>('SELECT * FROM named_edit_invite_v1 ORDER BY rowid DESC')
            .toArray()
            .map((row) => inviteDto(row, nowMs)),
        };
      case 'revoke':
        return revokeInvite(storage, command.inviteId, principalId, nowMs);
      case 'session': {
        const invite = resolveMembership(storage, command, principalId, nowMs);
        if (!invite) return namedEditFailure('forbidden');
        const expiresAtMs = nowMs + TICKET_TTL_MS;
        storage.sql.exec('DELETE FROM named_edit_ticket_v1 WHERE expires_at_ms <= ?', nowMs);
        storage.sql.exec(
          `INSERT INTO named_edit_ticket_v1
           (token_hash, invite_id, actor_id, browser_origin, expires_at_ms) VALUES (?, ?, ?, ?, ?)`,
          ticketHash,
          invite.invite_id,
          actorId,
          command.browserOrigin,
          expiresAtMs,
        );
        return {
          ok: true,
          version: 1,
          session: {
            source: 'named',
            role: 'edit',
            protocolVersion: NAMED_EDIT_PROTOCOL_VERSION,
            roomId,
            actorId,
            capabilities: NAMED_EDIT_CAPABILITIES,
            socketProtocol: NAMED_EDIT_SOCKET_PROTOCOL,
            ticketProtocol: `lash-named-ticket.${ticket}`,
            expiresAt: new Date(expiresAtMs).toISOString(),
          },
        };
      }
    }
  });
};

export const isCurrentNamedEditGrant = (input: {
  storage: DurableObjectStorage;
  roomId: string;
  grant: NamedEditGrant;
  nowMs: number;
}) => {
  if (input.grant.expiresAtMs <= input.nowMs || !authority(input.storage, input.roomId))
    return false;
  const invite = inviteById(input.storage, input.grant.inviteId);
  return !!invite && invite.revoked_at_ms === null && invite.accepted_principal_id !== null;
};

export const consumeNamedEditTicket = async (input: {
  storage: DurableObjectStorage;
  roomId: string;
  actorId: string;
  browserOrigin: string;
  token: string;
  nowMs: number;
}): Promise<NamedEditGrant | null> => {
  const { storage, roomId, actorId, browserOrigin, nowMs } = input;
  const tokenHash = await sha256Base64Url(encoder.encode(input.token));
  return storage.transactionSync(() => {
    const ticket = storage.sql
      .exec<TicketRow>('SELECT * FROM named_edit_ticket_v1 WHERE token_hash = ?', tokenHash)
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
    if (!isCurrentNamedEditGrant({ storage, roomId, grant, nowMs })) return null;
    storage.sql.exec(
      'UPDATE named_edit_ticket_v1 SET consumed_at_ms = ? WHERE token_hash = ?',
      nowMs,
      tokenHash,
    );
    return grant;
  });
};
