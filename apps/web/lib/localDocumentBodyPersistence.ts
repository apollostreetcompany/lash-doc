import type { Schema } from '@tiptap/pm/model';

import { normalizeDocumentId } from './documentRegistry';
import { parseLocalSuggestions, type LocalSuggestion } from './localSuggestions';

export const LOCAL_BODY_ENVELOPE_VERSION = 1 as const;
export const LOCAL_BODY_SCHEMA_VERSION = 'lash-schema-v1' as const;
export const MAX_LOCAL_BODY_RAW_LENGTH = 4_000_000;

const MAX_LOCAL_BODY_DEPTH = 64;
const MAX_LOCAL_BODY_VALUES = 200_000;
const MAX_LOCAL_BODY_STRING_LENGTH = 3_500_000;
const MAX_LOCAL_BODY_KEY_LENGTH = 128;
const MAX_DOCUMENT_ID_LENGTH = 96;
const MAX_WRITE_ID_LENGTH = 128;
const MAX_TIMESTAMP_LENGTH = 64;
const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const TEXT_NODE_JSON_KEYS = new Set(['type', 'text', 'marks']);
const NON_TEXT_NODE_JSON_KEYS = new Set(['type', 'attrs', 'content', 'marks']);
const MARK_JSON_KEYS = new Set(['type', 'attrs']);

export type LocalBodyDocJson = Record<string, unknown>;
export type LocalBodySchemaValidator = (doc: LocalBodyDocJson) => void;

export interface LocalBodyEnvelope {
  version: typeof LOCAL_BODY_ENVELOPE_VERSION;
  schemaVersion: typeof LOCAL_BODY_SCHEMA_VERSION;
  documentId: string;
  revision: number;
  writeId: string;
  savedAt: string;
  doc: LocalBodyDocJson;
  suggestions?: LocalSuggestion[];
  /** A known divergent History head, or null when its identity could not be verified. */
  divergentHistoryHead?: string | null;
}

export interface LocalBodyExpectedRevision {
  revision: number;
  writeId: string;
}

export interface LocalBodyRecoveryToken {
  readonly primaryRaw: string | null;
  readonly backupRaw: string;
}

export type LocalBodyPersistenceErrorCode =
  | 'conflict'
  | 'invalid-json'
  | 'oversize'
  | 'quota'
  | 'schema-invalid'
  | 'security'
  | 'storage-unavailable'
  | 'structural-invalid'
  | 'unsafe-url'
  | 'unsupported-schema'
  | 'unsupported-version'
  | 'verification-failed'
  | 'wrong-document';

export class LocalBodyPersistenceError extends Error {
  readonly code: LocalBodyPersistenceErrorCode;

  constructor(code: LocalBodyPersistenceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LocalBodyPersistenceError';
    this.code = code;
  }
}

export type LocalBodyLoadResult =
  | {
      state: 'empty';
      expected: null;
    }
  | {
      state: 'ready';
      envelope: LocalBodyEnvelope;
      expected: LocalBodyExpectedRevision;
    }
  | {
      state: 'recovered-awaiting-confirmation';
      envelope: LocalBodyEnvelope;
      primaryError: LocalBodyPersistenceError | null;
      primaryRaw: string | null;
      backupRaw: string;
      recoveryToken: Readonly<LocalBodyRecoveryToken>;
    }
  | {
      state: 'failed';
      primaryError: LocalBodyPersistenceError | null;
      backupError: LocalBodyPersistenceError | null;
      primaryRaw: string | null;
      backupRaw: string | null;
    }
  | {
      state: 'unavailable';
      error: LocalBodyPersistenceError;
    };

export interface LocalBodyPersistenceOptions {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  documentId: string;
  validateSchema: LocalBodySchemaValidator;
}

export interface SaveLocalDocumentBodyOptions extends LocalBodyPersistenceOptions {
  doc: LocalBodyDocJson;
  suggestions?: LocalSuggestion[];
  divergentHistoryHead?: string | null;
  expected: LocalBodyExpectedRevision | null;
  savedAt?: string;
  now?: () => Date;
  createWriteId?: () => string;
}

