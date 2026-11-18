import { expect, type Locator, type Page, type TestInfo, type WebSocket } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { selectDiscussionTab } from '../discussion-tabs';

const editor = (page: Page) =>
  page.getByRole('region', { name: 'Writing canvas' }).locator('.tiptap');
const sync = (page: Page) => page.getByTestId('realtime-sync-state');

type Frame = {
  direction: 'sent' | 'received';
  type: string;
  update?: string;
  updateId?: string;
};

type Wire = { frames: Frame[]; sockets: WebSocket[] };
const roomWires = new WeakMap<Page, Wire>();

export function observeRoomWire(page: Page) {
  const existing = roomWires.get(page);
  if (existing) return existing;

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
  const wire = { frames, sockets };
  roomWires.set(page, wire);
  return wire;
}

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
  const body = editor(page);
  const paragraphs = body.locator(':scope > p');
  const originalCount = await paragraphs.count();
  const originalTail = paragraphs.nth(originalCount - 1);
  const originalText = await originalTail.textContent();
  const settledCaret = (paragraph: Locator, atEnd: boolean) =>
    paragraph.evaluate(async (element, requireEnd) => {
      // The editor reconciles the DOM selection on animation frames after focus or navigation.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const selection = window.getSelection();
      if (
        document.activeElement !== element.parentElement ||
        !selection?.isCollapsed ||
        !selection.anchorNode ||
        !element.contains(selection.anchorNode)
      ) {
        return false;
      }
      if (!requireEnd) return true;
      const remainder = document.createRange();
      remainder.setStart(selection.anchorNode, selection.anchorOffset);
      remainder.setEnd(element, element.childNodes.length);
      const content = remainder.cloneContents();
      content.querySelectorAll('.ProseMirror-widget').forEach((widget) => widget.remove());
      return content.textContent === '';
    }, atEnd);

  await expect(body).toBeEditable();
  await originalTail.scrollIntoViewIfNeeded();
  const position = await originalTail.evaluate((paragraph) => {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let tail: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (
        node instanceof Text &&
        node.length &&
        !node.parentElement?.closest('.ProseMirror-widget')
      ) {
        tail = node;
      }
    }
    if (!tail) throw new Error('Expected a populated last paragraph.');
    const range = document.createRange();
    range.setStart(tail, tail.length - 1);
    range.setEnd(tail, tail.length);
    const glyph = range.getBoundingClientRect();
    const bounds = paragraph.getBoundingClientRect();
    return {
      x: glyph.right - bounds.left - Math.min(1, glyph.width / 4),
      y: glyph.top - bounds.top + glyph.height / 2,
    };
  });
  await originalTail.click({ position });
  await expect.poll(() => settledCaret(originalTail, false)).toBe(true);
  const lineEnd = await page.evaluate(() =>
    navigator.platform.startsWith('Mac') ? 'Meta+ArrowRight' : 'End',
  );
  await page.keyboard.press(lineEnd);
  await expect.poll(() => settledCaret(originalTail, true)).toBe(true);

  await page.keyboard.press('Enter');
  const newParagraph = paragraphs.nth(originalCount);
  await expect(paragraphs).toHaveCount(originalCount + 1);
  await expect(originalTail).toHaveText(originalText ?? '');
  await expect(newParagraph).toHaveText('');
  await expect.poll(() => settledCaret(newParagraph, true)).toBe(true);
  await page.keyboard.insertText(text);
  await expect(newParagraph).toHaveText(text);
}

