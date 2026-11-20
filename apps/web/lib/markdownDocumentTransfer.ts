import {
  MARKDOWN_FILE_MAX_BYTES,
  deriveLegacyMarkdownTitle,
  parseMarkdownFileToDoc,
  serializeDocToMarkdownFile,
  type MarkdownFileFormat,
  type MarkdownFileParseResult,
} from '@lash/editor-core';

import {
  DOCUMENT_REGISTRY_STORAGE_KEY,
  documentPath,
  documentTitleStorageKey,
  normalizeDocumentId,
  type LashDocumentRecord,
} from './documentRegistry';
import {
  validateAndDetachLocalBodyDocJson,
  loadLocalDocumentBody,
  localDocumentBodyBackupKey,
  localDocumentBodyKey,
  saveLocalDocumentBody,
  type LocalBodyDocJson,
  type LocalBodyExpectedRevision,
  type LocalBodyPersistenceOptions,
  type LocalBodySchemaValidator,
} from './localDocumentBodyPersistence';

export const MARKDOWN_IMPORT_NAVIGATION_WATCHDOG_MS = 5_000;
export const MARKDOWN_IMPORT_ID_ATTEMPTS = 16;
export const MARKDOWN_IMPORT_HANDOFF_STORAGE_KEY = 'lash:markdown-import-handoff:v1';

const SOURCE_QUIESCENCE_MESSAGE =
  'Finish saving or recover your current document before opening the imported document.';

type StrictStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface MarkdownBrowserFile {
  readonly name: string;
  readonly size: number;
  slice(
    start?: number,
    end?: number,
  ): {
    arrayBuffer(): Promise<ArrayBuffer>;
  };
}

export interface MarkdownImportPlan {
  readonly generation: number;
  readonly fileName: string;
  readonly format: MarkdownFileFormat;
  readonly title: string;
  readonly doc: LocalBodyDocJson;
  readonly warnings: readonly string[];
}

export type MarkdownFileIntakeResult =
  | Readonly<{ status: 'ready'; plan: MarkdownImportPlan }>
  | Readonly<{ status: 'ignored' }>
  | Readonly<{
      status: 'error';
      code:
        | 'file-read-failed'
        | 'file-too-large'
        | 'invalid-extension'
        | 'invalid-utf8'
        | 'malformed-lash-v1'
        | 'schema-invalid'
        | 'unsafe-content'
        | 'unsupported-lash-version';
      message: string;
    }>;

export interface ReadMarkdownFileForImportOptions {
  file: MarkdownBrowserFile;
  generation: number;
  isGenerationCurrent(): boolean;
  validateSchema: LocalBodySchemaValidator;
  canonicalizeSchema(doc: LocalBodyDocJson): LocalBodyDocJson;
  parseMarkdown?: (markdown: string) => MarkdownFileParseResult;
}

const isMarkdownFileName = (name: string) => /\.(?:md|markdown)$/iu.test(name);

