import { describe, expect, it } from 'vitest';

import {
  createRealtimeGrantFromInviteToken,
  createRealtimeGrantForScope,
  createRealtimeSessionToken,
  realtimeCapabilitiesForScope,
  verifyRealtimeInviteToken,
  verifyRealtimeSessionToken,
} from '../../../realtime-worker/src/access';
import { parseRealtimeRoute } from '../../../realtime-worker/src/routing';
import {
  createAuditLog,
  createMemoryRevocationStore,
  createShareSigner,
  createStaticPolicyStore,
} from '../../../share/src';
import { createDocumentId } from '../../../types/src';

const secret = 'unit-test-secret';
const inviteSecret = 'unit-test-invite-secret';
const now = '2026-06-03T17:45:00.000Z';
const redactionPolicy = {
  sha: 'unit-redaction-policy',
  version: 1,
  rules: [{ path: 'spans.text', action: 'redact' as const }],
};

const createInvite = async (
  scope: 'view' | 'comment' | 'suggest' | 'edit',
  expiresAt: string | null = '2026-06-03T18:45:00.000Z',
) => {
  const signer = createShareSigner({
    secret: inviteSecret,
    revocations: createMemoryRevocationStore(),
    policies: createStaticPolicyStore(redactionPolicy),
    audit: createAuditLog({ adapter: 'memory' }),
    now: () => now,
  });
  return signer.sign({
    docId: createDocumentId('doc-alpha'),
    scope,
    expiresAt,
    issuedBy: 'owner',
    redactionPolicy: redactionPolicy.sha,
    redactionPolicyVersion: redactionPolicy.version,
  });
};

describe('realtime actor access boundary', () => {
  it('parses the room session endpoint without exposing room access', () => {
    expect(
      parseRealtimeRoute(new URL('https://lash.test/api/realtime/rooms/Doc Alpha/session')),
    ).toEqual({
      kind: 'room-session',
      roomId: 'doc-alpha',
    });
  });

  it('accepts only signed actor grants for the matching document and capability', async () => {
    const token = await createRealtimeSessionToken(
      {
        actorId: 'actor-a',
        documentId: 'doc-alpha',
        capabilities: ['doc.read', 'doc.edit'],
        issuedAt: now,
        expiresAt: '2026-06-03T18:45:00.000Z',
      },
      secret,
    );

    await expect(
      verifyRealtimeSessionToken(token, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        grant: expect.objectContaining({ actorId: 'actor-a', documentId: 'doc-alpha' }),
      }),
    );

    await expect(
      verifyRealtimeSessionToken(token, secret, {
        documentId: 'doc-beta',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'document-mismatch' });

    await expect(
      verifyRealtimeSessionToken(`${token.slice(0, -2)}xx`, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('denies expired grants and grants without the required capability', async () => {
    const readOnly = await createRealtimeSessionToken(
      {
        actorId: 'actor-readonly',
        documentId: 'doc-alpha',
        capabilities: ['doc.read'],
        issuedAt: now,
        expiresAt: '2026-06-03T18:45:00.000Z',
      },
      secret,
    );
    const expired = await createRealtimeSessionToken(
      {
        actorId: 'actor-expired',
        documentId: 'doc-alpha',
        capabilities: ['doc.read', 'doc.edit'],
        issuedAt: '2026-06-03T16:00:00.000Z',
        expiresAt: '2026-06-03T17:00:00.000Z',
      },
      secret,
    );

    await expect(
      verifyRealtimeSessionToken(readOnly, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'scope-mismatch' });

    await expect(
      verifyRealtimeSessionToken(expired, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'expired' });
  });

  it('maps invite scopes to realtime grants without over-granting view links', async () => {
    expect(realtimeCapabilitiesForScope('view')).toEqual(['doc.read']);
    expect(realtimeCapabilitiesForScope('comment')).toEqual(['doc.read', 'doc.edit']);
    expect(realtimeCapabilitiesForScope('suggest')).toEqual(['doc.read', 'doc.edit']);
    expect(realtimeCapabilitiesForScope('edit')).toEqual(['doc.read', 'doc.edit']);

    const grant = createRealtimeGrantForScope(
      'Grace Editor',
      'doc-alpha',
      'view',
      new Date('2026-06-03T17:45:00.000Z'),
    );
    expect(grant).toMatchObject({
      actorId: 'grace-editor',
      documentId: 'doc-alpha',
      scope: 'view',
      capabilities: ['doc.read'],
    });

    const token = await createRealtimeSessionToken(grant, secret);
    await expect(
      verifyRealtimeSessionToken(token, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.read',
        now,
      }),
    ).resolves.toMatchObject({ ok: true, grant: expect.objectContaining({ scope: 'view' }) });
    await expect(
      verifyRealtimeSessionToken(token, secret, {
        documentId: 'doc-alpha',
        capability: 'doc.edit',
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'scope-mismatch' });
  });

  it('exchanges a valid invite token for a scope-matched realtime grant', async () => {
    const invite = await createInvite('edit');

    await expect(
      verifyRealtimeInviteToken(invite.token, inviteSecret, {
        documentId: 'doc-alpha',
        now,
      }),
    ).resolves.toMatchObject({
      ok: true,
      token: expect.objectContaining({ docId: 'doc-alpha', scope: 'edit' }),
    });

    await expect(
      createRealtimeGrantFromInviteToken(
        'Invited Editor',
        'doc-alpha',
        invite.token,
        inviteSecret,
        {
          now,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      grant: expect.objectContaining({
        actorId: 'invited-editor',
        documentId: 'doc-alpha',
        scope: 'edit',
        capabilities: ['doc.read', 'doc.edit'],
      }),
    });
  });

  it('denies invalid, expired, revoked, and wrong-document invite exchanges', async () => {
    const invite = await createInvite('comment');
    const expired = await createInvite('edit', '2026-06-03T17:00:00.000Z');

    await expect(
      createRealtimeGrantFromInviteToken(
        'Invited Editor',
        'doc-alpha',
        `${invite.token.slice(0, -2)}xx`,
        inviteSecret,
        { now },
      ),
    ).resolves.toEqual({ ok: false, reason: 'invalid' });

    await expect(
      createRealtimeGrantFromInviteToken(
        'Invited Editor',
        'doc-alpha',
        expired.token,
        inviteSecret,
        { now },
      ),
    ).resolves.toEqual({ ok: false, reason: 'expired' });

    await expect(
      createRealtimeGrantFromInviteToken(
        'Invited Editor',
        'doc-alpha',
        invite.token,
        inviteSecret,
        {
          now,
          isRevoked: (jti) => jti === invite.jti,
        },
      ),
    ).resolves.toEqual({ ok: false, reason: 'revoked' });

    await expect(
      createRealtimeGrantFromInviteToken('Invited Editor', 'doc-beta', invite.token, inviteSecret, {
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: 'document-mismatch' });
  });
});