export async function exerciseBrowserNetworkRecovery(input: {
  owner: Page;
  member: Page;
  memberWire: Wire;
  testInfo: TestInfo;
}) {
  const { owner, member, memberWire, testInfo } = input;
  const outageMs = 15_000;
  const before = await richBody(member);
  const context = member.context();
  const ownerWire = observeRoomWire(owner);
  const ownerSocket = ownerWire.sockets.filter((socket) => !socket.isClosed()).at(-1);
  const memberSocket = memberWire.sockets.filter((socket) => !socket.isClosed()).at(-1);
  if (!ownerSocket || !memberSocket) throw new Error('Expected two authenticated room sockets.');
  const memberSocketClosed = new Promise<number>((resolve) => {
    memberSocket.once('close', () => resolve(performance.now()));
  });
  const updateAcknowledged = (frames: Frame[], text: string) => {
    const submitted = frames.find((frame) => containsUpdate(frame, text, 'sent'));
    return (
      !!submitted?.updateId &&
      frames.some(
        (frame) =>
          frame.direction === 'received' &&
          frame.type === 'sync-ack' &&
          frame.updateId === submitted.updateId,
      )
    );
  };
  let memberSocketClosedAt: number | null = null;
  let ownerAcknowledgedAt: number;
  let peerFrameDeliveredWhileOffline = false;
  let memberQueuedEditAt: number | null = null;
  let heldOfflineMs: number;
  const ownerFramesBefore = ownerWire.frames.length;
  const memberFramesBefore = memberWire.frames.length;
  const httpFails = () =>
    member.evaluate(async () => {
      try {
        await fetch('/api/account/session', { cache: 'no-store' });
        return false;
      } catch {
        return true;
      }
    });
  await context.setOffline(true);
  const started = performance.now();
  const minimumHold = delay(outageMs, null);
  try {
    await expect.poll(() => member.evaluate(() => navigator.onLine)).toBe(false);
    expect(
      await httpFails(),
      'actual same-origin HTTP should fail while the browser is offline',
    ).toBe(true);
    await appendBrowserParagraph(owner, ONLINE_PEER_PROBE);
    await expect
      .poll(() => updateAcknowledged(ownerWire.frames.slice(ownerFramesBefore), ONLINE_PEER_PROBE))
      .toBe(true);
    ownerAcknowledgedAt = performance.now();
    expect(ownerAcknowledgedAt - started).toBeLessThan(outageMs);
    expect(ownerSocket.isClosed()).toBe(false);
    await expect(sync(owner)).toHaveAttribute('data-state', 'saved');
    await owner.screenshot({ path: testInfo.outputPath('owner-saved-during-browser-offline.png') });

    memberSocketClosedAt = await Promise.race([memberSocketClosed, minimumHold]);
    if (memberSocketClosedAt !== null) {
      await expect(sync(member)).toHaveAttribute('data-state', /^(reconnecting|offline)$/u);
      if (await editor(member).isEditable()) {
        await appendBrowserParagraph(member, OFFLINE_NOTE);
        memberQueuedEditAt = performance.now();
      } else {
        expect(await richBody(member)).toBe(before);
        testInfo.annotations.push({
          type: 'J06 offline editing unavailable',
          description: 'The editor preserved its body during the outage. Editing was disabled.',
        });
      }
      await member.screenshot({ path: testInfo.outputPath('actual-browser-offline.png') });
    }
    await minimumHold;
    expect(await httpFails()).toBe(true);
    expect(ownerSocket.isClosed()).toBe(false);
    peerFrameDeliveredWhileOffline = memberWire.frames
      .slice(memberFramesBefore)
      .some((frame) => containsUpdate(frame, ONLINE_PEER_PROBE, 'received'));
    if (memberQueuedEditAt !== null) {
      await expect(paragraphWith(owner, OFFLINE_NOTE)).toHaveCount(0);
      expect(
        memberWire.frames
          .slice(memberFramesBefore)
          .some((frame) => frame.direction === 'sent' && frame.type === 'yjs-update'),
      ).toBe(false);
    }
    heldOfflineMs = performance.now() - started;
    expect(heldOfflineMs).toBeGreaterThanOrEqual(outageMs);
  } finally {
    await context.setOffline(false);
  }

  const healedAt = performance.now();
  await expect.poll(() => member.evaluate(() => navigator.onLine)).toBe(true);
  let usedRetry = false;
  try {
    await expect(sync(member)).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
  } catch {
    await member.getByTestId('sync-retry-button').click();
    usedRetry = true;
    await expect(sync(member)).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
  }
  if (memberSocketClosedAt !== null) {
    expect(memberWire.sockets.some((socket) => socket !== memberSocket && !socket.isClosed())).toBe(
      true,
    );
    expect(
      memberWire.frames
        .slice(memberFramesBefore)
        .some(
          (frame) => frame.type === 'room-hydration-complete' && frame.direction === 'received',
        ),
    ).toBe(true);
  } else {
    testInfo.annotations.push({
      type: 'J06 offline unverified',
      description:
        'Browser offline mode blocked HTTP, but the room socket did not close within 15 seconds.',
    });
  }
  const wroteOffline = memberQueuedEditAt !== null;
  let memberAcknowledgedAfterOnlineMs: number | null = null;
  if (wroteOffline) {
    await expect
      .poll(() => updateAcknowledged(memberWire.frames.slice(memberFramesBefore), OFFLINE_NOTE))
      .toBe(true);
    memberAcknowledgedAfterOnlineMs = performance.now() - healedAt;
    await expect(paragraphWith(owner, OFFLINE_NOTE)).toHaveText(OFFLINE_NOTE);
  }
  await expect(paragraphWith(member, ONLINE_PEER_PROBE)).toHaveText(ONLINE_PEER_PROBE);
  const expected = await richBody(owner);
  await expectConvergedRichBody(member, expected);
  const richBodyConvergedAfterOnlineMs = performance.now() - healedAt;
  await Promise.all([owner.reload(), member.reload()]);
  for (const page of [owner, member]) {
    await expectConvergedRichBody(page, expected);
    await expect(paragraphWith(page, ONLINE_PEER_PROBE)).toHaveText(ONLINE_PEER_PROBE);
    await expect(paragraphWith(page, OFFLINE_NOTE)).toHaveCount(wroteOffline ? 1 : 0);
    await selectDiscussionTab(page, 'history');
    const version = page
      .getByRole('region', { name: 'Shared version history' })
      .getByRole('combobox', { name: 'Version', exact: true });
    await expect(version.getByRole('option', { name: /^History started/u })).toHaveCount(1);
    await expect(version.getByRole('option', { name: /^Restored version/u })).toHaveCount(2);
  }
  await member.screenshot({ path: testInfo.outputPath('browser-network-check-after-reload.png') });
  let verdict = 'inconclusive';
  if (memberSocketClosedAt !== null) {
    verdict = wroteOffline ? 'queued-edit-acknowledged' : 'offline-editing-unavailable';
  }
  await writeFile(
    testInfo.outputPath('network-outage-observation.json'),
    JSON.stringify(
      {
        verdict,
        browserHttpBlocked: true,
        heldOfflineMs,
        ownerAcknowledgedDuringCutMs: ownerAcknowledgedAt - started,
        roomSocketClosedDuringCutMs:
          memberSocketClosedAt === null ? null : memberSocketClosedAt - started,
        peerFrameDeliveredWhileOffline,
        memberEditQueuedDuringCutMs:
          memberQueuedEditAt === null ? null : memberQueuedEditAt - started,
        memberAcknowledgedAfterOnlineMs,
        richBodyConvergedAfterOnlineMs,
        recovery: memberSocketClosedAt === null ? null : usedRetry ? 'manual-retry' : 'automatic',
        bothReloadedWithSameRichBody: true,
        bothReloadedWithPriorHistory: true,
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