export const readMarkdownFileForImport = async ({
  file,
  generation,
  isGenerationCurrent,
  validateSchema,
  canonicalizeSchema,
  parseMarkdown = parseMarkdownFileToDoc,
}: ReadMarkdownFileForImportOptions): Promise<MarkdownFileIntakeResult> => {
  if (!isGenerationCurrent()) return { status: 'ignored' };
  if (!isMarkdownFileName(file.name)) {
    return {
      status: 'error',
      code: 'invalid-extension',
      message: 'Choose a Markdown file ending in .md or .markdown.',
    };
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    return {
      status: 'error',
      code: 'file-read-failed',
      message: 'This Markdown file could not be read.',
    };
  }
  if (file.size > MARKDOWN_FILE_MAX_BYTES) {
    return {
      status: 'error',
      code: 'file-too-large',
      message: 'This Markdown file is larger than the 2,000,000-byte limit.',
    };
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.slice(0, MARKDOWN_FILE_MAX_BYTES + 1).arrayBuffer();
  } catch {
    return isGenerationCurrent()
      ? {
          status: 'error',
          code: 'file-read-failed',
          message: 'This Markdown file could not be read.',
        }
      : { status: 'ignored' };
  }
  if (!isGenerationCurrent()) return { status: 'ignored' };
  if (buffer.byteLength !== file.size || buffer.byteLength > MARKDOWN_FILE_MAX_BYTES) {
    return {
      status: 'error',
      code: 'file-read-failed',
      message: 'This Markdown file could not be read.',
    };
  }

  let markdown: string;
  try {
    markdown = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    return {
      status: 'error',
      code: 'invalid-utf8',
      message: 'This file isn’t valid UTF-8 Markdown. Choose a UTF-8 .md or .markdown file.',
    };
  }
  if (!isGenerationCurrent()) return { status: 'ignored' };

  const parsed = parseMarkdown(markdown);
  if (!isGenerationCurrent()) return { status: 'ignored' };
  if (!parsed.ok) {
    return {
      status: 'error',
      code: parsed.code,
      message: parsed.message,
    };
  }

  const rawDoc = parsed.doc as LocalBodyDocJson;
  try {
    validateSchema(rawDoc);
  } catch {
    return isGenerationCurrent()
      ? {
          status: 'error',
          code: 'schema-invalid',
          message: 'This Markdown file does not match the supported document structure.',
        }
      : { status: 'ignored' };
  }
  if (!isGenerationCurrent()) return { status: 'ignored' };

  let canonicalDoc: LocalBodyDocJson;
  try {
    canonicalDoc = canonicalizeSchema(rawDoc);
  } catch {
    return isGenerationCurrent()
      ? {
          status: 'error',
          code: 'schema-invalid',
          message: 'This Markdown file does not match the supported document structure.',
        }
      : { status: 'ignored' };
  }
  if (!isGenerationCurrent()) return { status: 'ignored' };

  let detachedCanonicalDoc: LocalBodyDocJson;
  try {
    detachedCanonicalDoc = validateAndDetachLocalBodyDocJson(canonicalDoc);
  } catch {
    return isGenerationCurrent()
      ? {
          status: 'error',
          code: 'schema-invalid',
          message: 'This Markdown file does not match the supported document structure.',
        }
      : { status: 'ignored' };
  }
  if (!isGenerationCurrent()) return { status: 'ignored' };

  try {
    validateSchema(detachedCanonicalDoc);
  } catch {
    return isGenerationCurrent()
      ? {
          status: 'error',
          code: 'schema-invalid',
          message: 'This Markdown file does not match the supported document structure.',
        }
      : { status: 'ignored' };
  }
  if (!isGenerationCurrent()) return { status: 'ignored' };

  return {
    status: 'ready',
    plan: {
      generation,
      fileName: file.name,
      format: parsed.format,
      title:
        parsed.format === 'lash-v1' && parsed.title
          ? parsed.title
          : deriveLegacyMarkdownTitle(file.name),
      doc: detachedCanonicalDoc,
      warnings: [...parsed.warnings],
    },
  };
};

export type MarkdownDownloadPlan =
  | Readonly<{
      status: 'ready';
      filename: string;
      markdown: string;
      normalizedTitle: string;
      warnings: readonly string[];
    }>
  | Readonly<{
      status: 'blocked';
      reasons: readonly string[];
      warnings: readonly string[];
    }>;

export const createMarkdownDownloadPlan = (input: {
  doc: LocalBodyDocJson;
  title: string;
  documentId: string;
  mode?: 'share-copy';
}): MarkdownDownloadPlan => {
  const result = serializeDocToMarkdownFile(input.doc, {
    title: input.title,
    documentId: input.documentId,
    mode: input.mode,
  });
  if (result.blockedReasons.length) {
    return {
      status: 'blocked',
      reasons: [...result.blockedReasons],
      warnings: [...result.warnings],
    };
  }
  return {
    status: 'ready',
    filename: result.filename,
    markdown: result.markdown,
    normalizedTitle: result.normalizedTitle,
    warnings: [...result.warnings],
  };
};

type StrictRegistryRead =
  | Readonly<{ ok: true; raw: string | null; records: readonly LashDocumentRecord[] }>
  | Readonly<{ ok: false; code: 'registry-invalid' | 'storage-unavailable' }>;

const isExactIsoTimestamp = (value: string) => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
};

const isExactRegistryRecord = (value: unknown): value is LashDocumentRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'createdAt,id,title,updatedAt' ||
    typeof record.id !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return false;
  }
  return (
    record.id.length > 0 &&
    normalizeDocumentId(record.id) === record.id &&
    record.title.trim().length > 0 &&
    isExactIsoTimestamp(record.createdAt) &&
    isExactIsoTimestamp(record.updatedAt)
  );
};

