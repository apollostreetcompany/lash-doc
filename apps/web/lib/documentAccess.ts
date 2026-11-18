import { normalizeYProsemirrorProjectionJson } from '@lash/editor-core';
import { canonicalize, type ShareScope } from '@lash/types';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';

import {
  createDocumentMutationAuthority,
  type DocumentMutationAuthority,
} from './documentMutationAuthority';
import type {
  BrowserDocumentPromotionAttempt,
  BrowserPromotionReceipt,
  BrowserPromotionResult,
} from './documentPromotion/browserClient';
import {
  clearLegacyInviteCredential,
  clearRoomInviteCredentials,
  readInviteFragmentCredential,
  readValidatedInviteCredential,
  scrubInviteFragment,
  validateInviteAccess,
  writeValidatedInviteCredential,
  type InviteAccess,
  type InviteFragmentCredential,
  type ValidatedInviteCredential,
} from './inviteAccess';
import { requestNamedEditSession } from './namedEdit/browserClient';
import { NAMED_EDIT_ROOM_ID } from './namedEdit/contract';
import {
  createAuthorizedRealtimeResources,
  createOwnerCandidateResources,
  exchangeRealtimeSession,
  getOrCreateLocalActorId,
  readRealtimeDocumentTitle,
  RealtimeProviderStartError,
  selectBrowserRealtimeRuntime,
  type AuthorizedRealtimeSession,
  type AuthorizedRealtimeResources,
  type OwnerRealtimeCandidateResources,
  type OwnerRealtimeSessionV3,
  type RealtimeConnectionState,
  type RealtimeRuntimeMode,
  type RealtimeRuntimeSelection,
  type RealtimeRecoveryReason,
  type RealtimeRecoverySeal,
  type RealtimeSessionExchangeInput,
  type RealtimeSessionExchangeResult,
  type RealtimeSyncState,
  type RealtimeUnsyncedRecoverySnapshot,
} from './realtimeCollaboration';
import {
  createRealtimeRecoveryJournal,
  type RealtimeRecoveryJournal,
} from './realtimeRecoveryJournal';

export type DocumentAccessPhase =
  | 'checking'
  | 'local-ready'
  | 'authorizing'
  | 'remote-authorized'
  | 'remote-hydrating'
  | 'remote-ready'
  | 'recovery-available'
  | 'recovery-blocked'
  | 'denied'
  | 'unavailable'
  | 'destroyed';

export type DocumentAccessReason =
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'document-mismatch'
  | 'scope-mismatch'
  | 'unsupported-scope'
  | 'invite-authority-unavailable'
  | 'protocol-error'
  | 'transient-exhausted'
  | 'sign-in-required'
  | 'fragment-scrub-failed'
  | 'recovery-storage-unavailable'
  | 'lifecycle'
  | 'unavailable';

export type DocumentAccessSnapshot = {
  phase: DocumentAccessPhase;
  runtimeMode: RealtimeRuntimeMode;
  transportConfigured: boolean;
  hasIncomingInvite: boolean;
  authorized: boolean;
  hydrated: boolean;
  canIssueInvites: boolean;
  canWrite: boolean;
  authoritativeOwner: boolean;
  scope: ShareScope | null;
  connectionState:
    | RealtimeConnectionState
    | 'authorizing'
    | 'ready'
    | 'denied'
    | 'unavailable'
    | 'destroyed';
  syncState: RealtimeSyncState | 'checking-access' | 'denied' | 'unavailable';
  reason: DocumentAccessReason | null;
  retryable: boolean;
  attempt: number;
  recoveryExportAvailable: boolean;
  recoveryUpdateCount: number;
};

export type LocalDocumentAccessResolution = {
  authority: DocumentMutationAuthority;
  /** @deprecated Use routeDocumentId for route/local persistence identity. */
  documentId: string;
  kind: 'local';
  routeDocumentId: string;
  runtime: RealtimeRuntimeSelection;
};

export type RemoteDocumentAccessResolution = AuthorizedRealtimeResources & {
  authority: DocumentMutationAuthority;
  /** @deprecated Use routeDocumentId for route/local persistence identity. */
  documentId: string;
  kind: 'remote';
  remoteDocumentId: string;
  routeDocumentId: string;
  runtime: Exclude<RealtimeRuntimeSelection, { mode: 'disabled' }>;
};

export type DocumentAccessResolution =
  | LocalDocumentAccessResolution
  | RemoteDocumentAccessResolution;

export type InviteIssuanceTicket = Readonly<{
  authoritativeOwner: true;
  controllerGeneration: number;
  /** @deprecated Use routeDocumentId for route/local persistence identity. */
  documentId: string;
  issuanceEpoch: number;
  remoteDocumentId: string;
  routeDocumentId: string;
  scope: ShareScope;
}>;

type InviteIssuanceEligibility = Readonly<
  | {
      allowed: false;
      authoritativeOwner: false;
      issuanceEpoch: number;
      scope: null;
    }
  | {
      allowed: true;
      authoritativeOwner: true;
      issuanceEpoch: number;
      scope: 'edit';
    }
>;

export type DocumentAccessDependencies = {
  clearLegacyCredential(documentId: string): void;
  clearRoomCredentials(documentId: string): void;
  createOwnerResources(
    session: OwnerRealtimeSessionV3,
    options: {
      authority: DocumentMutationAuthority;
      refreshOwnerSession(
        routeDocumentId: string,
        signal: AbortSignal,
      ): Promise<OwnerRealtimeSessionV3>;
    },
  ): OwnerRealtimeCandidateResources;
  createResources: typeof createAuthorizedRealtimeResources;
  delay(milliseconds: number, signal: AbortSignal): Promise<void>;
  exchangeSession(input: RealtimeSessionExchangeInput): Promise<RealtimeSessionExchangeResult>;
  fetcher: typeof fetch;
  getActorId(): string;
  installRecoveryNavigationWarning(): () => void;
  navigateHome(): void;
  readFragmentCredential(): InviteFragmentCredential;
  readRuntime(): RealtimeRuntimeSelection;
  recoveryJournal: RealtimeRecoveryJournal | null;
  readStoredCredential(documentId: string): ValidatedInviteCredential | null;
  requestOwnerSession(input: OwnerSessionRequestInput): Promise<OwnerSessionRequestResult>;
  requestNamedSession?: typeof requestNamedEditSession;
  scrubInviteFragment(): boolean;
  validateDevelopmentInvite(documentId: string, token: string): Promise<InviteAccess | null>;
  writeValidatedCredential(credential: ValidatedInviteCredential): void;
};

export type DocumentAccessController = {
  allowsInviteIssuance(ticket: InviteIssuanceTicket | null): boolean;
  captureInviteIssuance(): InviteIssuanceTicket | null;
  clearCredentialAndNavigate(): DestroyResult;
  discardBlockedRealtimeRecovery(confirmationId: string): boolean;
  discardRealtimeRecovery(): boolean;
  destroy(): DestroyResult;
  disconnectForTest(): void;
  getResolution(): DocumentAccessResolution | null;
  getSnapshot(): DocumentAccessSnapshot;
  getMutationAuthority(): DocumentMutationAuthority;
  promoteOwnerDocument(attempt: BrowserDocumentPromotionAttempt): Promise<OwnerCutoverResult>;
  exportRealtimeRecovery(): string | null;
  reconnectForTest(): void;
  retry(): Promise<void>;
  start(): Promise<void>;
  subscribe(listener: (snapshot: DocumentAccessSnapshot) => void): () => void;
};

export type DestroyResult =
  | { ok: true; disposition: 'empty' | 'verified-receipt' }
  | { ok: false; disposition: 'recovery-blocked'; updateCount: number };

export type OwnerSessionRequestInput = Readonly<{
  actorId: string;
  routeDocumentId: string;
  signal: AbortSignal;
}>;

export type OwnerSessionRequestResult =
  | Readonly<{ ok: true; session: OwnerRealtimeSessionV3 }>
  | Readonly<{
      ok: false;
      reason:
        | 'aborted'
        | 'document-unavailable'
        | 'invalid-request'
        | 'invalid-response'
        | 'network-error'
        | 'temporarily-unavailable'
        | 'unauthenticated';
      retryable: boolean;
    }>;

export type OwnerCutoverResult =
  | Readonly<{
      ok: true;
      routeDocumentId: string;
      remoteDocumentId: string;
    }>
  | Readonly<{
      ok: false;
      reason:
        | 'aborted'
        | 'candidate-failed'
        | 'cutover-in-progress'
        | 'integrity-mismatch'
        | 'not-local-ready'
        | 'owner-session-failed'
        | 'owner-session-invalid';
      retryable: boolean;
    }>
  | Readonly<{
      ok: false;
      reason: 'promotion-failed';
      retryable: boolean;
      promotion: Exclude<BrowserPromotionResult, { ok: true }>;
    }>;

