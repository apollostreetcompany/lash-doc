/** @vitest-environment jsdom */

import {
  MARKDOWN_FILE_MAX_BYTES,
  createLashEditorExtensions,
  parseMarkdownFileToDoc,
  projectDocumentHeadingIds,
  type MarkdownFileParseResult,
} from '@lash/editor-core';
import { Editor, getSchema } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DOCUMENT_REGISTRY_STORAGE_KEY,
  documentTitleStorageKey,
  type LashDocumentRecord,
} from '../../../../apps/web/lib/documentRegistry';
import {
  assertStrictLocalBodySchemaJson,
  loadLocalDocumentBody,
  localDocumentBodyBackupKey,
  localDocumentBodyKey,
  saveLocalDocumentBody,
  validateAndDetachLocalBodyDocJson,
  type LocalBodyDocJson,
} from '../../../../apps/web/lib/localDocumentBodyPersistence';
import {
  MARKDOWN_IMPORT_HANDOFF_STORAGE_KEY,
  MARKDOWN_IMPORT_NAVIGATION_WATCHDOG_MS,
  acknowledgeMarkdownImportDestination,
  commitMarkdownImport,
  createMarkdownDownloadPlan,
  createMarkdownImportNavigationController,
  persistMarkdownImportHandoff,
  readMarkdownFileForImport,
  verifyMarkdownImportSourceQuiescence,
  type MarkdownImportDestination,
  type MarkdownImportPlan,
  type MarkdownImportSourceQuiescence,
} from '../../../../apps/web/lib/markdownDocumentTransfer';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly operations: string[] = [];
  readonly failAt = new Set<string>();
  readonly corruptReadAt = new Map<string, string>();
  faultOnOperationNumber: number | null = null;

  private record(operation: string) {
    this.operations.push(operation);
    if (this.faultOnOperationNumber === this.operations.length) {
      this.faultOnOperationNumber = null;
      throw new Error(`injected operation fault: ${operation}`);
    }
  }

  get length() {
    return this.values.size;
  }

  clear() {
    this.record('clear');
    this.values.clear();
  }

  getItem(key: string) {
    this.record(`get:${key}`);
    if (this.failAt.has(`get:${key}`)) throw new Error(`get failed: ${key}`);
    const corruption = this.corruptReadAt.get(`get:${key}:${this.operations.length}`);
    if (corruption !== undefined) return corruption;
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.record(`remove:${key}`);
    if (this.failAt.has(`remove:${key}`)) throw new Error(`remove failed: ${key}`);
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.record(`set:${key}`);
    if (this.failAt.has(`set:${key}`)) throw new Error(`set failed: ${key}`);
    this.values.set(key, value);
  }
}

type BrowserFileFixture = {
  name: string;
  size: number;
  slice: ReturnType<typeof vi.fn>;
};

const paragraphDoc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const identityCanonicalizeSchema = (doc: LocalBodyDocJson) => doc;

const schemaInvalidIntake = {
  status: 'error',
  code: 'schema-invalid',
  message: 'This Markdown file does not match the supported document structure.',
} as const;

const browserFixtureMarkdown = `# Project Plan

Welcome to the **Lash** _markdown_ import test with \`inline code\` sprinkled in.

## Tasks
- [x] Ship schema
- [ ] Wire history view

1. Create outline
2. Verify focus mode

![Architectural Diagram](https://example.com/diagram.png)

## Notes
Remember to keep determinism first.
`;

const markdownBytes = (text: string) => new TextEncoder().encode(text);

const browserFile = (
  name: string,
  bytes: Uint8Array,
  overrides: Partial<Pick<BrowserFileFixture, 'size' | 'slice'>> = {},
): BrowserFileFixture => ({
  name,
  size: overrides.size ?? bytes.byteLength,
  slice:
    overrides.slice ??
    vi.fn((_start: number, end: number) => ({
      arrayBuffer: async () => bytes.slice(0, end).buffer,
    })),
});

const readCanonicalFixture = (
  overrides: Partial<Parameters<typeof readMarkdownFileForImport>[0]> = {},
) =>
  readMarkdownFileForImport({
    file: browserFile('canonical.md', markdownBytes('# Canonical\n')),
    generation: 9,
    isGenerationCurrent: () => true,
    parseMarkdown: () => ({
      ok: true,
      format: 'legacy',
      title: null,
      doc: paragraphDoc('Raw parsed body'),
      warnings: [],
    }),
    validateSchema: () => undefined,
    canonicalizeSchema: identityCanonicalizeSchema,
    ...overrides,
  });

const readyPlan = (generation = 1): MarkdownImportPlan => ({
  generation,
  fileName: 'project.md',
  format: 'lash-v1',
  title: 'Imported project',
  doc: paragraphDoc('Imported body'),
  warnings: [],
});

const existingRecord = (id = 'source-doc'): LashDocumentRecord => ({
  id,
  title: 'Source title',
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
});

const seedSource = (storage: MemoryStorage) => {
  storage.values.set(DOCUMENT_REGISTRY_STORAGE_KEY, JSON.stringify([existingRecord()]));
  storage.values.set(documentTitleStorageKey('source-doc'), 'Source title');
  storage.values.set(localDocumentBodyKey('source-doc'), '{"source":"primary"}');
  storage.values.set(localDocumentBodyBackupKey('source-doc'), '{"source":"backup"}');
};

const sourceSnapshot = (storage: MemoryStorage) =>
  new Map([...storage.values.entries()].filter(([key]) => key.includes('source-doc')));

const commit = (
  storage: MemoryStorage,
  overrides: Partial<Parameters<typeof commitMarkdownImport>[0]> = {},
) =>
  commitMarkdownImport({
    storage,
    sourceDocumentId: 'source-doc',
    plan: readyPlan(),
    createDocumentId: () => 'import-doc',
    createWriteId: () => 'import-write-1',
    now: () => new Date('2026-08-08T01:02:03.000Z'),
    validateSchema: () => undefined,
    ...overrides,
  });