const readStrictRegistry = (storage: StrictStorage): StrictRegistryRead => {
  let raw: string | null;
  try {
    raw = storage.getItem(DOCUMENT_REGISTRY_STORAGE_KEY);
  } catch {
    return { ok: false, code: 'storage-unavailable' };
  }
  if (raw === null) return { ok: true, raw, records: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, code: 'registry-invalid' };
  }
  if (!Array.isArray(parsed) || !parsed.every(isExactRegistryRecord)) {
    return { ok: false, code: 'registry-invalid' };
  }
  const ids = parsed.map((record) => record.id);
  if (new Set(ids).size !== ids.length) return { ok: false, code: 'registry-invalid' };
  return { ok: true, raw, records: parsed };
};

const safeGet = (storage: StrictStorage, key: string) => {
  try {
    return { ok: true as const, value: storage.getItem(key) };
  } catch {
    return { ok: false as const };
  }
};

const restoreExact = (storage: StrictStorage, key: string, preimage: string | null) => {
  try {
    const current = storage.getItem(key);
    if (current !== preimage) {
      if (preimage === null) storage.removeItem(key);
      else storage.setItem(key, preimage);
    }
    return storage.getItem(key) === preimage;
  } catch {
    return false;
  }
};

export interface MarkdownImportDestination {
  readonly attemptId: string;
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly bodyRevision: number;
  readonly bodyWriteId: string;
}

type MarkdownImportHandoffReceipt = MarkdownImportDestination &
  Readonly<{
    version: 1;
    deadline: number;
  }>;

const isMarkdownImportDestination = (value: unknown): value is MarkdownImportDestination => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const destination = value as Record<string, unknown>;
  return (
    typeof destination.attemptId === 'string' &&
    destination.attemptId.length > 0 &&
    typeof destination.id === 'string' &&
    normalizeDocumentId(destination.id) === destination.id &&
    typeof destination.path === 'string' &&
    destination.path === documentPath(destination.id) &&
    typeof destination.title === 'string' &&
    destination.title.length > 0 &&
    typeof destination.bodyRevision === 'number' &&
    Number.isSafeInteger(destination.bodyRevision) &&
    destination.bodyRevision > 0 &&
    typeof destination.bodyWriteId === 'string' &&
    destination.bodyWriteId.length > 0
  );
};

const parseMarkdownImportHandoffReceipt = (
  raw: string | null,
): MarkdownImportHandoffReceipt | null => {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isMarkdownImportDestination(parsed)) return null;
  const receipt = parsed as unknown as Record<string, unknown>;
  if (
    receipt.version !== 1 ||
    typeof receipt.deadline !== 'number' ||
    !Number.isSafeInteger(receipt.deadline) ||
    receipt.deadline <= 0 ||
    Object.keys(receipt).sort().join(',') !==
      'attemptId,bodyRevision,bodyWriteId,deadline,id,path,title,version'
  ) {
    return null;
  }
  return parsed as MarkdownImportHandoffReceipt;
};

export const persistMarkdownImportHandoff = (
  storage: StrictStorage,
  destination: MarkdownImportDestination,
  deadline: number,
): boolean => {
  if (
    !isMarkdownImportDestination(destination) ||
    !Number.isSafeInteger(deadline) ||
    deadline <= 0
  ) {
    return false;
  }
  const receipt: MarkdownImportHandoffReceipt = {
    version: 1,
    ...destination,
    deadline,
  };
  const raw = JSON.stringify(receipt);
  try {
    storage.setItem(MARKDOWN_IMPORT_HANDOFF_STORAGE_KEY, raw);
    return storage.getItem(MARKDOWN_IMPORT_HANDOFF_STORAGE_KEY) === raw;
  } catch {
    return false;
  }
};

