import { createAnchor, createThreadStore, mapAnchor } from '@lash/doc-chat';
import { createDocumentId } from '@lash/types';
import { describe, expect, it } from 'vitest';

describe('@lash/doc-chat', () => {
  it('maps a selection anchor through inserted surrounding text', () => {
    const currentText = 'Lead Alpha target omega';
    const anchor = createAnchor({
      baseVersion: 'v1',
      docText: 'Alpha target omega',
      from: 6,
      to: 12,
    });

    const mapped = mapAnchor({
      anchor,
      baseDoc: { text: 'Alpha target omega' },
      ops: [{ op: 'replace_text', from: 0, to: 0, text: 'Lead ' }],
      currentDoc: { text: currentText },
      targetVersion: 'v2',
    });

    expect(mapped).toMatchObject({
      baseVersion: 'v2',
      from: 11,
      to: 17,
      orphaned: false,
    });
    expect(currentText.slice(mapped.from, mapped.to)).toBe('target');
  });

  it.each([
    { op: 'replace_text', from: 6, to: 12, text: '' },
    { op: 'delete_range', from: 6, to: 12 },
  ] as const)('pins an orphaned anchor after $op removes the selected text', (operation) => {
    const anchor = createAnchor({
      baseVersion: 'v1',
      docText: 'Alpha target omega',
      from: 6,
      to: 12,
    });

    const mapped = mapAnchor({
      anchor,
      baseDoc: { text: 'Alpha target omega' },
      ops: [operation],
      currentDoc: { text: 'Alpha omega' },
      targetVersion: 'v2',
    });

    expect(mapped).toMatchObject({
      baseVersion: 'v2',
      from: 6,
      to: 6,
      orphaned: true,
    });
  });

  it('filters thread lists by user and AI messages', async () => {
    const store = createThreadStore({ adapter: 'memory' });
    const docId = createDocumentId('doc-chat-test');
    const anchor = createAnchor({
      baseVersion: 'v1',
      docText: 'Discuss this',
      from: 0,
      to: 7,
    });
    const thread = await store.create(docId, anchor);
    await store.reply(thread.id, {
      author: { type: 'user', id: 'local-user' },
      ts: '2026-05-16T00:00:00.000Z',
      body: 'User note',
    });
    await store.reply(thread.id, {
      author: { type: 'ai', id: 'ai-doc-chat', label: 'AI' },
      ts: '2026-05-16T00:00:01.000Z',
      body: 'AI note',
    });

    await expect(store.list(docId, { authorId: 'local-user' })).resolves.toHaveLength(1);
    await expect(store.list(docId, { ai: true })).resolves.toHaveLength(1);
    await expect(store.list(docId, { authorId: 'someone-else' })).resolves.toHaveLength(0);
  });
});