describe('Markdown browser file intake', () => {
  it.each(['draft.md', 'draft.MD', 'draft.markdown', 'draft.MARKDOWN'])(
    'accepts the strict Markdown extension %s',
    async (name) => {
      const result = await readMarkdownFileForImport({
        file: browserFile(name, markdownBytes('# Draft\n')),
        generation: 1,
        isGenerationCurrent: () => true,
        validateSchema: () => undefined,
        canonicalizeSchema: identityCanonicalizeSchema,
      });

      expect(result).toMatchObject({
        status: 'ready',
        plan: { fileName: name, format: 'legacy', title: 'draft' },
      });
    },
  );

  it.each(['draft.txt', 'draft.md.backup', 'draft', 'draft.md/other'])(
    'rejects the non-Markdown extension %s before reading',
    async (name) => {
      const file = browserFile(name, markdownBytes('# Draft\n'));
      const result = await readMarkdownFileForImport({
        file,
        generation: 1,
        isGenerationCurrent: () => true,
        validateSchema: () => undefined,
        canonicalizeSchema: identityCanonicalizeSchema,
      });

      expect(result).toEqual({
        status: 'error',
        code: 'invalid-extension',
        message: 'Choose a Markdown file ending in .md or .markdown.',
      });
      expect(file.slice).not.toHaveBeenCalled();
    },
  );

  it('reads at most max+1 bytes and accepts the exact byte limit', async () => {
    const bytes = new Uint8Array(MARKDOWN_FILE_MAX_BYTES);
    bytes.fill(0x61);
    const file = browserFile('limit.md', bytes);

    const result = await readMarkdownFileForImport({
      file,
      generation: 2,
      isGenerationCurrent: () => true,
      parseMarkdown: () => ({
        ok: true,
        format: 'legacy',
        title: null,
        doc: paragraphDoc('bounded'),
        warnings: [],
      }),
      validateSchema: () => undefined,
      canonicalizeSchema: identityCanonicalizeSchema,
    });

    expect(result.status).toBe('ready');
    expect(file.slice).toHaveBeenCalledWith(0, MARKDOWN_FILE_MAX_BYTES + 1);
  });

  it('rejects max+1 bytes before allocating a buffer', async () => {
    const file = browserFile('too-large.md', new Uint8Array(), {
      size: MARKDOWN_FILE_MAX_BYTES + 1,
    });

    const result = await readMarkdownFileForImport({
      file,
      generation: 3,
      isGenerationCurrent: () => true,
      validateSchema: () => undefined,
      canonicalizeSchema: identityCanonicalizeSchema,
    });

    expect(result).toEqual({
      status: 'error',
      code: 'file-too-large',
      message: 'This Markdown file is larger than the 2,000,000-byte limit.',
    });
    expect(file.slice).not.toHaveBeenCalled();
  });

  it.each([
    new Uint8Array([0xc3, 0x28]),
    new Uint8Array([0xc0, 0xaf]),
    new Uint8Array([0xe2, 0x82]),
    new Uint8Array([0xed, 0xa0, 0x80]),
  ])('rejects malformed UTF-8 without replacement decoding', async (bytes) => {
    const result = await readMarkdownFileForImport({
      file: browserFile('invalid.md', bytes),
      generation: 4,
      isGenerationCurrent: () => true,
      validateSchema: () => undefined,
      canonicalizeSchema: identityCanonicalizeSchema,
    });

    expect(result).toEqual({
      status: 'error',
      code: 'invalid-utf8',
      message: 'This file isn’t valid UTF-8 Markdown. Choose a UTF-8 .md or .markdown file.',
    });
  });

  it('preserves one BOM for the core parser and does not confuse valid U+FFFD with repair', async () => {
    const decoded: string[] = [];
    const parseMarkdown = (markdown: string): MarkdownFileParseResult => {
      decoded.push(markdown);
      return {
        ok: true,
        format: 'legacy',
        title: null,
        doc: paragraphDoc(markdown),
        warnings: [],
      };
    };
    const text = '\ufeff# Valid \ufffd\n';

    const result = await readMarkdownFileForImport({
      file: browserFile('bom.md', markdownBytes(text)),
      generation: 5,
      isGenerationCurrent: () => true,
      parseMarkdown,
      validateSchema: () => undefined,
      canonicalizeSchema: identityCanonicalizeSchema,
    });

    expect(result.status).toBe('ready');
    expect(decoded).toEqual([text]);
  });

  it('ignores a stale generation after its bounded byte read resolves', async () => {
    let resolveRead!: (buffer: ArrayBuffer) => void;
    const bytes = markdownBytes('# Old\n');
    const file = browserFile('old.md', bytes, {
      slice: vi.fn(() => ({
        arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => (resolveRead = resolve)),
      })),
    });
    let current = true;
    const promise = readMarkdownFileForImport({
      file,
      generation: 6,
      isGenerationCurrent: () => current,
      validateSchema: () => undefined,
      canonicalizeSchema: identityCanonicalizeSchema,
    });
    current = false;
    resolveRead(bytes.buffer);

    await expect(promise).resolves.toEqual({ status: 'ignored' });
  });

  it('fails closed when parser warnings are accompanied by a blocking parse result', async () => {
    const result = await readMarkdownFileForImport({
      file: browserFile('blocked.md', markdownBytes('# Blocked\n')),
      generation: 7,
      isGenerationCurrent: () => true,
      parseMarkdown: () => ({
        ok: false,
        code: 'unsafe-content',
        message: 'Unsafe Markdown.',
      }),
      validateSchema: () => undefined,
      canonicalizeSchema: identityCanonicalizeSchema,
    });

    expect(result).toEqual({
      status: 'error',
      code: 'unsafe-content',
      message: 'Unsafe Markdown.',
    });
  });

  it('plans the active-schema canonical JSON rather than the real fixture parser shape', async () => {
    const schema = getSchema(createLashEditorExtensions());
    const parsed = parseMarkdownFileToDoc(browserFixtureMarkdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const canonical = projectDocumentHeadingIds(
      schema.nodeFromJSON(parsed.doc),
    ).toJSON() as LocalBodyDocJson;
    expect(parsed.doc).not.toStrictEqual(canonical);
    const detachedCanonical = validateAndDetachLocalBodyDocJson(canonical);

    const result = await readMarkdownFileForImport({
      file: browserFile('basic.md', markdownBytes(browserFixtureMarkdown)),
      generation: 8,
      isGenerationCurrent: () => true,
      validateSchema: (doc) => {
        assertStrictLocalBodySchemaJson(doc, schema);
        schema.nodeFromJSON(doc).check();
      },
      canonicalizeSchema: (doc) => {
        const node = schema.nodeFromJSON(doc);
        node.check();
        const projected = projectDocumentHeadingIds(node);
        projected.check();
        const hydrated = projected.toJSON() as LocalBodyDocJson;
        assertStrictLocalBodySchemaJson(hydrated, schema);
        return hydrated;
      },
    });

    expect(result).toMatchObject({ status: 'ready' });
    if (result.status === 'ready') {
      expect(result.plan.doc).toStrictEqual(detachedCanonical);
    }
  });

  it('persists the real fixture as revision one matching real Editor hydration before autosave', async () => {
    const bytes = markdownBytes(browserFixtureMarkdown);
    const bytesBefore = [...bytes];
    const parsed = parseMarkdownFileToDoc(browserFixtureMarkdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const editor = new Editor({
      extensions: createLashEditorExtensions(),
      content: '<p></p>',
    });

    try {
      const validateSchema = (doc: LocalBodyDocJson) => {
        assertStrictLocalBodySchemaJson(doc, editor.schema);
        editor.schema.nodeFromJSON(doc).check();
      };
      const intake = await readMarkdownFileForImport({
        file: browserFile('basic.md', bytes),
        generation: 11,
        isGenerationCurrent: () => true,
        parseMarkdown: () => parsed,
        validateSchema,
        canonicalizeSchema: (doc) => {
          const node = editor.schema.nodeFromJSON(doc);
          node.check();
          const projected = projectDocumentHeadingIds(node);
          projected.check();
          const canonical = projected.toJSON() as LocalBodyDocJson;
          assertStrictLocalBodySchemaJson(canonical, editor.schema);
          return canonical;
        },
      });

      expect(intake.status).toBe('ready');
      if (intake.status !== 'ready') return;
      expect(intake.plan).toMatchObject({
        generation: 11,
        fileName: 'basic.md',
        format: parsed.format,
        title: 'basic',
        warnings: parsed.warnings,
      });
      expect([...bytes]).toEqual(bytesBefore);
      expect(editor.schema.nodeFromJSON(intake.plan.doc).textContent).toBe(
        editor.schema.nodeFromJSON(parsed.doc).textContent,
      );

      const storage = new MemoryStorage();
      const saved = saveLocalDocumentBody({
        storage,
        documentId: 'projected-import',
        doc: intake.plan.doc,
        expected: null,
        savedAt: '2026-08-08T02:03:04.000Z',
        createWriteId: () => 'projected-import-write',
        validateSchema,
      });
      expect(saved.revision).toBe(1);
      expect(saved.doc).toStrictEqual(intake.plan.doc);
      const primaryKey = localDocumentBodyKey('projected-import');
      const revisionOneRaw = storage.values.get(primaryKey);
      expect(revisionOneRaw).toBeTruthy();
      const loaded = loadLocalDocumentBody({
        storage,
        documentId: 'projected-import',
        validateSchema,
      });
      expect(loaded.state).toBe('ready');
      if (loaded.state !== 'ready') return;

      const hydrationTransactionDocs: LocalBodyDocJson[] = [];
      editor.on('transaction', ({ transaction }) => {
        hydrationTransactionDocs.push(validateAndDetachLocalBodyDocJson(transaction.doc.toJSON()));
      });
      expect(editor.commands.setContent(loaded.envelope.doc, false)).toBe(true);
      const hydratedEditorJson = validateAndDetachLocalBodyDocJson(editor.getJSON());

      expect(loaded.envelope.doc).toStrictEqual(hydratedEditorJson);
      const headingIds: unknown[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'heading') headingIds.push(node.attrs.headingId);
        return true;
      });
      expect(headingIds).toEqual(['heading-0', 'heading-2f', 'heading-4u']);
      expect(hydrationTransactionDocs).toHaveLength(1);
      expect(hydrationTransactionDocs[0]).toStrictEqual(hydratedEditorJson);
      expect(storage.values.get(primaryKey)).toBe(revisionOneRaw);
      expect(JSON.parse(storage.values.get(primaryKey) ?? 'null').revision).toBe(1);
      expect(JSON.stringify(loaded.envelope.doc)).toBe(JSON.stringify(editor.getJSON()));
    } finally {
      editor.destroy();
    }
  });

  it('preserves file metadata, bytes, warnings, and semantics in detached idempotent canonical JSON', async () => {
    const schema = getSchema(createLashEditorExtensions());
    const bytes = markdownBytes(browserFixtureMarkdown);
    const bytesBefore = [...bytes];
    const parsed = parseMarkdownFileToDoc(browserFixtureMarkdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rawDoc = parsed.doc as LocalBodyDocJson;
    const rawBefore = validateAndDetachLocalBodyDocJson(rawDoc);
    const sourceWarnings = ['First warning', 'Second warning'];
    const validationInputs: LocalBodyDocJson[] = [];
    let canonicalInvocations = 0;
    let returnedCanonical: LocalBodyDocJson | null = null;
    const canonicalizeSchema = (doc: LocalBodyDocJson) => {
      canonicalInvocations += 1;
      const node = schema.nodeFromJSON(doc);
      node.check();
      const projected = projectDocumentHeadingIds(node);
      projected.check();
      const canonical = projected.toJSON() as LocalBodyDocJson;
      assertStrictLocalBodySchemaJson(canonical, schema);
      returnedCanonical = canonical;
      return canonical;
    };

    const result = await readMarkdownFileForImport({
      file: browserFile('Exact.MARKDOWN', bytes),
      generation: 10,
      isGenerationCurrent: () => true,
      parseMarkdown: () => ({
        ok: true,
        format: 'lash-v1',
        title: 'Exact title',
        doc: rawDoc,
        warnings: sourceWarnings,
      }),
      validateSchema: (doc) => {
        validationInputs.push(doc);
        assertStrictLocalBodySchemaJson(doc, schema);
        schema.nodeFromJSON(doc).check();
      },
      canonicalizeSchema,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(canonicalInvocations).toBe(1);
    expect(validationInputs).toHaveLength(2);
    expect(validationInputs[0]).toBe(rawDoc);
    expect(validationInputs[1]).toBe(result.plan.doc);
    expect(result.plan.doc).not.toBe(rawDoc);
    expect(result.plan.doc).not.toBe(returnedCanonical);
    expect(result.plan).toMatchObject({
      generation: 10,
      fileName: 'Exact.MARKDOWN',
      format: 'lash-v1',
      title: 'Exact title',
      warnings: ['First warning', 'Second warning'],
    });
    expect(result.plan.warnings).not.toBe(sourceWarnings);
    sourceWarnings.push('Late mutation');
    expect(result.plan.warnings).toEqual(['First warning', 'Second warning']);
    expect([...bytes]).toEqual(bytesBefore);
    expect(validateAndDetachLocalBodyDocJson(rawDoc)).toStrictEqual(rawBefore);
    expect(
      schema
        .nodeFromJSON(result.plan.doc)
        .eq(projectDocumentHeadingIds(schema.nodeFromJSON(rawDoc))),
    ).toBe(true);
    expect(validateAndDetachLocalBodyDocJson(canonicalizeSchema(result.plan.doc))).toStrictEqual(
      result.plan.doc,
    );
  });

  it('prevalidates raw JSON, canonicalizes once, then postvalidates detached canonical JSON', async () => {
    const rawDoc = paragraphDoc('Raw order');
    const canonicalDoc = paragraphDoc('Canonical order');
    const order: string[] = [];
    const validationInputs: LocalBodyDocJson[] = [];
    const canonicalizeSchema = vi.fn((doc: LocalBodyDocJson) => {
      order.push('canonicalize');
      expect(doc).toBe(rawDoc);
      return canonicalDoc;
    });

    const result = await readCanonicalFixture({
      parseMarkdown: () => {
        order.push('parse');
        return {
          ok: true,
          format: 'legacy',
          title: null,
          doc: rawDoc,
          warnings: [],
        };
      },
      validateSchema: (doc) => {
        validationInputs.push(doc);
        order.push(validationInputs.length === 1 ? 'validate-raw' : 'validate-canonical');
      },
      canonicalizeSchema,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(order).toEqual(['parse', 'validate-raw', 'canonicalize', 'validate-canonical']);
    expect(canonicalizeSchema).toHaveBeenCalledTimes(1);
    expect(validationInputs[0]).toBe(rawDoc);
    expect(validationInputs[1]).toBe(result.plan.doc);
    expect(validationInputs[1]).not.toBe(canonicalDoc);
    expect(result.plan.doc).toStrictEqual(canonicalDoc);
  });

  it('returns schema-invalid before canonicalization when raw prevalidation fails', async () => {
    const canonicalizeSchema = vi.fn(identityCanonicalizeSchema);
    const result = await readCanonicalFixture({
      validateSchema: () => {
        throw new Error('raw schema rejected');
      },
      canonicalizeSchema,
    });

    expect(result).toEqual(schemaInvalidIntake);
    expect(canonicalizeSchema).not.toHaveBeenCalled();
  });

  it('returns schema-invalid when detached canonical JSON fails final validation', async () => {
    let validationCount = 0;
    const canonicalizeSchema = vi.fn(() => paragraphDoc('Canonical'));
    const result = await readCanonicalFixture({
      validateSchema: () => {
        validationCount += 1;
        if (validationCount === 2) throw new Error('canonical schema rejected');
      },
      canonicalizeSchema,
    });

    expect(result).toEqual(schemaInvalidIntake);
    expect(validationCount).toBe(2);
    expect(canonicalizeSchema).toHaveBeenCalledTimes(1);
  });

  it('returns schema-invalid when canonicalization throws while current', async () => {
    const canonicalizeSchema = vi.fn((): LocalBodyDocJson => {
      throw new Error('canonicalization failed');
    });
    const result = await readCanonicalFixture({ canonicalizeSchema });

    expect(result).toEqual(schemaInvalidIntake);
    expect(canonicalizeSchema).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['null', () => null],
    ['array root', () => []],
    ['missing document content', () => ({ type: 'doc' })],
    ['undefined', () => ({ ...paragraphDoc('unsafe'), unsafe: undefined })],
    ['function', () => ({ ...paragraphDoc('unsafe'), unsafe: () => undefined })],
    ['symbol', () => ({ ...paragraphDoc('unsafe'), unsafe: Symbol('unsafe') })],
    ['bigint', () => ({ ...paragraphDoc('unsafe'), unsafe: BigInt(1) })],
    ['NaN', () => ({ ...paragraphDoc('unsafe'), unsafe: Number.NaN })],
    ['positive infinity', () => ({ ...paragraphDoc('unsafe'), unsafe: Number.POSITIVE_INFINITY })],
    [
      'cycle',
      () => {
        const value = paragraphDoc('cycle') as LocalBodyDocJson & { self?: unknown };
        value.self = value;
        return value;
      },
    ],
    [
      'sparse array',
      () => ({
        type: 'doc',
        content: new Array(1),
      }),
    ],
    [
      'non-plain object',
      () => {
        class NonPlainDocument {
          type = 'doc';
          content: unknown[] = [];
        }
        return new NonPlainDocument();
      },
    ],
  ])('rejects %s canonical output as schema-invalid', async (_label, createValue) => {
    const result = await readCanonicalFixture({
      canonicalizeSchema: () => createValue() as LocalBodyDocJson,
    });

    expect(result).toEqual(schemaInvalidIntake);
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects the prototype-sensitive canonical key %s',
    async (blockedKey) => {
      const canonical = paragraphDoc('blocked key') as LocalBodyDocJson;
      Object.defineProperty(canonical, blockedKey, {
        configurable: true,
        enumerable: true,
        value: 'blocked',
        writable: true,
      });

      const result = await readCanonicalFixture({
        canonicalizeSchema: () => canonical,
      });

      expect(result).toEqual(schemaInvalidIntake);
    },
  );

  it('rejects unsafe canonical URLs before final schema validation', async () => {
    let validationCount = 0;
    const result = await readCanonicalFixture({
      validateSchema: () => {
        validationCount += 1;
      },
      canonicalizeSchema: () => ({
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              src: 'javascript:alert(1)',
            },
          },
        ],
      }),
    });

    expect(result).toEqual(schemaInvalidIntake);
    expect(validationCount).toBe(1);
  });

  it.each([
    [
      'depth',
      () => {
        const canonical = paragraphDoc('depth') as LocalBodyDocJson & {
          nested?: Record<string, unknown>;
        };
        let cursor: Record<string, unknown> = canonical;
        for (let index = 0; index < 65; index += 1) {
          const nested: Record<string, unknown> = {};
          cursor.nested = nested;
          cursor = nested;
        }
        return canonical;
      },
    ],
    [
      'value count',
      () => ({
        type: 'doc',
        content: new Array(200_001).fill(null),
      }),
    ],
    ['string length', () => paragraphDoc('x'.repeat(3_500_001))],
    [
      'key length',
      () => {
        const canonical = paragraphDoc('key') as LocalBodyDocJson;
        Object.defineProperty(canonical, 'k'.repeat(129), {
          configurable: true,
          enumerable: true,
          value: true,
          writable: true,
        });
        return canonical;
      },
    ],
  ])('rejects canonical output over the authoritative %s bound', async (_label, createValue) => {
    const result = await readCanonicalFixture({
      canonicalizeSchema: () => createValue() as LocalBodyDocJson,
    });

    expect(result).toEqual(schemaInvalidIntake);
  });

  it('never parses or canonicalizes an already-stale generation', async () => {
    const parseMarkdown = vi.fn<[], MarkdownFileParseResult>(() => ({
      ok: true,
      format: 'legacy',
      title: null,
      doc: paragraphDoc('stale'),
      warnings: [],
    }));
    const canonicalizeSchema = vi.fn(identityCanonicalizeSchema);

    const result = await readCanonicalFixture({
      isGenerationCurrent: () => false,
      parseMarkdown,
      canonicalizeSchema,
    });

    expect(result).toEqual({ status: 'ignored' });
    expect(parseMarkdown).not.toHaveBeenCalled();
    expect(canonicalizeSchema).not.toHaveBeenCalled();
  });

  it('never validates or canonicalizes a blocking parser result', async () => {
    const validateSchema = vi.fn();
    const canonicalizeSchema = vi.fn(identityCanonicalizeSchema);
    const result = await readCanonicalFixture({
      parseMarkdown: () => ({
        ok: false,
        code: 'unsafe-content',
        message: 'Blocked before canonicalization.',
      }),
      validateSchema,
      canonicalizeSchema,
    });

    expect(result).toEqual({
      status: 'error',
      code: 'unsafe-content',
      message: 'Blocked before canonicalization.',
    });
    expect(validateSchema).not.toHaveBeenCalled();
    expect(canonicalizeSchema).not.toHaveBeenCalled();
  });

  it('lets stale generation dominate raw prevalidation failure', async () => {
    let current = true;
    const canonicalizeSchema = vi.fn(identityCanonicalizeSchema);
    const result = await readCanonicalFixture({
      isGenerationCurrent: () => current,
      validateSchema: () => {
        current = false;
        throw new Error('stale raw validation');
      },
      canonicalizeSchema,
    });

    expect(result).toEqual({ status: 'ignored' });
    expect(canonicalizeSchema).not.toHaveBeenCalled();
  });

  it('lets stale generation dominate invalid or throwing canonicalization', async () => {
    for (const behavior of ['invalid', 'throw'] as const) {
      let current = true;
      const canonicalizeSchema = vi.fn(() => {
        current = false;
        if (behavior === 'throw') throw new Error('stale canonicalizer');
        return null as unknown as LocalBodyDocJson;
      });

      const result = await readCanonicalFixture({
        isGenerationCurrent: () => current,
        canonicalizeSchema,
      });

      expect(result).toEqual({ status: 'ignored' });
      expect(canonicalizeSchema).toHaveBeenCalledTimes(1);
    }
  });

  it('lets stale generation dominate failure during strict canonical detachment', async () => {
    let current = true;
    const proxied = new Proxy(paragraphDoc('proxy') as LocalBodyDocJson, {
      getPrototypeOf() {
        current = false;
        throw new Error('stale detachment');
      },
    });

    const result = await readCanonicalFixture({
      isGenerationCurrent: () => current,
      canonicalizeSchema: () => proxied,
    });

    expect(result).toEqual({ status: 'ignored' });
  });

  it('lets stale generation dominate final validation failure or completion', async () => {
    for (const behavior of ['return', 'throw'] as const) {
      let current = true;
      let validationCount = 0;
      const result = await readCanonicalFixture({
        isGenerationCurrent: () => current,
        validateSchema: () => {
          validationCount += 1;
          if (validationCount !== 2) return;
          current = false;
          if (behavior === 'throw') throw new Error('stale final validation');
        },
      });

      expect(result).toEqual({ status: 'ignored' });
      expect(validationCount).toBe(2);
    }
  });
});

describe('Markdown download preflight', () => {
  it('returns deterministic simplification warnings before any download side effect', () => {
    const plan = createMarkdownDownloadPlan({
      title: 'Project',
      documentId: 'source-doc',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Underlined', marks: [{ type: 'underline' }] }],
          },
        ],
      },
    });

    expect(plan.status).toBe('ready');
    if (plan.status === 'ready') {
      expect(plan.warnings).toContain('Underline formatting is exported as emphasis in Markdown.');
      expect(plan.markdown).toContain('*Underlined*');
    }
  });

  it('blocks preflight when visible content cannot be preserved', () => {
    const plan = createMarkdownDownloadPlan({
      title: 'Project',
      documentId: 'source-doc',
      doc: {
        type: 'doc',
        content: [{ type: 'opaqueWidget', attrs: { secret: 'not-visible' } }],
      },
    });

    expect(plan.status).toBe('blocked');
    if (plan.status === 'blocked') expect(plan.reasons.length).toBeGreaterThan(0);
  });
});