const retryDelays = [0, 250, 1_000] as const;
const retainedBlockedRecoveryControllers = new Map<string, Set<BrowserDocumentAccessController>>();

export const createInitialDocumentAccessSnapshot = (): DocumentAccessSnapshot => ({
  phase: 'checking',
  runtimeMode: 'disabled',
  transportConfigured: false,
  hasIncomingInvite: false,
  authorized: false,
  hydrated: false,
  canIssueInvites: false,
  canWrite: false,
  authoritativeOwner: false,
  scope: null,
  connectionState: 'disabled',
  syncState: 'checking-access',
  reason: null,
  retryable: false,
  attempt: 0,
  recoveryExportAvailable: false,
  recoveryUpdateCount: 0,
});

const asAccessReason = (reason: Extract<InviteAccess, { ok: false }>['reason']) =>
  reason === 'unavailable' ? ('unavailable' as const) : reason;

const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

const OWNER_SESSION_RESPONSE_BYTES = 16 * 1024;
const OWNER_ROUTE_DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const OWNER_REMOTE_DOCUMENT_ID = /^doc-v(?:0|[1-9][0-9]{0,7})-[0-9a-f]{64}$/u;
const OWNER_SNAPSHOT_SHA256 = /^[A-Za-z0-9_-]{43}$/u;
const OWNER_ACTOR_ID = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/u;
const OWNER_TICKET_PROTOCOL = /^lash-ticket\.[A-Za-z0-9_-]{43}$/u;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const hasExactOwnerSocketUrl = (raw: string, remoteDocumentId: string, actorId: string) => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const query = [...url.searchParams.entries()];
  return (
    (url.protocol === 'wss:' || url.protocol === 'ws:') &&
    url.username === '' &&
    url.password === '' &&
    url.hash === '' &&
    url.pathname === `/api/realtime/rooms/${remoteDocumentId}/socket` &&
    query.length === 2 &&
    query[0]?.[0] === 'protocolVersion' &&
    query[0]?.[1] === '3' &&
    query[1]?.[0] === 'actorId' &&
    query[1]?.[1] === actorId
  );
};

const isExactOwnerRealtimeSession = (
  value: unknown,
  expected: {
    actorId: string;
    routeDocumentId: string;
    remoteDocumentId?: string;
    promotionSnapshotSha256?: string;
  },
): value is OwnerRealtimeSessionV3 => {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'protocolVersion',
      'source',
      'routeDocumentId',
      'remoteDocumentId',
      'promotionSnapshotSha256',
      'actorId',
      'capabilities',
      'socketUrl',
      'socketProtocol',
      'ticketProtocol',
      'expiresAt',
    ]) ||
    value.protocolVersion !== 3 ||
    value.source !== 'owner' ||
    value.routeDocumentId !== expected.routeDocumentId ||
    value.actorId !== expected.actorId ||
    !OWNER_ACTOR_ID.test(value.actorId) ||
    typeof value.remoteDocumentId !== 'string' ||
    !OWNER_REMOTE_DOCUMENT_ID.test(value.remoteDocumentId) ||
    (expected.remoteDocumentId !== undefined &&
      value.remoteDocumentId !== expected.remoteDocumentId) ||
    typeof value.promotionSnapshotSha256 !== 'string' ||
    !OWNER_SNAPSHOT_SHA256.test(value.promotionSnapshotSha256) ||
    (expected.promotionSnapshotSha256 !== undefined &&
      value.promotionSnapshotSha256 !== expected.promotionSnapshotSha256) ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length !== 2 ||
    value.capabilities[0] !== 'doc.read' ||
    value.capabilities[1] !== 'doc.edit' ||
    value.socketProtocol !== 'lash-realtime-v3' ||
    typeof value.ticketProtocol !== 'string' ||
    !OWNER_TICKET_PROTOCOL.test(value.ticketProtocol) ||
    typeof value.socketUrl !== 'string' ||
    !hasExactOwnerSocketUrl(value.socketUrl, value.remoteDocumentId, value.actorId) ||
    typeof value.expiresAt !== 'string'
  ) {
    return false;
  }
  const expiresAt = Date.parse(value.expiresAt);
  return (
    Number.isFinite(expiresAt) &&
    new Date(expiresAt).toISOString() === value.expiresAt &&
    expiresAt > Date.now()
  );
};

const readBoundedOwnerSessionResponse = async (response: Response) => {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > OWNER_SESSION_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return null;
  }
};

const ownerSessionFailure = (
  reason: Extract<OwnerSessionRequestResult, { ok: false }>['reason'],
  retryable: boolean,
): OwnerSessionRequestResult => ({ ok: false, reason, retryable });

const requestBrowserOwnerSessionOnce = async (
  input: OwnerSessionRequestInput & { fetcher?: typeof fetch },
): Promise<OwnerSessionRequestResult> => {
  if (
    input.signal.aborted ||
    !OWNER_ROUTE_DOCUMENT_ID.test(input.routeDocumentId) ||
    !OWNER_ACTOR_ID.test(input.actorId)
  ) {
    return ownerSessionFailure(input.signal.aborted ? 'aborted' : 'invalid-request', false);
  }
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(
      `/api/documents/${input.routeDocumentId}/owner-session`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, actorId: input.actorId }),
        signal: input.signal,
      },
    );
  } catch (error) {
    return input.signal.aborted || isAbortError(error)
      ? ownerSessionFailure('aborted', false)
      : ownerSessionFailure('network-error', true);
  }
  if (input.signal.aborted) return ownerSessionFailure('aborted', false);
  const declaredLength = response.headers.get('content-length');
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (
    mediaType !== 'application/json' ||
    (declaredLength !== null &&
      (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
        Number(declaredLength) > OWNER_SESSION_RESPONSE_BYTES))
  ) {
    return ownerSessionFailure('invalid-response', false);
  }
  const raw = await readBoundedOwnerSessionResponse(response);
  if (raw === null) return ownerSessionFailure('invalid-response', false);
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return ownerSessionFailure('invalid-response', false);
  }
  if (!isPlainObject(value) || value.version !== 1 || typeof value.ok !== 'boolean') {
    return ownerSessionFailure('invalid-response', false);
  }
  if (value.ok) {
    if (
      response.status !== 200 ||
      !hasExactKeys(value, [
        'ok',
        'version',
        'localDocumentId',
        'remoteDocumentId',
        'promotionSnapshotSha256',
        'access',
        'socket',
      ]) ||
      value.localDocumentId !== input.routeDocumentId ||
      !isPlainObject(value.access) ||
      !hasExactKeys(value.access, ['source', 'capabilities', 'protocolVersion']) ||
      value.access.source !== 'owner' ||
      value.access.protocolVersion !== 3 ||
      !Array.isArray(value.access.capabilities) ||
      value.access.capabilities.length !== 2 ||
      value.access.capabilities[0] !== 'doc.read' ||
      value.access.capabilities[1] !== 'doc.edit' ||
      !isPlainObject(value.socket) ||
      !hasExactKeys(value.socket, ['url', 'protocol', 'ticketProtocol', 'expiresAt'])
    ) {
      return ownerSessionFailure('invalid-response', false);
    }
    const session: unknown = {
      protocolVersion: 3,
      source: 'owner',
      routeDocumentId: value.localDocumentId,
      remoteDocumentId: value.remoteDocumentId,
      promotionSnapshotSha256: value.promotionSnapshotSha256,
      actorId: input.actorId,
      capabilities: value.access.capabilities,
      socketUrl: value.socket.url,
      socketProtocol: value.socket.protocol,
      ticketProtocol: value.socket.ticketProtocol,
      expiresAt: value.socket.expiresAt,
    };
    return isExactOwnerRealtimeSession(session, {
      actorId: input.actorId,
      routeDocumentId: input.routeDocumentId,
    })
      ? { ok: true, session }
      : ownerSessionFailure('invalid-response', false);
  }
  if (
    !hasExactKeys(value, ['ok', 'version', 'error', 'retryable']) ||
    typeof value.error !== 'string' ||
    typeof value.retryable !== 'boolean'
  ) {
    return ownerSessionFailure('invalid-response', false);
  }
  const expected: Record<string, { retryable: boolean; statuses: readonly number[] }> = {
    'invalid-request': { retryable: false, statuses: [400, 403] },
    unauthenticated: { retryable: false, statuses: [401] },
    'document-unavailable': { retryable: false, statuses: [404, 503] },
    'temporarily-unavailable': { retryable: true, statuses: [503] },
  };
  const failure = expected[value.error];
  return failure &&
    failure.retryable === value.retryable &&
    failure.statuses.includes(response.status)
    ? ownerSessionFailure(
        value.error as Extract<OwnerSessionRequestResult, { ok: false }>['reason'],
        failure.retryable,
      )
    : ownerSessionFailure('invalid-response', false);
};

