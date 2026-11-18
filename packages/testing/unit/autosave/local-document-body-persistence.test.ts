import { createLashEditorExtensions } from '@lash/editor-core';
import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import * as localBodyPersistence from '../../../../apps/web/lib/localDocumentBodyPersistence';
import {
  loadLocalDocumentBody,
  LocalBodyPersistenceError,
  localDocumentBodyBackupKey,
  localDocumentBodyKey,
  promoteRecoveredLocalDocumentBody,
  saveLocalDocumentBody,
  type LocalBodyEnvelope,
  type LocalBodyDocJson,
  type LocalBodySchemaValidator,
} from '../../../../apps/web/lib/localDocumentBodyPersistence';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly failures = new Map<string, DOMException>();
  readonly operations: Array<
    { operation: 'get'; key: string } | { operation: 'set'; key: string; value: string }
  > = [];
  readTransform: ((key: string, value: string | null) => string | null) | null = null;

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    this.operations.push({ operation: 'get', key });
    const value = this.values.get(key) ?? null;
    return this.readTransform ? this.readTransform(key, value) : value;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.operations.push({ operation: 'set', key, value });
    const failure = this.failures.get(key);
    if (failure) throw failure;
    this.values.set(key, value);
  }
}

const paragraphDoc = (text: string): LocalBodyDocJson => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text }],
    },
  ],
});

const validateSchema: LocalBodySchemaValidator = (doc) => {
  const text = JSON.stringify(doc);
  if (text.includes('"type":"schema-invalid"')) {
    throw new Error('schema-invalid fixture');
  }
};

type ValidateAndDetachLocalBodyDocJson = (doc: unknown) => LocalBodyDocJson;

const validateAndDetachLocalBodyDocJson = (doc: unknown) => {
  const helper = (
    localBodyPersistence as typeof localBodyPersistence & {
      validateAndDetachLocalBodyDocJson?: ValidateAndDetachLocalBodyDocJson;
    }
  ).validateAndDetachLocalBodyDocJson;
  if (!helper) {
    throw new Error('validateAndDetachLocalBodyDocJson is not exported.');
  }
  return helper(doc);
};

const expectLocalBodyError = (
  operation: () => unknown,
  code: LocalBodyPersistenceError['code'],
  message: string,
) => {
  expect(operation).toThrowError(
    expect.objectContaining<Partial<LocalBodyPersistenceError>>({
      name: 'LocalBodyPersistenceError',
      code,
      message,
    }),
  );
};

const docWithExtra = (extra: unknown): LocalBodyDocJson => ({
  type: 'doc',
  content: [],
  extra,
});

const nestedArrayAtDepth = (arrayCount: number) => {
  let nested: unknown = null;
  for (let index = 0; index < arrayCount; index += 1) {
    nested = [nested];
  }
  return docWithExtra(nested);
};

const envelope = (
  documentId: string,
  revision: number,
  text: string,
  writeId = `write-${revision}`,
): LocalBodyEnvelope => ({
  version: 1,
  schemaVersion: 'lash-schema-v1',
  documentId,
  revision,
  writeId,
  savedAt: `2026-07-18T00:00:0${Math.min(revision, 9)}.000Z`,
  doc: paragraphDoc(text),
});

