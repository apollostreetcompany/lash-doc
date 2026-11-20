/** @vitest-environment jsdom */

import { createLashEditorExtensions } from '@lash/editor-core';
import type { PublicCommentDtoV1 } from '@lash/types';
import { getSchema } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';

import {
  PublicDocumentClient,
  type PublicDocumentClientDependencies,
} from '../../../../apps/web/app/public/[roomId]/PublicDocumentClient';
import {
  createPublicDocumentProvider,
  type PublicDocumentProvider,
  type PublicDocumentProviderSnapshot,
} from '../../../../apps/web/lib/publicDocumentAccess/provider';
import { writeRealtimeDocumentTitle } from '../../../../apps/web/lib/realtimeCollaboration';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';
import { encodePublicYjsProjection } from '../../../realtime-worker/src/namedEditProjection';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ROOM_ID = `doc-v1-${'c'.repeat(64)}`;
const roots: Root[] = [];
const COMMENT: PublicCommentDtoV1 = {
  id: 'pc-v1-12345678-1234-4123-8123-123456789abc',
  sequence: 1,
  anchor: { kind: 'document' },
  body: 'Could we add the launch date?',
  author: { label: 'Commenter Ab3_xQ' },
  createdAt: '2026-07-30T12:34:56.789Z',
};

const render = async (node: React.ReactNode) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await React.act(async () => root.render(node));
  return host;
};

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await React.act(async () => root?.unmount());
  }
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const session = {
  authorization: {
    roomId: ROOM_ID,
    mode: 'comment' as const,
    policyVersion: 4,
    cutoffGeneration: 2,
  },
  actorId: 'public-reader-7',
  socketUrl: `wss://worker.example/api/realtime/rooms/${ROOM_ID}/socket?protocolVersion=4&actorId=public-reader-7`,
  socketProtocol: 'lash-realtime-v4' as const,
  ticketProtocol: `lash-public-ticket.${'f'.repeat(43)}`,
};

const providerHarness = () => {
  let snapshot: PublicDocumentProviderSnapshot = {
    phase: 'authorizing',
    projection: null,
  };
  const listeners = new Set<(next: PublicDocumentProviderSnapshot) => void>();
  let resolveStart: ((projection: { title: string; body: unknown }) => void) | undefined;
  const provider: PublicDocumentProvider = {
    start: vi.fn(
      () =>
        new Promise<{ title: string; body: unknown }>((resolve) => {
          resolveStart = resolve;
        }),
    ),
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    destroy: vi.fn(),
  };
  return {
    provider,
    publish(next: PublicDocumentProviderSnapshot) {
      snapshot = next;
      for (const listener of listeners) listener(next);
      if (next.phase === 'ready') resolveStart?.(next.projection);
    },
  };
};

