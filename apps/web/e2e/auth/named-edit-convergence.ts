import { expect, type Locator, type Page, type TestInfo, type WebSocket } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const editor = (page: Page) =>
  page.getByRole('region', { name: 'Writing canvas' }).locator('.tiptap');
const sync = (page: Page) => page.getByTestId('realtime-sync-state');

type Frame = {
  direction: 'sent' | 'received';
  type: string;
  update?: string;
  updateId?: string;
};

export function observeRoomWire(page: Page) {
  const frames: Frame[] = [];
  const sockets: WebSocket[] = [];
  page.on('websocket', (socket) => {
    if (!/\/api\/realtime\/rooms\/[^/]+\/socket$/u.test(new URL(socket.url()).pathname)) return;
    sockets.push(socket);
    const observe = (direction: Frame['direction'], payload: string | Buffer) => {
      try {
        const value = JSON.parse(payload.toString()) as Record<string, unknown>;
        if (typeof value.type !== 'string') return;
        frames.push({
          direction,
          type: value.type,
          ...(typeof value.update === 'string' ? { update: value.update } : {}),
          ...(typeof value.updateId === 'string' ? { updateId: value.updateId } : {}),
        });
      } catch {
        // Other traffic is outside the document-update measurements.
      }
    };
    socket.on('framesent', ({ payload }) => observe('sent', payload));
    socket.on('framereceived', ({ payload }) => observe('received', payload));
  });
  return { frames, sockets };
}
type Wire = ReturnType<typeof observeRoomWire>;

const containsUpdate = (frame: Frame, text: string, direction: Frame['direction']) =>
  frame.direction === direction &&
  frame.type === 'yjs-update' &&
  !!frame.update &&
  Buffer.from(frame.update, 'base64').includes(Buffer.from(text));

const paragraphWith = (page: Page, phrase: string) =>
  editor(page).locator('p').filter({ hasText: phrase });

async function targetFirstWord(paragraph: Locator) {
  await paragraph.scrollIntoViewIfNeeded();
  return paragraph.evaluate((element) => {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
    if (!(text instanceof Text) || !text.data.length) throw new Error('Expected editable text.');
    const word = text.data.split(/\s/u)[0];
    if (!word) throw new Error('Expected a leading word.');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, word.length);
    const rect = range.getBoundingClientRect();
    return {
      left: rect.left,
      centerX: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      word,
    };
  });
}

async function richBody(page: Page) {
  return editor(page).evaluate((root) => {
    const clean = root.cloneNode(true) as HTMLElement;
    clean
      .querySelectorAll('.ProseMirror-widget, .ProseMirror-trailingBreak')
      .forEach((node) => node.remove());
    clean
      .querySelectorAll('.ProseMirror-selectednode')
      .forEach((node) => node.classList.remove('ProseMirror-selectednode'));
    return clean.innerHTML;
  });
}

async function realNetworkLatency(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 1_500,
    downloadThroughput: 625_000,
    uploadThroughput: 625_000,
  });
  return async () => {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await cdp.detach();
  };
}

