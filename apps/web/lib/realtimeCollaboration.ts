import { SHARED_HISTORY_RESTORE_CLOSE, type SharedHistoryFrame, type ShareScope } from '@lash/types';
import * as Y from 'yjs';

import type { DocumentMutationAuthority } from './documentMutationAuthority';
import {
  NAMED_EDIT_PROTOCOL,
  NAMED_EDIT_ROOM_ID,
  validNamedEditGrant,
  validNamedEditSocketUrl,
  type NamedEditSession,
} from './namedEdit/contract';
import { RealtimeChatStore, type ReviewFrame } from './realtimeChatStore';
import type {
  RealtimeRecoveryJournalRecordV2,
  RealtimeRecoveryJournalRecordV3,
} from './realtimeRecoveryJournal';
import { SharedHistoryClient } from './sharedHistoryClient';

const REMOTE_UPDATE_ORIGIN = Symbol('lash-remote-yjs-update');
const REALTIME_PROTOCOL_VERSION = 2 as const;
const OWNER_REALTIME_PROTOCOL_VERSION = 3 as const;
const OWNER_SOCKET_PROTOCOL = 'lash-realtime-v3' as const;
const SOCKET_OPEN = 1;
const SESSION_EXCHANGE_DEADLINE_MS = 5_000;
const ACCOUNT_RECONNECT_DELAYS_MS = [250, 1_000, 2_000, 4_000, 8_000] as const;
const ACCOUNT_RECONNECT_MAX_DELAY_MS = 15_000;

export const REALTIME_DOCUMENT_METADATA_YMAP = 'lash:document-metadata:v1';
export const REALTIME_DOCUMENT_TITLE_KEY = 'title';
export const REALTIME_SUGGESTION_RESOLUTIONS_YMAP = 'lash:suggestion-resolutions:v1';

export type RealtimeSuggestionResolutionRecord = {
  id: string;
  entryId: string;
  action: 'accepted' | 'rejected';
  ts: string;
  actorId: string;
};

export const readRealtimeDocumentTitle = (doc: Y.Doc): string | null => {
  const title = doc
    .getMap<string>(REALTIME_DOCUMENT_METADATA_YMAP)
    .get(REALTIME_DOCUMENT_TITLE_KEY);
  return typeof title === 'string' ? title : null;
};

export const writeRealtimeDocumentTitle = (doc: Y.Doc, title: string) => {
  doc.getMap<string>(REALTIME_DOCUMENT_METADATA_YMAP).set(REALTIME_DOCUMENT_TITLE_KEY, title);
};

export const realtimeSuggestionResolutionPrefix = (documentId: string) =>
  `${encodeURIComponent(documentId)}:`;

const normalizeRealtimeSuggestionResolution = (
  value: unknown,
): RealtimeSuggestionResolutionRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<RealtimeSuggestionResolutionRecord>;
  if (
    typeof record.id !== 'string' ||
    typeof record.entryId !== 'string' ||
    typeof record.ts !== 'string' ||
    typeof record.actorId !== 'string' ||
    (record.action !== 'accepted' && record.action !== 'rejected')
  ) {
    return null;
  }
  return {
    id: record.id,
    entryId: record.entryId,
    action: record.action,
    ts: record.ts,
    actorId: record.actorId,
  };
};

const canonicalRealtimeSuggestionResolutions = (records: RealtimeSuggestionResolutionRecord[]) => {
  const byEntry = new Map<string, RealtimeSuggestionResolutionRecord>();
  for (const record of records) {
    const existing = byEntry.get(record.entryId);
    if (
      !existing ||
      record.ts > existing.ts ||
      (record.ts === existing.ts && record.id > existing.id)
    ) {
      byEntry.set(record.entryId, record);
    }
  }
  return [...byEntry.values()].sort(
    (left, right) => left.ts.localeCompare(right.ts) || left.id.localeCompare(right.id),
  );
};

export const readRealtimeSuggestionResolutions = (
  map: Y.Map<string>,
  documentId: string,
): RealtimeSuggestionResolutionRecord[] => {
  const prefix = realtimeSuggestionResolutionPrefix(documentId);
  const records: RealtimeSuggestionResolutionRecord[] = [];
  for (const [key, value] of map.entries()) {
    if (!key.startsWith(prefix)) continue;
    try {
      const record = normalizeRealtimeSuggestionResolution(JSON.parse(value) as unknown);
      if (record) records.push(record);
    } catch {
      // Invalid remote metadata is ignored instead of becoming local authority.
    }
  }
  return canonicalRealtimeSuggestionResolutions(records);
};

export const readSuggestionResolutionRecords = <Id extends string>(
  remote: Y.Map<string> | null,
  documentId: Id,
  readLocal: (documentId: Id) => RealtimeSuggestionResolutionRecord[],
) => remote ? readRealtimeSuggestionResolutions(remote, documentId) : readLocal(documentId);

export const replaceRealtimeSuggestionResolutions = (
  map: Y.Map<string>,
  documentId: string,
  records: RealtimeSuggestionResolutionRecord[],
) => {
  const prefix = realtimeSuggestionResolutionPrefix(documentId);
  for (const key of map.keys()) {
    if (key.startsWith(prefix)) map.delete(key);
  }
  for (const record of canonicalRealtimeSuggestionResolutions(records)) {
    map.set(`${prefix}entry:${encodeURIComponent(record.entryId)}`, JSON.stringify(record));
  }
};

export type RealtimeConnectionState =
  | 'disabled'
  | 'connecting'
  | 'hydrating'
  | 'connected'
  | 'reconnecting'
  | 'offline';

export type RealtimeSyncState =
  | 'disabled'
  | 'connecting'
  | 'hydrating'
  | 'reconnecting'
  | 'syncing'
  | 'saved'
  | 'offline';

export type RealtimeRuntimeMode = 'disabled' | 'configured' | 'development-loopback';

export type RealtimeSelection = { from: number; to: number };

export type RealtimePresencePeer = {
  actorId: string;
  label: string;
  color: string;
  selection: RealtimeSelection | null;
  updatedAt: number;
  connection: 'online';
};

export type RealtimeSnapshot = {
  enabled: boolean;
  hydrated: boolean;
  canWrite: boolean;
  actorId: string;
  connectionState: RealtimeConnectionState;
  syncState: RealtimeSyncState;
  queuedUpdateCount: number;
  pendingUpdateCount: number;
  peers: RealtimePresencePeer[];
};

/**
 * Transport selection only. A configured URL is never authorization,
 * hydration, or invite-issuance authority.
 */
export type RealtimeRuntimeSelection =
  | {
      invitationMode: 'unavailable';
      mode: 'disabled';
      socketBaseUrl: null;
    }
  | {
      invitationMode: 'unavailable';
      mode: 'configured';
      socketBaseUrl: string;
    }
  | {
      invitationMode: 'development-loopback';
      mode: 'development-loopback';
      socketBaseUrl: string;
    };

export type RealtimeRuntimeSelectionInput = {
  configuredSocketUrl: string | null | undefined;
  environment: 'development' | 'production' | 'test';
  hostname: string | null;
  localRealtimeEnabled: string | null | undefined;
  localSocketUrl: string | null | undefined;
  search: string;
  testHooksEnabled: boolean;
};

export type SyntheticMentionFixtureMarker = {
  version: 1;
  kind: 'synthetic-mention-identities';
  documentId: string;
};

export type SyntheticMentionFixtureAccess = {
  phase: string;
  authorized: boolean;
  hydrated: boolean;
  authoritativeOwner: boolean;
};

export type AuthorizedRealtimeSession = {
  protocolVersion: typeof REALTIME_PROTOCOL_VERSION;
  accessToken: string;
  actorId: string;
  capabilities: string[];
  documentId: string;
  inviteRequired: boolean;
  scope: ShareScope | null;
  socketBaseUrl: string;
};

export type OwnerRealtimeSessionV3 = Readonly<{
  protocolVersion: typeof OWNER_REALTIME_PROTOCOL_VERSION;
  source: 'owner';
  routeDocumentId: string;
  remoteDocumentId: string;
  promotionSnapshotSha256: string;
  actorId: string;
  capabilities: readonly ['doc.read', 'doc.edit'];
  socketUrl: string;
  socketProtocol: typeof OWNER_SOCKET_PROTOCOL;
  ticketProtocol: string;
  expiresAt: string;
}>;

export type OwnerRealtimeSessionRefresh = (
  routeDocumentId: string,
  signal: AbortSignal,
) => Promise<OwnerRealtimeSessionV3>;

export type NamedRealtimeSessionV5 = NamedEditSession & Readonly<{
  routeDocumentId: string;
  remoteDocumentId: string;
}>;

