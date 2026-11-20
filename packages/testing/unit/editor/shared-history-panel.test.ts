/** @vitest-environment jsdom */

import type { SharedHistoryCommand, SharedHistoryOutcome } from '@lash/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharedHistoryPanel } from '../../../../apps/web/components/editor/panels/SharedHistoryPanel';
import { SharedHistoryClient } from '../../../../apps/web/lib/sharedHistoryClient';
import * as React from '../../../../apps/web/node_modules/react';
import { createRoot, type Root } from '../../../../apps/web/node_modules/react-dom/client';

const timeline = (versions: number[], nextBefore: number | null = null): SharedHistoryOutcome => ({
  kind: 'list',
  head: versions[0],
  nextBefore,
  canRestore: true,
  revisions: versions.map((sequence) => ({
    sequence,
    parentSequence: sequence - 1,
    kind: 'edit',
    createdAt: '2026-11-21T00:00:00.000Z',
    author: 'Writer',
    restoredFrom: null,
  })),
});

const comparison = (after: string): SharedHistoryOutcome => ({
  kind: 'compare',
  truncated: false,
  changes: [{ after, before: '', prefix: '', suffix: '', structureChanged: false }],
});

const connection = () => {
  const requests: SharedHistoryCommand[] = [];
  const client = new SharedHistoryClient((request) => {
    requests.push(request);
    return true;
  });
  const reply = async (
    request: SharedHistoryCommand | undefined,
    outcome: SharedHistoryOutcome,
  ) => {
    if (!request) throw new Error('Missing request');
    await React.act(async () => {
      client.receive({
        type: 'shared-history-result',
        requestId: request.requestId,
        roomId: 'test',
        outcome,
      });
    });
  };
  return { client, requests, reply };
};

describe('shared History panel lifetime', () => {
  let host: HTMLDivElement;
  let root: Root;
  const commits: Array<{ selected: string | undefined; text: string | null | undefined }> = [];

  const render = (client: SharedHistoryClient, open = true) =>
    React.act(async () => {
      root.render(
        React.createElement(
          React.Profiler,
          {
            id: 'shared-history',
            onRender: () => {
              commits.push({
                selected: host.querySelector('select')?.value,
                text: host.querySelector('ins')?.textContent,
              });
            },
          },
          React.createElement(SharedHistoryPanel, {
            client,
            open,
            connected: true,
            canSendRestore: true,
          }),
        ),
      );
    });

  const finishListDebounce = () => React.act(async () => vi.advanceTimersByTimeAsync(240));

  const chooseVersion = (value: string) =>
    React.act(async () => {
      const select = host.querySelector('select');
      if (!select) throw new Error('Missing version picker');
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

  const click = (text: string) =>
    React.act(async () => {
      const button = [...host.querySelectorAll('button')].find((item) => item.textContent === text);
      if (!button) throw new Error(`Missing ${text}`);
      button.click();
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('React', React);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    commits.length = 0;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('only shows the comparison matching the selected versions and client', async () => {
    const first = connection();
    await render(first.client);
    await finishListDebounce();
    await first.reply(first.requests.at(-1), timeline([3, 2, 1]));
    expect(first.requests.at(-1)).toMatchObject({ type: 'shared-history-compare', from: 2, to: 3 });
    await first.reply(first.requests.at(-1), comparison('Third version'));
    expect(host.querySelector('ins')?.textContent).toBe('Third version');

    commits.length = 0;
    await chooseVersion('2');
    expect(first.requests.at(-1)).toMatchObject({ type: 'shared-history-compare', from: 1, to: 2 });
    expect(commits).not.toContainEqual({ selected: '2', text: 'Third version' });
    await first.reply(first.requests.at(-1), comparison('Second version'));
    expect(host.querySelector('ins')?.textContent).toBe('Second version');

    const next = connection();
    commits.length = 0;
    await render(next.client);
    expect(commits.some(({ text }) => text === 'Second version')).toBe(false);
  });

  it('ignores old page and restore replies after closing and reopening History', async () => {
    const room = connection();
    await render(room.client);
    await finishListDebounce();
    await room.reply(room.requests.at(-1), timeline([3, 2], 2));
    await room.reply(room.requests.at(-1), comparison('Third version'));
    await click('Load older versions');
    const older = room.requests.at(-1);
    expect(older).toMatchObject({ type: 'shared-history-list', before: 2 });
    await chooseVersion('2');
    await room.reply(room.requests.at(-1), comparison('Second version'));
    await click('Restore this version');
    await click('Restore version');
    const restore = room.requests.at(-1);
    expect(restore).toMatchObject({ type: 'shared-history-restore', expectedHead: 3, target: 2 });

    await render(room.client, false);
    await render(room.client);
    await finishListDebounce();
    await room.reply(room.requests.at(-1), timeline([4, 3, 2]));
    await chooseVersion('3');
    await room.reply(older, timeline([1]));
    await room.reply(restore, { kind: 'restored', sequence: 4 });

    expect(host.querySelector('select')?.value).toBe('3');
    expect(host.querySelector('select option[value="1"]')).toBeNull();
    expect(host.textContent).not.toContain('Version restored.');
  });
});