describe('local document body persistence', () => {
  it('round-trips a versioned primary under the normalized document id', () => {
    const storage = new MemoryStorage();
    const saved = saveLocalDocumentBody({
      storage,
      documentId: ' Trust Alpha ',
      doc: paragraphDoc('Durable draft'),
      expected: null,
      validateSchema,
      now: () => new Date('2026-07-18T00:00:00.000Z'),
      createWriteId: () => 'write-alpha-1',
    });

    expect(saved.documentId).toBe('trust-alpha');
    expect(saved.revision).toBe(1);
    expect(JSON.parse(storage.getItem(localDocumentBodyKey('trust-alpha')) ?? '')).toMatchObject({
      version: 1,
      schemaVersion: 'lash-schema-v1',
      documentId: 'trust-alpha',
      revision: 1,
      writeId: 'write-alpha-1',
      savedAt: '2026-07-18T00:00:00.000Z',
      doc: paragraphDoc('Durable draft'),
    });

    expect(
      loadLocalDocumentBody({
        storage,
        documentId: 'TRUST ALPHA',
        validateSchema,
      }),
    ).toMatchObject({
      state: 'ready',
      envelope: saved,
      expected: { revision: 1, writeId: 'write-alpha-1' },
    });
  });

  it('falls back to a valid backup without mutating malformed primary data', () => {
    const storage = new MemoryStorage();
    const documentId = 'trust-recovery';
    const backupRaw = JSON.stringify({
      version: 1,
      schemaVersion: 'lash-schema-v1',
      documentId,
      revision: 4,
      writeId: 'write-good-4',
      savedAt: '2026-07-18T00:00:00.000Z',
      doc: paragraphDoc('Last good copy'),
    });
    storage.setItem(localDocumentBodyKey(documentId), '{"broken":');
    storage.setItem(localDocumentBodyBackupKey(documentId), backupRaw);

    const before = new Map(storage.values);
    expect(loadLocalDocumentBody({ storage, documentId, validateSchema })).toMatchObject({
      state: 'recovered-awaiting-confirmation',
      envelope: {
        revision: 4,
        writeId: 'write-good-4',
        doc: paragraphDoc('Last good copy'),
      },
    });
    expect(storage.values).toEqual(before);
  });

  it.each([
    [
      'schema-invalid',
      JSON.stringify({
        ...envelope('fallback-doc', 5, 'schema-invalid'),
        doc: { type: 'doc', content: [{ type: 'schema-invalid' }] },
      }),
    ],
    [
      'unsupported version',
      JSON.stringify({ ...envelope('fallback-doc', 5, 'unsupported'), version: 2 }),
    ],
    [
      'unsupported schema',
      JSON.stringify({
        ...envelope('fallback-doc', 5, 'unsupported'),
        schemaVersion: 'lash-schema-v2',
      }),
    ],
    ['wrong document', JSON.stringify(envelope('other-document', 5, 'wrong doc'))],
  ])('falls back when the primary is %s', (_label, primaryRaw) => {
    const storage = new MemoryStorage();
    storage.setItem(localDocumentBodyKey('fallback-doc'), primaryRaw);
    storage.setItem(
      localDocumentBodyBackupKey('fallback-doc'),
      JSON.stringify(envelope('fallback-doc', 4, 'safe backup', 'backup-4')),
    );

    expect(
      loadLocalDocumentBody({ storage, documentId: 'fallback-doc', validateSchema }),
    ).toMatchObject({
      state: 'recovered-awaiting-confirmation',
      envelope: { revision: 4, writeId: 'backup-4', doc: paragraphDoc('safe backup') },
    });
  });

  it('rotates only a valid current primary before writing the next primary', () => {
    const storage = new MemoryStorage();
    const first = saveLocalDocumentBody({
      storage,
      documentId: 'rotation',
      doc: paragraphDoc('revision one'),
      expected: null,
      validateSchema,
      createWriteId: () => 'rotation-1',
    });
    const second = saveLocalDocumentBody({
      storage,
      documentId: 'rotation',
      doc: paragraphDoc('revision two'),
      expected: { revision: first.revision, writeId: first.writeId },
      validateSchema,
      createWriteId: () => 'rotation-2',
    });

    expect(JSON.parse(storage.getItem(localDocumentBodyBackupKey('rotation')) ?? '')).toEqual(
      first,
    );
    expect(JSON.parse(storage.getItem(localDocumentBodyKey('rotation')) ?? '')).toEqual(second);
  });

  it.each([
    ['empty write id', { createWriteId: () => '' }],
    ['invalid save timestamp', { savedAt: 'not-a-date' }],
  ])('validates generated %s before rotating either slot', (_label, generated) => {
    const storage = new MemoryStorage();
    const current = envelope('invalid-generated-metadata', 2, 'current');
    const primaryRaw = JSON.stringify(current);
    const backupRaw = JSON.stringify(envelope('invalid-generated-metadata', 1, 'backup'));
    storage.setItem(localDocumentBodyKey('invalid-generated-metadata'), primaryRaw);
    storage.setItem(localDocumentBodyBackupKey('invalid-generated-metadata'), backupRaw);

    expect(() =>
      saveLocalDocumentBody({
        storage,
        documentId: 'invalid-generated-metadata',
        doc: paragraphDoc('must not write'),
        expected: { revision: current.revision, writeId: current.writeId },
        validateSchema,
        ...generated,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<LocalBodyPersistenceError>>({
        code: 'structural-invalid',
      }),
    );
    expect(storage.getItem(localDocumentBodyKey('invalid-generated-metadata'))).toBe(primaryRaw);
    expect(storage.getItem(localDocumentBodyBackupKey('invalid-generated-metadata'))).toBe(
      backupRaw,
    );
  });

  it('leaves the primary untouched when backup rotation fails', () => {
    const storage = new MemoryStorage();
    const current = envelope('backup-failure', 2, 'current');
    const primaryRaw = JSON.stringify(current);
    storage.setItem(localDocumentBodyKey('backup-failure'), primaryRaw);
    storage.failures.set(
      localDocumentBodyBackupKey('backup-failure'),
      new DOMException('quota', 'QuotaExceededError'),
    );

    expect(() =>
      saveLocalDocumentBody({
        storage,
        documentId: 'backup-failure',
        doc: paragraphDoc('new content'),
        expected: { revision: current.revision, writeId: current.writeId },
        validateSchema,
      }),
    ).toThrowError(expect.objectContaining<Partial<LocalBodyPersistenceError>>({ code: 'quota' }));
    expect(storage.getItem(localDocumentBodyKey('backup-failure'))).toBe(primaryRaw);
  });

  it('keeps the old primary and a valid backup when the primary write fails', () => {
    const storage = new MemoryStorage();
    const current = envelope('primary-failure', 2, 'current');
    const primaryRaw = JSON.stringify(current);
    const primaryKey = localDocumentBodyKey('primary-failure');
    storage.setItem(primaryKey, primaryRaw);
    storage.failures.set(primaryKey, new DOMException('security', 'SecurityError'));

    expect(() =>
      saveLocalDocumentBody({
        storage,
        documentId: 'primary-failure',
        doc: paragraphDoc('new content'),
        expected: { revision: current.revision, writeId: current.writeId },
        validateSchema,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<LocalBodyPersistenceError>>({ code: 'security' }),
    );
    expect(storage.getItem(primaryKey)).toBe(primaryRaw);
    expect(
      JSON.parse(storage.getItem(localDocumentBodyBackupKey('primary-failure')) ?? ''),
    ).toEqual(current);
  });

  it('never rotates a malformed primary into the valid backup', () => {
    const storage = new MemoryStorage();
    const primaryKey = localDocumentBodyKey('malformed-rotation');
    const backupKey = localDocumentBodyBackupKey('malformed-rotation');
    const backupRaw = JSON.stringify(envelope('malformed-rotation', 3, 'safe'));
    storage.setItem(primaryKey, '{"malformed":');
    storage.setItem(backupKey, backupRaw);

    expect(() =>
      saveLocalDocumentBody({
        storage,
        documentId: 'malformed-rotation',
        doc: paragraphDoc('must not write'),
        expected: null,
        validateSchema,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<LocalBodyPersistenceError>>({ code: 'invalid-json' }),
    );
    expect(storage.getItem(backupKey)).toBe(backupRaw);
  });

  it('promotes a deliberately accepted recovery without changing its backup', () => {
    const storage = new MemoryStorage();
    const documentId = 'promote-recovery';
    const backup = envelope(documentId, 7, 'recovered', 'backup-7');
    const backupRaw = JSON.stringify(backup);
    storage.setItem(localDocumentBodyKey(documentId), '{"broken":');
    storage.setItem(localDocumentBodyBackupKey(documentId), backupRaw);
    const loaded = loadLocalDocumentBody({ storage, documentId, validateSchema });
    expect(loaded.state).toBe('recovered-awaiting-confirmation');
    if (loaded.state !== 'recovered-awaiting-confirmation') {
      throw new Error('Expected a recovery token fixture.');
    }

    const promoted = promoteRecoveredLocalDocumentBody({
      storage,
      documentId,
      recovered: backup,
      recoveryToken: loaded.recoveryToken,
      validateSchema,
      createWriteId: () => 'promoted-8',
    });

    expect(promoted).toMatchObject({ revision: 8, writeId: 'promoted-8' });
    expect(storage.getItem(localDocumentBodyBackupKey(documentId))).toBe(backupRaw);
    expect(JSON.parse(storage.getItem(localDocumentBodyKey(documentId)) ?? '')).toEqual(promoted);
  });

  it.each([
    ['different malformed primary', '{"changed-invalid":'],
    [
      'future-schema primary',
      JSON.stringify({
        ...envelope('promote-primary-token', 9, 'future primary', 'future-9'),
        schemaVersion: 'lash-schema-v2',
      }),
    ],
  ])(
    'refuses recovery promotion when the observed primary becomes a %s',
    (_label, changedPrimaryRaw) => {
      const storage = new MemoryStorage();
      const documentId = 'promote-primary-token';
      const observedPrimaryRaw = '{"observed-invalid":';
      const backupRaw = JSON.stringify(envelope(documentId, 4, 'recovered', 'backup-4'));
      storage.setItem(localDocumentBodyKey(documentId), observedPrimaryRaw);
      storage.setItem(localDocumentBodyBackupKey(documentId), backupRaw);
      const loaded = loadLocalDocumentBody({ storage, documentId, validateSchema });
      expect(loaded.state).toBe('recovered-awaiting-confirmation');
      if (loaded.state !== 'recovered-awaiting-confirmation') {
        throw new Error('Expected a recovery token fixture.');
      }
      const recoveryToken = Object.freeze({
        primaryRaw: loaded.primaryRaw,
        backupRaw: loaded.backupRaw,
      });

      storage.setItem(localDocumentBodyKey(documentId), changedPrimaryRaw);

      expect(() =>
        promoteRecoveredLocalDocumentBody({
          storage,
          documentId,
          recovered: loaded.envelope,
          recoveryToken,
          validateSchema,
          createWriteId: () => 'must-not-write',
        } as Parameters<typeof promoteRecoveredLocalDocumentBody>[0] & {
          recoveryToken: Readonly<{ primaryRaw: string | null; backupRaw: string }>;
        }),
      ).toThrowError(
        expect.objectContaining<Partial<LocalBodyPersistenceError>>({ code: 'conflict' }),
      );
      expect(storage.getItem(localDocumentBodyKey(documentId))).toBe(changedPrimaryRaw);
      expect(storage.getItem(localDocumentBodyBackupKey(documentId))).toBe(backupRaw);
    },
  );

  it('refuses recovery promotion when backup bytes change despite matching revision and write id', () => {
    const storage = new MemoryStorage();
    const documentId = 'promote-backup-token';
    const observedPrimaryRaw = '{"observed-invalid":';
    const backupRaw = JSON.stringify(envelope(documentId, 4, 'recovered', 'backup-4'));
    storage.setItem(localDocumentBodyKey(documentId), observedPrimaryRaw);
    storage.setItem(localDocumentBodyBackupKey(documentId), backupRaw);
    const loaded = loadLocalDocumentBody({ storage, documentId, validateSchema });
    expect(loaded.state).toBe('recovered-awaiting-confirmation');
    if (loaded.state !== 'recovered-awaiting-confirmation') {
      throw new Error('Expected a recovery token fixture.');
    }
    const recoveryToken = Object.freeze({
      primaryRaw: loaded.primaryRaw,
      backupRaw: loaded.backupRaw,
    });
    const changedBackupRaw = JSON.stringify(
      envelope(documentId, 4, 'different backup body', 'backup-4'),
    );
    storage.setItem(localDocumentBodyBackupKey(documentId), changedBackupRaw);

    expect(() =>
      promoteRecoveredLocalDocumentBody({
        storage,
        documentId,
        recovered: loaded.envelope,
        recoveryToken,
        validateSchema,
        createWriteId: () => 'must-not-write',
      } as Parameters<typeof promoteRecoveredLocalDocumentBody>[0] & {
        recoveryToken: Readonly<{ primaryRaw: string | null; backupRaw: string }>;
      }),
    ).toThrowError(
      expect.objectContaining<Partial<LocalBodyPersistenceError>>({ code: 'conflict' }),
    );
    expect(storage.getItem(localDocumentBodyKey(documentId))).toBe(observedPrimaryRaw);
    expect(storage.getItem(localDocumentBodyBackupKey(documentId))).toBe(changedBackupRaw);
  });

  it('validates generated recovery metadata before changing the corrupt primary', () => {
    const storage = new MemoryStorage();
    const documentId = 'invalid-recovery-metadata';
    const backup = envelope(documentId, 7, 'recovered', 'backup-7');
    const backupRaw = JSON.stringify(backup);
    storage.setItem(localDocumentBodyKey(documentId), '{"broken":');
    storage.setItem(localDocumentBodyBackupKey(documentId), backupRaw);
    const loaded = loadLocalDocumentBody({ storage, documentId, validateSchema });
    expect(loaded.state).toBe('recovered-awaiting-confirmation');
    if (loaded.state !== 'recovered-awaiting-confirmation') {
      throw new Error('Expected a recovery token fixture.');
    }

    expect(() =>
      promoteRecoveredLocalDocumentBody({
        storage,
        documentId,
        recovered: backup,
        recoveryToken: loaded.recoveryToken,
        validateSchema,
        createWriteId: () => '',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<LocalBodyPersistenceError>>({
        code: 'structural-invalid',
      }),
    );
    expect(storage.getItem(localDocumentBodyKey(documentId))).toBe('{"broken":');
    expect(storage.getItem(localDocumentBodyBackupKey(documentId))).toBe(backupRaw);
  });

  it('rejects stale revisions without changing either slot', () => {
    const storage = new MemoryStorage();
    const current = envelope('stale-tab', 3, 'newer tab', 'newer-3');
    storage.setItem(localDocumentBodyKey('stale-tab'), JSON.stringify(current));
    const before = new Map(storage.values);

    expect(() =>
      saveLocalDocumentBody({
        storage,
        documentId: 'stale-tab',
        doc: paragraphDoc('stale tab'),
        expected: { revision: 2, writeId: 'older-2' },
        validateSchema,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<LocalBodyPersistenceError>>({ code: 'conflict' }),
    );
    expect(storage.values).toEqual(before);
  });

  it('requires readback to equal the exact serialized bytes, not only revision and write id', () => {
    const storage = new MemoryStorage();
    const documentId = 'exact-readback';
    const primaryKey = localDocumentBodyKey(documentId);
    storage.readTransform = (key, raw) => {
      if (key !== primaryKey || raw === null) return raw;
      const changed = JSON.parse(raw) as LocalBodyEnvelope;
      return JSON.stringify({
        ...changed,
        doc: paragraphDoc('same token, different body'),
      });
    };

    expect(() =>
      saveLocalDocumentBody({
        storage,
        documentId,
        doc: paragraphDoc('intended serialized body'),
        expected: null,
        validateSchema,
        savedAt: '2026-07-18T00:00:00.000Z',
        createWriteId: () => 'exact-write-1',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<LocalBodyPersistenceError>>({
        code: 'verification-failed',
      }),
    );
  });

  it.each([
    [
      'unknown node JSON key',
      {
        type: 'doc',
        content: [{ type: 'paragraph', futureNodeKey: 'must not disappear' }],
      },
    ],
    [
      'unknown node attribute',
      {
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { futureNodeAttr: 'must not disappear' } }],
      },
    ],
    [
      'unknown mark JSON key',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'linked',
                marks: [
                  {
                    type: 'link',
                    attrs: { href: 'https://example.com' },
                    futureMarkKey: 'must not disappear',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    [
      'unknown mark attribute',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'linked',
                marks: [
                  {
                    type: 'link',
                    attrs: {
                      href: 'https://example.com',
                      futureMarkAttr: 'must not disappear',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    [
      'text field on a non-text node',
      {
        type: 'doc',
        content: [{ type: 'paragraph', text: 'must not disappear' }],
      },
    ],
    [
      'content field on a text node',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'kept',
                content: [{ type: 'text', text: 'must not disappear' }],
              },
            ],
          },
        ],
      },
    ],
  ])('rejects %s before active-schema hydration can normalize it', (_label, doc) => {
    const strictSchemaAssert = (
      localBodyPersistence as typeof localBodyPersistence & {
        assertStrictLocalBodySchemaJson?: (
          candidate: LocalBodyDocJson,
          schema: ReturnType<typeof getSchema>,
        ) => void;
      }
    ).assertStrictLocalBodySchemaJson;
    expect(strictSchemaAssert).toBeTypeOf('function');
    const schema = getSchema(createLashEditorExtensions());

    expect(() => strictSchemaAssert?.(doc, schema)).toThrowError(
      expect.objectContaining<Partial<LocalBodyPersistenceError>>({
        code: 'schema-invalid',
      }),
    );
  });

  it('allows omitted active-schema attributes so defaults can be applied', () => {
    const strictSchemaAssert = (
      localBodyPersistence as typeof localBodyPersistence & {
        assertStrictLocalBodySchemaJson?: (
          candidate: LocalBodyDocJson,
          schema: ReturnType<typeof getSchema>,
        ) => void;
      }
    ).assertStrictLocalBodySchemaJson;
    expect(strictSchemaAssert).toBeTypeOf('function');
    const schema = getSchema(createLashEditorExtensions());

    expect(() =>
      strictSchemaAssert?.(
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Defaults remain allowed' }],
            },
          ],
        },
        schema,
      ),
    ).not.toThrow();
  });

  it.each([
    [
      'link',
      {
        type: 'text',
        text: 'unsafe',
        marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
      },
    ],
    ['image', { type: 'image', attrs: { src: 'data:text/html;base64,PHNjcmlwdD4=' } }],
    ['chip icon', { type: 'chip', attrs: { iconUrl: 'data:image/svg+xml,<svg onload=alert(1)>' } }],
    [
      'failed upload preview',
      { type: 'image', attrs: { src: '', previewSrc: 'blob:https://lash.local/failed' } },
    ],
  ])('rejects unsafe %s URL-bearing attributes', (_label, unsafeNode) => {
    const storage = new MemoryStorage();
    expect(() =>
      saveLocalDocumentBody({
        storage,
        documentId: 'unsafe-url',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [unsafeNode] }],
        },
        expected: null,
        validateSchema,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<LocalBodyPersistenceError>>({ code: 'unsafe-url' }),
    );
    expect(storage.values.size).toBe(0);
  });

  it.each([
    [
      'link href array',
      {
        type: 'text',
        text: 'unsafe',
        marks: [{ type: 'link', attrs: { href: ['javascript:alert(1)'] } }],
      },
    ],
    ['image src object', { type: 'image', attrs: { src: { value: 'javascript:alert(1)' } } }],
    ['chip icon number', { type: 'chip', attrs: { iconUrl: 7 } }],
  ])('rejects non-string %s before browser coercion', (_label, unsafeNode) => {
    const storage = new MemoryStorage();
    expect(() =>
      saveLocalDocumentBody({
        storage,
        documentId: 'unsafe-url-type',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [unsafeNode] }],
        },
        expected: null,
        validateSchema,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<LocalBodyPersistenceError>>({ code: 'unsafe-url' }),
    );
    expect(storage.values.size).toBe(0);
  });

  it('fails closed and preserves both raw strings when neither copy is valid', () => {
    const storage = new MemoryStorage();
    storage.setItem(localDocumentBodyKey('dual-corrupt'), '{"primary":');
    storage.setItem(localDocumentBodyBackupKey('dual-corrupt'), '{"backup":');
    const before = new Map(storage.values);

    expect(
      loadLocalDocumentBody({ storage, documentId: 'dual-corrupt', validateSchema }),
    ).toMatchObject({
      state: 'failed',
      primaryError: { code: 'invalid-json' },
      backupError: { code: 'invalid-json' },
    });
    expect(storage.values).toEqual(before);
  });

  describe('validateAndDetachLocalBodyDocJson', () => {
    it('exports the Architect-approved direct-module validation authority', () => {
      expect(
        (
          localBodyPersistence as typeof localBodyPersistence & {
            validateAndDetachLocalBodyDocJson?: ValidateAndDetachLocalBodyDocJson;
          }
        ).validateAndDetachLocalBodyDocJson,
      ).toBeTypeOf('function');
    });

    it.each([
      ['null', null],
      ['array', []],
      ['wrong type', { type: 'paragraph', content: [] }],
      ['missing content', { type: 'doc' }],
      ['non-array content', { type: 'doc', content: {} }],
    ])('rejects the malformed %s root with the existing exact error', (_label, doc) => {
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(doc),
        'structural-invalid',
        'Local body must be a document with array content.',
      );
    });

    it.each([
      ['undefined', undefined],
      ['bigint', BigInt(1)],
      ['function', () => undefined],
      ['symbol', Symbol('value')],
      ['NaN', Number.NaN],
      ['positive infinity', Number.POSITIVE_INFINITY],
      ['negative infinity', Number.NEGATIVE_INFINITY],
    ])('rejects a %s value with the exact non-JSON error', (_label, value) => {
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(docWithExtra(value)),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );
    });

    it('rejects cycles while duplicating shared acyclic aliases independently', () => {
      const cyclic = docWithExtra(null);
      cyclic.extra = cyclic;
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(cyclic),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );

      const shared = { nested: ['same'] };
      const input = {
        type: 'doc',
        content: [],
        left: shared,
        right: shared,
      };
      const detached = validateAndDetachLocalBodyDocJson(input);
      expect(detached).toEqual(input);
      expect(detached.left).not.toBe(shared);
      expect(detached.right).not.toBe(shared);
      expect(detached.left).not.toBe(detached.right);
      expect((detached.left as { nested: unknown[] }).nested).not.toBe(shared.nested);
      expect((detached.right as { nested: unknown[] }).nested).not.toBe(shared.nested);
      expect((detached.left as { nested: unknown[] }).nested).not.toBe(
        (detached.right as { nested: unknown[] }).nested,
      );
    });

    it('rejects sparse arrays, accessors, symbols, and non-enumerable extra state', () => {
      const sparse = new Array(1);
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(docWithExtra(sparse)),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );

      let accessorReads = 0;
      const accessor = {};
      Object.defineProperty(accessor, 'value', {
        enumerable: true,
        get: () => {
          accessorReads += 1;
          return 'must not be read';
        },
      });
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(docWithExtra(accessor)),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );
      expect(accessorReads).toBe(0);

      const accessorRoot = {
        content: [] as unknown[],
      } as Record<string, unknown>;
      Object.defineProperty(accessorRoot, 'type', {
        enumerable: true,
        get: () => {
          accessorReads += 1;
          return 'doc';
        },
      });
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(accessorRoot),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );
      expect(accessorReads).toBe(0);

      const symbolState = docWithExtra('visible');
      Object.defineProperty(symbolState, Symbol('hidden'), {
        enumerable: true,
        value: 'must not disappear',
      });
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(symbolState),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );

      const nonEnumerableState = docWithExtra('visible');
      Object.defineProperty(nonEnumerableState, 'hidden', {
        enumerable: false,
        value: 'must not disappear',
      });
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(nonEnumerableState),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );

      const accessorArray = ['safe'];
      Object.defineProperty(accessorArray, '0', {
        enumerable: true,
        get: () => {
          accessorReads += 1;
          return 'must not be read';
        },
      });
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(docWithExtra(accessorArray)),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );
      expect(accessorReads).toBe(0);

      const symbolArray = ['safe'];
      Object.defineProperty(symbolArray, Symbol('hidden'), {
        enumerable: true,
        value: 'must not disappear',
      });
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(docWithExtra(symbolArray)),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );

      const extraArrayState = ['safe'];
      Object.defineProperty(extraArrayState, 'hidden', {
        enumerable: false,
        value: 'must not disappear',
      });
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(docWithExtra(extraArrayState)),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );

      const customPrototypeArray = ['safe'];
      Object.setPrototypeOf(customPrototypeArray, Object.create(Array.prototype));
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(docWithExtra(customPrototypeArray)),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );
    });

    it.each([
      ['Date', new Date('2026-08-08T00:00:00.000Z')],
      ['Map', new Map([['key', 'value']])],
      ['Set', new Set(['value'])],
      [
        'class instance',
        new (class JsonLookingValue {
          value = 'must not be accepted';
        })(),
      ],
      ['custom prototype', Object.assign(Object.create({ inherited: true }), { value: 'unsafe' })],
    ])('rejects the non-plain %s value', (_label, value) => {
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(docWithExtra(value)),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );
    });

    it('rejects a custom-prototype document root as non-JSON', () => {
      const customRoot = Object.assign(Object.create({ inherited: true }) as LocalBodyDocJson, {
        type: 'doc',
        content: [],
      });
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(customRoot),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );
    });

    it.each([
      ['type', 'paragraph'],
      ['content', 'not-an-array'],
    ] as const)(
      'rejects a stateful Proxy that drifts root %s while the detached copy is built',
      (driftedKey, driftedValue) => {
        const target: LocalBodyDocJson = {
          type: 'doc',
          content: [],
        };
        let descriptorReads = 0;
        const proxy = new Proxy(target, {
          getOwnPropertyDescriptor(currentTarget, property) {
            const descriptor = Reflect.getOwnPropertyDescriptor(currentTarget, property);
            if (property !== driftedKey || !descriptor || !('value' in descriptor)) {
              return descriptor;
            }
            descriptorReads += 1;
            return descriptorReads === 1 ? descriptor : { ...descriptor, value: driftedValue };
          },
        });

        expectLocalBodyError(
          () => validateAndDetachLocalBodyDocJson(proxy),
          'structural-invalid',
          'Local body must be a document with array content.',
        );
        expect(descriptorReads).toBe(2);
      },
    );

    it('rejects omitted own root fields even when Object.prototype supplies inherited values', () => {
      const previousType = Object.getOwnPropertyDescriptor(Object.prototype, 'type');
      const previousContent = Object.getOwnPropertyDescriptor(Object.prototype, 'content');
      Object.defineProperty(Object.prototype, 'type', {
        configurable: true,
        value: 'doc',
        writable: true,
      });
      Object.defineProperty(Object.prototype, 'content', {
        configurable: true,
        value: [],
        writable: true,
      });
      try {
        const proxy = new Proxy<LocalBodyDocJson>(
          {
            type: 'doc',
            content: [],
          },
          {
            ownKeys: () => [],
          },
        );

        expectLocalBodyError(
          () => validateAndDetachLocalBodyDocJson(proxy),
          'structural-invalid',
          'Local body must be a document with array content.',
        );
      } finally {
        if (previousType) {
          Object.defineProperty(Object.prototype, 'type', previousType);
        } else {
          Reflect.deleteProperty(Object.prototype, 'type');
        }
        if (previousContent) {
          Object.defineProperty(Object.prototype, 'content', previousContent);
        } else {
          Reflect.deleteProperty(Object.prototype, 'content');
        }
      }
    });

    it('copies an arbitrary key as own data without invoking an inherited prototype setter', () => {
      const probeKey = 'lashDetachedSetterProbe';
      const previousProbe = Object.getOwnPropertyDescriptor(Object.prototype, probeKey);
      let setterCalls = 0;
      Object.defineProperty(Object.prototype, probeKey, {
        configurable: true,
        set: () => {
          setterCalls += 1;
        },
      });
      try {
        const detached = validateAndDetachLocalBodyDocJson({
          type: 'doc',
          content: [],
          [probeKey]: 'retained exactly',
        });

        expect(setterCalls).toBe(0);
        expect(Object.getPrototypeOf(detached)).toBe(Object.prototype);
        expect(Object.getOwnPropertyDescriptor(detached, probeKey)).toEqual({
          configurable: true,
          enumerable: true,
          value: 'retained exactly',
          writable: true,
        });
      } finally {
        if (previousProbe) {
          Object.defineProperty(Object.prototype, probeKey, previousProbe);
        } else {
          Reflect.deleteProperty(Object.prototype, probeKey);
        }
      }
    });

    it('copies array indexes as dense own data without invoking an inherited numeric setter', () => {
      const previousIndex = Object.getOwnPropertyDescriptor(Array.prototype, '0');
      const input: LocalBodyDocJson = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [] }],
      };
      let detached: LocalBodyDocJson | null = null;
      let thrown: unknown;
      let setterCalls = 0;
      Object.defineProperty(Array.prototype, '0', {
        configurable: true,
        set: () => {
          setterCalls += 1;
        },
      });
      try {
        detached = validateAndDetachLocalBodyDocJson(input);
      } catch (error) {
        thrown = error;
      } finally {
        if (previousIndex) {
          Object.defineProperty(Array.prototype, '0', previousIndex);
        } else {
          Reflect.deleteProperty(Array.prototype, '0');
        }
      }

      if (thrown) throw thrown;
      expect(detached).not.toBeNull();
      const detachedContent = (detached as LocalBodyDocJson).content as unknown[];
      expect(setterCalls).toBe(0);
      expect(detachedContent).toHaveLength(1);
      expect(Object.keys(detachedContent)).toEqual(['0']);
      expect(Object.getOwnPropertyDescriptor(detachedContent, '0')).toEqual({
        configurable: true,
        enumerable: true,
        value: { type: 'paragraph', content: [] },
        writable: true,
      });
      expect(Array.from(detachedContent)).toEqual([{ type: 'paragraph', content: [] }]);
    });

    it('uses one own array-length snapshot when a Proxy drifts property reads', () => {
      let lengthGets = 0;
      let lengthDescriptorReads = 0;
      const content = new Proxy([{ type: 'paragraph', content: [] }], {
        get(target, property, receiver) {
          if (property === 'length') {
            lengthGets += 1;
            return lengthGets === 1 ? 1 : 0;
          }
          return Reflect.get(target, property, receiver);
        },
        getOwnPropertyDescriptor(target, property) {
          if (property === 'length') {
            lengthDescriptorReads += 1;
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });

      const detached = validateAndDetachLocalBodyDocJson({
        type: 'doc',
        content,
      });

      expect(detached.content).toEqual([{ type: 'paragraph', content: [] }]);
      expect(lengthGets).toBe(0);
      expect(lengthDescriptorReads).toBe(1);
    });

    it('accepts plain and null-prototype records and returns only detached plain records', () => {
      const nullPrototypeNested = Object.assign(Object.create(null) as Record<string, unknown>, {
        value: 'safe',
      });
      const input = Object.assign(Object.create(null) as LocalBodyDocJson, {
        type: 'doc',
        content: [nullPrototypeNested],
      });

      const detached = validateAndDetachLocalBodyDocJson(input);
      expect(detached).toEqual({
        type: 'doc',
        content: [{ value: 'safe' }],
      });
      expect(Object.getPrototypeOf(detached)).toBe(Object.prototype);
      expect(Object.getPrototypeOf((detached.content as unknown[])[0])).toBe(Object.prototype);
      expect(detached).not.toBe(input);
      expect(detached.content).not.toBe(input.content);
      expect((detached.content as unknown[])[0]).not.toBe(nullPrototypeNested);
    });

    it.each(['__proto__', 'constructor', 'prototype'])(
      'rejects blocked key %s with the existing exact error',
      (blockedKey) => {
        const doc = docWithExtra('safe');
        Object.defineProperty(doc, blockedKey, {
          configurable: true,
          enumerable: true,
          value: 'blocked',
        });
        expectLocalBodyError(
          () => validateAndDetachLocalBodyDocJson(doc),
          'structural-invalid',
          'Local body contains an invalid object key.',
        );
      },
    );

    it('accepts the exact key-length boundary and rejects one code unit over it', () => {
      const exact = docWithExtra('safe');
      exact['k'.repeat(128)] = true;
      expect(() => validateAndDetachLocalBodyDocJson(exact)).not.toThrow();

      const over = docWithExtra('safe');
      over['k'.repeat(129)] = true;
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(over),
        'structural-invalid',
        'Local body contains an invalid object key.',
      );
    });

    it('accepts the exact depth boundary and rejects one level over it', () => {
      expect(() => validateAndDetachLocalBodyDocJson(nestedArrayAtDepth(63))).not.toThrow();
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(nestedArrayAtDepth(64)),
        'oversize',
        'Local body nesting is too deep.',
      );
    });

    it('accepts the exact value-count boundary and rejects one value over it', () => {
      expect(() =>
        validateAndDetachLocalBodyDocJson({
          type: 'doc',
          content: [],
          filler: Array.from({ length: 199_996 }, () => null),
        }),
      ).not.toThrow();
      expectLocalBodyError(
        () =>
          validateAndDetachLocalBodyDocJson({
            type: 'doc',
            content: [],
            filler: Array.from({ length: 199_997 }, () => null),
          }),
        'oversize',
        'Local body contains too many values.',
      );
    });

    it('accepts the exact string boundary and rejects one code unit over it', () => {
      expect(() =>
        validateAndDetachLocalBodyDocJson(docWithExtra('x'.repeat(3_500_000))),
      ).not.toThrow();
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(docWithExtra('x'.repeat(3_500_001))),
        'oversize',
        'Local body contains an oversized string.',
      );
    });

    it.each([
      ['empty href', 'href', ''],
      ['null href', 'href', null],
      ['root-relative href', 'href', '/document/path'],
      ['fragment href', 'href', '#section'],
      ['HTTPS href', 'href', 'https://example.com/document'],
      ['HTTP href', 'href', 'http://example.com/document'],
      ['mail href', 'href', 'mailto:writer@example.com'],
      ['root-relative image', 'src', '/image.png'],
      ['HTTPS image', 'src', 'https://example.com/image.png'],
      ['HTTP image', 'src', 'http://example.com/image.png'],
      ['PNG data image', 'src', 'data:image/png;base64,AA=='],
      ['JPEG data image', 'previewSrc', 'data:image/jpeg;base64,AA=='],
      ['JPG data image', 'previewSrc', 'data:image/jpg;base64,AA=='],
      ['GIF data image', 'iconUrl', 'data:image/gif;base64,AA=='],
      ['WebP data image', 'iconUrl', 'data:image/webp;base64,AA=='],
      ['AVIF data image', 'src', 'data:image/avif;base64,AA=='],
    ])('accepts %s under the existing URL policy', (_label, key, value) => {
      expect(() =>
        validateAndDetachLocalBodyDocJson(
          docWithExtra({
            [key]: value,
          }),
        ),
      ).not.toThrow();
    });

    it.each([
      ['script href', 'href', 'javascript:alert(1)', 'href uses the unsafe javascript: protocol.'],
      ['blob href', 'href', 'blob:https://lash.local/id', 'href uses the unsafe blob: protocol.'],
      ['mail image', 'src', 'mailto:image@example.com', 'src uses the unsafe mailto: protocol.'],
      [
        'SVG data image',
        'src',
        'data:image/svg+xml;base64,AA==',
        'src contains an unsafe data URL.',
      ],
      [
        'text data image',
        'previewSrc',
        'data:text/html;base64,AA==',
        'previewSrc contains an unsafe data URL.',
      ],
      ['malformed URL', 'href', 'http://[::1', 'href contains an invalid URL.'],
    ])('rejects %s with the existing URL error', (_label, key, value, message) => {
      expectLocalBodyError(
        () =>
          validateAndDetachLocalBodyDocJson(
            docWithExtra({
              [key]: value,
            }),
          ),
        'unsafe-url',
        message,
      );
    });

    it.each([
      ['undefined', undefined],
      ['array', ['https://example.com']],
      ['object', { value: 'https://example.com' }],
      ['number', 1],
      ['boolean', true],
    ])('rejects non-string/non-null URL value %s before coercion', (_label, value) => {
      expectLocalBodyError(
        () => validateAndDetachLocalBodyDocJson(docWithExtra({ href: value })),
        'unsafe-url',
        'href must be a string or null before local body hydration.',
      );
    });

    it('preserves property and array order without retaining or mutating input identities', () => {
      const input = {
        type: 'doc',
        content: [{ z: 1, a: [{ second: 2, first: 1 }] }],
        tail: 'last',
      };
      const before = JSON.stringify(input);
      const detached = validateAndDetachLocalBodyDocJson(input);

      expect(JSON.stringify(detached)).toBe(before);
      expect(Object.keys(detached)).toEqual(['type', 'content', 'tail']);
      expect(Object.keys((detached.content as Array<Record<string, unknown>>)[0])).toEqual([
        'z',
        'a',
      ]);
      expect(input).toEqual(JSON.parse(before));

      (input.content[0].a[0] as { second: number }).second = 9;
      expect(
        (
          (detached.content as Array<Record<string, unknown>>)[0].a as Array<{
            second: number;
          }>
        )[0].second,
      ).toBe(2);
      (
        (detached.content as Array<Record<string, unknown>>)[0].a as Array<{
          first: number;
        }>
      )[0].first = 7;
      expect(input.content[0].a[0].first).toBe(1);
    });

    it('does not touch storage and failing save validation performs zero storage operations', () => {
      const storage = new MemoryStorage();
      validateAndDetachLocalBodyDocJson(paragraphDoc('pure helper'));
      expect(storage.operations).toEqual([]);

      expectLocalBodyError(
        () =>
          saveLocalDocumentBody({
            storage,
            documentId: 'zero-storage-before-validation',
            doc: docWithExtra(undefined),
            expected: null,
            validateSchema,
          }),
        'structural-invalid',
        'Local body contains a non-JSON value.',
      );
      expect(storage.operations).toEqual([]);

      expectLocalBodyError(
        () =>
          saveLocalDocumentBody({
            storage,
            documentId: 'zero-storage-before-schema-validation',
            doc: {
              type: 'doc',
              content: [{ type: 'schema-invalid' }],
            },
            expected: null,
            validateSchema,
          }),
        'schema-invalid',
        'Local body does not match the active editor schema.',
      );
      expect(storage.operations).toEqual([]);
    });

    it('passes a detached document to the schema validator and returns the detached authority', () => {
      const input = paragraphDoc('detached schema validation');
      let schemaInput: LocalBodyDocJson | null = null;
      const storage = new MemoryStorage();
      const saved = saveLocalDocumentBody({
        storage,
        documentId: 'detached-schema',
        doc: input,
        expected: null,
        validateSchema: (doc) => {
          if (schemaInput === null) schemaInput = doc;
        },
        savedAt: '2026-08-08T00:00:00.000Z',
        createWriteId: () => 'detached-schema-1',
      });

      const capturedSchemaInput = schemaInput as LocalBodyDocJson | null;
      expect(capturedSchemaInput).not.toBeNull();
      expect(capturedSchemaInput).not.toBe(input);
      expect(capturedSchemaInput?.content).not.toBe(input.content);
      expect(saved.doc).not.toBe(input);
      expect(saved.doc.content).not.toBe(input.content);
      expect(saved.doc).toBe(capturedSchemaInput);
    });

    it('preserves exact valid save bytes and storage operation order', () => {
      const storage = new MemoryStorage();
      const documentId = 'byte-order-parity';
      const primaryKey = localDocumentBodyKey(documentId);
      const backupKey = localDocumentBodyBackupKey(documentId);
      const firstDoc = paragraphDoc('first');
      const first = saveLocalDocumentBody({
        storage,
        documentId,
        doc: firstDoc,
        expected: null,
        validateSchema,
        savedAt: '2026-08-08T00:00:00.000Z',
        createWriteId: () => 'byte-order-1',
      });
      const firstRaw = JSON.stringify({
        version: 1,
        schemaVersion: 'lash-schema-v1',
        documentId,
        revision: 1,
        writeId: 'byte-order-1',
        savedAt: '2026-08-08T00:00:00.000Z',
        doc: firstDoc,
      });
      expect(storage.values.get(primaryKey)).toBe(firstRaw);
      expect(storage.operations).toEqual([
        { operation: 'get', key: primaryKey },
        { operation: 'set', key: primaryKey, value: firstRaw },
        { operation: 'get', key: primaryKey },
      ]);

      storage.operations.length = 0;
      expect(loadLocalDocumentBody({ storage, documentId, validateSchema })).toMatchObject({
        state: 'ready',
        envelope: first,
      });
      expect(storage.operations).toEqual([{ operation: 'get', key: primaryKey }]);

      storage.operations.length = 0;
      const secondDoc = paragraphDoc('second');
      const second = saveLocalDocumentBody({
        storage,
        documentId,
        doc: secondDoc,
        expected: { revision: first.revision, writeId: first.writeId },
        validateSchema,
        savedAt: '2026-08-08T00:00:01.000Z',
        createWriteId: () => 'byte-order-2',
      });
      const secondRaw = JSON.stringify({
        version: 1,
        schemaVersion: 'lash-schema-v1',
        documentId,
        revision: 2,
        writeId: 'byte-order-2',
        savedAt: '2026-08-08T00:00:01.000Z',
        doc: secondDoc,
      });
      expect(second.doc).toEqual(secondDoc);
      expect(storage.values.get(backupKey)).toBe(firstRaw);
      expect(storage.values.get(primaryKey)).toBe(secondRaw);
      expect(storage.operations).toEqual([
        { operation: 'get', key: primaryKey },
        { operation: 'set', key: backupKey, value: firstRaw },
        { operation: 'set', key: primaryKey, value: secondRaw },
        { operation: 'get', key: primaryKey },
      ]);
    });

    it('preserves load, backup recovery, and promotion bytes and operation order', () => {
      const storage = new MemoryStorage();
      const documentId = 'recovery-order-parity';
      const primaryKey = localDocumentBodyKey(documentId);
      const backupKey = localDocumentBodyBackupKey(documentId);
      const backup = envelope(documentId, 4, 'recovered', 'recovered-4');
      const backupRaw = JSON.stringify(backup);
      storage.values.set(primaryKey, '{"broken":');
      storage.values.set(backupKey, backupRaw);

      const loaded = loadLocalDocumentBody({ storage, documentId, validateSchema });
      expect(loaded.state).toBe('recovered-awaiting-confirmation');
      expect(storage.operations).toEqual([
        { operation: 'get', key: primaryKey },
        { operation: 'get', key: backupKey },
      ]);
      if (loaded.state !== 'recovered-awaiting-confirmation') {
        throw new Error('Expected recovery fixture.');
      }

      storage.operations.length = 0;
      const promoted = promoteRecoveredLocalDocumentBody({
        storage,
        documentId,
        recovered: loaded.envelope,
        recoveryToken: loaded.recoveryToken,
        validateSchema,
        savedAt: '2026-08-08T00:00:05.000Z',
        createWriteId: () => 'promoted-5',
      });
      const promotedRaw = JSON.stringify({
        version: 1,
        schemaVersion: 'lash-schema-v1',
        documentId,
        revision: 5,
        writeId: 'promoted-5',
        savedAt: '2026-08-08T00:00:05.000Z',
        doc: backup.doc,
      });
      expect(storage.values.get(backupKey)).toBe(backupRaw);
      expect(storage.values.get(primaryKey)).toBe(promotedRaw);
      expect(promoted.doc).toEqual(backup.doc);
      expect(storage.operations).toEqual([
        { operation: 'get', key: primaryKey },
        { operation: 'get', key: backupKey },
        { operation: 'set', key: primaryKey, value: promotedRaw },
        { operation: 'get', key: primaryKey },
      ]);
    });

    it('preserves the exact raw-envelope length boundary', () => {
      const storage = new MemoryStorage();
      const documentId = 'raw-envelope-boundary';
      const primaryKey = localDocumentBodyKey(documentId);
      const exactEnvelope = {
        version: 1,
        schemaVersion: 'lash-schema-v1',
        documentId,
        revision: 1,
        writeId: 'raw-envelope-1',
        savedAt: '2026-08-08T00:00:00.000Z',
        doc: {
          type: 'doc',
          content: [],
          first: 'a'.repeat(2_000_000),
          second: '',
        },
      };
      const withoutSecondPadding = JSON.stringify(exactEnvelope);
      const missingCodeUnits = 4_000_000 - withoutSecondPadding.length;
      exactEnvelope.doc.second = 'b'.repeat(missingCodeUnits);
      const exactRaw = JSON.stringify(exactEnvelope);
      expect(exactRaw).toHaveLength(4_000_000);

      storage.values.set(primaryKey, exactRaw);
      expect(loadLocalDocumentBody({ storage, documentId, validateSchema })).toMatchObject({
        state: 'ready',
        envelope: {
          doc: {
            first: exactEnvelope.doc.first,
            second: exactEnvelope.doc.second,
          },
        },
      });

      storage.values.set(primaryKey, `${exactRaw} `);
      expect(loadLocalDocumentBody({ storage, documentId, validateSchema })).toMatchObject({
        state: 'failed',
        primaryError: {
          code: 'oversize',
          message: 'Local body envelope exceeds the supported size.',
        },
      });
    });
  });
});