describe('strict fresh-document commit', () => {
  it('commits the real browser fixture through strict active-schema and local-body safety', async () => {
    const schema = getSchema(createLashEditorExtensions());
    const validateSchema = (doc: Record<string, unknown>) => {
      assertStrictLocalBodySchemaJson(doc, schema);
      schema.nodeFromJSON(doc).check();
    };
    const intake = await readMarkdownFileForImport({
      file: browserFile('basic.md', markdownBytes(browserFixtureMarkdown)),
      generation: 1,
      isGenerationCurrent: () => true,
      validateSchema,
      canonicalizeSchema: (doc) => {
        const node = schema.nodeFromJSON(doc);
        node.check();
        const projected = projectDocumentHeadingIds(node);
        projected.check();
        const canonical = projected.toJSON() as LocalBodyDocJson;
        assertStrictLocalBodySchemaJson(canonical, schema);
        return canonical;
      },
    });
    expect(intake.status).toBe('ready');
    if (intake.status !== 'ready') return;
    expect(validateAndDetachLocalBodyDocJson(intake.plan.doc)).toStrictEqual(intake.plan.doc);

    const safetyStorage = new MemoryStorage();
    expect(() =>
      saveLocalDocumentBody({
        storage: safetyStorage,
        documentId: 'fixture-safety-check',
        doc: intake.plan.doc,
        expected: null,
        savedAt: '2026-08-08T01:02:03.000Z',
        createWriteId: () => 'fixture-safety-write',
        validateSchema,
      }),
    ).not.toThrow();
    const primaryRawBeforeLoad = safetyStorage.values.get(
      localDocumentBodyKey('fixture-safety-check'),
    );
    expect(primaryRawBeforeLoad).toBeTruthy();
    const loaded = loadLocalDocumentBody({
      storage: safetyStorage,
      documentId: 'fixture-safety-check',
      validateSchema,
    });
    expect(safetyStorage.values.get(localDocumentBodyKey('fixture-safety-check'))).toBe(
      primaryRawBeforeLoad,
    );
    expect(loaded.state).toBe('ready');
    if (loaded.state === 'ready') {
      expect(loaded.envelope.doc).toStrictEqual(intake.plan.doc);
      const loadedEditorJson = schema.nodeFromJSON(loaded.envelope.doc).toJSON();
      expect(validateAndDetachLocalBodyDocJson(loadedEditorJson)).toStrictEqual(intake.plan.doc);
    }

    const storage = new MemoryStorage();
    seedSource(storage);
    expect(
      commit(storage, {
        plan: intake.plan,
        validateSchema,
      }),
    ).toMatchObject({ status: 'committed' });
  });

  it('writes verified body and title before the registry-last commit and never changes source keys', () => {
    const storage = new MemoryStorage();
    seedSource(storage);
    const before = sourceSnapshot(storage);

    const result = commit(storage);

    expect(result).toMatchObject({
      status: 'committed',
      destination: {
        id: 'import-doc',
        path: '/doc/import-doc',
        title: 'Imported project',
        bodyRevision: 1,
        bodyWriteId: 'import-write-1',
      },
    });
    expect(sourceSnapshot(storage)).toEqual(before);
    const primaryWrite = storage.operations.indexOf(`set:${localDocumentBodyKey('import-doc')}`);
    const titleWrite = storage.operations.indexOf(`set:${documentTitleStorageKey('import-doc')}`);
    const registryWrite = storage.operations.lastIndexOf(`set:${DOCUMENT_REGISTRY_STORAGE_KEY}`);
    expect(primaryWrite).toBeGreaterThan(-1);
    expect(titleWrite).toBeGreaterThan(primaryWrite);
    expect(registryWrite).toBeGreaterThan(titleWrite);
    expect(JSON.parse(storage.values.get(DOCUMENT_REGISTRY_STORAGE_KEY) ?? 'null')[0]).toEqual({
      id: 'import-doc',
      title: 'Imported project',
      createdAt: '2026-08-08T01:02:03.000Z',
      updatedAt: '2026-08-08T01:02:03.000Z',
    });
  });

  it.each([
    ['body write', `set:${localDocumentBodyKey('import-doc')}`],
    ['body verification read', `get:${localDocumentBodyKey('import-doc')}`],
    ['title write', `set:${documentTitleStorageKey('import-doc')}`],
    ['title verification read', `get:${documentTitleStorageKey('import-doc')}`],
    ['registry write', `set:${DOCUMENT_REGISTRY_STORAGE_KEY}`],
  ])('rolls back exact destination preimages after a %s fault', (_label, operation) => {
    const storage = new MemoryStorage();
    seedSource(storage);
    const before = new Map(storage.values);
    storage.failAt.add(operation);

    const result = commit(storage);

    expect(result.status).toBe('failed');
    expect(storage.values).toEqual(before);
  });

  it('rolls back exactly when every individual storage operation is fault-injected', () => {
    const baseline = new MemoryStorage();
    seedSource(baseline);
    expect(commit(baseline).status).toBe('committed');
    const operationCount = baseline.operations.length;
    expect(operationCount).toBeGreaterThan(15);

    for (let operationNumber = 1; operationNumber <= operationCount; operationNumber += 1) {
      const storage = new MemoryStorage();
      seedSource(storage);
      const before = new Map(storage.values);
      storage.faultOnOperationNumber = operationNumber;

      const result = commit(storage);

      expect(result.status, `operation ${operationNumber}`).not.toBe('committed');
      expect(storage.values, `operation ${operationNumber}`).toEqual(before);
    }
  });

  it('fails closed on malformed registry JSON without writing', () => {
    const storage = new MemoryStorage();
    storage.values.set(DOCUMENT_REGISTRY_STORAGE_KEY, '{"broken":');
    const before = new Map(storage.values);

    const result = commit(storage);

    expect(result).toMatchObject({ status: 'failed', code: 'registry-invalid' });
    expect(storage.values).toEqual(before);
    expect(storage.operations.every((operation) => !operation.startsWith('set:'))).toBe(true);
  });

  it('fails closed on duplicate normalized registry IDs without writing', () => {
    const storage = new MemoryStorage();
    storage.values.set(
      DOCUMENT_REGISTRY_STORAGE_KEY,
      JSON.stringify([existingRecord(), existingRecord()]),
    );
    const before = new Map(storage.values);

    expect(commit(storage)).toMatchObject({ status: 'failed', code: 'registry-invalid' });
    expect(storage.values).toEqual(before);
  });

  it.each([
    [
      'registry',
      (storage: MemoryStorage, id: string) => {
        storage.values.set(
          DOCUMENT_REGISTRY_STORAGE_KEY,
          JSON.stringify([existingRecord(), existingRecord(id)]),
        );
      },
    ],
    [
      'title',
      (storage: MemoryStorage, id: string) => {
        storage.values.set(documentTitleStorageKey(id), 'collision');
      },
    ],
    [
      'primary body',
      (storage: MemoryStorage, id: string) => {
        storage.values.set(localDocumentBodyKey(id), 'collision');
      },
    ],
    [
      'backup body',
      (storage: MemoryStorage, id: string) => {
        storage.values.set(localDocumentBodyBackupKey(id), 'collision');
      },
    ],
  ])('retries when a generated ID collides in %s', (_label, collide) => {
    const storage = new MemoryStorage();
    seedSource(storage);
    collide(storage, 'collision-id');
    const ids = ['collision-id', 'fresh-id'];

    const result = commit(storage, { createDocumentId: () => ids.shift() ?? 'exhausted' });

    expect(result).toMatchObject({ status: 'committed', destination: { id: 'fresh-id' } });
  });

  it('stops after 16 collision attempts without writes', () => {
    const storage = new MemoryStorage();
    seedSource(storage);
    storage.values.set(documentTitleStorageKey('collision-id'), 'occupied');
    const before = new Map(storage.values);
    const createDocumentId = vi.fn(() => 'collision-id');

    const result = commit(storage, { createDocumentId });

    expect(result).toMatchObject({ status: 'failed', code: 'id-exhausted' });
    expect(createDocumentId).toHaveBeenCalledTimes(16);
    expect(storage.values).toEqual(before);
  });

  it('cancels purely before the first destination write', () => {
    const storage = new MemoryStorage();
    seedSource(storage);
    const before = new Map(storage.values);

    const result = commit(storage, { shouldCancelBeforeCommit: () => true });

    expect(result).toEqual({ status: 'canceled' });
    expect(storage.values).toEqual(before);
  });

  it('ignores cancellation after the first write and never rolls back a committed destination', () => {
    const storage = new MemoryStorage();
    seedSource(storage);
    let cancel = false;
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      originalSetItem(key, value);
      cancel = true;
    };

    const result = commit(storage, { shouldCancelBeforeCommit: () => cancel });

    expect(result.status).toBe('committed');
    expect(storage.values.get(documentTitleStorageKey('import-doc'))).toBe('Imported project');
  });

  it('reports cleanup-unverified with the orphan ID when rollback verification fails', () => {
    const storage = new MemoryStorage();
    seedSource(storage);
    storage.failAt.add(`set:${documentTitleStorageKey('import-doc')}`);
    storage.failAt.add(`remove:${localDocumentBodyKey('import-doc')}`);

    const result = commit(storage);

    expect(result).toMatchObject({
      status: 'cleanup-unverified',
      destinationId: 'import-doc',
    });
  });
});

