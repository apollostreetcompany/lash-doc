import { capabilitiesForScope, createPolicyEngine } from '@lash/rbac';
import {
  createAuditLog,
  createMemoryRevocationStore,
  createShareSigner,
  createStaticPolicyStore,
  redactDiff,
  type RedactionPolicy,
} from '@lash/share';
import { createDocumentId, type DiffJSON } from '@lash/types';
import { describe, expect, it } from 'vitest';

const policy: RedactionPolicy = {
  sha: 'test-redaction',
  version: 1,
  rules: [{ path: 'spans.text', action: 'redact' }],
};

describe('share/RBAC', () => {
  it('maps scopes to least-privilege capabilities', () => {
    expect(capabilitiesForScope('comment')).toContain('doc.comment');
    expect(capabilitiesForScope('comment')).toContain('doc.suggest');
    expect(capabilitiesForScope('comment')).not.toContain('doc.edit');
    expect(capabilitiesForScope('edit')).toContain('doc.history.restore');
  });

  it('signs, validates, expires, and audits share links', async () => {
    const docId = createDocumentId('share-test');
    const audit = createAuditLog({ adapter: 'memory' });
    const signer = createShareSigner({
      secret: 'test-secret',
      revocations: createMemoryRevocationStore(),
      policies: createStaticPolicyStore(policy),
      audit,
      now: () => '2026-05-16T00:00:00.000Z',
    });

    const token = await signer.sign({
      docId,
      scope: 'comment',
      expiresAt: null,
      issuedBy: 'local-user',
      redactionPolicy: policy.sha,
      redactionPolicyVersion: policy.version,
    });
    await expect(signer.validate(token.token)).resolves.toMatchObject({ ok: true });

    const expired = await signer.sign({
      docId,
      scope: 'view',
      expiresAt: '2000-01-01T00:00:00.000Z',
      issuedBy: 'local-user',
      redactionPolicy: policy.sha,
      redactionPolicyVersion: policy.version,
    });
    await expect(signer.validate(expired.token)).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
    await expect(audit.query({ docId })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'share-link.created' }),
        expect.objectContaining({ action: 'share-link.access' }),
        expect.objectContaining({ action: 'share-link.expired' }),
      ]),
    );
  });

  it('enforces share-link scope decisions and redacts diff spans', async () => {
    const docId = createDocumentId('rbac-test');
    const audit = createAuditLog({ adapter: 'memory' });
    const revocations = createMemoryRevocationStore();
    const signer = createShareSigner({
      secret: 'test-secret',
      revocations,
      policies: createStaticPolicyStore(policy),
      audit,
    });
    const shareToken = await signer.sign({
      docId,
      scope: 'comment',
      expiresAt: null,
      issuedBy: 'local-user',
      redactionPolicy: policy.sha,
      redactionPolicyVersion: policy.version,
    });
    const engine = createPolicyEngine({
      revocations,
      visibility: { canSee: async () => true },
    });

    await expect(
      engine.decide(
        { type: 'share-link', token: shareToken },
        'doc.comment',
        { kind: 'doc', id: docId },
        { now: '2026-05-16T00:00:00.000Z' },
      ),
    ).resolves.toEqual({ allow: true });
    await expect(
      engine.decide(
        { type: 'share-link', token: shareToken },
        'doc.edit',
        { kind: 'doc', id: docId },
        { now: '2026-05-16T00:00:00.000Z' },
      ),
    ).resolves.toEqual({ allow: false, reason: 'scope-mismatch' });

    const diff: DiffJSON = {
      from: 'a',
      to: 'b',
      spans: [{ id: '1', kind: 'inserted', from: 0, to: 5, text: 'secret' }],
    };
    expect(redactDiff(diff, policy, 'viewer').spans[0]).toMatchObject({
      redacted: true,
      text: '[redacted]',
    });
  });
});