export const requestBrowserOwnerSession = async (
  input: OwnerSessionRequestInput & {
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<OwnerSessionRequestResult> => {
  if (input.signal.aborted) return ownerSessionFailure('aborted', false);
  const requestController = new AbortController();
  let timedOut = false;
  let rejectBoundary!: (reason: unknown) => void;
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
  });
  const abort = () => {
    requestController.abort();
    rejectBoundary(new DOMException('Owner session request aborted.', 'AbortError'));
  };
  input.signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    requestController.abort();
    rejectBoundary(new Error('Owner session request deadline elapsed.'));
  }, input.timeoutMs ?? 8_000);
  try {
    const result = await Promise.race([
      requestBrowserOwnerSessionOnce({
        ...input,
        signal: requestController.signal,
      }),
      boundary,
    ]);
    if (timedOut) return ownerSessionFailure('network-error', true);
    return input.signal.aborted ? ownerSessionFailure('aborted', false) : result;
  } catch {
    return timedOut
      ? ownerSessionFailure('network-error', true)
      : ownerSessionFailure('aborted', false);
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener('abort', abort);
  }
};

const isExactPromotionReceipt = (value: unknown): value is BrowserPromotionReceipt => {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['version', 'title', 'body', 'snapshotSha256', 'room']) ||
    value.version !== 1 ||
    typeof value.title !== 'string' ||
    typeof value.snapshotSha256 !== 'string' ||
    !OWNER_SNAPSHOT_SHA256.test(value.snapshotSha256) ||
    !isPlainObject(value.room) ||
    !hasExactKeys(value.room, [
      'roomId',
      'aclVersion',
      'publicPolicy',
      'publicPolicyVersion',
      'created',
    ]) ||
    typeof value.room.roomId !== 'string' ||
    !OWNER_REMOTE_DOCUMENT_ID.test(value.room.roomId) ||
    value.room.aclVersion !== 1 ||
    value.room.publicPolicy !== 'restricted' ||
    value.room.publicPolicyVersion !== 1 ||
    typeof value.room.created !== 'boolean'
  ) {
    return false;
  }
  try {
    canonicalize(value.body);
    return true;
  } catch {
    return false;
  }
};

const resolveInviteIssuanceScope = ({
  canWrite,
  runtimeMode,
  session,
  usedIncomingInviteCredential,
}: {
  canWrite: boolean;
  runtimeMode: RealtimeRuntimeMode;
  session: AuthorizedRealtimeSession;
  usedIncomingInviteCredential: boolean;
}): 'edit' | null =>
  runtimeMode === 'development-loopback' &&
  !usedIncomingInviteCredential &&
  session.inviteRequired === false &&
  session.capabilities.includes('doc.read') &&
  canWrite &&
  (session.scope === null || session.scope === 'edit')
    ? 'edit'
    : null;

class BrowserDocumentAccessController implements DocumentAccessController {
  private readonly documentId: string;
  private readonly dependencies: DocumentAccessDependencies;
  private readonly authority: DocumentMutationAuthority;
  private readonly listeners = new Set<(snapshot: DocumentAccessSnapshot) => void>();
  private snapshot = createInitialDocumentAccessSnapshot();
  private resolution: DocumentAccessResolution | null = null;
  private resources: AuthorizedRealtimeResources | null = null;
  private unsubscribeProvider: (() => void) | null = null;
  private credential: string | null = null;
  private credentialAuthority: 'configured' | 'development-loopback' | null = null;
  private expectedScope: ShareScope | null = null;
  private abortController: AbortController | null = null;
  private generation = 0;
  private startPromise: Promise<void> | null = null;
  private ownerCutoverAbortController: AbortController | null = null;
  private ownerCutoverPromise: Promise<OwnerCutoverResult> | null = null;
  private ownerCutoverKind: 'promotion' | 'reopen' | null = null;
  private destroyed = false;
  private recoveryKey: string | null = null;
  private recoverySeal: RealtimeRecoverySeal | null = null;
  private recoverySnapshot: RealtimeUnsyncedRecoverySnapshot | null = null;
  private recoveryBlocked = false;
  private removeRecoveryNavigationWarning: (() => void) | null = null;
  private fragmentDecision: InviteFragmentCredential | null = null;
  private fragmentCaptured = false;
  private fragmentScrubbed = false;
  private lastDestroyResult: DestroyResult | null = null;
  private inviteIssuanceEligibility: InviteIssuanceEligibility = {
    allowed: false,
    authoritativeOwner: false,
    issuanceEpoch: 0,
    scope: null,
  };

  constructor(documentId: string, dependencies: DocumentAccessDependencies) {
    this.documentId = documentId;
    this.dependencies = dependencies;
    this.authority = createDocumentMutationAuthority(documentId);
    this.authority.subscribe((snapshot) => {
      if (snapshot.phase !== 'ready-edit') this.revokeInviteIssuance();
    });
  }

  getSnapshot() {
    return this.snapshot;
  }

  getResolution() {
    return this.resolution;
  }

  getMutationAuthority() {
    return this.authority;
  }

  promoteOwnerDocument(
    attempt: BrowserDocumentPromotionAttempt,
  ): Promise<OwnerCutoverResult> {
    if (this.ownerCutoverPromise) {
      const activeCutover = this.ownerCutoverPromise;
      return this.ownerCutoverKind === 'reopen'
        ? activeCutover.then((result) =>
            result.ok ? result : this.promoteOwnerDocument(attempt),
          )
        : activeCutover;
    }
    if (
      this.destroyed ||
      this.snapshot.phase !== 'local-ready' ||
      this.resolution?.kind !== 'local' ||
      this.resolution.routeDocumentId !== this.documentId
    ) {
      return Promise.resolve<OwnerCutoverResult>({
        ok: false,
        reason: 'not-local-ready',
        retryable: false,
      });
    }
    if (!this.authority.freezeForOwnerCutover()) {
      return Promise.resolve<OwnerCutoverResult>({
        ok: false,
        reason: 'not-local-ready',
        retryable: false,
      });
    }
    const abortController = new AbortController();
    this.ownerCutoverAbortController = abortController;
    const promise = this.runOwnerPromotion(attempt, abortController.signal).finally(() => {
      if (this.ownerCutoverAbortController === abortController) {
        this.ownerCutoverAbortController = null;
      }
      if (this.ownerCutoverPromise === promise) {
        this.ownerCutoverPromise = null;
        this.ownerCutoverKind = null;
      }
    });
    this.ownerCutoverPromise = promise;
    this.ownerCutoverKind = 'promotion';
    return promise;
  }

  captureInviteIssuance(): InviteIssuanceTicket | null {
    const eligibility = this.inviteIssuanceEligibility;
    if (
      !eligibility.allowed ||
      !this.snapshot.canIssueInvites ||
      !this.snapshot.authoritativeOwner ||
      this.snapshot.phase !== 'remote-ready' ||
      this.authority.getSnapshot().phase !== 'ready-edit' ||
      this.resolution?.kind !== 'remote'
    ) {
      return null;
    }
    return {
      authoritativeOwner: true,
      controllerGeneration: this.generation,
      documentId: this.documentId,
      issuanceEpoch: eligibility.issuanceEpoch,
      remoteDocumentId: this.resolution.remoteDocumentId,
      routeDocumentId: this.documentId,
      scope: eligibility.scope,
    };
  }

  allowsInviteIssuance(ticket: InviteIssuanceTicket | null) {
    const eligibility = this.inviteIssuanceEligibility;
    if (
      !ticket ||
      !eligibility.allowed ||
      !this.snapshot.canIssueInvites ||
      !this.snapshot.authoritativeOwner ||
      this.snapshot.phase !== 'remote-ready' ||
      this.authority.getSnapshot().phase !== 'ready-edit'
    ) {
      return false;
    }
    return (
      ticket.authoritativeOwner === true &&
      ticket.controllerGeneration === this.generation &&
      ticket.documentId === this.documentId &&
      ticket.issuanceEpoch === eligibility.issuanceEpoch &&
      this.resolution?.kind === 'remote' &&
      ticket.remoteDocumentId === this.resolution.remoteDocumentId &&
      ticket.routeDocumentId === this.documentId &&
      ticket.scope === eligibility.scope
    );
  }