describe('source quiescence', () => {
  it('requires a verified local flush of the current editor JSON', async () => {
    const flushVerified = vi.fn(async () => true);
    const source: MarkdownImportSourceQuiescence = {
      kind: 'local',
      localBodyState: 'ready',
      flushVerified,
    };

    await expect(verifyMarkdownImportSourceQuiescence(source)).resolves.toEqual({ ok: true });
    expect(flushVerified).toHaveBeenCalledTimes(1);
  });

  it('blocks failed local save and unsafe recovery states with exact copy', async () => {
    const detail =
      'Finish saving or recover your current document before opening the imported document.';
    await expect(
      verifyMarkdownImportSourceQuiescence({
        kind: 'local',
        localBodyState: 'failed',
        flushVerified: vi.fn(async () => true),
      }),
    ).resolves.toEqual({ ok: false, message: detail });
    await expect(
      verifyMarkdownImportSourceQuiescence({
        kind: 'local',
        localBodyState: 'ready',
        flushVerified: vi.fn(async () => false),
      }),
    ).resolves.toEqual({ ok: false, message: detail });
  });

  it('accepts a hydrated saved read-only remote snapshot without mutation ports', async () => {
    const source: MarkdownImportSourceQuiescence = {
      kind: 'remote',
      accessHydrated: true,
      providerHydrated: true,
      syncState: 'saved',
      pendingUpdateCount: 0,
      queuedUpdateCount: 0,
      readOnly: true,
    };

    await expect(verifyMarkdownImportSourceQuiescence(source)).resolves.toEqual({ ok: true });
    expect(Object.keys(source).sort()).toEqual([
      'accessHydrated',
      'kind',
      'pendingUpdateCount',
      'providerHydrated',
      'queuedUpdateCount',
      'readOnly',
      'syncState',
    ]);
  });
});