export interface PromoteRecoveredLocalDocumentBodyOptions extends LocalBodyPersistenceOptions {
  recovered: LocalBodyEnvelope;
  recoveryToken: Readonly<LocalBodyRecoveryToken>;
  savedAt?: string;
  now?: () => Date;
  createWriteId?: () => string;
}

export const localDocumentBodyKey = (documentId: string) =>
  `lash:body:${normalizeDocumentId(documentId)}`;

export const localDocumentBodyBackupKey = (documentId: string) =>
  `lash:body-backup:${normalizeDocumentId(documentId)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const persistenceError = (code: LocalBodyPersistenceErrorCode, message: string, cause?: unknown) =>
  new LocalBodyPersistenceError(code, message, cause === undefined ? undefined : { cause });

const classifyStorageError = (error: unknown, operation: string) => {
  const name = isRecord(error) && typeof error.name === 'string' ? error.name : '';
  if (name === 'QuotaExceededError') {
    return persistenceError(
      'quota',
      `Local body ${operation} exceeded browser storage quota.`,
      error,
    );
  }
  if (name === 'SecurityError') {
    return persistenceError(
      'security',
      `Local body ${operation} was blocked by browser security.`,
      error,
    );
  }
  return persistenceError(
    'storage-unavailable',
    `Local body ${operation} could not access browser storage.`,
    error,
  );
};

const readStorage = (
  storage: Pick<Storage, 'getItem'>,
  key: string,
  operation: string,
): string | null => {
  try {
    return storage.getItem(key);
  } catch (error) {
    throw classifyStorageError(error, operation);
  }
};

const writeStorage = (
  storage: Pick<Storage, 'setItem'>,
  key: string,
  value: string,
  operation: string,
) => {
  try {
    storage.setItem(key, value);
  } catch (error) {
    throw classifyStorageError(error, operation);
  }
};

const assertSafeUrl = (attribute: string, value: string) => {
  if (!value) return;
  if (value.length > MAX_LOCAL_BODY_STRING_LENGTH) {
    throw persistenceError('oversize', `${attribute} exceeds the local body string limit.`);
  }

  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  const isImageAttribute =
    attribute === 'src' || attribute === 'previewSrc' || attribute === 'iconUrl';

  if (isImageAttribute && lower.startsWith('data:')) {
    if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/iu.test(normalized)) return;
    throw persistenceError('unsafe-url', `${attribute} contains an unsafe data URL.`);
  }

  if (normalized.startsWith('/') || normalized.startsWith('#')) return;

  let protocol = '';
  try {
    protocol = new URL(normalized, 'https://lash.local').protocol.toLowerCase();
  } catch (error) {
    throw persistenceError('unsafe-url', `${attribute} contains an invalid URL.`, error);
  }

  const allowed = isImageAttribute
    ? protocol === 'https:' || protocol === 'http:'
    : protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:';
  if (!allowed) {
    throw persistenceError('unsafe-url', `${attribute} uses the unsafe ${protocol} protocol.`);
  }
};

const nonJsonValueError = (cause?: unknown) =>
  persistenceError('structural-invalid', 'Local body contains a non-JSON value.', cause);

interface LocalBodyDetachState {
  activeContainers: WeakSet<object>;
  valueCount: number;
}

const detachBoundedAndSafeJsonValue = (
  value: unknown,
  depth: number,
  key: string | null,
  state: LocalBodyDetachState,
): unknown => {
  state.valueCount += 1;
  if (state.valueCount > MAX_LOCAL_BODY_VALUES) {
    throw persistenceError('oversize', 'Local body contains too many values.');
  }
  if (depth > MAX_LOCAL_BODY_DEPTH) {
    throw persistenceError('oversize', 'Local body nesting is too deep.');
  }

  const isUrlAttribute =
    key === 'href' || key === 'src' || key === 'previewSrc' || key === 'iconUrl';
  if (isUrlAttribute && value !== null && typeof value !== 'string') {
    throw persistenceError(
      'unsafe-url',
      `${key} must be a string or null before local body hydration.`,
    );
  }
  if (typeof value === 'string') {
    if (value.length > MAX_LOCAL_BODY_STRING_LENGTH) {
      throw persistenceError('oversize', 'Local body contains an oversized string.');
    }
    if (isUrlAttribute) {
      assertSafeUrl(key, value);
    }
    return value;
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw nonJsonValueError();
  }
  if (state.activeContainers.has(value)) {
    throw nonJsonValueError();
  }

  state.activeContainers.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw nonJsonValueError();
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (
        !lengthDescriptor ||
        !('value' in lengthDescriptor) ||
        typeof lengthDescriptor.value !== 'number' ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0
      ) {
        throw nonJsonValueError();
      }
      const arrayLength = lengthDescriptor.value;
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== arrayLength + 1 || ownKeys[arrayLength] !== 'length') {
        throw nonJsonValueError();
      }
      for (let index = 0; index < arrayLength; index += 1) {
        if (ownKeys[index] !== String(index)) {
          throw nonJsonValueError();
        }
      }

      const detached: unknown[] = [];
      for (let index = 0; index < arrayLength; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor)) {
          throw nonJsonValueError();
        }
        Object.defineProperty(detached, String(index), {
          configurable: true,
          enumerable: true,
          value: detachBoundedAndSafeJsonValue(descriptor.value, depth + 1, null, state),
          writable: true,
        });
      }
      return detached;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw nonJsonValueError();
    }

    const detached: Record<string, unknown> = {};
    for (const ownKey of Reflect.ownKeys(value)) {
      if (typeof ownKey !== 'string') {
        throw nonJsonValueError();
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw nonJsonValueError();
      }
      if (ownKey.length > MAX_LOCAL_BODY_KEY_LENGTH || BLOCKED_OBJECT_KEYS.has(ownKey)) {
        throw persistenceError('structural-invalid', 'Local body contains an invalid object key.');
      }
      Object.defineProperty(detached, ownKey, {
        configurable: true,
        enumerable: true,
        value: detachBoundedAndSafeJsonValue(descriptor.value, depth + 1, ownKey, state),
        writable: true,
      });
    }
    return detached;
  } finally {
    state.activeContainers.delete(value);
  }
};

/**
 * Enforces the local-body structural, resource, and URL boundary while
 * producing a recursively detached JSON authority. Shared acyclic values are
 * deliberately copied per occurrence so caller-owned aliases cannot cross the
 * validation boundary.
 */
export const validateAndDetachLocalBodyDocJson = (doc: unknown): LocalBodyDocJson => {
  if (!isRecord(doc)) {
    throw persistenceError(
      'structural-invalid',
      'Local body must be a document with array content.',
    );
  }

  try {
    const rootPrototype = Object.getPrototypeOf(doc);
    if (rootPrototype !== Object.prototype && rootPrototype !== null) {
      throw nonJsonValueError();
    }
    const typeDescriptor = Object.getOwnPropertyDescriptor(doc, 'type');
    const contentDescriptor = Object.getOwnPropertyDescriptor(doc, 'content');
    if (
      (typeDescriptor && !('value' in typeDescriptor)) ||
      (contentDescriptor && !('value' in contentDescriptor))
    ) {
      throw nonJsonValueError();
    }
    if (
      !typeDescriptor ||
      typeDescriptor.value !== 'doc' ||
      !contentDescriptor ||
      !Array.isArray(contentDescriptor.value)
    ) {
      throw persistenceError(
        'structural-invalid',
        'Local body must be a document with array content.',
      );
    }

    const detached = detachBoundedAndSafeJsonValue(doc, 0, null, {
      activeContainers: new WeakSet(),
      valueCount: 0,
    });
    if (!isRecord(detached)) {
      throw persistenceError(
        'structural-invalid',
        'Local body must be a document with array content.',
      );
    }
    const detachedTypeDescriptor = Object.getOwnPropertyDescriptor(detached, 'type');
    const detachedContentDescriptor = Object.getOwnPropertyDescriptor(detached, 'content');
    if (
      !detachedTypeDescriptor ||
      !detachedTypeDescriptor.enumerable ||
      !('value' in detachedTypeDescriptor) ||
      detachedTypeDescriptor.value !== 'doc' ||
      !detachedContentDescriptor ||
      !detachedContentDescriptor.enumerable ||
      !('value' in detachedContentDescriptor) ||
      !Array.isArray(detachedContentDescriptor.value)
    ) {
      throw persistenceError(
        'structural-invalid',
        'Local body must be a document with array content.',
      );
    }
    return detached;
  } catch (error) {
    if (error instanceof LocalBodyPersistenceError) throw error;
    throw nonJsonValueError(error);
  }
};

const assertOnlyKnownKeys = (
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  kind: 'node' | 'mark',
) => {
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    throw persistenceError(
      'schema-invalid',
      `Local body ${kind} contains unsupported JSON key "${unknownKey}".`,
    );
  }
};

const assertKnownSchemaAttrs = (
  attrs: unknown,
  allowedAttrs: Record<string, unknown> | undefined,
  kind: 'node' | 'mark',
  typeName: string,
) => {
  if (attrs === undefined) return;
  if (!isRecord(attrs)) {
    throw persistenceError(
      'schema-invalid',
      `Local body ${kind} "${typeName}" attributes must be an object.`,
    );
  }
  const allowed = new Set(Object.keys(allowedAttrs ?? {}));
  const unknownAttr = Object.keys(attrs).find((key) => !allowed.has(key));
  if (unknownAttr) {
    throw persistenceError(
      'schema-invalid',
      `Local body ${kind} "${typeName}" contains unsupported attribute "${unknownAttr}".`,
    );
  }
};

/**
 * ProseMirror intentionally normalizes JSON by ignoring unknown attributes.
 * Persistence cannot accept that silent-loss behavior: reject fields not
 * declared by the active schema before nodeFromJSON has a chance to drop them.
 * Omitted attributes remain valid so schema defaults can still be applied.
 */
export const assertStrictLocalBodySchemaJson = (doc: LocalBodyDocJson, schema: Schema) => {
  const visitMark = (value: unknown) => {
    if (!isRecord(value) || typeof value.type !== 'string') {
      throw persistenceError('schema-invalid', 'Local body contains an invalid mark.');
    }
    assertOnlyKnownKeys(value, MARK_JSON_KEYS, 'mark');
    const markType = schema.marks[value.type];
    if (!markType) {
      throw persistenceError(
        'schema-invalid',
        `Local body contains unsupported mark type "${value.type}".`,
      );
    }
    assertKnownSchemaAttrs(
      value.attrs,
      markType.spec.attrs as Record<string, unknown> | undefined,
      'mark',
      value.type,
    );
  };

  const visitNode = (value: unknown) => {
    if (!isRecord(value) || typeof value.type !== 'string') {
      throw persistenceError('schema-invalid', 'Local body contains an invalid node.');
    }
    const nodeType = schema.nodes[value.type];
    if (!nodeType) {
      throw persistenceError(
        'schema-invalid',
        `Local body contains unsupported node type "${value.type}".`,
      );
    }
    assertOnlyKnownKeys(
      value,
      nodeType.isText ? TEXT_NODE_JSON_KEYS : NON_TEXT_NODE_JSON_KEYS,
      'node',
    );
    assertKnownSchemaAttrs(
      value.attrs,
      nodeType.spec.attrs as Record<string, unknown> | undefined,
      'node',
      value.type,
    );
    if (value.marks !== undefined) {
      if (!Array.isArray(value.marks)) {
        throw persistenceError('schema-invalid', 'Local body node marks must be an array.');
      }
      value.marks.forEach(visitMark);
    }
    if (value.content !== undefined) {
      if (!Array.isArray(value.content)) {
        throw persistenceError('schema-invalid', 'Local body node content must be an array.');
      }
      value.content.forEach(visitNode);
    }
  };

  visitNode(doc);
};

const validateDocument = (doc: unknown, validateSchema: LocalBodySchemaValidator) => {
  const detached = validateAndDetachLocalBodyDocJson(doc);
  try {
    validateSchema(detached);
  } catch (error) {
    if (error instanceof LocalBodyPersistenceError) throw error;
    throw persistenceError(
      'schema-invalid',
      'Local body does not match the active editor schema.',
      error,
    );
  }
  return detached;
};

const normalizeDivergentHistoryHead = (value: unknown) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null;

const parseEnvelope = (
  raw: string,
  requestedDocumentId: string,
  validateSchema: LocalBodySchemaValidator,
): LocalBodyEnvelope => {
  if (raw.length > MAX_LOCAL_BODY_RAW_LENGTH) {
    throw persistenceError('oversize', 'Local body envelope exceeds the supported size.');
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw persistenceError('invalid-json', 'Local body envelope is malformed JSON.', error);
  }
  if (!isRecord(value)) {
    throw persistenceError('structural-invalid', 'Local body envelope must be an object.');
  }
  if (value.version !== LOCAL_BODY_ENVELOPE_VERSION) {
    throw persistenceError('unsupported-version', 'Local body envelope version is unsupported.');
  }
  if (value.schemaVersion !== LOCAL_BODY_SCHEMA_VERSION) {
    throw persistenceError('unsupported-schema', 'Local body schema version is unsupported.');
  }
  if (
    typeof value.documentId !== 'string' ||
    !value.documentId ||
    value.documentId.length > MAX_DOCUMENT_ID_LENGTH
  ) {
    throw persistenceError('structural-invalid', 'Local body document id is invalid.');
  }
  const normalizedRequestedId = normalizeDocumentId(requestedDocumentId);
  if (
    value.documentId !== normalizeDocumentId(value.documentId) ||
    value.documentId !== normalizedRequestedId
  ) {
    throw persistenceError('wrong-document', 'Local body belongs to a different document.');
  }
  if (
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  ) {
    throw persistenceError('structural-invalid', 'Local body revision is invalid.');
  }
  if (
    typeof value.writeId !== 'string' ||
    !value.writeId ||
    value.writeId.length > MAX_WRITE_ID_LENGTH
  ) {
    throw persistenceError('structural-invalid', 'Local body write id is invalid.');
  }
  if (
    typeof value.savedAt !== 'string' ||
    !value.savedAt ||
    value.savedAt.length > MAX_TIMESTAMP_LENGTH ||
    Number.isNaN(Date.parse(value.savedAt))
  ) {
    throw persistenceError('structural-invalid', 'Local body save timestamp is invalid.');
  }

  const suggestions =
    value.suggestions === undefined ? undefined : parseLocalSuggestions(value.suggestions);
  if (suggestions === null) {
    throw persistenceError('structural-invalid', 'Saved suggestions are invalid.');
  }
  return {
    version: LOCAL_BODY_ENVELOPE_VERSION,
    schemaVersion: LOCAL_BODY_SCHEMA_VERSION,
    documentId: normalizedRequestedId,
    revision: value.revision,
    writeId: value.writeId,
    savedAt: value.savedAt,
    doc: validateDocument(value.doc, validateSchema),
    ...(suggestions?.length ? { suggestions } : {}),
    ...(Object.hasOwn(value, 'divergentHistoryHead')
      ? { divergentHistoryHead: normalizeDivergentHistoryHead(value.divergentHistoryHead) }
      : {}),
  };
};

const parseEnvelopeResult = (
  raw: string | null,
  documentId: string,
  validateSchema: LocalBodySchemaValidator,
) => {
  if (raw === null) return { envelope: null, error: null };
  try {
    return { envelope: parseEnvelope(raw, documentId, validateSchema), error: null };
  } catch (error) {
    return {
      envelope: null,
      error:
        error instanceof LocalBodyPersistenceError
          ? error
          : persistenceError('structural-invalid', 'Local body validation failed.', error),
    };
  }
};

export const loadLocalDocumentBody = ({
  storage,
  documentId,
  validateSchema,
}: LocalBodyPersistenceOptions): LocalBodyLoadResult => {
  const id = normalizeDocumentId(documentId);
  let primaryRaw: string | null;
  try {
    primaryRaw = readStorage(storage, localDocumentBodyKey(id), 'read');
  } catch (error) {
    return {
      state: 'unavailable',
      error: error as LocalBodyPersistenceError,
    };
  }
  const primary = parseEnvelopeResult(primaryRaw, id, validateSchema);
  if (primary.envelope) {
    return {
      state: 'ready',
      envelope: primary.envelope,
      expected: {
        revision: primary.envelope.revision,
        writeId: primary.envelope.writeId,
      },
    };
  }

  let backupRaw: string | null;
  try {
    backupRaw = readStorage(storage, localDocumentBodyBackupKey(id), 'backup read');
  } catch (error) {
    return {
      state: 'unavailable',
      error: error as LocalBodyPersistenceError,
    };
  }
  const backup = parseEnvelopeResult(backupRaw, id, validateSchema);
  if (backup.envelope && backupRaw !== null) {
    const recoveryToken = Object.freeze({
      primaryRaw,
      backupRaw,
    }) satisfies Readonly<LocalBodyRecoveryToken>;
    return {
      state: 'recovered-awaiting-confirmation',
      envelope: backup.envelope,
      primaryError: primary.error,
      primaryRaw,
      backupRaw,
      recoveryToken,
    };
  }
  if (primaryRaw === null && backupRaw === null) {
    return { state: 'empty', expected: null };
  }
  return {
    state: 'failed',
    primaryError: primary.error,
    backupError: backup.error,
    primaryRaw,
    backupRaw,
  };
};

const defaultWriteId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `write-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const nextSavedAt = (options: { savedAt?: string; now?: () => Date }) =>
  options.savedAt ?? (options.now ?? (() => new Date()))().toISOString();

