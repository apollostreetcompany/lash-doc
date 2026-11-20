import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import {
  waitForDevelopmentLoopbackWorker,
  type DevelopmentLoopbackWorkerLifecycle,
} from '../../../../apps/web/e2e/development-loopback-worker';
import { createSyntheticMentionDocumentId } from '../../../../apps/web/e2e/mentions/development-loopback-mention-fixture';

class FakeWorker extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  asLifecycle(): DevelopmentLoopbackWorkerLifecycle {
    return this;
  }
}

const healthResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const immediateSleep = async () => undefined;
const wranglerReadyMessage = (ip = '127.0.0.1', port = 4312) =>
  JSON.stringify({ event: 'DEV_SERVER_READY', ip, port });

describe('synthetic mention loopback fixture', () => {
  it('accepts readiness only from the Lash realtime semantic health contract', async () => {
    const worker = new FakeWorker();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('healthy', { status: 200 }))
      .mockResolvedValueOnce(healthResponse({ ok: true, service: 'another-service' }))
      .mockResolvedValueOnce(
        healthResponse({
          ok: true,
          service: 'lash-realtime',
          runtime: { provider: 'another-provider' },
        }),
      )
      .mockResolvedValueOnce(
        healthResponse({
          ok: true,
          service: 'lash-realtime',
          runtime: {
            provider: 'cloudflare',
            coordination: 'durable-object-room',
            transport: 'websocket',
          },
        }),
      );

    const waiting = waitForDevelopmentLoopbackWorker(worker.asLifecycle(), {
      fetchFn,
      pollIntervalMs: 0,
      sleepFn: immediateSleep,
      timeoutMs: 1_000,
    });

    worker.emit('message', 'not JSON');
    worker.emit('message', wranglerReadyMessage('0.0.0.0'));
    worker.emit('message', wranglerReadyMessage('127.0.0.1', 0));
    await Promise.resolve();
    expect(fetchFn).not.toHaveBeenCalled();
    worker.emit('message', wranglerReadyMessage());

    await expect(waiting).resolves.toEqual({
      port: 4312,
      httpBaseUrl: 'http://127.0.0.1:4312',
      socketBaseUrl: 'ws://127.0.0.1:4312',
    });
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(fetchFn).toHaveBeenLastCalledWith('http://127.0.0.1:4312/api/realtime/health');
    expect(worker.listenerCount('message')).toBe(0);
    expect(worker.listenerCount('error')).toBe(0);
    expect(worker.listenerCount('exit')).toBe(0);
  });

  it('fails immediately when the child exits before a hanging health request completes', async () => {
    const worker = new FakeWorker();
    const fetchFn = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const waiting = waitForDevelopmentLoopbackWorker(worker.asLifecycle(), { fetchFn });
    worker.emit('message', wranglerReadyMessage());
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    worker.exitCode = 17;
    worker.emit('exit', 17, null);

    await expect(waiting).rejects.toThrow(/exited before readiness.*17/i);
    expect(worker.listenerCount('message')).toBe(0);
    expect(worker.listenerCount('error')).toBe(0);
    expect(worker.listenerCount('exit')).toBe(0);
  });

  it('fails immediately when the child emits a startup error', async () => {
    const worker = new FakeWorker();
    const waiting = waitForDevelopmentLoopbackWorker(worker.asLifecycle());

    worker.emit('error', new Error('spawn failed'));

    await expect(waiting).rejects.toThrow(/startup error.*spawn failed/i);
    expect(worker.listenerCount('message')).toBe(0);
    expect(worker.listenerCount('error')).toBe(0);
    expect(worker.listenerCount('exit')).toBe(0);
  });

  it('times out when the child never reports a ready endpoint', async () => {
    const worker = new FakeWorker();
    const fetchFn = vi.fn<typeof fetch>();

    await expect(
      waitForDevelopmentLoopbackWorker(worker.asLifecycle(), { fetchFn, timeoutMs: 10 }),
    ).rejects.toThrow(/did not become ready.*no Wrangler loopback readiness message/i);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(worker.listenerCount('message')).toBe(0);
  });

  it('adds an injectable collision-resistant nonce instead of deriving the document solely from the port', () => {
    expect(createSyntheticMentionDocumentId(4312, 'run-a')).toBe('mention-fixture-4312-run-a');
    expect(createSyntheticMentionDocumentId(4312, 'run-b')).toBe('mention-fixture-4312-run-b');
  });
});