describe('destination acknowledgement receipt', () => {
  const destination: MarkdownImportDestination = {
    attemptId: 'attempt-receipt-1',
    id: 'import-doc',
    path: '/doc/import-doc',
    title: 'Imported project',
    bodyRevision: 1,
    bodyWriteId: 'import-write-1',
  };

  it('persists only the bounded handoff fields and leaves destination authority in local storage', () => {
    const handoffStorage = new MemoryStorage();

    expect(persistMarkdownImportHandoff(handoffStorage, destination, 5_000)).toBe(true);
    expect(
      JSON.parse(handoffStorage.values.get(MARKDOWN_IMPORT_HANDOFF_STORAGE_KEY) ?? 'null'),
    ).toEqual({
      version: 1,
      ...destination,
      deadline: 5_000,
    });
    expect(handoffStorage.values.get(MARKDOWN_IMPORT_HANDOFF_STORAGE_KEY)).not.toContain(
      'Imported body',
    );
  });

  it('does not consume a receipt for a wrong path, title, revision, or write ID', () => {
    const documentStorage = new MemoryStorage();
    seedSource(documentStorage);
    expect(commit(documentStorage).status).toBe('committed');

    for (const mismatch of [
      { pathname: '/doc/wrong' },
      { title: 'Wrong title' },
      { bodyRevision: 2 },
      { bodyWriteId: 'wrong-write' },
    ]) {
      const handoffStorage = new MemoryStorage();
      persistMarkdownImportHandoff(handoffStorage, destination, 5_000);
      expect(
        acknowledgeMarkdownImportDestination({
          handoffStorage,
          documentStorage,
          pathname: destination.path,
          documentId: destination.id,
          title: destination.title,
          bodyRevision: destination.bodyRevision,
          bodyWriteId: destination.bodyWriteId,
          validateSchema: () => undefined,
          ...mismatch,
        }),
      ).toBeNull();
      expect(handoffStorage.values.has(MARKDOWN_IMPORT_HANDOFF_STORAGE_KEY)).toBe(true);
    }
  });

  it('consumes only an exact receipt after registry, title, and body verification', () => {
    const documentStorage = new MemoryStorage();
    const handoffStorage = new MemoryStorage();
    seedSource(documentStorage);
    expect(commit(documentStorage).status).toBe('committed');
    persistMarkdownImportHandoff(handoffStorage, destination, 5_000);

    expect(
      acknowledgeMarkdownImportDestination({
        handoffStorage,
        documentStorage,
        pathname: destination.path,
        documentId: destination.id,
        title: destination.title,
        bodyRevision: destination.bodyRevision,
        bodyWriteId: destination.bodyWriteId,
        validateSchema: () => undefined,
      }),
    ).toEqual(destination);
    expect(handoffStorage.values.has(MARKDOWN_IMPORT_HANDOFF_STORAGE_KEY)).toBe(false);
  });
});