type AccountRealtimeSession = OwnerRealtimeSessionV3 | NamedRealtimeSessionV5;
type AccountRealtimeSessionRefresh = (
  routeDocumentId: string,
  signal: AbortSignal,
) => Promise<AccountRealtimeSession>;

type RealtimeProviderSession = AuthorizedRealtimeSession | AccountRealtimeSession;

export type RealtimeSessionTerminalError =
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'document-mismatch'
  | 'scope-mismatch'
  | 'unsupported-scope'
  | 'invite-authority-unavailable'
  | 'protocol-error';

export type RealtimeSessionExchangeResult =
  | { ok: true; session: AuthorizedRealtimeSession }
  | {
      ok: false;
      error: RealtimeSessionTerminalError | 'transient';
      retryable: boolean;
      status: number | null;
    };

export type RealtimeSessionExchangeInput = {
  actorId: string;
  inviteToken: string | null;
  roomId: string;
  runtime: Exclude<RealtimeRuntimeSelection, { mode: 'disabled' }>;
  signal: AbortSignal;
  fetcher?: typeof fetch;
};

export interface RealtimeSocket {
  readonly readyState: number;
  addEventListener(
    type: 'close' | 'error' | 'message' | 'open',
    listener: (event: unknown) => void,
  ): void;
  removeEventListener(
    type: 'close' | 'error' | 'message' | 'open',
    listener: (event: unknown) => void,
  ): void;
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export type RealtimeProviderOptions = {
  authority?: DocumentMutationAuthority;
  createSocket?: (url: string, protocols?: readonly string[]) => RealtimeSocket;
  doc: Y.Doc;
  hydrationTimeoutMs?: number;
  refreshOwnerSession?: AccountRealtimeSessionRefresh;
  session: RealtimeProviderSession;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

export type AuthorizedRealtimeResources = {
  doc: Y.Doc;
  provider: LashRealtimeYjsProvider;
};

export type OwnerRealtimeCandidateResources = AuthorizedRealtimeResources;

export type OwnerRealtimeCandidateOptions = Omit<
  RealtimeProviderOptions,
  'doc' | 'refreshOwnerSession' | 'session'
> & {
  refreshOwnerSession: OwnerRealtimeSessionRefresh;
};

export type RealtimeUnsyncedRecoverySnapshot = {
  authorityEpoch: number;
  baselineStateVector: Uint8Array;
  documentId: string;
  principalId: string;
  remoteDocumentId?: string;
  reason: RealtimeRecoveryReason;
  routeDocumentId?: string;
  sealedAt: string;
  scope: ShareScope | null;
  updates: Array<{ bytes: Uint8Array; updateId: string }>;
};

export type RealtimeRecoveryReason = RealtimeProviderTerminalReason | 'lifecycle';

export type RealtimeRecoverySeal = Readonly<{
  id: string;
  snapshot: RealtimeUnsyncedRecoverySnapshot;
}>;

export type RealtimeRecoveryDestroyDisposition =
  | { kind: 'empty' }
  | {
      kind: 'verified-receipt';
      record: RealtimeRecoveryJournalRecordV2 | RealtimeRecoveryJournalRecordV3;
    };

type RealtimeMessage =
  | ReviewFrame
  | SharedHistoryFrame
  | {
      type: 'room-ready';
      roomId?: string;
      protocolVersion?: number;
      historyGeneration?: number;
    }
  | {
      type: 'room-hydration-complete';
      roomId?: string;
      protocolVersion?: number;
      persistedUpdates?: number;
      historyGeneration?: number;
    }
  | { type: 'pong' }
  | { type: 'sync-ack'; roomId?: string; updateId?: string }
  | { type: 'awareness-state'; peers?: RealtimePresencePeer[]; roomId?: string }
  | { type: 'yjs-update'; roomId?: string; source?: string; update?: string }
  | { type: 'error'; code?: string; roomId?: string };

type ProviderSocketHandlers = {
  close: (event: unknown) => void;
  error: (event: unknown) => void;
  message: (event: unknown) => void;
  open: (event: unknown) => void;
};

export type RealtimeProviderStartErrorKind =
  | 'authorization'
  | 'destroyed'
  | 'protocol'
  | 'transient-exhausted';

export type RealtimeProviderTerminalReason = 'invalid' | 'scope-mismatch' | 'protocol-error';

export class RealtimeProviderStartError extends Error {
  readonly kind: RealtimeProviderStartErrorKind;

  constructor(kind: RealtimeProviderStartErrorKind, message: string) {
    super(message);
    this.name = 'RealtimeProviderStartError';
    this.kind = kind;
  }
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const browserLocalStorage = (): Storage | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const readBrowserLocalStorage = (key: string) => {
  try {
    return browserLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const disabledRuntime = (): RealtimeRuntimeSelection => ({
  invitationMode: 'unavailable',
  mode: 'disabled',
  socketBaseUrl: null,
});

export const isLoopbackHostname = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

const safeLoopbackSocketUrl = (raw: string | null | undefined) => {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (
      (url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
      !isLoopbackHostname(url.hostname) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const selectRealtimeRuntime = ({
  configuredSocketUrl,
  environment,
  hostname,
  localRealtimeEnabled,
  localSocketUrl,
  search,
  testHooksEnabled,
}: RealtimeRuntimeSelectionInput): RealtimeRuntimeSelection => {
  const params = new URLSearchParams(search);
  if (params.getAll('realtime').includes('off')) return disabledRuntime();

  const configured = configuredSocketUrl?.trim();
  if (configured) {
    return {
      invitationMode: 'unavailable',
      mode: 'configured',
      socketBaseUrl: configured,
    };
  }

  const developmentOverridesAllowed =
    hostname !== null &&
    isLoopbackHostname(hostname) &&
    (environment !== 'production' || testHooksEnabled);
  if (!developmentOverridesAllowed) return disabledRuntime();

  const explicitLocalSocketUrl = localSocketUrl?.trim();
  if (explicitLocalSocketUrl) {
    const loopbackUrl = safeLoopbackSocketUrl(explicitLocalSocketUrl);
    if (!loopbackUrl) return disabledRuntime();
    return {
      invitationMode: 'development-loopback',
      mode: 'development-loopback',
      socketBaseUrl: loopbackUrl,
    };
  }

  const realtimeEnabled = params.get('realtime') === 'on' || localRealtimeEnabled === 'true';
  if (!realtimeEnabled) return disabledRuntime();
  return {
    invitationMode: 'development-loopback',
    mode: 'development-loopback',
    socketBaseUrl: 'ws://127.0.0.1:8787',
  };
};

export const selectBrowserRealtimeRuntime = (): RealtimeRuntimeSelection => {
  const browserAvailable = typeof window !== 'undefined';
  const environment =
    process.env.NODE_ENV === 'production'
      ? 'production'
      : process.env.NODE_ENV === 'test'
        ? 'test'
        : 'development';
  return selectRealtimeRuntime({
    configuredSocketUrl: process.env.NEXT_PUBLIC_LASH_REALTIME_URL,
    environment,
    hostname: browserAvailable ? window.location.hostname : null,
    localRealtimeEnabled: browserAvailable
      ? readBrowserLocalStorage('lash:realtime-enabled')
      : null,
    localSocketUrl: browserAvailable ? readBrowserLocalStorage('lash:realtime-url') : null,
    search: browserAvailable ? window.location.search : '',
    testHooksEnabled: process.env.NEXT_PUBLIC_LASH_TEST_HOOKS === 'true',
  });
};

const isSyntheticMentionMarker = (
  marker: unknown,
  documentId: string,
): marker is SyntheticMentionFixtureMarker => {
  if (!marker || typeof marker !== 'object') return false;
  const candidate = marker as Partial<SyntheticMentionFixtureMarker>;
  return (
    candidate.version === 1 &&
    candidate.kind === 'synthetic-mention-identities' &&
    candidate.documentId === documentId
  );
};

export const canMountSyntheticMentionFixture = ({
  access,
  documentId,
  marker,
  runtime,
  testHooksEnabled,
}: {
  access: SyntheticMentionFixtureAccess;
  documentId: string;
  marker: unknown;
  runtime: RealtimeRuntimeSelection;
  testHooksEnabled: boolean;
}) =>
  testHooksEnabled &&
  runtime.mode === 'development-loopback' &&
  safeLoopbackSocketUrl(runtime.socketBaseUrl) !== null &&
  isSyntheticMentionMarker(marker, documentId) &&
  access.phase === 'remote-ready' &&
  access.authorized &&
  access.hydrated &&
  access.authoritativeOwner;

const normalizeActorId = (raw: string | undefined | null) => {
  const normalized = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
  return normalized || 'local-user';
};

export const getOrCreateLocalActorId = () => {
  if (typeof window === 'undefined') return 'local-user';
  try {
    const existing = window.localStorage.getItem('lash:actor-id');
    if (existing) return normalizeActorId(existing);
    const next =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `actor-${crypto.randomUUID().slice(0, 8)}`
        : `actor-${Date.now().toString(36)}`;
    window.localStorage.setItem('lash:actor-id', next);
    return normalizeActorId(next);
  } catch {
    return 'local-user';
  }
};

const httpBaseUrl = (baseUrl: string) =>
  baseUrl.replace(/^wss:/u, 'https:').replace(/^ws:/u, 'http:');

const sessionUrl = (baseUrl: string, roomId: string) =>
  new URL(`/api/realtime/rooms/${encodeURIComponent(roomId)}/session`, httpBaseUrl(baseUrl));

const socketUrl = (session: AuthorizedRealtimeSession) => {
  const url = new URL(
    `/api/realtime/rooms/${encodeURIComponent(session.documentId)}/socket`,
    session.socketBaseUrl,
  );
  url.searchParams.set('accessToken', session.accessToken);
  url.searchParams.set('protocolVersion', String(REALTIME_PROTOCOL_VERSION));
  return url.toString();
};

const isOwnerRealtimeSession = (
  session: RealtimeProviderSession,
): session is OwnerRealtimeSessionV3 => session.protocolVersion === OWNER_REALTIME_PROTOCOL_VERSION;

const isAccountRealtimeSession = (
  session: RealtimeProviderSession,
): session is AccountRealtimeSession =>
  isOwnerRealtimeSession(session) || session.protocolVersion === NAMED_EDIT_PROTOCOL;

const isValidAccountRealtimeSession = (
  session: AccountRealtimeSession,
  expected?: AccountRealtimeSession,
) => {
  if (isOwnerRealtimeSession(session)) {
    return (!expected || isOwnerRealtimeSession(expected)) &&
      isValidOwnerRealtimeSession(session, expected);
  }
  return NAMED_EDIT_ROOM_ID.test(session.roomId) &&
    session.routeDocumentId === session.roomId &&
    session.remoteDocumentId === session.roomId &&
    validNamedEditGrant(session, session.roomId) &&
    validNamedEditSocketUrl(session.socketUrl, session.roomId, session.actorId) &&
    (!expected || (
      expected.source === 'named' && expected.roomId === session.roomId &&
      expected.actorId === session.actorId &&
      new URL(expected.socketUrl).origin === new URL(session.socketUrl).origin
    ));
};

const cloneAccountRealtimeSession = (session: AccountRealtimeSession): AccountRealtimeSession | null => {
  if (isOwnerRealtimeSession(session)) return cloneOwnerRealtimeSession(session);
  try {
    if (!Array.isArray(session.capabilities)) return null;
    return Object.freeze({
      ...session,
      capabilities: Object.freeze([...session.capabilities]) as readonly ['doc.read', 'doc.edit'],
    });
  } catch {
    return null;
  }
};

const ownerSocketUrlIsBearerFree = (value: string, ticketProtocol: string) => {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
      url.username ||
      url.password ||
      url.hash ||
      value.includes(ticketProtocol)
    ) {
      return false;
    }
    for (const key of url.searchParams.keys()) {
      if (/(?:authorization|credential|ticket|token|secret)/iu.test(key)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
};

const isValidOwnerRealtimeSession = (
  session: OwnerRealtimeSessionV3,
  expected?: OwnerRealtimeSessionV3,
) => {
  const capabilities = session.capabilities as readonly unknown[];
  if (
    session.protocolVersion !== OWNER_REALTIME_PROTOCOL_VERSION ||
    session.source !== 'owner' ||
    !session.routeDocumentId ||
    !session.remoteDocumentId ||
    !/^[A-Za-z0-9_-]{43}$/u.test(session.promotionSnapshotSha256) ||
    !session.actorId ||
    !Array.isArray(capabilities) ||
    capabilities.length !== 2 ||
    capabilities[0] !== 'doc.read' ||
    capabilities[1] !== 'doc.edit' ||
    session.socketProtocol !== OWNER_SOCKET_PROTOCOL ||
    !/^lash-ticket\.[A-Za-z0-9_-]{43}$/u.test(session.ticketProtocol) ||
    !session.expiresAt ||
    !ownerSocketUrlIsBearerFree(session.socketUrl, session.ticketProtocol)
  ) {
    return false;
  }
  return (
    !expected ||
    (session.routeDocumentId === expected.routeDocumentId &&
      session.remoteDocumentId === expected.remoteDocumentId &&
      session.promotionSnapshotSha256 === expected.promotionSnapshotSha256 &&
      session.actorId === expected.actorId &&
      session.source === expected.source &&
      session.protocolVersion === expected.protocolVersion &&
      session.socketProtocol === expected.socketProtocol)
  );
};

const cloneOwnerRealtimeSession = (
  session: OwnerRealtimeSessionV3,
): OwnerRealtimeSessionV3 | null => {
  try {
    if (!Array.isArray(session.capabilities)) return null;
    return Object.freeze({
      actorId: session.actorId,
      capabilities: Object.freeze([...session.capabilities]) as readonly ['doc.read', 'doc.edit'],
      expiresAt: session.expiresAt,
      promotionSnapshotSha256: session.promotionSnapshotSha256,
      protocolVersion: session.protocolVersion,
      remoteDocumentId: session.remoteDocumentId,
      routeDocumentId: session.routeDocumentId,
      socketProtocol: session.socketProtocol,
      socketUrl: session.socketUrl,
      source: session.source,
      ticketProtocol: session.ticketProtocol,
    });
  } catch {
    return null;
  }
};

const providerRemoteDocumentId = (session: RealtimeProviderSession) =>
  isAccountRealtimeSession(session) ? session.remoteDocumentId : session.documentId;

const providerRouteDocumentId = (session: RealtimeProviderSession) =>
  isAccountRealtimeSession(session) ? session.routeDocumentId : session.documentId;

const providerScope = (session: RealtimeProviderSession): ShareScope | null =>
  isAccountRealtimeSession(session) ? 'edit' : session.scope;

const providerSocket = (
  session: RealtimeProviderSession,
): { protocols: readonly string[] | undefined; url: string } =>
  isAccountRealtimeSession(session)
    ? {
        protocols: [session.socketProtocol, session.ticketProtocol],
        url: session.socketUrl,
      }
    : { protocols: undefined, url: socketUrl(session) };

const terminalErrors = new Set<RealtimeSessionTerminalError>([
  'invalid',
  'expired',
  'revoked',
  'document-mismatch',
  'scope-mismatch',
  'unsupported-scope',
  'invite-authority-unavailable',
  'protocol-error',
]);

const isRetryableHttpStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

class RealtimeSessionDeadlineError extends Error {
  constructor() {
    super('Realtime session exchange deadline elapsed.');
    this.name = 'RealtimeSessionDeadlineError';
  }
}

const isSupportedScope = (value: unknown): value is ShareScope | null =>
  value === null ||
  value === undefined ||
  value === 'view' ||
  value === 'comment' ||
  value === 'suggest' ||
  value === 'edit';

export const exchangeRealtimeSession = async ({
  actorId,
  fetcher = fetch,
  inviteToken,
  roomId,
  runtime,
  signal,
}: RealtimeSessionExchangeInput): Promise<RealtimeSessionExchangeResult> => {
  const url = sessionUrl(runtime.socketBaseUrl, roomId);
  const requestController = new AbortController();
  let rejectAttempt!: (reason: unknown) => void;
  const attemptBoundary = new Promise<never>((_resolve, reject) => {
    rejectAttempt = reject;
  });
  const abortFromCaller = () => {
    const reason =
      signal.reason ?? new DOMException('Realtime session exchange aborted.', 'AbortError');
    requestController.abort(reason);
    rejectAttempt(reason);
  };
  if (signal.aborted) abortFromCaller();
  else signal.addEventListener('abort', abortFromCaller, { once: true });
  const deadline = setTimeout(() => {
    const error = new RealtimeSessionDeadlineError();
    requestController.abort(error);
    rejectAttempt(error);
  }, SESSION_EXCHANGE_DEADLINE_MS);
  let response: Response;
  let payload: unknown;
  try {
    try {
      response = await Promise.race([
        fetcher(url, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ actorId, inviteToken }),
          signal: requestController.signal,
        }),
        attemptBoundary,
      ]);
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, error: 'transient', retryable: true, status: null };
    }

    try {
      payload = await Promise.race([response.json(), attemptBoundary]);
    } catch (error) {
      if (signal.aborted) throw error;
      const retryable = isRetryableHttpStatus(response.status);
      return {
        ok: false,
        error: retryable ? 'transient' : 'protocol-error',
        retryable,
        status: response.status,
      };
    }
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', abortFromCaller);
  }

  if (payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === false) {
    const failure = payload as { error?: unknown; retryable?: unknown };
    if (
      typeof failure.error === 'string' &&
      terminalErrors.has(failure.error as RealtimeSessionTerminalError) &&
      failure.retryable === false
    ) {
      return {
        ok: false,
        error: failure.error as RealtimeSessionTerminalError,
        retryable: false,
        status: response.status,
      };
    }
  }

  if (!response.ok) {
    const retryable = isRetryableHttpStatus(response.status);
    return {
      ok: false,
      error: retryable ? 'transient' : 'protocol-error',
      retryable,
      status: response.status,
    };
  }

  if (runtime.mode === 'configured') {
    return {
      ok: false,
      error: 'invite-authority-unavailable',
      retryable: false,
      status: response.status,
    };
  }

  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'protocol-error', retryable: false, status: response.status };
  }

  const success = payload as {
    ok?: unknown;
    accessToken?: unknown;
    inviteRequired?: unknown;
    protocolVersion?: unknown;
    grant?: {
      actorId?: unknown;
      capabilities?: unknown;
      documentId?: unknown;
      protocolVersion?: unknown;
      scope?: unknown;
    };
  };
  const capabilities = success.grant?.capabilities;
  const scope = success.grant?.scope ?? null;
  if (
    success.ok !== true ||
    success.protocolVersion !== REALTIME_PROTOCOL_VERSION ||
    success.grant?.protocolVersion !== REALTIME_PROTOCOL_VERSION ||
    success.grant.actorId !== actorId ||
    success.grant.documentId !== roomId ||
    typeof success.accessToken !== 'string' ||
    success.accessToken.length === 0 ||
    typeof success.inviteRequired !== 'boolean' ||
    !Array.isArray(capabilities) ||
    !capabilities.every((capability) => typeof capability === 'string') ||
    !capabilities.includes('doc.read') ||
    !isSupportedScope(scope)
  ) {
    return { ok: false, error: 'protocol-error', retryable: false, status: response.status };
  }

  return {
    ok: true,
    session: {
      accessToken: success.accessToken,
      actorId,
      capabilities,
      documentId: roomId,
      inviteRequired: success.inviteRequired,
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      scope: scope ?? null,
      socketBaseUrl: runtime.socketBaseUrl,
    },
  };
};

const actorLabel = (actorId: string) =>
  actorId
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || actorId;

const actorColor = (actorId: string) => {
  const colors = ['#2563eb', '#16a34a', '#9333ea', '#c2410c', '#0f766e', '#be123c'];
  let hash = 0;
  for (let index = 0; index < actorId.length; index += 1) {
    hash = (hash * 31 + actorId.charCodeAt(index)) >>> 0;
  }
  return colors[hash % colors.length];
};

const sameSelection = (left: RealtimeSelection | null, right: RealtimeSelection | null) => {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.from === right.from && left.to === right.to;
};

const isPresencePeer = (value: unknown): value is RealtimePresencePeer => {
  if (!value || typeof value !== 'object') return false;
  const peer = value as Partial<RealtimePresencePeer>;
  const selection = peer.selection;
  return (
    typeof peer.actorId === 'string' &&
    typeof peer.label === 'string' &&
    typeof peer.color === 'string' &&
    typeof peer.updatedAt === 'number' &&
    peer.connection === 'online' &&
    (selection === null ||
      (typeof selection === 'object' &&
        typeof selection.from === 'number' &&
        typeof selection.to === 'number'))
  );
};

const messageData = (event: unknown) => {
  if (!event || typeof event !== 'object') return '';
  return String((event as { data?: unknown }).data ?? '');
};

const defaultCreateSocket = (url: string, protocols?: readonly string[]): RealtimeSocket =>
  (protocols
    ? new WebSocket(url, [...protocols])
    : new WebSocket(url)) as unknown as RealtimeSocket;

export class LashRealtimeYjsProvider {
  readonly sharedHistory = new SharedHistoryClient((command) => {
    const session = this.session;
    const socket = this.socket;
    if (
      !session ||
      !isAccountRealtimeSession(session) ||
      !this.hydrated ||
      this.historyGeneration === null ||
      socket?.readyState !== SOCKET_OPEN ||
      (command.type === 'shared-history-restore' && (
        !isOwnerRealtimeSession(session) ||
        this.hasPendingBodyEdits() ||
        (this.authority && !this.authority.getSnapshot().bodyWrite)
      ))
    ) return false;
    try {
      socket.send(JSON.stringify(command));
      return true;
    } catch {
      return false;
    }
  });

  readonly reviewStore = new RealtimeChatStore((operationId, operation) => {
    const session = this.session;
    const socket = this.socket;
    if (
      this.lifecycleState !== 'active' ||
      !session ||
      !isAccountRealtimeSession(session) ||
      !this.hydrated ||
      !this.canWrite ||
      !socket ||
      socket.readyState !== SOCKET_OPEN ||
      (this.authority && this.authority.getSnapshot().metadataWrite !== 'document')
    ) {
      return false;
    }
    try {
      socket.send(JSON.stringify({
        type: 'review-operation', operationId, operation,
        ...(this.historyGeneration === null ? {} : { historyGeneration: this.historyGeneration }),
      }));
      return true;
    } catch {
      return false;
    }
  });

  private readonly authority: DocumentMutationAuthority | null;
  private readonly doc: Y.Doc;
  private session: RealtimeProviderSession | null;
  private readonly createSocket: (url: string, protocols?: readonly string[]) => RealtimeSocket;
  private readonly refreshOwnerSession: AccountRealtimeSessionRefresh | null;
  private readonly ownerSessionBinding: AccountRealtimeSession | null;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly hydrationTimeoutMs: number;
  private readonly listeners = new Set<(snapshot: RealtimeSnapshot) => void>();
  private readonly pendingUpdates = new Map<string, Uint8Array>();
  private peers = new Map<string, RealtimePresencePeer>();
  private queuedUpdates: Array<{ update: Uint8Array; updateId: string }> = [];
  private socket: RealtimeSocket | null = null;
  private socketHandlers: ProviderSocketHandlers | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hydrationTimer: ReturnType<typeof setTimeout> | null = null;
  private status: RealtimeConnectionState = 'connecting';
  private hydrated = false;
  private hasHydratedOnce = false;
  private hydrationStarted = false;
  private localListenerAttached = false;
  private historyGeneration: number | null = null;
  private localSelection: RealtimeSelection | null = null;
  private updateCounter = 0;
  private canWrite: boolean;
  private terminalReason: RealtimeProviderTerminalReason | null = null;
  private terminalBarrierEpoch: number | null = null;
  private lastAcknowledgedStateVector: Uint8Array;
  private destroyed = false;
  private lifecycleState: 'active' | 'sealed' | 'destroyed' = 'active';
  private recoverySeal: RealtimeRecoverySeal | null = null;
  private sealedInventory: RealtimeUnsyncedRecoverySnapshot | null = null;
  private socketEpoch = 0;
  private connectionAttempt = 0;
  private suppressAutoReconnect = false;
  private networkEventTarget: Window | null = null;
  private ownerRefreshController: AbortController | null = null;
  private readonly usedOwnerTickets = new Set<string>();
  private readonly ownerAuthorityCandidate: boolean;
  private authorityOwnershipCommitted: boolean;
  private startPromise: Promise<void> | null = null;
  private resolveStart: (() => void) | null = null;
  private rejectStart: ((error: Error) => void) | null = null;

  constructor({
    authority,
    clearTimeoutFn = clearTimeout,
    createSocket = defaultCreateSocket,
    doc,
    hydrationTimeoutMs = 5_000,
    refreshOwnerSession,
    session,
    setTimeoutFn = setTimeout,
  }: RealtimeProviderOptions) {
    this.authority = authority ?? null;
    this.doc = doc;
    const stableOwnerSession = isAccountRealtimeSession(session)
      ? cloneAccountRealtimeSession(session)
      : null;
    const stableSession = stableOwnerSession ?? session;
    if (
      isAccountRealtimeSession(session) &&
      (!stableOwnerSession ||
        !refreshOwnerSession ||
        !isValidAccountRealtimeSession(stableOwnerSession))
    ) {
      throw new RealtimeProviderStartError(
        'authorization',
        isOwnerRealtimeSession(session)
          ? 'Owner realtime authorization was invalid.'
          : 'Shared realtime authorization was invalid.',
      );
    }
    this.session = stableSession;
    this.createSocket = createSocket;
    this.refreshOwnerSession = refreshOwnerSession ?? null;
    this.ownerSessionBinding = isAccountRealtimeSession(stableSession) ? stableSession : null;
    this.ownerAuthorityCandidate = isOwnerRealtimeSession(stableSession);
    this.authorityOwnershipCommitted = !this.ownerAuthorityCandidate;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.hydrationTimeoutMs = hydrationTimeoutMs;
    this.canWrite = stableSession.capabilities.includes('doc.edit');
    this.lastAcknowledgedStateVector = Y.encodeStateVector(doc);
  }

  getDocument() {
    return this.doc;
  }

  getStatus() {
    return this.status;
  }

  getSnapshot(): RealtimeSnapshot {
    return {
      enabled: this.session !== null,
      hydrated: this.hydrated,
      canWrite: this.canWrite,
      actorId: this.session?.actorId ?? '',
      connectionState: this.status,
      syncState: this.syncState(),
      queuedUpdateCount: this.queuedUpdates.length,
      pendingUpdateCount: this.pendingUpdates.size,
      peers: [...this.peers.values()].sort((left, right) =>
        left.actorId.localeCompare(right.actorId),
      ),
    };
  }

  toJSON() {
    return this.getSnapshot();
  }

  subscribe(listener: (snapshot: RealtimeSnapshot) => void) {
    this.listeners.add(listener);
    try {
      listener(this.getSnapshot());
    } catch {
      // One observer must not prevent provider lifecycle work or other observers.
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  getTerminalReason() {
    return this.terminalReason;
  }

  hasSharedHistory() {
    return this.historyGeneration !== null;
  }

  private hasPendingBodyEdits() {
    return this.pendingUpdates.size > 0 || this.queuedUpdates.length > 0;
  }

  commitAuthorityOwnership(): boolean {
    if (!this.ownerAuthorityCandidate) return false;
    if (this.authorityOwnershipCommitted) return true;
    const session = this.session;
    const authoritySnapshot = this.authority?.getSnapshot();
    if (
      !session ||
      !isOwnerRealtimeSession(session) ||
      !authoritySnapshot ||
      this.destroyed ||
      this.lifecycleState !== 'active' ||
      this.terminalReason !== null ||
      !this.hydrated ||
      !this.canWrite ||
      this.status !== 'connected' ||
      authoritySnapshot.phase !== 'remote-hydrating' ||
      authoritySnapshot.routeDocumentId !== session.routeDocumentId ||
      authoritySnapshot.remoteDocumentId !== session.remoteDocumentId
    ) {
      return false;
    }
    this.authorityOwnershipCommitted = true;
    return true;
  }

  getUnsyncedRecoverySnapshot(): RealtimeUnsyncedRecoverySnapshot | null {
    if (this.sealedInventory) return cloneRecoverySnapshot(this.sealedInventory);
    const session = this.session;
    const reason = this.terminalReason;
    const authorityEpoch = this.terminalBarrierEpoch;
    if (!session || !reason || authorityEpoch === null) return null;
    const updates = new Map<string, Uint8Array>();
    for (const [updateId, bytes] of this.pendingUpdates) {
      updates.set(updateId, bytes.slice());
    }
    for (const { updateId, update } of this.queuedUpdates) {
      if (!updates.has(updateId)) updates.set(updateId, update.slice());
    }
    return {
      authorityEpoch,
      baselineStateVector: this.lastAcknowledgedStateVector.slice(),
      documentId: providerRouteDocumentId(session),
      principalId: session.actorId,
      ...(isAccountRealtimeSession(session)
        ? {
            remoteDocumentId: session.remoteDocumentId,
            routeDocumentId: session.routeDocumentId,
          }
        : {}),
      reason,
      sealedAt: new Date().toISOString(),
      scope: providerScope(session),
      updates: [...updates].map(([updateId, bytes]) => ({ bytes, updateId })),
    };
  }

  sealForRecovery(reason: RealtimeRecoveryReason): RealtimeRecoverySeal {
    if (this.recoverySeal) return this.recoverySeal;
    if (this.lifecycleState === 'destroyed' || !this.session) {
      throw new RealtimeProviderStartError('destroyed', 'Realtime provider was destroyed.');
    }

    const authorityEpoch =
      this.terminalBarrierEpoch ?? this.authority?.getSnapshot().epoch ?? this.socketEpoch;
    this.lifecycleState = 'sealed';
    this.reviewStore.dispose();
    this.sharedHistory.disconnect();
    if (this.terminalBarrierEpoch === null) {
      this.revokeAuthorityIfOwned();
    }
    this.socketEpoch += 1;
    this.abortOwnerRefresh();
    this.clearReconnectTimer();
    this.clearHydrationTimer();
    this.stopBrowserNetworkListeners();
    if (this.localListenerAttached) {
      this.doc.off('update', this.handleLocalUpdate);
      this.localListenerAttached = false;
    }
    const socket = this.socket;
    this.detachSocket(socket);
    this.socket = null;
    socket?.close(1000, 'provider sealed');
    this.requeuePendingUpdates();
    this.canWrite = false;
    this.hydrated = false;
    this.hydrationStarted = false;
    this.peers.clear();
    this.status = 'offline';
    const reject = this.rejectStart;
    this.resolveStart = null;
    this.rejectStart = null;
    reject?.(new RealtimeProviderStartError('destroyed', 'Realtime provider was destroyed.'));

    const inventory: RealtimeUnsyncedRecoverySnapshot = {
      authorityEpoch,
      baselineStateVector: this.lastAcknowledgedStateVector.slice(),
      documentId: providerRouteDocumentId(this.session),
      principalId: this.session.actorId,
      ...(isAccountRealtimeSession(this.session)
        ? {
            remoteDocumentId: this.session.remoteDocumentId,
            routeDocumentId: this.session.routeDocumentId,
          }
        : {}),
      reason,
      sealedAt: new Date().toISOString(),
      scope: providerScope(this.session),
      updates: this.queuedUpdates.map(({ update, updateId }) => ({
        bytes: update.slice(),
        updateId,
      })),
    };
    this.sealedInventory = inventory;
    this.recoverySeal = {
      id: `${inventory.documentId}:${inventory.authorityEpoch}:${this.socketEpoch}:${this.updateCounter}`,
      snapshot: cloneRecoverySnapshot(inventory),
    };
    this.emit();
    return this.recoverySeal;
  }

  commitDestroy(
    seal: RealtimeRecoverySeal,
    disposition: RealtimeRecoveryDestroyDisposition,
  ): boolean {
    if (
      this.lifecycleState !== 'sealed' ||
      !this.recoverySeal ||
      !this.sealedInventory ||
      seal.id !== this.recoverySeal.id
    ) {
      return false;
    }
    if (disposition.kind === 'empty') {
      if (this.sealedInventory.updates.length !== 0) return false;
    } else if (!recoveryRecordMatches(this.sealedInventory, disposition.record)) {
      return false;
    }
    this.finishDestroy();
    return true;
  }

  discardSealedRecovery(
    seal: RealtimeRecoverySeal,
    confirmation: { kind: 'explicit-user-discard'; confirmationId: string },
  ): boolean {
    if (
      this.lifecycleState !== 'sealed' ||
      !confirmation.confirmationId ||
      !this.recoverySeal ||
      seal.id !== this.recoverySeal.id
    ) {
      return false;
    }
    this.finishDestroy();
    return true;
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.destroyed || this.lifecycleState !== 'active' || !this.session) {
      return Promise.reject(
        new RealtimeProviderStartError('destroyed', 'Realtime provider was destroyed.'),
      );
    }
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
    this.connect();
    return this.startPromise;
  }

  setLocalSelection(selection: RealtimeSelection | null) {
    if (this.lifecycleState !== 'active') return;
    const normalized = selection
      ? {
          from: Math.max(0, Math.floor(selection.from)),
          to: Math.max(0, Math.floor(selection.to)),
        }
      : null;
    if (sameSelection(this.localSelection, normalized)) return;
    this.localSelection = normalized;
    if (this.hydrated) this.sendAwareness();
  }

  disconnectForTest() {
    if (
      this.destroyed ||
      this.lifecycleState !== 'active' ||
      !this.session ||
      this.terminalReason
    ) {
      return;
    }
    this.suppressAutoReconnect = true;
    this.socketEpoch += 1;
    this.abortOwnerRefresh();
    this.clearReconnectTimer();
    this.clearHydrationTimer();
    const socket = this.socket;
    this.detachSocket(socket);
    this.socket = null;
    this.requeuePendingUpdates();
    this.hydrated = false;
    this.hydrationStarted = false;
    this.peers.clear();
    this.setConnectionState('reconnecting');
    socket?.close(4000, 'test disconnect');
  }

  reconnectForTest() {
    this.reconnectNow();
  }

  reconnectNow() {
    if (
      this.destroyed ||
      this.lifecycleState !== 'active' ||
      !this.session ||
      this.terminalReason ||
      this.socket ||
      this.ownerRefreshController
    ) {
      return;
    }
    this.suppressAutoReconnect = false;
    this.clearReconnectTimer();
    this.connectionAttempt = 0;
    this.connect();
  }

  destroy(): boolean {
    if (this.lifecycleState === 'destroyed') return true;
    const seal = this.sealForRecovery(this.terminalReason ?? 'lifecycle');
    return this.commitDestroy(seal, { kind: 'empty' });
  }

  private connect() {
    const session = this.session;
    if (
      !session ||
      this.destroyed ||
      this.lifecycleState !== 'active' ||
      this.socket ||
      this.ownerRefreshController ||
      this.suppressAutoReconnect ||
      this.terminalReason
    ) {
      return;
    }
    this.connectionAttempt += 1;
    const epoch = ++this.socketEpoch;
    this.hydrationStarted = false;
    this.hydrated = false;
    this.setConnectionState(this.hasHydratedOnce ? 'reconnecting' : 'connecting');

    if (isAccountRealtimeSession(session) && this.usedOwnerTickets.size > 0) {
      void this.refreshAndOpenOwnerSocket(epoch);
      return;
    }
    this.openSocket(session, epoch);
  }

  private async refreshAndOpenOwnerSocket(epoch: number) {
    if (this.lifecycleState !== 'active' || epoch !== this.socketEpoch) return;
    const binding = this.ownerSessionBinding;
    const refresh = this.refreshOwnerSession;
    if (!binding || !refresh) {
      this.failProtocol(epoch, 'Owner realtime authorization was unavailable.');
      return;
    }
    const controller = new AbortController();
    this.ownerRefreshController = controller;
    this.armHydrationTimer(epoch);
    let refreshed: AccountRealtimeSession;
    try {
      refreshed = await refresh(binding.routeDocumentId, controller.signal);
    } catch (error) {
      if (this.ownerRefreshController !== controller) return;
      this.ownerRefreshController = null;
      this.clearHydrationTimer();
      if (error instanceof RealtimeProviderStartError) {
        if (error.kind === 'authorization') {
          this.failTerminal(epoch, 'scope-mismatch', 'Document access could not be renewed.');
          return;
        }
        if (error.kind === 'protocol') {
          this.failProtocol(epoch, 'Document authorization changed unexpectedly.');
          return;
        }
      }
      this.handleTransientSocketFailure(epoch);
      return;
    }
    if (this.ownerRefreshController !== controller) return;
    this.ownerRefreshController = null;
    this.clearHydrationTimer();
    const stableRefreshed = refreshed && cloneAccountRealtimeSession(refreshed);
    if (
      !stableRefreshed ||
      !isValidAccountRealtimeSession(stableRefreshed, binding) ||
      this.usedOwnerTickets.has(stableRefreshed.ticketProtocol)
    ) {
      this.failProtocol(epoch, 'Document authorization changed unexpectedly.');
      return;
    }
    this.session = stableRefreshed;
    this.openSocket(stableRefreshed, epoch);
  }

  private openSocket(session: RealtimeProviderSession, epoch: number) {
    if (
      this.destroyed ||
      this.lifecycleState !== 'active' ||
      epoch !== this.socketEpoch ||
      this.socket ||
      this.terminalReason
    ) {
      return;
    }
    const connection = providerSocket(session);
    if (isAccountRealtimeSession(session)) {
      if (
        !isValidAccountRealtimeSession(session, this.ownerSessionBinding ?? undefined) ||
        this.usedOwnerTickets.has(session.ticketProtocol)
      ) {
        this.failProtocol(epoch, 'Owner realtime authorization was invalid.');
        return;
      }
      this.usedOwnerTickets.add(session.ticketProtocol);
    }

    let socket: RealtimeSocket;
    try {
      socket = this.createSocket(connection.url, connection.protocols);
    } catch {
      this.handleTransientSocketFailure(epoch);
      return;
    }
    if (this.destroyed || epoch !== this.socketEpoch) {
      socket.close(1000, 'stale provider socket');
      return;
    }
    this.socket = socket;
    this.armHydrationTimer(epoch);

    const active = () =>
      !this.destroyed &&
      this.lifecycleState === 'active' &&
      this.socket === socket &&
      this.socketEpoch === epoch;
    const handlers: ProviderSocketHandlers = {
      open: () => {
        if (!active()) return;
        this.emit();
      },
      message: (event) => {
        if (!active()) return;
        this.handleMessage(messageData(event), epoch);
      },
      close: (event) => {
        if (!active()) return;
        this.sharedHistory.disconnect();
        const restored = (event as { code?: number } | null)?.code === SHARED_HISTORY_RESTORE_CLOSE;
        if (restored && this.hasPendingBodyEdits()) {
          this.failProtocol(epoch, 'The document was restored while edits were waiting to sync.');
          return;
        }
        const terminalReason = this.terminalReasonForClose(event);
        if (terminalReason) {
          this.failTerminal(
            epoch,
            terminalReason,
            terminalReason === 'protocol-error'
              ? 'Realtime protocol was rejected.'
              : 'Realtime document access was rejected.',
            false,
          );
          return;
        }
        this.detachSocket(socket);
        this.socket = null;
        this.requeuePendingUpdates();
        this.hydrated = false;
        this.hydrationStarted = false;
        this.peers.clear();
        this.clearHydrationTimer();
        this.setConnectionState(this.destroyed ? 'offline' : 'reconnecting');
        if (!this.destroyed && !this.suppressAutoReconnect) {
          this.handleTransientSocketFailure(epoch);
        }
      },
      error: () => {
        if (!active()) return;
        this.setConnectionState('reconnecting');
      },
    };
    this.socketHandlers = handlers;
    socket.addEventListener('open', handlers.open);
    socket.addEventListener('message', handlers.message);
    socket.addEventListener('close', handlers.close);
    socket.addEventListener('error', handlers.error);
  }

  private handleMessage(data: string, epoch: number) {
    if (this.lifecycleState !== 'active') return;
    const session = this.session;
    if (!session) return;
    const remoteDocumentId = providerRemoteDocumentId(session);
    const protocolVersion = session.protocolVersion;
    let message: RealtimeMessage;
    try {
      message = JSON.parse(data) as RealtimeMessage;
    } catch {
      this.failProtocol(epoch, 'Malformed realtime frame.');
      return;
    }

    if (message.type === 'shared-history-result') {
      if (
        this.hydrated &&
        isAccountRealtimeSession(session) &&
        message.roomId === remoteDocumentId
      ) this.sharedHistory.receive(message);
      return;
    }

    if (
      message.type === 'review-snapshot' ||
      message.type === 'review-operation' ||
      message.type === 'review-ack' ||
      message.type === 'review-error'
    ) {
      if (
        this.hydrated &&
        isAccountRealtimeSession(session) &&
        message.roomId === remoteDocumentId
      ) {
        this.reviewStore.receive(message);
      }
      return;
    }

    if (message.type === 'room-ready') {
      if (
        this.hydrationStarted ||
        message.roomId !== remoteDocumentId ||
        message.protocolVersion !== protocolVersion
      ) {
        this.failProtocol(epoch, 'Invalid room-ready protocol frame.');
        return;
      }
      if (isAccountRealtimeSession(session)) {
        const generation = message.historyGeneration;
        if (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 0)) {
          this.failProtocol(epoch, 'Invalid document restore generation.');
          return;
        }
        if (this.historyGeneration !== null && (
          generation === undefined ||
          generation < this.historyGeneration
        )) {
          this.failProtocol(epoch, 'The document version changed while reconnecting.');
          return;
        }
        if ((generation ?? 0) > (this.historyGeneration ?? 0) && this.hasPendingBodyEdits()) {
          this.failProtocol(epoch, 'The document was restored while edits were waiting to sync.');
          return;
        }
        this.historyGeneration = generation ?? null;
      }
      this.hydrationStarted = true;
      this.setConnectionState('hydrating');
      return;
    }

    if (message.type === 'room-hydration-complete') {
      if (
        !this.hydrationStarted ||
        message.roomId !== remoteDocumentId ||
        message.protocolVersion !== protocolVersion ||
        (isAccountRealtimeSession(session) &&
          (message.historyGeneration ?? null) !== this.historyGeneration)
      ) {
        this.failProtocol(epoch, 'Invalid hydration-complete protocol frame.');
        return;
      }
      this.completeHydration();
      return;
    }

    if (message.type === 'yjs-update') {
      if (
        (!this.hydrationStarted && !this.hydrated) ||
        (isAccountRealtimeSession(session)
          ? message.roomId !== remoteDocumentId
          : message.roomId !== undefined && message.roomId !== remoteDocumentId) ||
        typeof message.update !== 'string'
      ) {
        this.failProtocol(epoch, 'Invalid Yjs update frame.');
        return;
      }
      try {
        const apply = () =>
          Y.applyUpdate(this.doc, base64ToBytes(message.update ?? ''), REMOTE_UPDATE_ORIGIN);
        const applied = this.authority
          ? this.authority.runRemoteBodyApply(remoteDocumentId, apply)
          : (apply(), true);
        if (!applied) {
          this.failProtocol(epoch, 'Remote update arrived outside document read authority.');
        }
      } catch {
        this.failProtocol(epoch, 'Invalid Yjs update payload.');
      }
      if (this.hydrated && this.hasSharedHistory()) this.sharedHistory.refresh();
      return;
    }

    if (message.type === 'sync-ack' && typeof message.updateId === 'string') {
      if (isAccountRealtimeSession(session) && message.roomId !== remoteDocumentId) {
        this.failProtocol(epoch, 'Invalid sync acknowledgement frame.');
        return;
      }
      if (!this.hydrated) return;
      this.pendingUpdates.delete(message.updateId);
      if (this.pendingUpdates.size === 0 && this.queuedUpdates.length === 0) {
        this.lastAcknowledgedStateVector = Y.encodeStateVector(this.doc);
        if (this.hasSharedHistory()) this.sharedHistory.refresh();
      }
      this.emit();
      return;
    }

    if (
      message.type === 'error' &&
      isAccountRealtimeSession(session) &&
      message.roomId !== remoteDocumentId
    ) {
      this.failProtocol(epoch, 'Invalid realtime error frame.');
      return;
    }

    if (message.type === 'error' && message.code === 'scope_mismatch') {
      this.failTerminal(
        epoch,
        'scope-mismatch',
        'Realtime write scope no longer matches this document.',
      );
      return;
    }

    if (message.type === 'awareness-state' && Array.isArray(message.peers)) {
      if (isAccountRealtimeSession(session) && message.roomId !== remoteDocumentId) {
        this.failProtocol(epoch, 'Invalid awareness frame.');
        return;
      }
      if (!this.hydrated) return;
      const nextPeers = new Map<string, RealtimePresencePeer>();
      for (const peer of message.peers) {
        if (isPresencePeer(peer) && peer.actorId !== this.session?.actorId) {
          nextPeers.set(peer.actorId, peer);
        }
      }
      this.peers = nextPeers;
      this.emit();
    }
  }

  private completeHydration() {
    this.clearHydrationTimer();
    this.hydrationStarted = false;
    const firstHydration = !this.hasHydratedOnce;
    this.hydrated = true;
    this.hasHydratedOnce = true;
    this.connectionAttempt = 0;
    if (firstHydration && this.canRetryOpenAccountSession() && typeof window !== 'undefined') {
      this.networkEventTarget = window;
      window.addEventListener('offline', this.handleBrowserOffline);
      window.addEventListener('online', this.wakeAfterNetworkRestored);
    }
    if (this.pendingUpdates.size === 0 && this.queuedUpdates.length === 0) {
      this.lastAcknowledgedStateVector = Y.encodeStateVector(this.doc);
    }
    if (!this.localListenerAttached) {
      this.doc.on('update', this.handleLocalUpdate);
      this.localListenerAttached = true;
    }
    this.setConnectionState('connected');
    if (this.hasSharedHistory()) this.sharedHistory.refresh();
    for (const queued of this.queuedUpdates.splice(0)) {
      this.sendUpdatePayload(queued.update, queued.updateId);
    }
    this.sendAwareness();
    if (firstHydration) {
      const resolve = this.resolveStart;
      this.resolveStart = null;
      this.rejectStart = null;
      resolve?.();
    }
  }

  private handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (this.lifecycleState !== 'active') return;
    if (origin === REMOTE_UPDATE_ORIGIN) return;
    this.sendUpdate(update);
  };

  private sendUpdate(update: Uint8Array) {
    if (
      this.lifecycleState !== 'active' ||
      !update.length ||
      !this.canWrite ||
      (this.authority && !this.authority.getSnapshot().bodyWrite)
    ) {
      return;
    }
    const updateId = this.nextUpdateId();
    const socket = this.socket;
    if (!this.hydrated || !socket || socket.readyState !== SOCKET_OPEN) {
      this.queuedUpdates.push({ update, updateId });
      this.emit();
      return;
    }
    this.sendUpdatePayload(update, updateId);
  }

  private sendUpdatePayload(update: Uint8Array, updateId: string) {
    if (
      this.lifecycleState !== 'active' ||
      !update.length ||
      !this.canWrite ||
      (this.authority && !this.authority.getSnapshot().bodyWrite)
    ) {
      return;
    }
    const socket = this.socket;
    if (!this.hydrated || !socket || socket.readyState !== SOCKET_OPEN) {
      this.queuedUpdates.push({ update, updateId });
      this.emit();
      return;
    }
    this.pendingUpdates.set(updateId, update);
    socket.send(
      JSON.stringify({
        type: 'yjs-update',
        updateId,
        update: bytesToBase64(update),
        ...(this.historyGeneration === null ? {} : { historyGeneration: this.historyGeneration }),
      }),
    );
    this.emit();
  }

  private sendAwareness() {
    if (this.lifecycleState !== 'active') return;
    const socket = this.socket;
    if (!this.hydrated || !socket || socket.readyState !== SOCKET_OPEN) return;
    socket.send(
      JSON.stringify({
        type: 'awareness-update',
        awareness: {
          label: actorLabel(this.session?.actorId ?? ''),
          color: actorColor(this.session?.actorId ?? ''),
          selection: this.localSelection,
        },
      }),
    );
  }

  private nextUpdateId() {
    this.updateCounter += 1;
    return `${this.session?.actorId ?? 'actor'}-${Date.now().toString(36)}-${this.updateCounter}`;
  }

  private syncState(): RealtimeSyncState {
    if (!this.session) return this.destroyed ? 'offline' : 'disabled';
    if (this.status === 'connecting') return 'connecting';
    if (this.status === 'hydrating') return 'hydrating';
    if (this.status === 'reconnecting') return 'reconnecting';
    if (this.status === 'offline') return 'offline';
    if (this.queuedUpdates.length || this.pendingUpdates.size) return 'syncing';
    return this.hydrated ? 'saved' : 'connecting';
  }

  private setConnectionState(status: RealtimeConnectionState) {
    this.status = status;
    this.emit();
  }

  private handleTransientSocketFailure(epoch: number) {
    if (this.destroyed || this.lifecycleState !== 'active' || epoch !== this.socketEpoch) return;
    if (this.canRetryOpenAccountSession()) {
      this.scheduleReconnect(
        ACCOUNT_RECONNECT_DELAYS_MS[this.connectionAttempt] ?? ACCOUNT_RECONNECT_MAX_DELAY_MS,
      );
      this.setConnectionState('reconnecting');
      return;
    }
    if (this.connectionAttempt >= 3) {
      this.status = 'offline';
      const reject = this.rejectStart;
      this.resolveStart = null;
      this.rejectStart = null;
      reject?.(
        new RealtimeProviderStartError(
          'transient-exhausted',
          'Realtime transport attempts were exhausted.',
        ),
      );
      this.emit();
      return;
    }
    const delay = this.connectionAttempt === 1 ? 250 : 1_000;
    this.scheduleReconnect(delay);
  }

  private canRetryOpenAccountSession() {
    return this.hasHydratedOnce && this.session !== null && isAccountRealtimeSession(this.session);
  }

  private handleBrowserOffline = () => {
    if (this.suppressAutoReconnect) return;
    this.detachTransientTransport('Browser went offline');
    this.handleTransientSocketFailure(this.socketEpoch);
  };

  private wakeAfterNetworkRestored = () => {
    if (this.suppressAutoReconnect || this.hydrated) return;
    if (this.socket || this.ownerRefreshController) {
      this.detachTransientTransport('Browser network restored');
    }
    this.reconnectNow();
  };

  private stopBrowserNetworkListeners() {
    this.networkEventTarget?.removeEventListener('offline', this.handleBrowserOffline);
    this.networkEventTarget?.removeEventListener('online', this.wakeAfterNetworkRestored);
    this.networkEventTarget = null;
  }

  private scheduleReconnect(delayMs: number) {
    if (this.destroyed || this.lifecycleState !== 'active' || this.reconnectTimer) return;
    const schedule = this.setTimeoutFn;
    this.reconnectTimer = schedule(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private armHydrationTimer(epoch: number) {
    this.clearHydrationTimer();
    const schedule = this.setTimeoutFn;
    this.hydrationTimer = schedule(() => {
      this.hydrationTimer = null;
      if (this.socket?.readyState !== SOCKET_OPEN) {
        this.expireTransportAttempt(epoch);
        return;
      }
      this.failProtocol(epoch, 'Realtime hydration did not complete.');
    }, this.hydrationTimeoutMs);
  }

  private expireTransportAttempt(epoch: number) {
    if (this.destroyed || this.lifecycleState !== 'active' || epoch !== this.socketEpoch) return;
    this.detachTransientTransport('Realtime attempt timed out');
    if (this.canRetryOpenAccountSession()) {
      this.handleTransientSocketFailure(this.socketEpoch);
      return;
    }
    this.status = 'offline';
    const reject = this.rejectStart;
    this.resolveStart = null;
    this.rejectStart = null;
    reject?.(
      new RealtimeProviderStartError(
        'transient-exhausted',
        'Realtime transport did not open before its deadline.',
      ),
    );
    this.emit();
  }

  private detachTransientTransport(reason: string) {
    this.socketEpoch += 1;
    this.abortOwnerRefresh();
    this.clearHydrationTimer();
    this.clearReconnectTimer();
    this.sharedHistory.disconnect();
    const socket = this.socket;
    this.detachSocket(socket);
    this.socket = null;
    socket?.close(4000, reason);
    this.requeuePendingUpdates();
    this.hydrated = false;
    this.hydrationStarted = false;
    this.peers.clear();
  }

  private failProtocol(epoch: number, message: string) {
    this.failTerminal(epoch, 'protocol-error', message);
  }

  private failTerminal(
    epoch: number,
    reason: RealtimeProviderTerminalReason,
    message: string,
    closeSocket = true,
  ) {
    if (this.destroyed || this.lifecycleState !== 'active' || epoch !== this.socketEpoch) return;
    this.terminalBarrierEpoch = this.authority?.getSnapshot().epoch ?? this.socketEpoch;
    this.revokeAuthorityIfOwned();
    this.reviewStore.dispose();
    this.sharedHistory.disconnect();
    this.socketEpoch += 1;
    this.abortOwnerRefresh();
    this.clearHydrationTimer();
    this.clearReconnectTimer();
    this.stopBrowserNetworkListeners();
    const socket = this.socket;
    this.detachSocket(socket);
    this.socket = null;
    if (closeSocket) {
      const closeCode = reason === 'invalid' ? 4401 : reason === 'scope-mismatch' ? 4403 : 4409;
      socket?.close(closeCode, reason);
    }
    this.terminalReason = reason;
    this.canWrite = false;
    this.hydrated = false;
    this.hydrationStarted = false;
    this.peers.clear();
    this.status = 'offline';
    const reject = this.rejectStart;
    this.resolveStart = null;
    this.rejectStart = null;
    reject?.(
      new RealtimeProviderStartError(
        reason === 'protocol-error' ? 'protocol' : 'authorization',
        message,
      ),
    );
    this.emit();
  }

  private terminalReasonForClose(event: unknown): RealtimeProviderTerminalReason | null {
    if (!event || typeof event !== 'object') return null;
    const code = (event as { code?: unknown }).code;
    if (code === 4401) return 'invalid';
    if (code === 4403) return 'scope-mismatch';
    if (code === 4409 || code === 1002 || code === 1003 || code === 1007 || code === 1008) {
      return 'protocol-error';
    }
    return null;
  }

  private requeuePendingUpdates() {
    if (this.pendingUpdates.size === 0) return;
    const queuedIds = new Set(this.queuedUpdates.map(({ updateId }) => updateId));
    const unacknowledged = [...this.pendingUpdates.entries()]
      .filter(([updateId]) => !queuedIds.has(updateId))
      .map(([updateId, update]) => ({ update, updateId }));
    this.queuedUpdates = [...unacknowledged, ...this.queuedUpdates];
    this.pendingUpdates.clear();
  }

  private detachSocket(socket: RealtimeSocket | null) {
    this.reviewStore.disconnect();
    const handlers = this.socketHandlers;
    if (!socket || !handlers) return;
    socket.removeEventListener('open', handlers.open);
    socket.removeEventListener('message', handlers.message);
    socket.removeEventListener('close', handlers.close);
    socket.removeEventListener('error', handlers.error);
    if (this.socketHandlers === handlers) this.socketHandlers = null;
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer === null) return;
    const cancel = this.clearTimeoutFn;
    cancel(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private abortOwnerRefresh() {
    const controller = this.ownerRefreshController;
    this.ownerRefreshController = null;
    controller?.abort();
  }

  private revokeAuthorityIfOwned() {
    if (!this.ownerAuthorityCandidate || this.authorityOwnershipCommitted) {
      this.authority?.revoke();
    }
  }

  private clearHydrationTimer() {
    if (this.hydrationTimer === null) return;
    const cancel = this.clearTimeoutFn;
    cancel(this.hydrationTimer);
    this.hydrationTimer = null;
  }

  private finishDestroy() {
    this.destroyed = true;
    this.lifecycleState = 'destroyed';
    this.socketEpoch += 1;
    this.abortOwnerRefresh();
    this.clearReconnectTimer();
    this.clearHydrationTimer();
    if (this.localListenerAttached) {
      this.doc.off('update', this.handleLocalUpdate);
      this.localListenerAttached = false;
    }
    const socket = this.socket;
    this.detachSocket(socket);
    this.socket = null;
    socket?.close(1000, 'provider destroyed');
    this.queuedUpdates = [];
    this.pendingUpdates.clear();
    this.peers.clear();
    this.session = null;
    this.hydrated = false;
    this.hasHydratedOnce = false;
    this.hydrationStarted = false;
    this.canWrite = false;
    this.status = 'offline';
    const reject = this.rejectStart;
    this.resolveStart = null;
    this.rejectStart = null;
    reject?.(new RealtimeProviderStartError('destroyed', 'Realtime provider was destroyed.'));
    this.emit();
  }

  private emit() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Listener failure is isolated from provider state transitions and peers.
      }
    }
  }
}

const cloneRecoverySnapshot = (
  snapshot: RealtimeUnsyncedRecoverySnapshot,
): RealtimeUnsyncedRecoverySnapshot => ({
  ...snapshot,
  baselineStateVector: snapshot.baselineStateVector.slice(),
  updates: snapshot.updates.map(({ bytes, updateId }) => ({ bytes: bytes.slice(), updateId })),
});

const equalBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const recoveryRecordMatches = (
  snapshot: RealtimeUnsyncedRecoverySnapshot,
  record: RealtimeRecoveryJournalRecordV2 | RealtimeRecoveryJournalRecordV3,
) => {
  const identityMatches =
    snapshot.routeDocumentId !== undefined && snapshot.remoteDocumentId !== undefined
      ? record.version === 3 &&
        record.routeDocumentId === snapshot.routeDocumentId &&
        record.remoteDocumentId === snapshot.remoteDocumentId &&
        record.documentId === snapshot.routeDocumentId
      : record.version === 2 && record.documentId === snapshot.documentId;
  return (
    identityMatches &&
    record.epoch === snapshot.authorityEpoch &&
    record.principalId === snapshot.principalId &&
    record.reason === snapshot.reason &&
    record.sealedAt === snapshot.sealedAt &&
    record.scope === snapshot.scope &&
    equalBytes(record.baselineStateVector, snapshot.baselineStateVector) &&
    record.updates.length === snapshot.updates.length &&
    record.updates.every(
      (update, index) =>
        update.updateId === snapshot.updates[index]?.updateId &&
        equalBytes(update.bytes, snapshot.updates[index]?.bytes ?? new Uint8Array()),
    )
  );
};

export const createRealtimeDocument = () => new Y.Doc();

export const createAuthorizedRealtimeResources = (
  session: AuthorizedRealtimeSession | NamedRealtimeSessionV5,
  options: Omit<RealtimeProviderOptions, 'doc' | 'session'> = {},
): AuthorizedRealtimeResources => {
  const doc = createRealtimeDocument();
  return {
    doc,
    provider: new LashRealtimeYjsProvider({ ...options, doc, session }),
  };
};

export const createOwnerCandidateResources = (
  session: OwnerRealtimeSessionV3,
  options: OwnerRealtimeCandidateOptions,
): OwnerRealtimeCandidateResources => {
  const doc = createRealtimeDocument();
  return {
    doc,
    provider: new LashRealtimeYjsProvider({ ...options, doc, session }),
  };
};