export async function exerciseOverlappingEdits(input: {
  owner: Page;
  member: Page;
  ownerWire: Wire;
  memberWire: Wire;
  ownerLine: string;
  memberLine: string;
  testInfo: TestInfo;
}) {
  const { owner, member, ownerWire, memberWire, ownerLine, memberLine, testInfo } = input;
  const ownerInsert = 'First concurrent insertion. ';
  const memberInsert = 'Second concurrent insertion. ';
  const ownerParagraph = paragraphWith(owner, ownerLine);
  const memberParagraph = paragraphWith(member, memberLine);
  await owner.bringToFront();
  const richWord = await targetFirstWord(ownerParagraph);
  await owner.mouse.dblclick(richWord.centerX, richWord.y);
  await expect.poll(() => owner.evaluate(() => getSelection()?.toString())).toBe(richWord.word);
  await owner.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(ownerParagraph.locator('strong')).toHaveText(richWord.word);
  await expect(paragraphWith(member, ownerLine).locator('strong')).toHaveText(richWord.word);
  for (const page of [owner, member]) {
    await expect(sync(page)).toHaveAttribute('data-state', 'saved');
  }

  const restoreLatency = await Promise.all([realNetworkLatency(owner), realNetworkLatency(member)]);
  const ordering: Array<{ editor: string; sentIndex: number; peerReceivedIndex: number }> = [];
  const ownerCursor = await targetFirstWord(ownerParagraph);
  const memberCursor = await targetFirstWord(memberParagraph);
  try {
    // Mouse selection and browser keyboard insertion exercise the editor's normal event path.
    await owner.mouse.click(ownerCursor.left + 1, ownerCursor.y);
    await member.mouse.click(memberCursor.left + 1, memberCursor.y);
    const ownerStart = ownerWire.frames.length;
    const memberStart = memberWire.frames.length;
    await Promise.all([
      owner.keyboard.insertText(ownerInsert),
      member.keyboard.insertText(memberInsert),
    ]);
    for (const [actor, wire, start, local, remote] of [
      ['owner', ownerWire, ownerStart, ownerInsert, memberInsert],
      ['member', memberWire, memberStart, memberInsert, ownerInsert],
    ] as const) {
      const readOrdering = () => {
        const frames = wire.frames.slice(start);
        return {
          sentIndex: frames.findIndex((frame) => containsUpdate(frame, local, 'sent')),
          peerReceivedIndex: frames.findIndex((frame) => containsUpdate(frame, remote, 'received')),
        };
      };
      await expect
        .poll(() => {
          const { sentIndex, peerReceivedIndex } = readOrdering();
          return sentIndex >= 0 && peerReceivedIndex > sentIndex;
        })
        .toBe(true);
      ordering.push({ editor: actor, ...readOrdering() });
    }
  } finally {
    await Promise.all(restoreLatency.map((restore) => restore()));
  }

  for (const page of [owner, member]) {
    await expect(paragraphWith(page, ownerLine)).toHaveText(ownerInsert + ownerLine);
    await expect(paragraphWith(page, memberLine)).toHaveText(memberInsert + memberLine);
    await expect(paragraphWith(page, ownerLine).locator('strong')).toContainText(richWord.word);
    await expect(sync(page)).toHaveAttribute('data-state', 'saved');
  }
  const expected = await richBody(owner);
  expect(await richBody(member)).toBe(expected);
  await member.screenshot({ path: testInfo.outputPath('overlapping-edits-converged.png') });
  await writeFile(
    testInfo.outputPath('overlapping-edit-frame-order.json'),
    JSON.stringify(ordering, null, 2),
  );
  return expected;
}

export async function expectConvergedRichBody(page: Page, expected: string) {
  await expect.poll(() => richBody(page)).toBe(expected);
}

const OFFLINE_NOTE = 'Offline note: Capture feedback after the pilot.';
const ONLINE_PEER_PROBE = 'The connected editor kept writing.';

export async function appendBrowserParagraph(page: Page, text: string) {
  await page.bringToFront();
  const paragraph = editor(page).locator('p').last();
  await paragraph.scrollIntoViewIfNeeded();
  const tail = await paragraph.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let tail: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Text && node.length > 0) tail = node;
    }
    if (!tail) throw new Error('Expected a populated last paragraph.');
    const range = document.createRange();
    range.setStart(tail, tail.length - 1);
    range.setEnd(tail, tail.length);
    const rect = range.getBoundingClientRect();
    return { x: rect.right + 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(tail.x, tail.y);
  await expect
    .poll(() =>
      paragraph.evaluate((element) => {
        const selection = window.getSelection();
        if (!selection?.anchorNode || !element.contains(selection.anchorNode)) return false;
        const after = document.createRange();
        after.setStart(selection.anchorNode, selection.anchorOffset);
        after.setEnd(element, element.childNodes.length);
        return !after.toString();
      }),
    )
    .toBe(true);
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(text);
  await expect(editor(page).locator('p').last()).toHaveText(text);
}