describe('void-router destination handoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const destination: MarkdownImportDestination = {
    attemptId: 'attempt-1',
    id: 'import-doc',
    path: '/doc/import-doc',
    title: 'Imported project',
    bodyRevision: 1,
    bodyWriteId: 'import-write-1',
  };

  it('calls a void router exactly once and fails open truthfully at 5,000 ms', () => {
    const push = vi.fn((_path: string) => undefined);
    const states: string[] = [];
    const controller = createMarkdownImportNavigationController({
      push,
      onStateChange: (state) => states.push(state.status),
    });

    controller.start(destination);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/doc/import-doc');
    vi.advanceTimersByTime(MARKDOWN_IMPORT_NAVIGATION_WATCHDOG_MS - 1);
    expect(controller.getState().status).toBe('created-opening');
    vi.advanceTimersByTime(1);
    expect(controller.getState()).toMatchObject({
      status: 'created-open-failed',
      destination,
    });
    expect(states).toEqual(['created-opening', 'created-open-failed']);
  });

  it.each([
    { ...destination, attemptId: 'wrong' },
    { ...destination, id: 'wrong' },
    { ...destination, path: '/doc/wrong' },
    { ...destination, title: 'Wrong' },
    { ...destination, bodyRevision: 2 },
    { ...destination, bodyWriteId: 'wrong' },
  ])('rejects a wrong destination acknowledgement %#', (acknowledgement) => {
    const controller = createMarkdownImportNavigationController({
      push: vi.fn(),
      onStateChange: vi.fn(),
    });
    controller.start(destination);

    expect(controller.acknowledge(acknowledgement)).toBe(false);
    expect(controller.getState().status).toBe('created-opening');
  });

  it('accepts the exact acknowledgement and cancels the watchdog', () => {
    const controller = createMarkdownImportNavigationController({
      push: vi.fn(),
      onStateChange: vi.fn(),
    });
    controller.start(destination);

    expect(controller.acknowledge(destination)).toBe(true);
    expect(controller.getState()).toMatchObject({ status: 'opened', destination });
    vi.advanceTimersByTime(MARKDOWN_IMPORT_NAVIGATION_WATCHDOG_MS);
    expect(controller.getState().status).toBe('opened');
  });

  it('retries the same committed ID with zero destination writes', () => {
    const push = vi.fn();
    const controller = createMarkdownImportNavigationController({
      push,
      onStateChange: vi.fn(),
    });
    controller.start(destination);
    vi.advanceTimersByTime(MARKDOWN_IMPORT_NAVIGATION_WATCHDOG_MS);

    expect(controller.retry()).toBe(true);
    expect(push).toHaveBeenNthCalledWith(2, '/doc/import-doc');
    expect(controller.getState()).toMatchObject({
      status: 'created-opening',
      destination,
    });
  });
});
