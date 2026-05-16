/** @vitest-environment jsdom */

import { createLashEditorExtensions, type LashImageUploader } from '@lash/editor-core';
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

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
});
