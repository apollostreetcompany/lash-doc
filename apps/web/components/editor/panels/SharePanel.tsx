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
import { useEffect, useMemo, useRef, useState } from 'react';

import type { InviteIssuanceTicket } from '../../../lib/documentAccess';
import {
  createInviteRecord,
  expiryForOption,
  inviteCapabilities,
  listInviteRecords,
  revokeInviteRecord,
  type InviteRecord,
} from '../../../lib/inviteAccess';
import type { RealtimeRuntimeMode } from '../../../lib/realtimeCollaboration';

export interface SharePanelProps {
  editor: Editor | null;
  docId: DocumentId;
  open?: boolean;
  accessScope?: ShareScope | null;
  authorized: boolean;
  hydrated: boolean;
  canIssueInvites: boolean;
  canMutateDocument: boolean;
  runtimeMode: RealtimeRuntimeMode;
  allowsInviteIssuance(ticket: InviteIssuanceTicket | null): boolean;
  captureInviteIssuance(): InviteIssuanceTicket | null;
  exposeInviteTestHook?: boolean;
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

export const runtimeShareCapabilities = (scope: ShareScope | null, canMutateDocument: boolean) => {
  if (!canMutateDocument) {
    return { canAccept: false, canComment: false, canEdit: false, canSuggest: false };
  }
  const inviteCaps = inviteCapabilities(scope);
  return {
    canComment: inviteCaps.canComment || hasCapability(scope, 'doc.comment'),
    canSuggest: inviteCaps.canSuggest || hasCapability(scope, 'doc.suggest'),
    canEdit: inviteCaps.canEdit || hasCapability(scope, 'doc.edit'),
    canAccept: inviteCaps.canAccept || hasCapability(scope, 'doc.history.restore'),
  };
};

function DevelopmentSharePanel({
  docId,
  open = true,
  accessScope = null,
  allowsInviteIssuance,
  canIssueInvites,
  canMutateDocument,
  captureInviteIssuance,
  exposeInviteTestHook = false,
}: SharePanelProps) {
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
  const mountedRef = useRef(true);

  const docKey = docId.toString();
  const ticketIsCurrent = (ticket: InviteIssuanceTicket | null) =>
    mountedRef.current && allowsInviteIssuance(ticket);

  const refreshInviteRecords = () => {
    if (typeof window === 'undefined') return;
    try {
      setInviteRecords(listInviteRecords(window.localStorage, docKey));
    } catch {
      setInviteRecords([]);
    }
  };

  useEffect(() => {
    refreshInviteRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (!open) return null;

  const issueLink = async (nextScope: ShareScope, expired = false) => {
    const issuanceTicket = captureInviteIssuance();
    if (!ticketIsCurrent(issuanceTicket)) return;
    const token = await signer.sign({
      docId,
      scope: nextScope,
      expiresAt: expired ? '2000-01-01T00:00:00.000Z' : null,
      issuedBy: 'local-user',
      redactionPolicy: REDACTION_POLICY.sha,
      redactionPolicyVersion: REDACTION_POLICY.version,
    });
    if (!ticketIsCurrent(issuanceTicket)) return;
    const result = await signer.validate(token.token);
    if (!ticketIsCurrent(issuanceTicket)) return;
    const effectivePolicy =
      nextScope === 'edit' ? { ...REDACTION_POLICY, rules: [] } : REDACTION_POLICY;
    const redacted = redactDiff(SAMPLE_DIFF, effectivePolicy, 'share-viewer');
    const nextEvents = await auditLog.query({ docId });
    if (!ticketIsCurrent(issuanceTicket)) return;
    setScope(nextScope);
    setValidation(result.ok ? `Access granted: ${nextScope}` : `Denied: ${result.reason}`);
    setRedactedCount(redacted.spans.filter((span) => span.redacted).length);
    setEvents(nextEvents);
  };

  const createInvite = async () => {
    if (typeof window === 'undefined') return;
    const issuanceTicket = captureInviteIssuance();
    if (!ticketIsCurrent(issuanceTicket)) return;
    const email = inviteEmail.trim() || 'collaborator@example.com';
    const result = await createInviteRecord(
      {
        storage: window.localStorage,
        docId: docKey,
        email,
        scope: inviteRole,
        expiresAt: expiryForOption(inviteExpiry),
        origin: window.location.origin,
        authority: 'development-loopback',
      },
      {
        commitGuard: () => ticketIsCurrent(issuanceTicket),
      },
    );
    if (!result.ok || !ticketIsCurrent(issuanceTicket)) return;
    const invite = result.record;
    try {
      if (!ticketIsCurrent(issuanceTicket)) return;
      await navigator.clipboard?.writeText(invite.link);
    } catch {
      // HTTP previews may not expose clipboard; the hook still records the copied link.
    }
    if (!ticketIsCurrent(issuanceTicket)) return;
    if (exposeInviteTestHook) {
      (window as Window & { __lashLastInviteLink?: string }).__lashLastInviteLink = invite.link;
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
  const { canAccept, canComment, canEdit, canSuggest } = runtimeShareCapabilities(
    effectiveScope,
    canMutateDocument,
  );

  return (
    <section className="lash-share-panel" data-testid="share-panel" aria-label="Share links">
      <div className="share-panel-header">
        <h2 className="share-panel-title">Share</h2>
        <span data-testid="share-validation">{validation}</span>
      </div>
      {!canMutateDocument && accessScope ? (
        <p role="status" data-testid="share-mutation-unavailable">
          {accessScope === 'comment' || accessScope === 'suggest'
            ? `${accessScope === 'comment' ? 'Comment' : 'Suggest'} access is read-only in this runtime; commenting and suggesting are unavailable.`
            : 'This shared access is read-only in this runtime.'}
        </p>
      ) : null}
      {canIssueInvites ? (
        <>
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
        </>
      ) : null}

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

export function SharePanel({
  open = true,
  allowsInviteIssuance,
  authorized,
  canIssueInvites,
  captureInviteIssuance,
  hydrated,
  runtimeMode,
  ...developmentProps
}: SharePanelProps) {
  const issuanceAuthorized =
    runtimeMode === 'development-loopback' && authorized && hydrated && canIssueInvites;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const clearInviteTestBearer = () => {
      delete (window as Window & { __lashLastInviteLink?: string }).__lashLastInviteLink;
    };
    if (!issuanceAuthorized) clearInviteTestBearer();
    return clearInviteTestBearer;
  }, [issuanceAuthorized]);

  if (!open) return null;
  if (runtimeMode === 'development-loopback' && authorized && hydrated) {
    return (
      <DevelopmentSharePanel
        {...developmentProps}
        allowsInviteIssuance={allowsInviteIssuance}
        authorized={authorized}
        canIssueInvites={issuanceAuthorized}
        captureInviteIssuance={captureInviteIssuance}
        hydrated={hydrated}
        runtimeMode={runtimeMode}
        open={open}
      />
    );
  }

  return (
    <section className="lash-share-panel" data-testid="share-panel" aria-label="Share links">
      <div className="share-panel-header">
        <h2 className="share-panel-title">Share</h2>
        <span data-testid="share-runtime-label">
          {runtimeMode === 'configured' ? 'Transport configured' : 'Local only'}
        </span>
      </div>
      <div className="invite-list" data-testid="share-unavailable">
        <h3 data-testid="share-unavailable-heading">Sharing is not available on this build</h3>
        <p data-testid="share-unavailable-detail">
          {runtimeMode === 'configured'
            ? 'The collaboration transport is configured, but this build has no authoritative invite service. No collaborator link can be created here yet.'
            : 'This document is stored in this browser profile, and no collaborator link can carry it yet. You can keep writing here.'}
        </p>
      </div>
    </section>
  );
}