const serializeEnvelope = (envelope: LocalBodyEnvelope) => {
  const raw = JSON.stringify(envelope);
  if (raw.length > MAX_LOCAL_BODY_RAW_LENGTH) {
    throw persistenceError('oversize', 'Local body envelope exceeds the supported size.');
  }
  return raw;
};

const assertExpectedRevision = (
  current: LocalBodyEnvelope | null,
  expected: LocalBodyExpectedRevision | null,
) => {
  const matches =
    current === null
      ? expected === null
      : expected !== null &&
        current.revision === expected.revision &&
        current.writeId === expected.writeId;
  if (!matches) {
    throw persistenceError(
      'conflict',
      'This document changed in another tab. Reload before saving again.',
    );
  }
};

const verifyPrimaryWrite = (
  storage: Pick<Storage, 'getItem'>,
  key: string,
  expectedRaw: string,
  documentId: string,
  validateSchema: LocalBodySchemaValidator,
) => {
  const readBackRaw = readStorage(storage, key, 'read-back verification');
  if (readBackRaw === null) {
    throw persistenceError('verification-failed', 'Saved local body could not be read back.');
  }
  if (readBackRaw !== expectedRaw) {
    throw persistenceError('verification-failed', 'Saved local body did not verify.');
  }
  parseEnvelope(readBackRaw, documentId, validateSchema);
};

