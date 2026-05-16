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
import { useMemo, useState } from 'react';

export interface SharePanelProps {
  editor: Editor | null;
  docId: DocumentId;
  open?: boolean;
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

export function SharePanel({ docId, open = true }: SharePanelProps) {
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

  const canComment = hasCapability(scope, 'doc.comment');
  const canSuggest = hasCapability(scope, 'doc.suggest');
  const canEdit = hasCapability(scope, 'doc.edit');
  const canAccept = hasCapability(scope, 'doc.history.restore');

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