export const acknowledgeMarkdownImportDestination = (options: {
  handoffStorage: StrictStorage;
  documentStorage: StrictStorage;
  pathname: string;
  documentId: string;
  title: string;
  bodyRevision: number;
  bodyWriteId: string;
  validateSchema: LocalBodySchemaValidator;
}): MarkdownImportDestination | null => {
  let raw: string | null;
  try {
    raw = options.handoffStorage.getItem(MARKDOWN_IMPORT_HANDOFF_STORAGE_KEY);
  } catch {
    return null;
  }
  const receipt = parseMarkdownImportHandoffReceipt(raw);
  if (
    !receipt ||
    receipt.path !== options.pathname ||
    receipt.id !== normalizeDocumentId(options.documentId) ||
    receipt.title !== options.title ||
    receipt.bodyRevision !== options.bodyRevision ||
    receipt.bodyWriteId !== options.bodyWriteId
  ) {
    return null;
  }
  const registry = readStrictRegistry(options.documentStorage);
  if (
    !registry.ok ||
    !registry.records.some((record) => record.id === receipt.id && record.title === receipt.title)
  ) {
    return null;
  }
  const title = safeGet(options.documentStorage, documentTitleStorageKey(receipt.id));
  if (!title.ok || title.value !== receipt.title) return null;
  const body = loadLocalDocumentBody({
    storage: options.documentStorage,
    documentId: receipt.id,
    validateSchema: options.validateSchema,
  });
  if (
    body.state !== 'ready' ||
    body.envelope.revision !== receipt.bodyRevision ||
    body.envelope.writeId !== receipt.bodyWriteId
  ) {
    return null;
  }
  try {
    options.handoffStorage.removeItem(MARKDOWN_IMPORT_HANDOFF_STORAGE_KEY);
    if (options.handoffStorage.getItem(MARKDOWN_IMPORT_HANDOFF_STORAGE_KEY) !== null) return null;
  } catch {
    return null;
  }
  return {
    attemptId: receipt.attemptId,
    id: receipt.id,
    path: receipt.path,
    title: receipt.title,
    bodyRevision: receipt.bodyRevision,
    bodyWriteId: receipt.bodyWriteId,
  };
};

export type MarkdownImportCommitResult =
  | Readonly<{ status: 'canceled' }>
  | Readonly<{ status: 'committed'; destination: Omit<MarkdownImportDestination, 'attemptId'> }>
  | Readonly<{
      status: 'failed';
      code:
        | 'id-exhausted'
        | 'invalid-id'
        | 'registry-invalid'
        | 'storage-unavailable'
        | 'verification-failed';
    }>
  | Readonly<{
      status: 'cleanup-unverified';
      destinationId: string;
    }>;

export interface CommitNewDeviceDocumentOptions {
  storage: StrictStorage;
  sourceDocumentId: string;
  doc: LocalBodyDocJson;
  title: string;
  createDocumentId(): string;
  createWriteId?(): string;
  now?: () => Date;
  validateSchema: LocalBodySchemaValidator;
  shouldCancelBeforeCommit?: () => boolean;
}

export interface CommitMarkdownImportOptions
  extends Omit<CommitNewDeviceDocumentOptions, 'doc' | 'title'> {
  plan: MarkdownImportPlan;
}

const failureCode = (
  error: unknown,
): Extract<MarkdownImportCommitResult, { status: 'failed' }>['code'] => {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === 'storage-unavailable'
  ) {
    return 'storage-unavailable';
  }
  return 'verification-failed';
};

