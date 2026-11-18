/** @vitest-environment jsdom */

import {
  createLashEditorExtensions,
  normalizeYProsemirrorProjectionJson,
  parseMarkdownFileToDoc,
  serializeDocToMarkdownFile,
  type LashImageUploader,
} from '@lash/editor-core';
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';

import {
  assertStrictLocalBodySchemaJson,
  loadLocalDocumentBody,
  saveLocalDocumentBody,
} from '../../../../apps/web/lib/localDocumentBodyPersistence';
import { applyNamedEditYjsUpdate } from '../../../realtime-worker/src/namedEditProjection';
import {
  base64ToBytes,
  buildPromotedHydrationUpdates,
  bytesToBase64,
} from '../../../realtime-worker/src/persistence';
import {
  canonicalizePromotionJson,
  projectionMatchesInitialUpdate,
} from '../../../realtime-worker/src/promotion';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAYAAADN5B7xAAAAFElEQVR4nGMQyoj5TwpmGNVACw0ALdKv4VVTVV0AAAAASUVORK5CYII=';
const PNG_SOURCE = `data:image/png;base64,${PNG_BASE64}`;
const pngFile = () =>
  new File([new Uint8Array(Buffer.from(PNG_BASE64, 'base64'))], 'sample.png', {
    type: 'image/png',
  });

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Lash image extension', () => {
  it('inserts a placeholder and resolves the upload', async () => {
    const progressValues: number[] = [];
    const uploader: LashImageUploader = {
      async upload(_file, onProgress) {
        onProgress(0.4);
        progressValues.push(0.4);
        return { src: 'https://mock.cdn/image-idle.png', width: 460 };
      },
    };

    const editor = new Editor({
      extensions: createLashEditorExtensions({ image: { uploader } }),
      content: '<p></p>',
    });

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'sample.png', { type: 'image/png' });
    editor.commands.insertImagePlaceholder(file);
    await flushMicrotasks();

    const node = editor.state.doc.content.firstChild;
    expect(node?.type.name).toBe('image');
    expect(node?.attrs.status).toBe('idle');
    expect(node?.attrs.src).toBe('https://mock.cdn/image-idle.png');
    expect(node?.attrs.width).toBe(460);
    expect(progressValues).toContain(0.4);

    editor.commands.updateImageAttributes({ alt: 'Uploaded diagram' });
    const updated = editor.state.doc.content.firstChild;
    expect(updated?.attrs.alt).toBe('Uploaded diagram');

    editor.destroy();
  });

  it('allows retry after a failed upload', async () => {
    let attempts = 0;
    const uploader: LashImageUploader = {
      async upload(_file, _onProgress) {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('network down');
        }
        return { src: 'https://mock.cdn/image-retry.png', width: 420 };
      },
    };

    const editor = new Editor({
      extensions: createLashEditorExtensions({ image: { uploader } }),
      content: '<p></p>',
    });

    const file = new File([new Uint8Array([0xff, 0xd8])], 'retry.jpg', { type: 'image/jpeg' });
    editor.commands.insertImagePlaceholder(file);
    await flushMicrotasks();

    let node = editor.state.doc.content.firstChild;
    expect(node?.attrs.status).toBe('error');
    const uploadId = node?.attrs.uploadId as string;
    expect(typeof uploadId).toBe('string');

    editor.commands.retryImageUpload(uploadId);
    await flushMicrotasks();

    node = editor.state.doc.content.firstChild;
    expect(node?.attrs.status).toBe('idle');
    expect(node?.attrs.src).toBe('https://mock.cdn/image-retry.png');

    editor.destroy();
  });

  it('preserves a user-selected width when upload completion reports dimensions later', async () => {
    let finishUpload!: (value: { src: string; width: number }) => void;
    const uploader: LashImageUploader = {
      async upload(_file, _onProgress) {
        return new Promise((resolve) => {
          finishUpload = resolve;
        });
      },
    };

    const editor = new Editor({
      extensions: createLashEditorExtensions({ image: { uploader } }),
      content: '<p></p>',
    });

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'resize.png', { type: 'image/png' });
    editor.commands.insertImagePlaceholder(file);
    await flushMicrotasks();

    editor.commands.updateImageAttributes({ width: 310 });
    finishUpload({ src: 'https://mock.cdn/image-resized.png', width: 420 });
    await flushMicrotasks();

    const node = editor.state.doc.content.firstChild;
    expect(node?.attrs.status).toBe('idle');
    expect(node?.attrs.src).toBe('https://mock.cdn/image-resized.png');
    expect(node?.attrs.width).toBe(310);

    editor.destroy();
  });

  it('preserves a selected range when the pending attachment exceeds the document budget', async () => {
    const text = 'abc '.repeat(200_000);
    const editor = new Editor({
      extensions: createLashEditorExtensions({
        image: { uploader: { upload: async () => ({ src: PNG_SOURCE, width: 12 }) } },
      }),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    });
    editor.commands.setTextSelection({ from: 1, to: 10 });
    editor.commands.insertImagePlaceholder(pngFile());
    expect(editor.state.doc.textContent).toBe(text);
    await flushMicrotasks();

    const json = editor.getJSON();
    expect(editor.state.doc.textContent).toBe(text);
    const attachment = json.content?.find((node) => node.type === 'image');
    expect(attachment?.attrs).toMatchObject({
      src: '',
      status: 'error',
      error: 'This document is too large to add this image.',
      previewSrc: null,
    });
    expect(JSON.stringify(json)).not.toContain('blob:');
    editor.destroy();
  });

  it('preserves actual PNG bytes in local storage, a remote Yjs replica, and Markdown', async () => {
    const room = new Y.Doc();
    const editor = new Editor({
      extensions: createLashEditorExtensions({
        collaboration: { document: room, field: 'content' },
        image: { uploader: { upload: async () => ({ src: PNG_SOURCE, width: 12 }) } },
      }),
    });
    room.getMap('lash:document-metadata:v1').set('title', 'Color card');
    editor.commands.insertContent('Color reference');
    const baseline = Y.encodeStateAsUpdate(room);
    const updates: Uint8Array[] = [];
    room.on('update', (update) => {
      updates.push(update);
    });
    editor.commands.insertImagePlaceholder(pngFile());
    await flushMicrotasks();
    editor.commands.updateImageAttributes({ alt: 'Teal sample', width: 240 });

    const body = editor.getJSON();
    const image = body.content?.find((node) => node.type === 'image');
    expect(image?.attrs).toMatchObject({ src: PNG_SOURCE, alt: 'Teal sample', width: 240 });

    const documentId = 'image-extension-roundtrip';
    const validateSchema = (doc: Record<string, unknown>) => {
      assertStrictLocalBodySchemaJson(doc, editor.schema);
      editor.schema.nodeFromJSON(doc).check();
    };
    saveLocalDocumentBody({
      storage: window.localStorage,
      documentId,
      doc: body,
      expected: null,
      validateSchema,
    });
    expect(
      loadLocalDocumentBody({ storage: window.localStorage, documentId, validateSchema }),
    ).toMatchObject({
      state: 'ready',
      envelope: { doc: body },
    });

    const replica = new Y.Doc();
    const [seed, ...deltas] = buildPromotedHydrationUpdates(
      bytesToBase64(baseline),
      null,
      updates.map((update, index) => ({
        sequence: index + 1,
        actorId: 'editor',
        source: 'client' as const,
        update: bytesToBase64(update),
        createdAt: '2026-11-18T00:00:00.000Z',
      })),
    );
    Y.applyUpdate(replica, base64ToBytes(seed));
    expect(deltas.length).toBeGreaterThan(1);
    for (const delta of deltas)
      expect(applyNamedEditYjsUpdate(replica, delta)).toEqual(expect.any(String));
    const replicaProjection = normalizeYProsemirrorProjectionJson(
      yXmlFragmentToProsemirrorJSON(replica.getXmlFragment('content')),
    );
    expect(replicaProjection).toEqual(body);
    expect(
      projectionMatchesInitialUpdate(
        Y.encodeStateAsUpdate(room),
        'Color card',
        canonicalizePromotionJson(body),
      ),
    ).toBe(true);

    const exported = serializeDocToMarkdownFile(body, { title: 'Color card' });
    expect(exported.blockedReasons).toEqual([]);
    expect(exported.markdown).toContain(`[image-1]: ${PNG_SOURCE}`);
    expect(parseMarkdownFileToDoc(exported.markdown)).toMatchObject({
      ok: true,
      doc: {
        content: expect.arrayContaining([
          { type: 'image', attrs: { src: PNG_SOURCE, alt: 'Teal sample' } },
        ]),
      },
    });
    for (const untrustedSource of [
      'data:image/png;base64,PHNjcmlwdD4=',
      'data:image/svg+xml;base64,PHN2Zz4=',
      PNG_SOURCE.replace('image/png', 'image/jpeg'),
    ]) {
      expect(parseMarkdownFileToDoc(`![Invalid](${untrustedSource})`)).toMatchObject({
        ok: false,
        code: 'unsafe-content',
      });
    }

    replica.destroy();
    editor.destroy();
    room.destroy();
  });
});