export const saveLocalDocumentBody = (options: SaveLocalDocumentBodyOptions): LocalBodyEnvelope => {
  const id = normalizeDocumentId(options.documentId);
  const doc = validateDocument(options.doc, options.validateSchema);
  const primaryKey = localDocumentBodyKey(id);
  const backupKey = localDocumentBodyBackupKey(id);
  const currentRaw = readStorage(options.storage, primaryKey, 'pre-save read');
  const current = parseEnvelopeResult(currentRaw, id, options.validateSchema);
  if (current.error) throw current.error;
  assertExpectedRevision(current.envelope, options.expected);

  const divergentHistoryHead =
    current.envelope?.divergentHistoryHead === undefined
      ? options.divergentHistoryHead
      : current.envelope.divergentHistoryHead;
  const envelope: LocalBodyEnvelope = {
    version: LOCAL_BODY_ENVELOPE_VERSION,
    schemaVersion: LOCAL_BODY_SCHEMA_VERSION,
    documentId: id,
    revision: (current.envelope?.revision ?? 0) + 1,
    writeId: (options.createWriteId ?? defaultWriteId)(),
    savedAt: nextSavedAt(options),
    doc,
    ...(options.suggestions?.length ? { suggestions: options.suggestions } : {}),
    ...(divergentHistoryHead !== undefined
      ? { divergentHistoryHead: normalizeDivergentHistoryHead(divergentHistoryHead) }
      : {}),
  };
  const nextRaw = serializeEnvelope(envelope);
  // Validate generated metadata as an envelope before rotating either slot.
  // Injected clocks/ID generators must never be able to mutate storage with an
  // envelope that the read path would reject.
  parseEnvelope(nextRaw, id, options.validateSchema);

  if (current.envelope) {
    writeStorage(
      options.storage,
      backupKey,
      serializeEnvelope(current.envelope),
      'backup rotation',
    );
  }
  writeStorage(options.storage, primaryKey, nextRaw, 'primary write');
  verifyPrimaryWrite(options.storage, primaryKey, nextRaw, id, options.validateSchema);
  return envelope;
};

