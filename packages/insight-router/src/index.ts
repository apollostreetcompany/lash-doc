/**
 * @lash/insight-router — routes "insights" (selections, notes, AI rationale,
 * chat messages, extracted todos) to "writing places" (destinations).
 *
 * This is the hardened core of "the feature that routes insights to the right
 * place." Hardening contract:
 *   - Payloads are validated up-front; invalid payloads FAIL LOUD (never silently
 *     dropped or rewritten). See {@link validateInsightPayload}.
 *   - Each writing place is ISOLATED: a place that throws/rejects surfaces a typed
 *     failure for THAT place only — the router NEVER silently falls back to another
 *     place (CLAUDE.md: no silent fallbacks that mask real failures).
 *   - IDEMPOTENCY: within a single router instance, a (payload.id + placeId) pair
 *     is written at most once; repeat routes return the prior success flagged
 *     `idempotent: true`. NOTE: the dedup map is in-memory — it does not survive a
 *     process restart. A durably exactly-once destination must enforce its own
 *     unique key (a stable {@link stableInsightId} makes that straightforward).
 *   - Every attempt is recorded in an append-only audit trail ({@link InsightRouter.history}).
 *
 * Built-in places (wired by the host app via factories):
 *   - 'doc'        — insert the insight into the current document.
 *   - 'new-doc'    — spin the insight out into a fresh document.
 *   - 'clipboard'  — copy the insight to the clipboard.
 *
 * Special external "writing places" — placeholder adapters that stay UNCONFIGURED
 * (and fail loud with a clear contract message) until a client is supplied:
 *   - 'persephone' — memory store.
 *   - 'hermes'     — agent dispatch.
 *   - 'garden'     — todo lists (garden-state / gardenos).
 */

import type { ActorRef } from '@lash/types';

// ---------------------------------------------------------------------------
// Insight payload
// ---------------------------------------------------------------------------

export type InsightKind =
  | 'selection'
  | 'note'
  | 'ai-rationale'
  | 'ai-answer'
  | 'chat-message'
  | 'todo';

export const INSIGHT_KINDS: readonly InsightKind[] = [
  'selection',
  'note',
  'ai-rationale',
  'ai-answer',
  'chat-message',
  'todo',
];

export interface InsightSource {
  /** Character range in the source document the insight was lifted from. */
  range?: { from: number; to: number };
  /** Who/what produced the insight. */
  author?: ActorRef;
  /** Document version the range refers to. */
  baseVersion?: string | null;
}

export interface InsightPayload {
  /** Stable idempotency key. Use {@link stableInsightId} for content-derived ids. */
  id: string;
  kind: InsightKind;
  /** The content to route. Must be non-empty. */
  text: string;
  docId: string;
  source?: InsightSource;
  tags?: string[];
  /** ISO-8601 timestamp. */
  createdAt: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Writing places
// ---------------------------------------------------------------------------

export type WritingPlaceId = string;
export type WritingPlaceKind = 'builtin' | 'external';
export type WriteFailureCode = 'unconfigured' | 'rejected' | 'invalid' | 'failed';

export type WriteResult =
  | { ok: true; placeId: WritingPlaceId; ref: string; idempotent: boolean; at: string }
  | { ok: false; placeId: WritingPlaceId; code: WriteFailureCode; error: string; at: string };

export interface WriteContext {
  /** Clock injected by the router so writes share one timestamp source. */
  now: () => string;
  signal?: AbortSignal;
}

export interface WritingPlace {
  id: WritingPlaceId;
  label: string;
  kind: WritingPlaceKind;
  description: string;
  /** Whether the place can actually accept writes right now. Builtins: always true. */
  isConfigured: () => boolean;
  /** Guard. Return `true` to accept, or a reason string to reject this payload. */
  accepts: (payload: InsightPayload) => true | string;
  write: (payload: InsightPayload, ctx: WriteContext) => Promise<WriteResult> | WriteResult;
}

export interface RouteAuditEntry {
  payloadId: string;
  placeId: WritingPlaceId;
  kind: InsightKind | 'unknown';
  /** Who/what produced the routed insight, when known (payload.source.author). */
  actor?: ActorRef;
  result: WriteResult;
  at: string;
}

// ---------------------------------------------------------------------------
// Validation + helpers
// ---------------------------------------------------------------------------

export type PayloadValidation = { ok: true } | { ok: false; errors: string[] };

export const validateInsightPayload = (payload: InsightPayload): PayloadValidation => {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['payload must be an object'] };
  }
  const errors: string[] = [];
  if (!payload.id || typeof payload.id !== 'string') errors.push('payload.id is required');
  if (!INSIGHT_KINDS.includes(payload.kind)) {
    errors.push(`payload.kind must be one of: ${INSIGHT_KINDS.join(', ')}`);
  }
  if (typeof payload.text !== 'string' || payload.text.trim().length === 0) {
    errors.push('payload.text must be a non-empty string');
  }
  if (!payload.docId || typeof payload.docId !== 'string') errors.push('payload.docId is required');
  if (!payload.createdAt || Number.isNaN(Date.parse(payload.createdAt))) {
    errors.push('payload.createdAt must be an ISO-8601 timestamp');
  }
  if (payload.source?.range) {
    const { from, to } = payload.source.range;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
      errors.push('payload.source.range must satisfy 0 <= from <= to');
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
};

