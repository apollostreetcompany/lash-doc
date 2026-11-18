// @vitest-environment jsdom

import { createLashEditorExtensions } from '@lash/editor-core';
import { Editor, getSchema } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';

const BODY = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'The launch brief is ready for a teammate to review and comment.',
        },
      ],
    },
  ],
};

describe('realtime editor hydration', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('renders a pre-hydrated content fragment on the first collaborative editor frame', () => {
    const schema = getSchema(createLashEditorExtensions());
    const promoted = prosemirrorJSONToYDoc(schema, BODY, 'content');
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(promoted));

    editor = new Editor({
      element: document.createElement('div'),
      extensions: createLashEditorExtensions({
        collaboration: {
          document: remote,
          field: 'content',
        },
      }),
    });

    expect(editor.getJSON()).toEqual(BODY);
    expect(editor.getText()).toBe(
      'The launch brief is ready for a teammate to review and comment.',
    );
  });
});