  exportRealtimeRecovery() {
    const recovery = this.recoverySnapshot;
    if (!recovery) return null;
    return JSON.stringify(
      {
        version:
          recovery.routeDocumentId !== undefined && recovery.remoteDocumentId !== undefined ? 3 : 2,
        baselineStateVector: [...recovery.baselineStateVector],
        documentId: recovery.documentId,
        epoch: recovery.authorityEpoch,
        principalId: recovery.principalId,
        reason: recovery.reason,
        ...(recovery.remoteDocumentId !== undefined
          ? { remoteDocumentId: recovery.remoteDocumentId }
          : {}),
        ...(recovery.routeDocumentId !== undefined
          ? { routeDocumentId: recovery.routeDocumentId }
          : {}),
        sealedAt: recovery.sealedAt,
        scope: recovery.scope,
        updates: recovery.updates.map(({ bytes, updateId }) => ({
          bytes: [...bytes],
          updateId,
        })),
      },
      null,
      2,
    );
  }

  discardRealtimeRecovery() {
    if (
      this.snapshot.phase !== 'recovery-available' ||
      !this.recoverySnapshot ||
      !this.recoveryKey ||
      !this.dependencies.recoveryJournal ||
      !this.dependencies.recoveryJournal.discard(this.recoveryKey)
    ) {
      return false;
    }
    const namedActorId = NAMED_EDIT_ROOM_ID.test(this.documentId)
      ? this.recoverySnapshot.principalId
      : undefined;
    this.recoveryKey = null;
    this.recoverySeal = null;
    this.recoverySnapshot = null;
    this.recoveryBlocked = false;
    this.releaseBlockedRecoveryRetention();
    this.clearRecoveryNavigationWarning();
    const recovery = this.restoreVerifiedRecoveryReceipt(namedActorId);
    if (recovery === 'restored') return true;
    if (recovery === 'unavailable') {
      this.failUnavailable('recovery-storage-unavailable', true);
      return true;
    }
    this.publishDenied(this.snapshot.reason ?? 'unavailable');
    return true;
  }

  discardBlockedRealtimeRecovery(confirmationId: string) {
    if (
      this.snapshot.phase !== 'recovery-blocked' ||
      !confirmationId ||
      !this.resources ||
      !this.recoverySeal ||
      !this.resources.provider.discardSealedRecovery(this.recoverySeal, {
        kind: 'explicit-user-discard',
        confirmationId,
      })
    ) {
      return false;
    }
    const resources = this.resources;
    this.resources = null;
    this.resolution = null;
    resources.doc.destroy();
    this.recoverySeal = null;
    this.recoverySnapshot = null;
    this.recoveryBlocked = false;
    this.releaseBlockedRecoveryRetention();
    this.clearRecoveryNavigationWarning();
    this.publishDenied(this.snapshot.reason ?? 'lifecycle');
    return true;
  }