export async function exerciseBrowserNetworkRecovery(input: {
  owner: Page;
  member: Page;
  memberWire: Wire;
  testInfo: TestInfo;
}) {
  const { owner, member, memberWire, testInfo } = input;
  const before = await richBody(member);
  const context = member.context();
  const live = memberWire.sockets.filter((socket) => !socket.isClosed()).at(-1);
  expect(
    live,
    'the browser should own an authenticated room socket before the outage',
  ).toBeDefined();
  await context.setOffline(true);
  const started = performance.now();
  let socketClosed = false;
  let peerFrameDeliveredWhileOffline = false;
  let wroteOffline = false;
  const framesBefore = memberWire.frames.length;
  const httpFails = () =>
    member.evaluate(async () => {
      try {
        await fetch('/api/account/session', { cache: 'no-store' });
        return false;
      } catch {
        return true;
      }
    });
  try {
    await expect.poll(() => member.evaluate(() => navigator.onLine)).toBe(false);
    expect(
      await httpFails(),
      'actual same-origin HTTP should fail while the browser is offline',
    ).toBe(true);
    try {
      await expect.poll(() => live?.isClosed(), { timeout: 4_000 }).toBe(true);
    } catch {
      // Check whether the established socket still transports real peer edits
      // during the network control, rather than relying on its close signal alone.
      await appendBrowserParagraph(owner, ONLINE_PEER_PROBE);
      try {
        await expect
          .poll(
            () =>
              memberWire.frames
                .slice(framesBefore)
                .some((frame) => containsUpdate(frame, ONLINE_PEER_PROBE, 'received')),
            { timeout: 4_000 },
          )
          .toBe(true);
        await expect(paragraphWith(member, ONLINE_PEER_PROBE)).toHaveText(ONLINE_PEER_PROBE, {
          timeout: 2_000,
        });
        peerFrameDeliveredWhileOffline = true;
      } catch {
        // The original close check is repeated before claiming anything about recovery.
      }
    }

    socketClosed = live?.isClosed() === true;
    if (socketClosed) {
      await expect(sync(member)).toHaveAttribute('data-state', /^(reconnecting|offline)$/u);
      await expect(sync(owner)).toHaveAttribute('data-state', 'saved');
      if (await editor(member).isEditable()) {
        await appendBrowserParagraph(member, OFFLINE_NOTE);
        await expect(paragraphWith(owner, OFFLINE_NOTE)).toHaveCount(0);
        expect(
          memberWire.frames
            .slice(framesBefore)
            .some((frame) => containsUpdate(frame, OFFLINE_NOTE, 'sent')),
        ).toBe(false);
        wroteOffline = true;
      } else {
        expect(await richBody(member)).toBe(before);
        testInfo.annotations.push({
          type: 'J06 offline editing unavailable',
          description: 'The editor preserved its body during the outage. Editing was disabled.',
        });
      }
      await member.screenshot({ path: testInfo.outputPath('actual-browser-offline.png') });
    }
    const remaining = 15_000 - (performance.now() - started);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    expect(await httpFails()).toBe(true);
  } finally {
    await context.setOffline(false);
  }

  await expect.poll(() => member.evaluate(() => navigator.onLine)).toBe(true);
  const retry = member.getByTestId('sync-retry-button');
  if (await retry.isVisible()) await retry.click();
  await expect(sync(member)).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
  if (socketClosed) {
    expect(memberWire.sockets.some((socket) => socket !== live && !socket.isClosed())).toBe(true);
    expect(
      memberWire.frames
        .slice(framesBefore)
        .some(
          (frame) => frame.type === 'room-hydration-complete' && frame.direction === 'received',
        ),
    ).toBe(true);
  } else {
    testInfo.annotations.push({
      type: 'J06 offline unverified',
      description:
        'Browser offline mode blocked HTTP but the test could not establish a room WebSocket outage.',
    });
  }
  if (wroteOffline) {
    await expect(paragraphWith(owner, OFFLINE_NOTE)).toHaveCount(1);
    await expect
      .poll(() => {
        const frames = memberWire.frames.slice(framesBefore);
        const submitted = frames.find((frame) => containsUpdate(frame, OFFLINE_NOTE, 'sent'));
        return (
          !!submitted?.updateId &&
          frames.some(
            (frame) =>
              frame.direction === 'received' &&
              frame.type === 'sync-ack' &&
              frame.updateId === submitted.updateId,
          )
        );
      })
      .toBe(true);
  }
  const expected = await richBody(owner);
  await expectConvergedRichBody(member, expected);
  await Promise.all([owner.reload(), member.reload()]);
  for (const page of [owner, member]) {
    await expectConvergedRichBody(page, expected);
    await expect(paragraphWith(page, OFFLINE_NOTE)).toHaveCount(wroteOffline ? 1 : 0);
  }
  await member.screenshot({ path: testInfo.outputPath('browser-network-check-after-reload.png') });
  const verdict = wroteOffline
    ? 'queued-edit-acknowledged'
    : socketClosed
      ? 'offline-editing-unavailable'
      : 'inconclusive';
  await writeFile(
    testInfo.outputPath('network-outage-observation.json'),
    JSON.stringify(
      {
        verdict,
        browserHttpBlocked: true,
        heldOfflineForAtLeast15Seconds: true,
        roomSocketClosedDuringEditCheck: socketClosed,
        peerFrameDeliveredWhileOffline,
        bothReloadedWithSameRichBody: true,
      },
      null,
      2,
    ),
  );
  return verdict;
}

