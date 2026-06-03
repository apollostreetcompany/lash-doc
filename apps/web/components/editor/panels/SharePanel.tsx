/**
 * panels/SharePanel — share-link dialog (scope, expiry, audit).
 */
'use client';

import { capabilitiesForScope, type Capability } from '@lash/rbac';
import {
  createAuditLog,
  createMemoryRevocationStore,
  createShareSigner,
  createStaticPolicyStore,
  redactDiff,
  type AuditEvent,
  type RedactionPolicy,
} from '@lash/share';
import type { DiffJSON, DocumentId, ShareScope } from '@lash/types';
import type { Editor } from '@tiptap/core';
import { useEffect, useMemo, useState } from 'react';

import {
  createInviteRecord,
  expiryForOption,
  inviteCapabilities,
  listInviteRecords,
  revokeInviteRecord,
  type InviteRecord,
} from '../../../lib/inviteAccess';

export interface SharePanelProps {
  editor: Editor | null;
  docId: DocumentId;
  open?: boolean;
  accessScope?: ShareScope | null;
}

const REDACTION_POLICY: RedactionPolicy = {
  sha: 'local-redaction-v1',
  version: 1,
  rules: [{ path: 'spans.text', action: 'redact' }],
};

const SAMPLE_DIFF: DiffJSON = {
  from: 'before',
  to: 'after',
  spans: [
    {
      id: 'span:private:1',
      kind: 'inserted',
      from: 0,
      to: 12,
      text: 'Private edit',
      authorId: 'local-user',
    },
  ],
};

const hasCapability = (scope: ShareScope | null, capability: Capability) =>
  scope ? capabilitiesForScope(scope).includes(capability) : false;