  subscribe(listener: (snapshot: DocumentAccessSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start() {
    if (this.startPromise) return this.startPromise;
    if (this.destroyed) return Promise.resolve();
    if (!this.captureAndScrubInviteFragment()) {
      this.authority.revoke();
      this.failUnavailable('fragment-scrub-failed', true);
      this.startPromise = Promise.resolve();
      return this.startPromise;
    }
    // The canonical route always verifies the current account before accessing
    // room data. A previous user's local recovery record is not an access grant.
    if (NAMED_EDIT_ROOM_ID.test(this.documentId)) return this.beginAuthorization();

    const recovery = this.restoreVerifiedRecoveryReceipt();
    if (recovery === 'restored') {
      this.fragmentDecision = null;
      this.credential = null;
      this.credentialAuthority = null;
      this.expectedScope = null;
      this.startPromise = Promise.resolve();
      return this.startPromise;
    }
    if (recovery === 'unavailable') {
      this.authority.revoke();
      this.failUnavailable('recovery-storage-unavailable', true);
      this.startPromise = Promise.resolve();
      return this.startPromise;
    }
    return this.beginAuthorization();
  }

  retry() {
    if (this.destroyed || !this.snapshot.retryable) return Promise.resolve();
    if (this.snapshot.phase === 'local-ready' && this.snapshot.runtimeMode === 'configured') {
      this.abortController?.abort();
      const epoch = ++this.generation;
      const abortController = new AbortController();
      this.abortController = abortController;
      this.publish({
        ...this.snapshot,
        reason: null,
        retryable: false,
      });
      const retrying = this.runOwnerReopen(epoch, abortController.signal).then(() => undefined);
      this.startPromise = retrying;
      return retrying;
    }
    if (
      this.snapshot.reason === 'fragment-scrub-failed' ||
      this.snapshot.reason === 'recovery-storage-unavailable'
    ) {
      this.abortController?.abort();
      const teardown = this.teardownResources('lifecycle');
      if (!teardown.ok) return Promise.resolve();
      this.startPromise = null;
      return this.start();
    }
    if (
      !this.credential &&
      !NAMED_EDIT_ROOM_ID.test(this.documentId) &&
      this.snapshot.runtimeMode !== 'development-loopback'
    ) {
      return Promise.resolve();
    }
    this.abortController?.abort();
    const teardown = this.teardownResources('lifecycle');
    if (!teardown.ok) return Promise.resolve();
    this.startPromise = null;
    return this.beginAuthorization();
  }

  disconnectForTest() {
    if (this.snapshot.phase !== 'remote-ready') return;
    this.resources?.provider.disconnectForTest();
  }

  reconnectForTest() {
    if (this.snapshot.phase !== 'remote-ready') return;
    this.resources?.provider.reconnectForTest();
  }

  clearCredentialAndNavigate(): DestroyResult {
    if (this.destroyed) {
      return this.lastDestroyResult ?? { ok: true, disposition: 'empty' };
    }
    if (
      this.snapshot.phase === 'recovery-blocked' ||
      this.snapshot.phase === 'recovery-available'
    ) {
      return {
        ok: false,
        disposition: 'recovery-blocked',
        updateCount: this.recoverySnapshot?.updates.length ?? this.snapshot.recoveryUpdateCount,
      };
    }
    const result = this.destroy();
    if (!result.ok) return result;
    this.dependencies.clearRoomCredentials(this.documentId);
    this.scrubInviteFragmentOnce();
    this.dependencies.navigateHome();
    return result;
  }

  destroy(): DestroyResult {
    if (this.destroyed) {
      return this.lastDestroyResult ?? { ok: true, disposition: 'empty' };
    }
    if (this.recoveryBlocked) {
      return {
        ok: false,
        disposition: 'recovery-blocked',
        updateCount: this.recoverySnapshot?.updates.length ?? this.snapshot.recoveryUpdateCount,
      };
    }
    const hadResources = this.resources !== null;
    const result = this.teardownResources('lifecycle');
    if (!result.ok) return result;
    this.destroyed = true;
    this.lastDestroyResult = result;
    this.releaseBlockedRecoveryRetention();
    if (!hadResources) this.authority.revoke();
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.ownerCutoverAbortController?.abort();
    this.ownerCutoverAbortController = null;
    this.credential = null;
    this.credentialAuthority = null;
    this.expectedScope = null;
    this.clearRecoveryNavigationWarning();
    this.resolution = null;
    this.publish({
      ...this.snapshot,
      phase: 'destroyed',
      authorized: false,
      hydrated: false,
      canIssueInvites: false,
      canWrite: false,
      authoritativeOwner: false,
      connectionState: 'destroyed',
      syncState: 'unavailable',
      retryable: false,
      recoveryExportAvailable: false,
      recoveryUpdateCount: this.recoverySnapshot?.updates.length ?? 0,
    });
    return result;
  }

  private beginAuthorization() {
    const epoch = ++this.generation;
    const abortController = new AbortController();
    this.abortController = abortController;
    const promise = this.runAuthorization(epoch, abortController.signal).catch((error) => {
      if (this.isCurrent(epoch, abortController.signal) && !isAbortError(error)) {
        if (this.snapshot.phase === 'denied') return;
        const hadResources = this.resources !== null;
        const teardown = this.teardownResources('lifecycle');
        if (!teardown.ok) return;
        if (!hadResources) this.authority.revoke();
        if (error instanceof RealtimeProviderStartError && error.kind === 'transient-exhausted') {
          this.failUnavailable('transient-exhausted', true);
        } else {
          this.failUnavailable('protocol-error', false);
        }
      }
    });
    this.startPromise = promise;
    return promise;
  }

  private async runAuthorization(epoch: number, signal: AbortSignal) {
    const runtime = this.dependencies.readRuntime();
    if (NAMED_EDIT_ROOM_ID.test(this.documentId)) {
      await this.runNamedAuthorization(runtime, epoch, signal);
      return;
    }
    this.dependencies.clearLegacyCredential(this.documentId);
    const fragmentDecision = this.fragmentDecision ?? { state: 'absent' as const };
    this.fragmentDecision = null;
    const fragmentCredential = fragmentDecision.state === 'valid' ? fragmentDecision.token : null;
    const storedCredential = this.dependencies.readStoredCredential(this.documentId);
    if (this.credential === null) {
      this.credential = fragmentCredential ?? storedCredential?.token ?? null;
      this.credentialAuthority = fragmentCredential
        ? runtime.mode === 'development-loopback'
          ? 'development-loopback'
          : 'configured'
        : (storedCredential?.authority ?? null);
    }
    const hasIncomingInvite = fragmentDecision.state !== 'absent' || this.credential !== null;
    this.publish({
      ...createInitialDocumentAccessSnapshot(),
      runtimeMode: runtime.mode,
      transportConfigured: runtime.mode === 'configured',
      hasIncomingInvite,
    });

    if (fragmentDecision.state === 'invalid') {
      this.clearRejectedCredential();
      this.publishDenied('invalid');
      return;
    }

    if (!hasIncomingInvite && (runtime.mode === 'disabled' || runtime.mode === 'configured')) {
      if (!this.isCurrent(epoch, signal)) return;
      this.authority.enterLocalReady();
      this.resolution = {
        authority: this.authority,
        documentId: this.documentId,
        kind: 'local',
        routeDocumentId: this.documentId,
        runtime,
      };
      if (runtime.mode === 'configured') {
        await this.runOwnerReopen(epoch, signal);
        return;
      }
      this.publish({
        ...this.snapshot,
        phase: 'local-ready',
        connectionState: 'disabled',
        syncState: 'disabled',
      });
      return;
    }

    if (runtime.mode === 'disabled') {
      this.clearRejectedCredential();
      this.publishDenied('unavailable');
      return;
    }

    if (runtime.mode === 'development-loopback' && this.credential) {
      const validation = await this.dependencies.validateDevelopmentInvite(
        this.documentId,
        this.credential,
      );
      if (!this.isCurrent(epoch, signal)) return;
      if (!validation || !validation.ok) {
        this.clearRejectedCredential();
        this.publishDenied(asAccessReason(validation?.reason ?? 'invalid'));
        return;
      }
      this.expectedScope = validation.scope;
      this.credential = validation.token;
      this.credentialAuthority = 'development-loopback';
    }

    const actorId = this.dependencies.getActorId();
    let exchangeResult: RealtimeSessionExchangeResult | null = null;
    for (let attemptIndex = 0; attemptIndex < retryDelays.length; attemptIndex += 1) {
      if (attemptIndex > 0) {
        await this.dependencies.delay(retryDelays[attemptIndex], signal);
        if (!this.isCurrent(epoch, signal)) return;
      }
      this.publish({
        ...this.snapshot,
        phase: 'authorizing',
        connectionState: 'authorizing',
        syncState: 'checking-access',
        attempt: attemptIndex + 1,
        reason: null,
        retryable: false,
      });
      exchangeResult = await this.dependencies.exchangeSession({
        actorId,
        inviteToken: this.credential,
        roomId: this.documentId,
        runtime,
        signal,
      });
      if (!this.isCurrent(epoch, signal)) return;
      if (exchangeResult.ok || !exchangeResult.retryable) break;
    }

    if (!exchangeResult || !this.isCurrent(epoch, signal)) return;
    if (!exchangeResult.ok) {
      if (exchangeResult.retryable) {
        this.scrubInviteFragmentOnce();
        this.failUnavailable('transient-exhausted', true);
      } else {
        this.clearRejectedCredential();
        if (exchangeResult.error === 'invite-authority-unavailable') {
          this.failUnavailable(exchangeResult.error, false);
        } else {
          this.publishDenied(
            exchangeResult.error === 'transient' ? 'protocol-error' : exchangeResult.error,
          );
        }
      }
      return;
    }

    const { session } = exchangeResult;
    if (
      session.documentId !== this.documentId ||
      (this.expectedScope !== null && session.scope !== this.expectedScope)
    ) {
      this.clearRejectedCredential();
      this.publishDenied(
        session.documentId !== this.documentId ? 'document-mismatch' : 'scope-mismatch',
      );
      return;
    }

    if (this.credential) {
      // Remove the bearer from browser history before best-effort persistence.
      // A privacy-restricted sessionStorage must not leave the secret in the URL.
      this.scrubInviteFragmentOnce();
      try {
        this.dependencies.writeValidatedCredential({
          version: 1,
          authority: this.credentialAuthority ?? runtime.mode,
          documentId: this.documentId,
          token: this.credential,
          validatedAt: new Date().toISOString(),
        });
      } catch {
        // The authorized in-memory session remains valid for this page.
      }
    }
    const usedIncomingInviteCredential = this.credential !== null;
    const canWrite = session.capabilities.includes('doc.edit');
    const inviteIssuanceScope = resolveInviteIssuanceScope({
      canWrite,
      runtimeMode: runtime.mode,
      session,
      usedIncomingInviteCredential,
    });
    await this.hydrateRemoteDocument({
      roomId: session.documentId,
      scope: session.scope,
      canWrite,
      inviteIssuanceScope,
      runtime,
      createResources: () => this.dependencies.createResources(session, { authority: this.authority }),
      epoch,
      signal,
    });
  }

  private async runNamedAuthorization(
    runtime: RealtimeRuntimeSelection,
    epoch: number,
    signal: AbortSignal,
  ) {
    this.fragmentDecision = null;
    this.publish({
      ...createInitialDocumentAccessSnapshot(),
      phase: 'authorizing',
      runtimeMode: runtime.mode,
      transportConfigured: runtime.mode === 'configured',
      connectionState: 'authorizing',
      attempt: 1,
    });
    if (runtime.mode !== 'configured') {
      this.publishDenied('unavailable');
      return;
    }
    const requestSession = this.dependencies.requestNamedSession ?? requestNamedEditSession;
    const result = await requestSession(this.documentId, signal);
    if (!this.isCurrent(epoch, signal)) return;
    if (!result.ok) {
      if (result.retryable) this.failUnavailable('transient-exhausted', true);
      else this.publishDenied(result.signInRequired ? 'sign-in-required' : 'unavailable');
      return;
    }
    const recovery = this.restoreVerifiedRecoveryReceipt(result.session.actorId);
    if (recovery === 'restored') return;
    if (recovery === 'unavailable') {
      this.failUnavailable('recovery-storage-unavailable', true);
      return;
    }
    const toRealtimeSession = (session: typeof result.session) => ({
      ...session,
      routeDocumentId: session.roomId,
      remoteDocumentId: session.roomId,
    });
    await this.hydrateRemoteDocument({
      roomId: this.documentId,
      scope: 'edit',
      canWrite: true,
      inviteIssuanceScope: null,
      runtime,
      createResources: () => createAuthorizedRealtimeResources(toRealtimeSession(result.session), {
        authority: this.authority,
        refreshOwnerSession: async (roomId, refreshSignal) => {
          const refreshed = await requestSession(roomId, refreshSignal);
          if (!refreshed.ok) {
            throw new RealtimeProviderStartError(
              refreshed.retryable ? 'transient-exhausted' : 'authorization',
              'Could not renew shared document access.',
            );
          }
          return toRealtimeSession(refreshed.session);
        },
      }),
      epoch,
      signal,
    });
  }

  private async hydrateRemoteDocument({
    roomId,
    scope,
    canWrite,
    inviteIssuanceScope,
    runtime,
    createResources,
    epoch,
    signal,
  }: {
    roomId: string;
    scope: ShareScope | null;
    canWrite: boolean;
    inviteIssuanceScope: 'edit' | null;
    runtime: Exclude<RealtimeRuntimeSelection, { mode: 'disabled' }>;
    createResources: () => AuthorizedRealtimeResources;
    epoch: number;
    signal: AbortSignal;
  }) {
    this.publish({
      ...this.snapshot,
      phase: 'remote-authorized',
      authorized: true,
      scope,
      canWrite,
      // Invite issuance does not become visible until hydration and mutation
      // authority both reach their ready state.
      authoritativeOwner: false,
      connectionState: 'connecting',
      syncState: 'connecting',
      reason: null,
      retryable: false,
    });
    if (!this.isCurrent(epoch, signal)) return;

    this.authority.enterRemoteHydrating(roomId);
    const resources = createResources();
    if (!this.isCurrent(epoch, signal)) {
      resources.provider.destroy();
      resources.doc.destroy();
      return;
    }
    if (
      !this.authority.registerInitialRemoteProjection(
        roomId,
        resources.doc.getXmlFragment('content'),
      )
    ) {
      resources.provider.destroy();
      resources.doc.destroy();
      throw new RealtimeProviderStartError(
        'protocol',
        'Realtime document projection authority could not be bound.',
      );
    }
    this.resources = resources;
    this.publish({
      ...this.snapshot,
      phase: 'remote-hydrating',
      connectionState: 'hydrating',
      syncState: 'hydrating',
    });
    this.unsubscribeProvider = resources.provider.subscribe((providerSnapshot) => {
      if (!this.isCurrent(epoch, signal) || !this.snapshot.authorized) return;
      const terminalReason = resources.provider.getTerminalReason?.() ?? null;
      if (terminalReason) {
        this.handleTerminalResources(resources, terminalReason);
        return;
      }
      this.publish({
        ...this.snapshot,
        hydrated: providerSnapshot.hydrated,
        canWrite: providerSnapshot.canWrite ?? this.snapshot.canWrite,
        connectionState: providerSnapshot.hydrated
          ? providerSnapshot.connectionState === 'connected'
            ? 'ready'
            : providerSnapshot.connectionState
          : providerSnapshot.connectionState,
        syncState: providerSnapshot.syncState,
      });
    });
    await resources.provider.start();
    if (!this.isCurrent(epoch, signal)) return;
    const providerSnapshot = resources.provider.getSnapshot();
    // The long-lived invite is no longer needed once the short-lived provider
    // session has hydrated. Keep only the room-scoped stored credential.
    this.credential = null;
    this.credentialAuthority = null;
    this.expectedScope = null;
    this.authority.enterRemoteReady({ canWrite });
    this.enableInviteIssuance(inviteIssuanceScope);
    this.resolution = {
      ...resources,
      authority: this.authority,
      documentId: this.documentId,
      kind: 'remote',
      remoteDocumentId: roomId,
      routeDocumentId: this.documentId,
      runtime,
    };
    this.publish({
      ...this.snapshot,
      phase: 'remote-ready',
      authorized: true,
      hydrated: true,
      canIssueInvites: this.inviteIssuanceEligibility.allowed,
      authoritativeOwner: this.inviteIssuanceEligibility.authoritativeOwner,
      connectionState:
        providerSnapshot.connectionState === 'connected'
          ? 'ready'
          : providerSnapshot.connectionState,
      syncState: providerSnapshot.syncState,
    });
  }

  private async runOwnerPromotion(
    attempt: BrowserDocumentPromotionAttempt,
    signal: AbortSignal,
  ): Promise<OwnerCutoverResult> {
    let promotion: BrowserPromotionResult;
    try {
      const submitted: unknown = await attempt.submit({
        fetcher: this.dependencies.fetcher,
        signal,
      });
      promotion =
        isPlainObject(submitted) &&
        typeof submitted.ok === 'boolean' &&
        (submitted.ok || typeof submitted.retryable === 'boolean')
          ? (submitted as BrowserPromotionResult)
          : { ok: false, reason: 'invalid-response', retryable: false };
    } catch {
      promotion = {
        ok: false,
        reason: 'network-error',
        retryable: true,
      };
    }
    if (!promotion.ok) {
      this.restoreLocalCutoverAuthority();
      return {
        ok: false,
        reason: 'promotion-failed',
        retryable: promotion.retryable,
        promotion,
      };
    }
    if (!isExactPromotionReceipt(promotion.receipt)) {
      this.restoreLocalCutoverAuthority();
      return {
        ok: false,
        reason: 'promotion-failed',
        retryable: false,
        promotion: {
          ok: false,
          reason: 'invalid-response',
          retryable: false,
        },
      };
    }
    return this.runOwnerCandidate(promotion.receipt, signal);
  }

  private async runOwnerReopen(epoch: number, signal: AbortSignal) {
    if (
      !this.isCurrent(epoch, signal) ||
      this.ownerCutoverPromise ||
      this.resolution?.kind !== 'local' ||
      !this.authority.freezeForOwnerCutover()
    ) {
      return null;
    }
    const promise = this.runOwnerCandidate(null, signal).finally(() => {
      if (this.ownerCutoverPromise === promise) {
        this.ownerCutoverPromise = null;
        this.ownerCutoverKind = null;
      }
    });
    this.ownerCutoverPromise = promise;
    this.ownerCutoverKind = 'reopen';
    const result = await promise;
    if (
      !result.ok &&
      this.isCurrent(epoch, signal) &&
      this.resolution?.kind === 'local'
    ) {
      this.publish({
        ...this.snapshot,
        phase: 'local-ready',
        reason: result.retryable ? 'unavailable' : null,
        retryable: result.retryable,
      });
    }
    return result;
  }

  private async runOwnerCandidate(
    receipt: BrowserPromotionReceipt | null,
    signal: AbortSignal,
  ): Promise<OwnerCutoverResult> {
    const generation = this.generation;
    const localResolution = this.resolution?.kind === 'local' ? this.resolution : null;
    let candidate: OwnerRealtimeCandidateResources | null = null;
    let committed = false;
    try {
      if (
        !localResolution ||
        localResolution.routeDocumentId !== this.documentId ||
        !this.isOwnerCutoverCurrent(generation, signal, localResolution)
      ) {
        return { ok: false, reason: 'aborted', retryable: false };
      }
      const actorId = this.dependencies.getActorId();
      const sessionResult = await this.dependencies.requestOwnerSession({
        actorId,
        routeDocumentId: this.documentId,
        signal,
      });
      if (!this.isOwnerCutoverCurrent(generation, signal, localResolution)) {
        return { ok: false, reason: 'aborted', retryable: false };
      }
      if (!sessionResult.ok) {
        return {
          ok: false,
          reason: 'owner-session-failed',
          retryable: sessionResult.retryable,
        };
      }
      const session = sessionResult.session;
      if (
        !isExactOwnerRealtimeSession(session, {
          actorId,
          routeDocumentId: this.documentId,
          remoteDocumentId: receipt?.room.roomId,
          promotionSnapshotSha256: receipt?.snapshotSha256,
        })
      ) {
        return { ok: false, reason: 'owner-session-invalid', retryable: false };
      }

      this.authority.enterRemoteHydrating(session.remoteDocumentId);
      const refreshOwnerSession = async (
        expectedRouteDocumentId: string,
        refreshSignal: AbortSignal,
      ) => {
        if (expectedRouteDocumentId !== this.documentId) {
          throw new RealtimeProviderStartError(
            'protocol',
            'Owner realtime refresh requested a different route document.',
          );
        }
        const refreshed = await this.dependencies.requestOwnerSession({
          actorId,
          routeDocumentId: expectedRouteDocumentId,
          signal: refreshSignal,
        });
        if (!refreshed.ok) {
          throw new RealtimeProviderStartError(
            refreshed.retryable ? 'transient-exhausted' : 'authorization',
            'Owner realtime session refresh failed.',
          );
        }
        if (
          !isExactOwnerRealtimeSession(refreshed.session, {
            actorId,
            routeDocumentId: session.routeDocumentId,
            remoteDocumentId: session.remoteDocumentId,
            promotionSnapshotSha256: session.promotionSnapshotSha256,
          })
        ) {
          throw new RealtimeProviderStartError(
            'protocol',
            'Owner realtime session refresh changed its authority binding.',
          );
        }
        return refreshed.session;
      };
      candidate = this.dependencies.createOwnerResources(session, {
        authority: this.authority,
        refreshOwnerSession,
      });
      if (
        !this.authority.registerInitialRemoteProjection(
          session.remoteDocumentId,
          candidate.doc.getXmlFragment('content'),
        )
      ) {
        return { ok: false, reason: 'candidate-failed', retryable: false };
      }
      await candidate.provider.start();
      if (!this.isOwnerCutoverCurrent(generation, signal, localResolution)) {
        return { ok: false, reason: 'aborted', retryable: false };
      }
      const providerSnapshot = candidate.provider.getSnapshot();
      if (providerSnapshot.hydrated !== true || providerSnapshot.canWrite !== true) {
        return { ok: false, reason: 'candidate-failed', retryable: false };
      }
      if (receipt && !this.ownerProjectionMatches(candidate, receipt)) {
        return { ok: false, reason: 'integrity-mismatch', retryable: true };
      }
      if (!candidate.provider.commitAuthorityOwnership()) {
        return { ok: false, reason: 'candidate-failed', retryable: false };
      }

      const runtime: Exclude<RealtimeRuntimeSelection, { mode: 'disabled' }> = {
        invitationMode: 'unavailable',
        mode: 'configured',
        socketBaseUrl: new URL(session.socketUrl).origin,
      };
      const committedCandidate = candidate;
      this.unsubscribeProvider = committedCandidate.provider.subscribe((next) => {
        if (
          !this.isCurrent(generation, signal) ||
          this.resources !== committedCandidate ||
          !this.snapshot.authorized
        ) {
          return;
        }
        const terminalReason = committedCandidate.provider.getTerminalReason?.() ?? null;
        if (terminalReason) {
          this.handleTerminalResources(committedCandidate, terminalReason);
          return;
        }
        this.publish({
          ...this.snapshot,
          hydrated: next.hydrated,
          canWrite: next.canWrite ?? this.snapshot.canWrite,
          connectionState:
            next.hydrated && next.connectionState === 'connected' ? 'ready' : next.connectionState,
          syncState: next.syncState,
        });
      });
      this.resources = committedCandidate;
      this.resolution = {
        ...committedCandidate,
        authority: this.authority,
        documentId: this.documentId,
        kind: 'remote',
        remoteDocumentId: session.remoteDocumentId,
        routeDocumentId: this.documentId,
        runtime,
      };
      this.authority.enterRemoteReady({ canWrite: true });
      this.enableInviteIssuance('edit');
      this.publish({
        ...this.snapshot,
        phase: 'remote-ready',
        authorized: true,
        hydrated: true,
        canIssueInvites: true,
        canWrite: true,
        authoritativeOwner: true,
        scope: 'edit',
        connectionState:
          providerSnapshot.connectionState === 'connected'
            ? 'ready'
            : providerSnapshot.connectionState,
        syncState: providerSnapshot.syncState,
        reason: null,
        retryable: false,
      });
      committed = true;
      return {
        ok: true,
        routeDocumentId: this.documentId,
        remoteDocumentId: session.remoteDocumentId,
      };
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        return { ok: false, reason: 'aborted', retryable: false };
      }
      return {
        ok: false,
        reason: 'candidate-failed',
        retryable:
          error instanceof RealtimeProviderStartError && error.kind === 'transient-exhausted',
      };
    } finally {
      if (!committed) {
        if (candidate) {
          try {
            candidate.provider.destroy();
          } catch {
            // Candidate resources never become document authority on cleanup failure.
          }
          try {
            candidate.doc.destroy();
          } catch {
            // The candidate remains unbound even if a defensive destroy hook fails.
          }
        }
        this.restoreLocalCutoverAuthority(localResolution);
      }
    }
  }

  private ownerProjectionMatches(
    candidate: OwnerRealtimeCandidateResources,
    receipt: BrowserPromotionReceipt,
  ) {
    try {
      const title = readRealtimeDocumentTitle(candidate.doc);
      const body = normalizeYProsemirrorProjectionJson(
        yXmlFragmentToProsemirrorJSON(candidate.doc.getXmlFragment('content')),
      );
      return title === receipt.title && canonicalize(body) === canonicalize(receipt.body);
    } catch {
      return false;
    }
  }

  private isOwnerCutoverCurrent(
    generation: number,
    signal: AbortSignal,
    localResolution: LocalDocumentAccessResolution,
  ) {
    return (
      this.isCurrent(generation, signal) &&
      this.resolution === localResolution &&
      localResolution.routeDocumentId === this.documentId
    );
  }

  private restoreLocalCutoverAuthority(
    localResolution: LocalDocumentAccessResolution | null = null,
  ) {
    if (this.destroyed || (localResolution !== null && this.resolution !== localResolution)) {
      return;
    }
    this.authority.restoreLocalAfterOwnerCutover();
  }

  private isCurrent(epoch: number, signal: AbortSignal) {
    return !this.destroyed && !signal.aborted && this.generation === epoch;
  }

  private enableInviteIssuance(scope: 'edit' | null) {
    if (scope === null) {
      this.revokeInviteIssuance();
      return;
    }
    this.inviteIssuanceEligibility = {
      allowed: true,
      authoritativeOwner: true,
      issuanceEpoch: this.inviteIssuanceEligibility.issuanceEpoch + 1,
      scope,
    };
  }

  private revokeInviteIssuance() {
    if (this.inviteIssuanceEligibility.allowed) {
      this.inviteIssuanceEligibility = {
        allowed: false,
        authoritativeOwner: false,
        issuanceEpoch: this.inviteIssuanceEligibility.issuanceEpoch + 1,
        scope: null,
      };
    }
    if (this.snapshot.canIssueInvites || this.snapshot.authoritativeOwner) {
      this.publish({
        ...this.snapshot,
        canIssueInvites: false,
        authoritativeOwner: false,
      });
    }
  }

  private publish(next: DocumentAccessSnapshot) {
    if (this.destroyed && next.phase !== 'destroyed') return;
    this.snapshot = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        // One UI observer cannot interrupt an access/authority state transition.
      }
    }
  }

  private publishDenied(reason: DocumentAccessReason) {
    this.publish({
      ...this.snapshot,
      phase: 'denied',
      authorized: false,
      hydrated: false,
      canIssueInvites: false,
      canWrite: false,
      authoritativeOwner: false,
      connectionState: 'denied',
      syncState: 'denied',
      reason,
      retryable: false,
      recoveryExportAvailable: false,
      recoveryUpdateCount: 0,
    });
  }

  private failUnavailable(reason: DocumentAccessReason, retryable: boolean) {
    this.publish({
      ...this.snapshot,
      phase: 'unavailable',
      authorized: false,
      hydrated: false,
      canIssueInvites: false,
      canWrite: false,
      authoritativeOwner: false,
      connectionState: 'unavailable',
      syncState: 'unavailable',
      reason,
      retryable,
      recoveryExportAvailable: false,
      recoveryUpdateCount: this.recoverySnapshot?.updates.length ?? 0,
    });
  }

  private clearRejectedCredential() {
    this.dependencies.clearRoomCredentials(this.documentId);
    this.scrubInviteFragmentOnce();
    this.credential = null;
    this.credentialAuthority = null;
    this.expectedScope = null;
  }

  private captureAndScrubInviteFragment() {
    if (!this.fragmentCaptured) {
      this.fragmentCaptured = true;
      try {
        this.fragmentDecision = this.dependencies.readFragmentCredential();
      } catch {
        this.fragmentDecision = { state: 'invalid' };
      }
    }
    if (this.fragmentDecision?.state === 'absent') return true;
    return this.scrubInviteFragmentOnce();
  }

  private scrubInviteFragmentOnce() {
    if (this.fragmentScrubbed) return true;
    try {
      if (this.dependencies.scrubInviteFragment() === true) {
        this.fragmentScrubbed = true;
        return true;
      }
    } catch {
      // Bearer handling stays fail-closed even when browser history is restricted.
    }
    return false;
  }

  private handleTerminalResources(
    resources: AuthorizedRealtimeResources,
    reason: 'invalid' | 'scope-mismatch' | 'protocol-error',
  ) {
    if (
      this.snapshot.phase === 'recovery-available' ||
      this.snapshot.phase === 'recovery-blocked'
    ) {
      return;
    }
    if (this.resources !== resources) return;
    const result = this.teardownResources(reason);
    if (!result.ok) return;
    if (result.disposition === 'empty') {
      this.publishDenied(reason);
      return;
    }
    this.authority.markRecoveryAvailable();
    this.publishRecoveryState(
      'recovery-available',
      reason,
      this.recoverySnapshot?.updates.length ?? 0,
    );
  }

  private restoreVerifiedRecoveryReceipt(actorId?: string): 'none' | 'restored' | 'unavailable' {
    const result = this.dependencies.recoveryJournal?.listForDocument(this.documentId);
    if (!result || !result.ok) return 'unavailable';
    const receipt = actorId
      ? result.records.find(({ record }) =>
          record.version === 3 && record.principalId === actorId &&
          record.routeDocumentId === this.documentId && record.remoteDocumentId === this.documentId,
        )
      : result.records[0];
    if (!receipt) return 'none';
    const { key, record } = receipt;
    this.recoveryKey = key;
    this.recoveryBlocked = false;
    this.recoverySnapshot = {
      authorityEpoch: record.epoch,
      baselineStateVector: record.baselineStateVector.slice(),
      documentId: record.documentId,
      principalId: record.principalId,
      reason: record.reason,
      ...(record.version === 3 ? { remoteDocumentId: record.remoteDocumentId } : {}),
      ...(record.version === 3 ? { routeDocumentId: record.routeDocumentId } : {}),
      sealedAt: record.version === 1 ? record.createdAt : record.sealedAt,
      scope: record.scope,
      updates: record.updates.map(({ bytes, updateId }) => ({
        bytes: bytes.slice(),
        updateId,
      })),
    };
    this.authority.revoke();
    this.authority.markRecoveryAvailable();
    this.publishRecoveryState('recovery-available', record.reason, record.updates.length);
    return 'restored';
  }

  private ensureRecoveryNavigationWarning() {
    if (this.removeRecoveryNavigationWarning) return;
    this.removeRecoveryNavigationWarning = this.dependencies.installRecoveryNavigationWarning();
  }

  private clearRecoveryNavigationWarning() {
    const remove = this.removeRecoveryNavigationWarning;
    this.removeRecoveryNavigationWarning = null;
    remove?.();
  }

  private retainBlockedRecovery() {
    const retained =
      retainedBlockedRecoveryControllers.get(this.documentId) ??
      new Set<BrowserDocumentAccessController>();
    retained.add(this);
    retainedBlockedRecoveryControllers.set(this.documentId, retained);
  }

  private releaseBlockedRecoveryRetention() {
    const retained = retainedBlockedRecoveryControllers.get(this.documentId);
    retained?.delete(this);
    if (retained?.size === 0) {
      retainedBlockedRecoveryControllers.delete(this.documentId);
    }
  }

  private publishRecoveryState(
    phase: 'recovery-available' | 'recovery-blocked',
    reason: DocumentAccessReason,
    recoveryUpdateCount: number,
  ) {
    this.publish({
      ...this.snapshot,
      phase,
      authorized: false,
      hydrated: false,
      canIssueInvites: false,
      canWrite: false,
      authoritativeOwner: false,
      connectionState: 'unavailable',
      syncState: 'unavailable',
      reason,
      retryable: false,
      recoveryExportAvailable: this.recoverySnapshot !== null,
      scope: this.recoverySnapshot?.scope ?? this.snapshot.scope,
      recoveryUpdateCount,
    });
  }

  private teardownResources(reason: RealtimeRecoveryReason = 'lifecycle'): DestroyResult {
    this.revokeInviteIssuance();
    this.unsubscribeProvider?.();
    this.unsubscribeProvider = null;
    if (!this.resources) return { ok: true, disposition: 'empty' };
    const resources = this.resources;
    this.resolution = null;
    if (typeof resources.provider.sealForRecovery !== 'function') {
      const snapshot = resources.provider.getSnapshot();
      const updateCount = snapshot.pendingUpdateCount + snapshot.queuedUpdateCount;
      if (updateCount > 0) {
        return this.blockRecovery(reason, updateCount, null);
      }
      const destroyed = resources.provider.destroy();
      if (destroyed === false) return this.blockRecovery(reason, 0, null);
      this.resources = null;
      resources.doc.destroy();
      return { ok: true, disposition: 'empty' };
    }

    let seal: RealtimeRecoverySeal;
    try {
      seal = resources.provider.sealForRecovery(reason);
    } catch {
      const snapshot = resources.provider.getSnapshot();
      return this.blockRecovery(
        reason,
        snapshot.pendingUpdateCount + snapshot.queuedUpdateCount,
        null,
      );
    }
    const recovery = seal.snapshot;
    this.recoverySeal = seal;
    this.recoverySnapshot = recovery;
    if (recovery.updates.length === 0) {
      if (!resources.provider.commitDestroy(seal, { kind: 'empty' })) {
        return this.blockRecovery(reason, 0, recovery);
      }
      this.resources = null;
      this.recoverySeal = null;
      this.recoverySnapshot = null;
      this.recoveryKey = null;
      this.recoveryBlocked = false;
      resources.doc.destroy();
      return { ok: true, disposition: 'empty' };
    }

    const receipt = this.dependencies.recoveryJournal?.persistAndVerify({
      baselineStateVector: recovery.baselineStateVector,
      documentId: recovery.documentId,
      epoch: recovery.authorityEpoch,
      principalId: recovery.principalId,
      reason: recovery.reason,
      ...(recovery.remoteDocumentId !== undefined
        ? { remoteDocumentId: recovery.remoteDocumentId }
        : {}),
      ...(recovery.routeDocumentId !== undefined
        ? { routeDocumentId: recovery.routeDocumentId }
        : {}),
      sealedAt: recovery.sealedAt,
      scope: recovery.scope,
      unsyncedMetadata: null,
      unsyncedTitle: null,
      updates: recovery.updates,
    }) ?? { ok: false as const, reason: 'write-failed' as const };
    if (
      receipt.ok &&
      receipt.record.version !== 1 &&
      resources.provider.commitDestroy(seal, {
        kind: 'verified-receipt',
        record: receipt.record,
      })
    ) {
      this.resources = null;
      this.recoveryKey = receipt.key;
      this.recoverySeal = null;
      this.recoveryBlocked = false;
      this.releaseBlockedRecoveryRetention();
      this.clearRecoveryNavigationWarning();
      resources.doc.destroy();
      return { ok: true, disposition: 'verified-receipt' };
    }
    return this.blockRecovery(reason, recovery.updates.length, recovery);
  }

  private blockRecovery(
    reason: DocumentAccessReason,
    updateCount: number,
    recovery: RealtimeUnsyncedRecoverySnapshot | null,
  ): Extract<DestroyResult, { ok: false }> {
    this.recoveryBlocked = true;
    this.recoverySnapshot = recovery;
    this.recoveryKey = null;
    this.ensureRecoveryNavigationWarning();
    this.retainBlockedRecovery();
    this.authority.markRecoveryBlocked();
    this.publishRecoveryState('recovery-blocked', reason, updateCount);
    return { ok: false, disposition: 'recovery-blocked', updateCount };
  }
}

