import { normalizeYProsemirrorProjectionJson } from '@lash/editor-core';
import { describe, expect, it } from 'vitest';

describe('Yjs ProseMirror projection normalization', () => {
  it('removes only exact empty attrs from mark objects without mutating the projection', () => {
    const projection = {
      type: 'doc',
      attrs: {},
      content: [
        {
          type: 'paragraph',
          attrs: {},
          content: [
            {
              type: 'text',
              text: 'linked emphasis',
              marks: [
                { type: 'bold', attrs: {} },
                { type: 'italic', attrs: Object.create(null) as Record<string, never> },
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com/review',
                    rel: 'noopener noreferrer nofollow',
                    target: '_blank',
                  },
                },
              ],
            },
          ],
        },
      ],
      extensionData: {
        attrs: {},
        marks: 'not-a-mark-array',
      },
    };

    const normalized = normalizeYProsemirrorProjectionJson(projection);

    expect(normalized).toEqual({
      type: 'doc',
      attrs: {},
      content: [
        {
          type: 'paragraph',
          attrs: {},
          content: [
            {
              type: 'text',
              text: 'linked emphasis',
              marks: [
                { type: 'bold' },
                { type: 'italic' },
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com/review',
                    rel: 'noopener noreferrer nofollow',
                    target: '_blank',
                  },
                },
              ],
            },
          ],
        },
      ],
      extensionData: {
        attrs: {},
        marks: 'not-a-mark-array',
      },
    });
    expect(normalized).not.toBe(projection);
    expect((normalized as typeof projection).content).not.toBe(projection.content);
    expect(projection.content[0]?.content[0]?.marks[0]).toEqual({ type: 'bold', attrs: {} });
    expect(Object.getPrototypeOf(projection.content[0]?.content[0]?.marks[1]?.attrs)).toBeNull();
  });

  it('preserves nonempty mark attrs plus unknown node, mark, and field data', () => {
    const projection = {
      type: 'unknown-node',
      unknownNodeField: { nested: true },
      content: [
        {
          type: 'text',
          text: 'x',
          unknownTextField: 7,
          marks: [
            {
              type: 'unknown-mark',
              attrs: { custom: 'kept' },
              unknownMarkField: ['kept'],
            },
          ],
        },
      ],
    };

    expect(normalizeYProsemirrorProjectionJson(projection)).toEqual(projection);
  });
});