export const commitNewDeviceDocument = (
  options: CommitNewDeviceDocumentOptions,
): MarkdownImportCommitResult => {
  const registry = readStrictRegistry(options.storage);
  if (!registry.ok) return { status: 'failed', code: registry.code };
  const sourceId = normalizeDocumentId(options.sourceDocumentId);

  let destinationId = '';
  let titleKey = '';
  let primaryKey = '';
  let backupKey = '';
  for (let attempt = 0; attempt < MARKDOWN_IMPORT_ID_ATTEMPTS; attempt += 1) {
    const candidate = options.createDocumentId();
    const normalized = normalizeDocumentId(candidate);
    if (!candidate || normalized !== candidate || normalized === sourceId) {
      if (attempt === MARKDOWN_IMPORT_ID_ATTEMPTS - 1) {
        return { status: 'failed', code: 'id-exhausted' };
      }
      continue;
    }
    const candidateTitleKey = documentTitleStorageKey(normalized);
    const candidatePrimaryKey = localDocumentBodyKey(normalized);
    const candidateBackupKey = localDocumentBodyBackupKey(normalized);
    const title = safeGet(options.storage, candidateTitleKey);
    const primary = safeGet(options.storage, candidatePrimaryKey);
    const backup = safeGet(options.storage, candidateBackupKey);
    if (!title.ok || !primary.ok || !backup.ok) {
      return { status: 'failed', code: 'storage-unavailable' };
    }
    const collides =
      registry.records.some((record) => record.id === normalized) ||
      title.value !== null ||
      primary.value !== null ||
      backup.value !== null;
    if (collides) {
      if (attempt === MARKDOWN_IMPORT_ID_ATTEMPTS - 1) {
        return { status: 'failed', code: 'id-exhausted' };
      }
      continue;
    }
    destinationId = normalized;
    titleKey = candidateTitleKey;
    primaryKey = candidatePrimaryKey;
    backupKey = candidateBackupKey;
    break;
  }
  if (!destinationId) return { status: 'failed', code: 'id-exhausted' };

  const titlePreimage = safeGet(options.storage, titleKey);
  const primaryPreimage = safeGet(options.storage, primaryKey);
  const backupPreimage = safeGet(options.storage, backupKey);
  if (!titlePreimage.ok || !primaryPreimage.ok || !backupPreimage.ok) {
    return { status: 'failed', code: 'storage-unavailable' };
  }
  if (options.shouldCancelBeforeCommit?.()) return { status: 'canceled' };

  const now = options.now ?? (() => new Date());
  const timestamp = now().toISOString();
  const record: LashDocumentRecord = {
    id: destinationId,
    title: options.title,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const nextRegistryRaw = JSON.stringify([record, ...registry.records]);
  let wroteRegistry = false;
  let committed = false;
  try {
    const envelope = saveLocalDocumentBody({
      storage: options.storage,
      documentId: destinationId,
      doc: options.doc,
      expected: null,
      savedAt: timestamp,
      createWriteId: options.createWriteId,
      validateSchema: options.validateSchema,
    });
    const expectedPrimaryRaw = JSON.stringify(envelope);
    if (options.storage.getItem(primaryKey) !== expectedPrimaryRaw) {
      throw new Error('Destination body exact readback failed.');
    }
    const loaded = loadLocalDocumentBody({
      storage: options.storage,
      documentId: destinationId,
      validateSchema: options.validateSchema,
    });
    if (
      loaded.state !== 'ready' ||
      loaded.envelope.revision !== envelope.revision ||
      loaded.envelope.writeId !== envelope.writeId ||
      JSON.stringify(loaded.envelope.doc) !== JSON.stringify(options.doc)
    ) {
      throw new Error('Destination body verification failed.');
    }

    options.storage.setItem(titleKey, options.title);
    if (options.storage.getItem(titleKey) !== options.title) {
      throw new Error('Destination title verification failed.');
    }

    if (options.storage.getItem(DOCUMENT_REGISTRY_STORAGE_KEY) !== registry.raw) {
      throw new Error('Document registry changed before commit.');
    }
    wroteRegistry = true;
    options.storage.setItem(DOCUMENT_REGISTRY_STORAGE_KEY, nextRegistryRaw);
    if (options.storage.getItem(primaryKey) !== expectedPrimaryRaw) {
      throw new Error('Destination body changed before registry commit.');
    }
    if (options.storage.getItem(titleKey) !== options.title) {
      throw new Error('Destination title changed before registry commit.');
    }
    // This exact registry readback is deliberately last: it is the
    // transaction's visibility/linearization point.
    if (options.storage.getItem(DOCUMENT_REGISTRY_STORAGE_KEY) !== nextRegistryRaw) {
      throw new Error('Destination registry verification failed.');
    }
    committed = true;
    return {
      status: 'committed',
      destination: {
        id: destinationId,
        path: documentPath(destinationId),
        title: options.title,
        bodyRevision: envelope.revision,
        bodyWriteId: envelope.writeId,
      },
    };
  } catch (error) {
    if (committed) {
      throw error;
    }
    let registryRestored = true;
    if (wroteRegistry) {
      const current = readStrictRegistry(options.storage);
      if (!current.ok) registryRestored = false;
      else if (current.raw === nextRegistryRaw) {
        registryRestored = restoreExact(options.storage, DOCUMENT_REGISTRY_STORAGE_KEY, registry.raw);
      } else {
        registryRestored = !current.records.some((entry) => entry.id === destinationId);
      }
    }
    if (!registryRestored) return { status: 'cleanup-unverified', destinationId };
    const restored = [
      restoreExact(options.storage, titleKey, titlePreimage.value),
      restoreExact(options.storage, primaryKey, primaryPreimage.value),
      restoreExact(options.storage, backupKey, backupPreimage.value),
    ].every(Boolean);
    if (!restored) {
      return { status: 'cleanup-unverified', destinationId };
    }
    return { status: 'failed', code: failureCode(error) };
  }
};

export const commitMarkdownImport = ({ plan, ...options }: CommitMarkdownImportOptions) =>
  commitNewDeviceDocument({ ...options, doc: plan.doc, title: plan.title });

type InitialEmptyMarkdownSource = LocalBodyPersistenceOptions & {
  expected: LocalBodyExpectedRevision | null;
};

export const isVerifiedInitialEmptyMarkdownSource = (source: InitialEmptyMarkdownSource | null) =>
  source?.expected === null && loadLocalDocumentBody(source).state === 'empty';

export type MarkdownImportSourceQuiescence =
  | Readonly<{
      kind: 'local';
      localBodyState:
        | 'conflict'
        | 'failed'
        | 'loading'
        | 'ready'
        | 'recovered-awaiting-confirmation'
        | 'unavailable';
      initialEmpty?: InitialEmptyMarkdownSource | null;
      flushVerified(): Promise<boolean>;
    }>
  | Readonly<{
      kind: 'remote';
      accessHydrated: boolean;
      providerHydrated: boolean;
      syncState:
        | 'connecting'
        | 'disabled'
        | 'hydrating'
        | 'offline'
        | 'reconnecting'
        | 'saved'
        | 'syncing';
      pendingUpdateCount: number;
      queuedUpdateCount: number;
      readOnly: boolean;
    }>;

export const verifyMarkdownImportSourceQuiescence = async (
  source: MarkdownImportSourceQuiescence,
): Promise<Readonly<{ ok: true; source?: 'initial-empty' }> | Readonly<{ ok: false; message: string }>> => {
  if (source.kind === 'remote') {
    return source.accessHydrated &&
      source.providerHydrated &&
      source.syncState === 'saved' &&
      source.pendingUpdateCount === 0 &&
      source.queuedUpdateCount === 0
      ? { ok: true }
      : { ok: false, message: SOURCE_QUIESCENCE_MESSAGE };
  }
  if (source.localBodyState !== 'ready') {
    return { ok: false, message: SOURCE_QUIESCENCE_MESSAGE };
  }
  try {
    if (isVerifiedInitialEmptyMarkdownSource(source.initialEmpty ?? null)) {
      return { ok: true, source: 'initial-empty' };
    }
    return (await source.flushVerified())
      ? { ok: true }
      : { ok: false, message: SOURCE_QUIESCENCE_MESSAGE };
  } catch {
    return { ok: false, message: SOURCE_QUIESCENCE_MESSAGE };
  }
};

export type MarkdownImportNavigationState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{
      status: 'created-opening' | 'created-open-failed' | 'opened';
      destination: MarkdownImportDestination;
    }>;

export interface MarkdownImportNavigationController {
  start(destination: MarkdownImportDestination): void;
  acknowledge(destination: MarkdownImportDestination): boolean;
  retry(): boolean;
  dispose(): void;
  getState(): MarkdownImportNavigationState;
}

const sameDestination = (expected: MarkdownImportDestination, actual: MarkdownImportDestination) =>
  expected.attemptId === actual.attemptId &&
  expected.id === actual.id &&
  expected.path === actual.path &&
  expected.title === actual.title &&
  expected.bodyRevision === actual.bodyRevision &&
  expected.bodyWriteId === actual.bodyWriteId;

export const createMarkdownImportNavigationController = (options: {
  push(path: string): void;
  onStateChange(state: MarkdownImportNavigationState): void;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}): MarkdownImportNavigationController => {
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let state: MarkdownImportNavigationState = { status: 'idle' };
  let timer: ReturnType<typeof setTimeout> | null = null;

  const publish = (next: MarkdownImportNavigationState) => {
    state = next;
    options.onStateChange(next);
  };
  const cancelTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };
  const open = (destination: MarkdownImportDestination) => {
    cancelTimer();
    publish({ status: 'created-opening', destination });
    options.push(destination.path);
    timer = setTimer(() => {
      timer = null;
      if (state.status !== 'created-opening' || !sameDestination(state.destination, destination)) {
        return;
      }
      publish({ status: 'created-open-failed', destination });
    }, MARKDOWN_IMPORT_NAVIGATION_WATCHDOG_MS);
  };

  return {
    start(destination) {
      if (state.status !== 'idle') return;
      open(destination);
    },
    acknowledge(destination) {
      if (state.status !== 'created-opening' || !sameDestination(state.destination, destination)) {
        return false;
      }
      cancelTimer();
      publish({ status: 'opened', destination });
      return true;
    },
    retry() {
      if (state.status !== 'created-open-failed') return false;
      open(state.destination);
      return true;
    },
    dispose() {
      cancelTimer();
    },
    getState: () => state,
  };
};