/** Deterministic djb2 hash → stable, content-derived insight id (good for idempotency). */
export const stableInsightId = (
  input: Pick<InsightPayload, 'docId' | 'kind' | 'text'> & { source?: InsightSource },
): string => {
  const range = input.source?.range ? `${input.source.range.from}-${input.source.range.to}` : 'na';
  const basis = `${input.docId}|${input.kind}|${range}|${input.text}`;
  let hash = 5381;
  for (let i = 0; i < basis.length; i += 1) {
    hash = ((hash << 5) + hash + basis.charCodeAt(i)) >>> 0;
  }
  return `insight:${input.kind}:${hash.toString(36)}`;
};

export interface CreateInsightInput
  extends Omit<InsightPayload, 'id' | 'createdAt'>,
    Partial<Pick<InsightPayload, 'id' | 'createdAt'>> {}

/** Build a normalized payload, deriving a stable id + timestamp when omitted. */
export const createInsightPayload = (input: CreateInsightInput): InsightPayload => ({
  ...input,
  id: input.id ?? stableInsightId(input),
  createdAt: input.createdAt ?? new Date().toISOString(),
});

const idempotencyKey = (payloadId: string, placeId: WritingPlaceId) => `${payloadId}::${placeId}`;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface InsightRouterOptions {
  /** Injectable clock (tests pass a fixed one). Defaults to wall-clock ISO. */
  now?: () => string;
}

export interface PlaceAvailability {
  place: WritingPlace;
  available: boolean;
  reason?: string;
}

export class InsightRouter {
  private readonly registry = new Map<WritingPlaceId, WritingPlace>();
  private readonly idempotency = new Map<string, Extract<WriteResult, { ok: true }>>();
  private readonly audit: RouteAuditEntry[] = [];
  private readonly now: () => string;