const browserSessionStorage = () => {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

const browserLocalStorage = () => {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const abortableDelay = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Authorization aborted.', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Authorization aborted.', 'AbortError'));
      },
      { once: true },
    );
  });

export const createBrowserDocumentAccessDependencies = (
  navigateHome: () => void,
): DocumentAccessDependencies => ({
  clearLegacyCredential: (documentId) =>
    clearLegacyInviteCredential(browserSessionStorage(), documentId),
  clearRoomCredentials: (documentId) =>
    clearRoomInviteCredentials(browserSessionStorage(), documentId),
  createOwnerResources: createOwnerCandidateResources,
  createResources: createAuthorizedRealtimeResources,
  delay: abortableDelay,
  exchangeSession: exchangeRealtimeSession,
  fetcher: fetch,
  getActorId: getOrCreateLocalActorId,
  installRecoveryNavigationWarning: () => {
    if (typeof window === 'undefined') return () => undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  },
  navigateHome,
  readFragmentCredential: () =>
    typeof window === 'undefined'
      ? { state: 'absent' }
      : readInviteFragmentCredential(window.location),
  readRuntime: selectBrowserRealtimeRuntime,
  recoveryJournal: (() => {
    const storage = browserLocalStorage();
    return storage ? createRealtimeRecoveryJournal(storage) : null;
  })(),
  readStoredCredential: (documentId) =>
    readValidatedInviteCredential(browserSessionStorage(), documentId),
  requestOwnerSession: (input) => requestBrowserOwnerSession({ ...input, fetcher: fetch }),
  scrubInviteFragment: () => {
    if (typeof window === 'undefined') return true;
    try {
      scrubInviteFragment(window.location, window.history);
      return readInviteFragmentCredential(window.location).state === 'absent';
    } catch {
      return false;
    }
  },
  validateDevelopmentInvite: (documentId, token) =>
    validateInviteAccess(browserLocalStorage(), documentId, token, 'development-loopback'),
  writeValidatedCredential: (credential) =>
    writeValidatedInviteCredential(browserSessionStorage(), credential),
});

export const createDocumentAccessController = (
  input: { documentId: string },
  dependencies: DocumentAccessDependencies,
): DocumentAccessController => new BrowserDocumentAccessController(input.documentId, dependencies);

export const createBrowserDocumentAccessController = (input: {
  documentId: string;
  navigateHome: () => void;
}): DocumentAccessController => {
  const retained = retainedBlockedRecoveryControllers.get(input.documentId);
  const oldestRetained = retained?.values().next().value;
  if (oldestRetained && !NAMED_EDIT_ROOM_ID.test(input.documentId)) return oldestRetained;
  return createDocumentAccessController(
    { documentId: input.documentId },
    createBrowserDocumentAccessDependencies(input.navigateHome),
  );
};
