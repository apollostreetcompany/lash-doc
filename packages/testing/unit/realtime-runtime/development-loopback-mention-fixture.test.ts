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

    await waitForDevelopmentLoopbackWorker(worker.asLifecycle(), 'http://127.0.0.1/health', {
      fetchFn,
      pollIntervalMs: 0,
      sleepFn: immediateSleep,
      timeoutMs: 1_000,
    });

    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(worker.listenerCount('error')).toBe(0);
    expect(worker.listenerCount('exit')).toBe(0);
  });

  it('fails immediately when the child exits before a hanging health request completes', async () => {
    const worker = new FakeWorker();
    const waiting = waitForDevelopmentLoopbackWorker(
      worker.asLifecycle(),
      'http://127.0.0.1/health',
      {
        fetchFn: vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined)),
        timeoutMs: 30_000,
      },
    );

    worker.exitCode = 17;
    worker.emit('exit', 17, null);

    await expect(waiting).rejects.toThrow(/exited before readiness.*17/i);
    expect(worker.listenerCount('error')).toBe(0);
    expect(worker.listenerCount('exit')).toBe(0);
  });

  it('fails immediately when the child emits a startup error', async () => {
    const worker = new FakeWorker();
    const waiting = waitForDevelopmentLoopbackWorker(
      worker.asLifecycle(),
      'http://127.0.0.1/health',
      {
        fetchFn: vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined)),
        timeoutMs: 30_000,
      },
    );

    worker.emit('error', new Error('spawn failed'));

    await expect(waiting).rejects.toThrow(/startup error.*spawn failed/i);
    expect(worker.listenerCount('error')).toBe(0);
    expect(worker.listenerCount('exit')).toBe(0);
  });

  it('adds an injectable collision-resistant nonce instead of deriving the document solely from the port', () => {
    expect(createSyntheticMentionDocumentId(4312, 'run-a')).toBe('mention-fixture-4312-run-a');
    expect(createSyntheticMentionDocumentId(4312, 'run-b')).toBe('mention-fixture-4312-run-b');
  });
});