  constructor(options: InsightRouterOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  register(place: WritingPlace): this {
    if (this.registry.has(place.id)) {
      throw new Error(`writing place "${place.id}" is already registered`);
    }
    this.registry.set(place.id, place);
    return this;
  }

  unregister(id: WritingPlaceId): boolean {
    return this.registry.delete(id);
  }

  has(id: WritingPlaceId): boolean {
    return this.registry.has(id);
  }

  resolve(id: WritingPlaceId): WritingPlace | undefined {
    return this.registry.get(id);
  }

  places(): WritingPlace[] {
    return [...this.registry.values()];
  }

  /** Which places can accept this payload right now (configured + accepts guard). */
  availabilityFor(payload: InsightPayload): PlaceAvailability[] {
    return this.places().map((place) => {
      if (!place.isConfigured()) {
        return { place, available: false, reason: `${place.label} is not configured` };
      }
      const verdict = place.accepts(payload);
      return verdict === true
        ? { place, available: true }
        : { place, available: false, reason: verdict };
    });
  }

  async route(
    payload: InsightPayload,
    placeId: WritingPlaceId,
    ctx: { signal?: AbortSignal } = {},
  ): Promise<WriteResult> {
    const place = this.registry.get(placeId);
    if (!place) {
      return this.fail(payload, placeId, 'rejected', `unknown writing place "${placeId}"`);
    }

    const validation = validateInsightPayload(payload);
    if (!validation.ok) {
      return this.fail(
        payload,
        placeId,
        'invalid',
        `invalid insight payload: ${validation.errors.join('; ')}`,
      );
    }

    // Idempotency: never write the same insight to the same place twice.
    const key = idempotencyKey(payload.id, placeId);
    const prior = this.idempotency.get(key);
    if (prior) {
      const replay: WriteResult = { ...prior, idempotent: true, at: this.now() };
      this.record(payload, placeId, replay);
      return replay;
    }

    const verdict = place.accepts(payload);
    if (verdict !== true) {
      return this.fail(payload, placeId, 'rejected', verdict);
    }

    // Note: unconfigured external places are NOT short-circuited here — each place
    // owns its unconfigured handling in `write` so it can return a specific,
    // actionable message (see the placeholder adapters). `isConfigured()` is used
    // by `availabilityFor()` to drive the UI.

    // Isolate the write: a throwing place fails only itself, never the router.
    let result: WriteResult;
    try {
      result = await place.write(payload, { now: this.now, signal: ctx.signal });
    } catch (err) {
      result = this.makeFailure(
        placeId,
        'failed',
        err instanceof Error ? err.message : String(err),
      );
    }

    if (result.ok) {
      const normalized: Extract<WriteResult, { ok: true }> = { ...result, idempotent: false };
      this.idempotency.set(key, normalized);
      this.record(payload, placeId, normalized);
      return normalized;
    }

    this.record(payload, placeId, result);
    return result;
  }

  history(): readonly RouteAuditEntry[] {
    return [...this.audit];
  }

  private makeFailure(
    placeId: WritingPlaceId,
    code: WriteFailureCode,
    error: string,
  ): Extract<WriteResult, { ok: false }> {
    return { ok: false, placeId, code, error, at: this.now() };
  }

  private fail(
    payload: InsightPayload,
    placeId: WritingPlaceId,
    code: WriteFailureCode,
    error: string,
  ): WriteResult {
    const result = this.makeFailure(placeId, code, error);
    this.record(payload, placeId, result);
    return result;
  }

  private record(payload: InsightPayload, placeId: WritingPlaceId, result: WriteResult): void {
    this.audit.push({
      payloadId: payload?.id ?? '(none)',
      placeId,
      kind: INSIGHT_KINDS.includes(payload?.kind) ? payload.kind : 'unknown',
      actor: payload?.source?.author,
      result,
      at: result.at,
    });
  }
}

// ---------------------------------------------------------------------------
// Built-in writing places (host supplies the effectful handler)
// ---------------------------------------------------------------------------

const nonEmpty = (payload: InsightPayload): true | string =>
  payload.text.trim().length > 0 ? true : 'insight has no text to write';

const succeed = (placeId: WritingPlaceId, ref: string, ctx: WriteContext): WriteResult => ({
  ok: true,
  placeId,
  ref,
  idempotent: false,
  at: ctx.now(),
});

export const createDocumentInsertPlace = (
  insert: (payload: InsightPayload, ctx: WriteContext) => Promise<string> | string,
): WritingPlace => ({
  id: 'doc',
  label: 'This document',
  kind: 'builtin',
  description: 'Insert the insight into the current document.',
  isConfigured: () => true,
  accepts: nonEmpty,
  write: async (payload, ctx) => succeed('doc', await insert(payload, ctx), ctx),
});

export const createNewDocumentPlace = (
  create: (payload: InsightPayload, ctx: WriteContext) => Promise<string> | string,
): WritingPlace => ({
  id: 'new-doc',
  label: 'New document',
  kind: 'builtin',
  description: 'Spin the insight out into a fresh document.',
  isConfigured: () => true,
  accepts: nonEmpty,
  write: async (payload, ctx) => succeed('new-doc', await create(payload, ctx), ctx),
});

export const createClipboardPlace = (
  copy: (text: string, ctx: WriteContext) => Promise<void> | void,
): WritingPlace => ({
  id: 'clipboard',
  label: 'Clipboard',
  kind: 'builtin',
  description: 'Copy the insight to the clipboard.',
  isConfigured: () => true,
  accepts: nonEmpty,
  write: async (payload, ctx) => {
    await copy(payload.text, ctx);
    return succeed('clipboard', `clipboard:${payload.id}`, ctx);
  },
});

// ---------------------------------------------------------------------------
// External "writing places" — placeholder adapters (persephone / hermes / garden)
// ---------------------------------------------------------------------------

export const PERSEPHONE_UNCONFIGURED =
  'Persephone (memory) is not wired yet. Pass a PersephoneClient to createPersephonePlace() to route insights into long-term memory.';
export const HERMES_UNCONFIGURED =
  'Hermes (agent) is not wired yet. Pass a HermesClient to createHermesPlace() to dispatch insights to an agent.';
export const GARDEN_UNCONFIGURED =
  'Garden (todos) is not wired yet. Pass a GardenClient to createGardenPlace() to turn insights into tasks (garden-state / gardenos).';

/** Persephone memory integration contract. Implement to wire the placeholder. */
export interface PersephoneClient {
  remember(input: {
    text: string;
    kind: InsightKind;
    docId: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }>;
}

/** Hermes agent integration contract. Implement to wire the placeholder. */
export interface HermesClient {
  dispatch(input: {
    text: string;
    kind: InsightKind;
    docId: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ taskId: string }>;
}

/** Garden / gardenos todo integration contract. Implement to wire the placeholder. */
export interface GardenClient {
  createTask(input: {
    title: string;
    docId: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }>;
}

const unconfiguredWrite =
  (placeId: WritingPlaceId, message: string) =>
  (_payload: InsightPayload, ctx: WriteContext): WriteResult => ({
    ok: false,
    placeId,
    code: 'unconfigured',
    error: message,
    at: ctx.now(),
  });

export const createPersephonePlace = (client?: PersephoneClient): WritingPlace => ({
  id: 'persephone',
  label: 'Persephone (memory)',
  kind: 'external',
  description: 'Persist the insight as a long-term memory in Persephone.',
  isConfigured: () => Boolean(client),
  accepts: nonEmpty,
  write: client
    ? async (payload, ctx) => {
        const { id } = await client.remember({
          text: payload.text,
          kind: payload.kind,
          docId: payload.docId,
          tags: payload.tags,
          metadata: payload.metadata,
        });
        return succeed('persephone', `persephone:${id}`, ctx);
      }
    : unconfiguredWrite('persephone', PERSEPHONE_UNCONFIGURED),
});

export const createHermesPlace = (client?: HermesClient): WritingPlace => ({
  id: 'hermes',
  label: 'Hermes (agent)',
  kind: 'external',
  description: 'Dispatch the insight to a Hermes agent for action.',
  isConfigured: () => Boolean(client),
  accepts: nonEmpty,
  write: client
    ? async (payload, ctx) => {
        const { taskId } = await client.dispatch({
          text: payload.text,
          kind: payload.kind,
          docId: payload.docId,
          metadata: payload.metadata,
        });
        return succeed('hermes', `hermes:${taskId}`, ctx);
      }
    : unconfiguredWrite('hermes', HERMES_UNCONFIGURED),
});

export const createGardenPlace = (client?: GardenClient): WritingPlace => ({
  id: 'garden',
  label: 'Garden (todos)',
  kind: 'external',
  description: 'Turn the insight into a task in garden-state / gardenos.',
  isConfigured: () => Boolean(client),
  accepts: nonEmpty,
  write: client
    ? async (payload, ctx) => {
        const { id } = await client.createTask({
          title: payload.text,
          docId: payload.docId,
          tags: payload.tags,
          metadata: payload.metadata,
        });
        return succeed('garden', `garden:${id}`, ctx);
      }
    : unconfiguredWrite('garden', GARDEN_UNCONFIGURED),
});

// ---------------------------------------------------------------------------
// Default router assembly
// ---------------------------------------------------------------------------

export interface DefaultInsightRouterOptions extends InsightRouterOptions {
  doc?: (payload: InsightPayload, ctx: WriteContext) => Promise<string> | string;
  newDoc?: (payload: InsightPayload, ctx: WriteContext) => Promise<string> | string;
  clipboard?: (text: string, ctx: WriteContext) => Promise<void> | void;
  persephone?: PersephoneClient;
  hermes?: HermesClient;
  garden?: GardenClient;
}

/**
 * Assemble a router with the standard set of writing places. Built-ins are only
 * registered when their host handler is supplied; the three external places are
 * always registered (as placeholders until their client is provided), so the UI
 * can surface them and explain that they are not yet wired.
 */
export const createDefaultInsightRouter = (
  options: DefaultInsightRouterOptions = {},
): InsightRouter => {
  const router = new InsightRouter({ now: options.now });
  if (options.doc) router.register(createDocumentInsertPlace(options.doc));
  if (options.newDoc) router.register(createNewDocumentPlace(options.newDoc));
  if (options.clipboard) router.register(createClipboardPlace(options.clipboard));
  router.register(createPersephonePlace(options.persephone));
  router.register(createHermesPlace(options.hermes));
  router.register(createGardenPlace(options.garden));
  return router;
};