export const promoteRecoveredLocalDocumentBody = (
  options: PromoteRecoveredLocalDocumentBodyOptions,
): LocalBodyEnvelope => {
  const id = normalizeDocumentId(options.documentId);
  if (options.recovered.documentId !== id) {
    throw persistenceError('wrong-document', 'Recovered body belongs to a different document.');
  }
  const doc = validateDocument(options.recovered.doc, options.validateSchema);
  const primaryKey = localDocumentBodyKey(id);
  const backupKey = localDocumentBodyBackupKey(id);
  const currentPrimaryRaw = readStorage(options.storage, primaryKey, 'recovery primary read');
  const currentBackupRaw = readStorage(options.storage, backupKey, 'recovery backup read');
  if (
    currentPrimaryRaw !== options.recoveryToken.primaryRaw ||
    currentBackupRaw !== options.recoveryToken.backupRaw
  ) {
    throw persistenceError(
      'conflict',
      'Saved recovery data changed before confirmation. Reload before trying again.',
    );
  }
  const currentPrimary = parseEnvelopeResult(currentPrimaryRaw, id, options.validateSchema);
  if (currentPrimary.envelope) {
    throw persistenceError(
      'conflict',
      'A newer valid primary copy appeared before recovery was confirmed.',
    );
  }
  if (currentBackupRaw === null) {
    throw persistenceError('conflict', 'The recovered backup is no longer available.');
  }
  const currentBackup = parseEnvelope(currentBackupRaw, id, options.validateSchema);
  if (
    currentBackup.revision !== options.recovered.revision ||
    currentBackup.writeId !== options.recovered.writeId
  ) {
    throw persistenceError('conflict', 'The recovered backup changed before confirmation.');
  }

  const promoted: LocalBodyEnvelope = {
    version: LOCAL_BODY_ENVELOPE_VERSION,
    schemaVersion: LOCAL_BODY_SCHEMA_VERSION,
    documentId: id,
    revision: currentBackup.revision + 1,
    writeId: (options.createWriteId ?? defaultWriteId)(),
    savedAt: nextSavedAt(options),
    doc,
    ...(currentBackup.suggestions ? { suggestions: currentBackup.suggestions } : {}),
    ...(currentBackup.divergentHistoryHead !== undefined
      ? { divergentHistoryHead: currentBackup.divergentHistoryHead }
      : {}),
  };
  const promotedRaw = serializeEnvelope(promoted);
  parseEnvelope(promotedRaw, id, options.validateSchema);
  writeStorage(options.storage, primaryKey, promotedRaw, 'recovery promotion');
  verifyPrimaryWrite(options.storage, primaryKey, promotedRaw, id, options.validateSchema);
  return promoted;
};

export const localBodyExpectedRevision = (
  envelope: LocalBodyEnvelope,
): LocalBodyExpectedRevision => ({
  revision: envelope.revision,
  writeId: envelope.writeId,
});