describe('public document client shell', () => {
  it.each(['read', 'comment'] as const)(
    'renders author-visible table values in public %s mode',
    async (mode) => {
      const paragraph = (text: string) => ({
        type: 'paragraph',
        ...(text && { content: [{ type: 'text', text }] }),
      });
      const typedCell = (
        cellType: string,
        value: string,
        options: string[],
        retainedText = '',
      ) => ({
        type: 'tableCell',
        attrs: { cellType, value, options },
        content: [paragraph(retainedText)],
      });
      const selectedLabel = 'Beta <b>launch</b>';
      const headers = ['Stage', 'Priority', 'Notes', 'Next step', 'Group', 'Default', 'Empty'];
      const room = prosemirrorJSONToYDoc(
        getSchema(createLashEditorExtensions()),
        {
          type: 'doc',
          content: [
            {
              type: 'table',
              content: [
                {
                  type: 'tableRow',
                  content: headers.map((header) => ({
                    type: 'tableHeader',
                    content: [paragraph(header)],
                  })),
                },
                {
                  type: 'tableRow',
                  content: [
                    typedCell('status', 'Done', []),
                    typedCell(
                      'select',
                      selectedLabel,
                      ['Unselected option', selectedLabel],
                      'Retained cell note',
                    ),
                    {
                      type: 'tableCell',
                      attrs: { cellType: 'text', value: 'Unused text attribute' },
                      content: [
                        {
                          type: 'paragraph',
                          content: [
                            { type: 'text', text: 'Formatted note', marks: [{ type: 'bold' }] },
                          ],
                        },
                      ],
                    },
                    typedCell('status', '', []),
                    typedCell('select', 'No longer configured', ['Custom fallback']),
                    typedCell('select', '', []),
                    typedCell('select', '', ['']),
                  ],
                },
              ],
            },
          ],
        },
        'content',
      );
      writeRealtimeDocumentTitle(room, 'Launch readiness');
      const update = encodePublicYjsProjection(room);
      room.destroy();
      expect(update).toEqual(expect.any(String));

      const socket = Object.assign(new EventTarget(), { close: vi.fn() });
      const authorization = { ...session.authorization, mode };
      const projectionSession = { ...session, authorization };
      const dependencies: PublicDocumentClientDependencies = {
        getActorId: () => session.actorId,
        requestSession: vi.fn().mockResolvedValue({ ok: true, session: projectionSession }),
        createProvider: (authorizedSession) =>
          createPublicDocumentProvider(authorizedSession, { createSocket: () => socket }),
        listComments: vi.fn().mockResolvedValue({
          ok: true,
          version: 1,
          authorization,
          comments: [],
          nextBeforeSequence: null,
        }),
        requestAuthoringSession: vi
          .fn()
          .mockResolvedValue({ ok: true, version: 1, authenticated: false }),
      };
      const host = await render(
        React.createElement(PublicDocumentClient, { roomId: ROOM_ID, dependencies }),
      );
      const frame = (value: unknown) =>
        socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
      const envelope = { ...authorization, protocolVersion: 4, highWaterSequence: 0 };
      await React.act(async () => {
        frame({ type: 'room-ready', ...envelope });
        frame({ type: 'yjs-update', roomId: ROOM_ID, update });
      });
      expect(host.querySelector('table')).toBeNull();
      await React.act(async () => {
        frame({ type: 'room-hydration-complete', ...envelope, persistedUpdates: 1 });
      });

      expect(host.textContent).toContain(mode === 'read' ? 'Can read' : 'Can comment');
      expect([...host.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(headers);
      expect(host.querySelector('td strong')?.textContent).toBe('Formatted note');
      expect([...host.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual([
        'Done',
        selectedLabel,
        'Formatted note',
        'Todo',
        'Custom fallback',
        'Option A',
        '',
      ]);
      expect(host.querySelector('table b')).toBeNull();
      expect(host.querySelector('table')?.outerHTML).not.toMatch(
        /Unselected option|Retained cell note|Unused text attribute/u,
      );
      expect(
        host.querySelector('table button, table [role="listbox"], [contenteditable]'),
      ).toBeNull();
      expect(dependencies.listComments).toHaveBeenCalledTimes(mode === 'comment' ? 1 : 0);
    },
  );

  it('keeps title and body absent through session authorization and hydration', async () => {
    let resolveSession!: (value: { ok: true; session: typeof session }) => void;
    const harness = providerHarness();
    const dependencies: PublicDocumentClientDependencies = {
      getActorId: () => 'public-reader-7',
      requestSession: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveSession = resolve;
          }),
      ) as never,
      createProvider: () => harness.provider,
    };
    const host = await render(
      React.createElement(PublicDocumentClient, { roomId: ROOM_ID, dependencies }),
    );
    expect(host.textContent).toBe('Opening public document…');
    expect(host.querySelector('[data-public-document-title]')).toBeNull();
    expect(host.querySelector('[data-public-document-body]')).toBeNull();

    await React.act(async () => resolveSession({ ok: true, session }));
    await React.act(async () => harness.publish({ phase: 'hydrating', projection: null }));
    expect(host.textContent).toBe('Opening public document…');
    expect(host.querySelector('[data-public-document-title]')).toBeNull();
    expect(host.querySelector('[data-public-document-body]')).toBeNull();
  });

  it('renders exact read-only projection and anonymous public discussion only after ready', async () => {
    const harness = providerHarness();
    const dependencies: PublicDocumentClientDependencies = {
      getActorId: () => 'public-reader-7',
      requestSession: vi.fn().mockResolvedValue({ ok: true, session }),
      createProvider: () => harness.provider,
      listComments: vi.fn().mockResolvedValue({
        ok: true,
        version: 1,
        authorization: session.authorization,
        comments: [COMMENT],
        nextBeforeSequence: null,
      }),
      requestAuthoringSession: vi.fn().mockResolvedValue({
        ok: true,
        version: 1,
        authenticated: false,
      }),
      createComment: vi.fn(),
    };
    const host = await render(
      React.createElement(PublicDocumentClient, { roomId: ROOM_ID, dependencies }),
    );
    await React.act(async () =>
      harness.publish({
        phase: 'ready',
        mode: 'comment',
        projection: {
          title: 'Account ownership handoff',
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'The owner’s latest sentence.' }],
              },
            ],
          },
        },
      }),
    );
    await React.act(async () => undefined);
    expect(host.textContent).toContain('Public access · Can comment');
    expect(host.textContent).toContain('Account ownership handoff');
    expect(host.textContent).toContain('The owner’s latest sentence.');
    expect(host.textContent).toContain('Public comments');
    expect(host.textContent).toContain('Could we add the launch date?');
    expect(host.textContent).toContain('Commenter Ab3_xQ');
    expect(host.textContent).toContain('Sign in to comment');
    expect(host.querySelector('textarea[aria-label="Comment"]')).not.toBeNull();
    expect(
      host.querySelector(`a[href="/auth/sign-in?next=%2Fpublic%2F${ROOM_ID}"]`),
    ).not.toBeNull();
    expect(host.querySelector('[contenteditable]')).toBeNull();
    expect(host.textContent).not.toMatch(/Edit|Suggest|History|AI|Share|Settings|People|Presence/u);

    await React.act(async () =>
      harness.publish({
        phase: 'unavailable',
        projection: null,
      }),
    );
    expect(host.textContent).toContain("This document isn't available.");
    expect(host.textContent).not.toContain('Account ownership handoff');
    expect(host.textContent).not.toContain('The owner’s latest sentence.');
  });

  it('posts one typed comment for an authenticated account and preserves body read-only', async () => {
    const harness = providerHarness();
    const createComment = vi.fn().mockResolvedValue({
      ok: true,
      version: 1,
      created: true,
      authorization: session.authorization,
      comment: COMMENT,
    });
    const dependencies: PublicDocumentClientDependencies = {
      getActorId: () => 'public-reader-7',
      requestSession: vi.fn().mockResolvedValue({ ok: true, session }),
      createProvider: () => harness.provider,
      listComments: vi.fn().mockResolvedValue({
        ok: true,
        version: 1,
        authorization: session.authorization,
        comments: [],
        nextBeforeSequence: null,
      }),
      requestAuthoringSession: vi.fn().mockResolvedValue({
        ok: true,
        version: 1,
        authenticated: true,
        csrfProof: `v1.${'a'.repeat(43)}.1780000000.${'b'.repeat(43)}`,
        expiresAt: '2026-05-28T20:26:40.000Z',
      }),
      createComment,
    };
    window.localStorage.setItem(
      `lash:public-comment-draft:v1:${ROOM_ID}`,
      JSON.stringify({
        body: '  Could we add the launch date?  ',
        savedAt: Date.now(),
      }),
    );
    const host = await render(
      React.createElement(PublicDocumentClient, { roomId: ROOM_ID, dependencies }),
    );
    await React.act(async () =>
      harness.publish({
        phase: 'ready',
        mode: 'comment',
        projection: {
          title: 'Account ownership handoff',
          body: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read only.' }] }],
          },
        },
      }),
    );
    await React.act(async () => undefined);
    const textarea = host.querySelector('textarea[aria-label="Comment"]') as HTMLTextAreaElement;
    expect(textarea.value).toBe('  Could we add the launch date?  ');
    const post = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Post comment',
    );
    await React.act(async () => post?.click());

    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        body: 'Could we add the launch date?',
        expectedPolicyVersion: 4,
        expectedCutoffGeneration: 2,
      }),
    );
    expect(host.textContent).toContain('Comment posted.');
    expect(host.textContent).toContain('Could we add the launch date?');
    expect(window.localStorage.getItem(`lash:public-comment-draft:v1:${ROOM_ID}`)).toBeNull();
    expect(host.querySelector('[contenteditable]')).toBeNull();
  });

  it('offers a bounded non-disclosing retry after policy cutoff', async () => {
    const first = providerHarness();
    const second = providerHarness();
    const requestSession = vi.fn().mockResolvedValue({ ok: true, session });
    const createProvider = vi
      .fn()
      .mockReturnValueOnce(first.provider)
      .mockReturnValueOnce(second.provider);
    const dependencies: PublicDocumentClientDependencies = {
      getActorId: () => 'public-reader-7',
      requestSession,
      createProvider,
      listComments: vi.fn().mockResolvedValue({
        ok: true,
        version: 1,
        authorization: session.authorization,
        comments: [],
        nextBeforeSequence: null,
      }),
      requestAuthoringSession: vi.fn().mockResolvedValue({
        ok: true,
        version: 1,
        authenticated: false,
      }),
      createComment: vi.fn(),
    };
    const host = await render(
      React.createElement(PublicDocumentClient, { roomId: ROOM_ID, dependencies }),
    );
    await React.act(async () =>
      first.publish({
        phase: 'ready',
        mode: 'comment',
        projection: {
          title: 'Policy cutoff',
          body: { type: 'doc', content: [] },
        },
      }),
    );
    await React.act(async () => first.publish({ phase: 'unavailable', projection: null }));
    expect(host.textContent).toContain("This document isn't available.");
    const retry = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Try again',
    );
    await React.act(async () => retry?.click());
    expect(requestSession).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Opening public document…');
  });

  it('ignores a retired public comment response and retries the same unconfirmed draft', async () => {
    const first = providerHarness();
    const second = providerHarness();
    const createProvider = vi
      .fn()
      .mockReturnValueOnce(first.provider)
      .mockReturnValueOnce(second.provider);
    const success = {
      ok: true,
      version: 1,
      created: true,
      authorization: session.authorization,
      comment: COMMENT,
    } as const;
    let finishPost: (result: typeof success) => void = () => undefined;
    const pending = new Promise<typeof success>((resolve) => {
      finishPost = resolve;
    });
    const createComment = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(success);
    const dependencies: PublicDocumentClientDependencies = {
      getActorId: () => 'public-reader-7',
      requestSession: vi.fn().mockResolvedValue({ ok: true, session }),
      createProvider,
      listComments: vi.fn().mockResolvedValue({
        ok: true,
        version: 1,
        authorization: session.authorization,
        comments: [],
        nextBeforeSequence: null,
      }),
      requestAuthoringSession: vi.fn().mockResolvedValue({
        ok: true,
        version: 1,
        authenticated: true,
        csrfProof: 'comment-post-proof',
        expiresAt: '2026-11-21T17:00:00Z',
      }),
      createComment,
    };
    const key = `lash:public-comment-draft:v1:${ROOM_ID}`;
    window.localStorage.setItem(
      key,
      JSON.stringify({ body: 'Pending public note', savedAt: Date.now() }),
    );
    const host = await render(
      React.createElement(PublicDocumentClient, { roomId: ROOM_ID, dependencies }),
    );
    const ready = {
      phase: 'ready',
      mode: 'comment',
      projection: { title: 'Public discussion', body: { type: 'doc', content: [] } },
    } as const;
    const button = (text: string) =>
      [...host.querySelectorAll('button')].find((item) => item.textContent === text);
    await React.act(async () => first.publish(ready));
    await React.act(async () => button('Post comment')?.click());
    expect(createComment).toHaveBeenCalledOnce();
    await React.act(async () => first.publish({ phase: 'unavailable', projection: null }));
    await React.act(async () => button('Try again')?.click());
    await React.act(async () => second.publish(ready));
    await React.act(async () => finishPost(success));
    expect(host.querySelector('textarea')?.value).toBe('Pending public note');
    expect(host.textContent).not.toContain('Comment posted.');
    expect(window.localStorage.getItem(key)).toContain('Pending public note');
    await React.act(async () => button('Post comment')?.click());
    expect(createComment).toHaveBeenCalledTimes(2);
    expect(createComment.mock.calls[1][0].mutationId).toBe(
      createComment.mock.calls[0][0].mutationId,
    );
  });
});