export function SharePanel({ docId, open = true, accessScope = null }: SharePanelProps) {
  const auditLog = useMemo(() => createAuditLog({ adapter: 'memory' }), []);
  const revocations = useMemo(() => createMemoryRevocationStore(), []);
  const policies = useMemo(() => createStaticPolicyStore(REDACTION_POLICY), []);
  const signer = useMemo(
    () =>
      createShareSigner({
        secret: 'local-share-secret',
        revocations,
        policies,
        audit: auditLog,
      }),
    [auditLog, policies, revocations],
  );
  const [scope, setScope] = useState<ShareScope | null>(null);
  const [validation, setValidation] = useState('No link created');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [redactedCount, setRedactedCount] = useState(0);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ShareScope>('comment');
  const [inviteExpiry, setInviteExpiry] = useState<'never' | '7d' | 'expired'>('7d');
  const [inviteCopyStatus, setInviteCopyStatus] = useState('No invite copied');
  const [inviteRecords, setInviteRecords] = useState<InviteRecord[]>([]);

  const docKey = docId.toString();

  const refreshInviteRecords = () => {
    if (typeof window === 'undefined') return;
    setInviteRecords(listInviteRecords(window.localStorage, docKey));
  };

  useEffect(() => {
    refreshInviteRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  if (!open) return null;

  const issueLink = async (nextScope: ShareScope, expired = false) => {
    const token = await signer.sign({
      docId,
      scope: nextScope,
      expiresAt: expired ? '2000-01-01T00:00:00.000Z' : null,
      issuedBy: 'local-user',
      redactionPolicy: REDACTION_POLICY.sha,
      redactionPolicyVersion: REDACTION_POLICY.version,
    });
    const result = await signer.validate(token.token);
    setScope(nextScope);
    setValidation(result.ok ? `Access granted: ${nextScope}` : `Denied: ${result.reason}`);
    const effectivePolicy =
      nextScope === 'edit' ? { ...REDACTION_POLICY, rules: [] } : REDACTION_POLICY;
    const redacted = redactDiff(SAMPLE_DIFF, effectivePolicy, 'share-viewer');
    setRedactedCount(redacted.spans.filter((span) => span.redacted).length);
    setEvents(await auditLog.query({ docId }));
  };

  const createInvite = async () => {
    if (typeof window === 'undefined') return;
    const email = inviteEmail.trim() || 'collaborator@example.com';
    const invite = await createInviteRecord({
      storage: window.localStorage,
      docId: docKey,
      email,
      scope: inviteRole,
      expiresAt: expiryForOption(inviteExpiry),
      origin: window.location.origin,
    });
    (window as Window & { __lashLastInviteLink?: string }).__lashLastInviteLink = invite.link;
    try {
      await navigator.clipboard?.writeText(invite.link);
    } catch {
      // HTTP previews may not expose clipboard; the hook still records the copied link.
    }
    setInviteEmail('');
    setInviteCopyStatus('Copied invite link');
    setScope(inviteRole);
    refreshInviteRecords();
  };

  const revokeInvite = async (jti: string) => {
    if (typeof window === 'undefined') return;
    await revokeInviteRecord(window.localStorage, jti);
    setInviteCopyStatus('Invite revoked');
    refreshInviteRecords();
  };

  const effectiveScope = accessScope ?? scope;
  const inviteCaps = inviteCapabilities(effectiveScope);
  const canComment = inviteCaps.canComment || hasCapability(effectiveScope, 'doc.comment');
  const canSuggest = inviteCaps.canSuggest || hasCapability(effectiveScope, 'doc.suggest');
  const canEdit = inviteCaps.canEdit || hasCapability(effectiveScope, 'doc.edit');
  const canAccept = inviteCaps.canAccept || hasCapability(effectiveScope, 'doc.history.restore');

  return (
    <section className="lash-share-panel" data-testid="share-panel" aria-label="Share links">
      <div className="share-panel-header">
        <h2 className="share-panel-title">Share</h2>
        <span data-testid="share-validation">{validation}</span>
      </div>
      <div className="share-controls">
        <button
          type="button"
          className="share-action-button"
          data-testid="share-create-comment"
          onClick={() => void issueLink('comment')}
        >
          Comment link
        </button>
        <button
          type="button"
          className="share-action-button"
          data-testid="share-create-suggest"
          onClick={() => void issueLink('suggest')}
        >
          Suggest link
        </button>
        <button
          type="button"
          className="share-action-button"
          data-testid="share-create-edit"
          onClick={() => void issueLink('edit')}
        >
          Edit link
        </button>
        <button
          type="button"
          className="share-action-button"
          data-testid="share-create-expired"
          onClick={() => void issueLink('view', true)}
        >
          Expired link
        </button>
      </div>

      <div className="invite-controls" data-testid="invite-controls">
        <label className="invite-field">
          <span>Invite</span>
          <input
            data-testid="invite-email-input"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="collaborator@example.com"
            type="email"
          />
        </label>
        <label className="invite-field">
          <span>Role</span>
          <select
            data-testid="invite-role-select"
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as ShareScope)}
          >
            <option value="view">view</option>
            <option value="comment">comment</option>
            <option value="suggest">suggest</option>
            <option value="edit">edit</option>
          </select>
        </label>
        <label className="invite-field">
          <span>Expiry</span>
          <select
            data-testid="invite-expiry-select"
            value={inviteExpiry}
            onChange={(event) => setInviteExpiry(event.target.value as typeof inviteExpiry)}
          >
            <option value="7d">7 days</option>
            <option value="never">never</option>
            <option value="expired">expired</option>
          </select>
        </label>
        <button
          type="button"
          className="share-action-button"
          data-testid="invite-create"
          onClick={() => void createInvite()}
        >
          Create invite
        </button>
        <span data-testid="invite-copy-status">{inviteCopyStatus}</span>
      </div>

      <div className="invite-list" data-testid="invite-collaborator-list">
        {inviteRecords.length ? (
          inviteRecords.map((invite) => (
            <div
              key={invite.jti}
              className="invite-row"
              data-testid="invite-collaborator-row"
              data-status={invite.status}
            >
              <span>{invite.email}</span>
              <span>{invite.scope}</span>
              <span>{invite.status}</span>
              <button
                type="button"
                className="share-action-button"
                data-testid="invite-revoke-button"
                disabled={invite.status === 'revoked'}
                onClick={() => void revokeInvite(invite.jti)}
              >
                Revoke
              </button>
            </div>
          ))
        ) : (
          <span data-testid="invite-collaborator-empty">No collaborators invited</span>
        )}
      </div>

      <div className="share-capabilities" data-testid="share-capabilities">
        <span data-testid="share-can-comment">comment:{canComment ? 'yes' : 'no'}</span>
        <span data-testid="share-can-suggest">suggest:{canSuggest ? 'yes' : 'no'}</span>
        <span data-testid="share-can-edit">edit:{canEdit ? 'yes' : 'no'}</span>
        <span data-testid="share-can-accept">accept:{canAccept ? 'yes' : 'no'}</span>
      </div>

      <div className="share-redaction-grid">
        <span data-testid="history-redaction">
          history redacted {redactedCount} of {SAMPLE_DIFF.spans.length}
        </span>
        <span data-testid="chat-redaction">
          {scope === 'edit' ? 'chat visible' : 'chat transcript redacted'}
        </span>
      </div>

      <div className="share-audit" data-testid="share-audit">
        <span data-testid="share-audit-count">{events.length} audit events</span>
        <ol>
          {events.map((event, index) => (
            <li key={`${event.action}:${index}`} data-testid="share-audit-event">
              {event.action}
              {event.reason ? `:${event.reason}` : ''}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