export async function exerciseRealWorkerRestart(input: {
  owner: Page;
  member: Page;
  ownerWire: Wire;
  memberWire: Wire;
  testInfo: TestInfo;
}) {
  const { owner, member, ownerWire, memberWire, testInfo } = input;
  const lives = [ownerWire, memberWire].map((wire) =>
    wire.sockets.filter((socket) => !socket.isClosed()).at(-1),
  );
  expect(lives.every(Boolean), 'both accounts must have a live authenticated socket').toBe(true);
  const before = await richBody(member);
  await expectConvergedRichBody(owner, before);
  const queuedFrom = memberWire.frames.length;
  await writeFile(
    testInfo.outputPath('worker-restart-ready.json'),
    JSON.stringify({
      bothHydrated: true,
      expectedAction: 'stop-owned-worker-with-state-retained',
    }),
  );

  await expect
    .poll(() => lives.every((socket) => socket?.isClosed()), { timeout: 100_000 })
    .toBe(true);
  for (const page of [owner, member]) {
    await expect(sync(page)).toHaveAttribute('data-state', /^(reconnecting|offline)$/u);
    await expectConvergedRichBody(page, before);
  }

  const wroteOffline = await editor(member).isEditable();
  if (wroteOffline) {
    await appendBrowserParagraph(member, OFFLINE_NOTE);
    await expect(paragraphWith(owner, OFFLINE_NOTE)).toHaveCount(0);
    expect(
      memberWire.frames
        .slice(queuedFrom)
        .some((frame) => containsUpdate(frame, OFFLINE_NOTE, 'sent')),
    ).toBe(false);
  } else {
    await expectConvergedRichBody(member, before);
  }
  await member.screenshot({ path: testInfo.outputPath('worker-offline-visible-state.png') });
  await writeFile(
    testInfo.outputPath('worker-restart-edit-queued.json'),
    JSON.stringify({
      bothSocketsClosed: true,
      memberAuthoredOfflineNote: wroteOffline,
      expectedAction: 'restart-owned-worker-with-state-retained',
    }),
  );

  for (const [page, wire, live] of [
    [owner, ownerWire, lives[0]],
    [member, memberWire, lives[1]],
  ] as const) {
    const retry = page.getByTestId('sync-retry-button');
    await expect
      .poll(
        async () => {
          if (wire.sockets.some((socket) => socket !== live && !socket.isClosed())) return true;
          if (await retry.isVisible()) await retry.click();
          return false;
        },
        { timeout: 100_000, intervals: [500, 1_000, 2_000, 3_000] },
      )
      .toBe(true);
    await expect(sync(page)).toHaveAttribute('data-state', 'saved');
  }

  if (wroteOffline) {
    await expect(paragraphWith(owner, OFFLINE_NOTE)).toHaveCount(1);
    await expect
      .poll(() => {
        const frames = memberWire.frames.slice(queuedFrom);
        const sent = frames.find((frame) => containsUpdate(frame, OFFLINE_NOTE, 'sent'));
        return (
          !!sent?.updateId &&
          frames.some(
            (frame) =>
              frame.direction === 'received' &&
              frame.type === 'sync-ack' &&
              frame.updateId === sent.updateId,
          )
        );
      })
      .toBe(true);
  }

  const expected = await richBody(owner);
  await expectConvergedRichBody(member, expected);
  await Promise.all([owner.reload(), member.reload()]);
  for (const page of [owner, member]) {
    await expectConvergedRichBody(page, expected);
    await expect(paragraphWith(page, OFFLINE_NOTE)).toHaveCount(wroteOffline ? 1 : 0);
  }
  await member.screenshot({ path: testInfo.outputPath('worker-recovered-after-reload.png') });
  await writeFile(
    testInfo.outputPath('worker-restart-verdict.json'),
    JSON.stringify(
      {
        verdict: wroteOffline ? 'queued-edit-acknowledged' : 'offline-editing-unavailable',
        scope: 'both-browser-sockets-closed-by-actual-local-worker-restart',
        bothReloadedWithSameRichBody: true,
      },
      null,
      2,
    ),
  );
}
