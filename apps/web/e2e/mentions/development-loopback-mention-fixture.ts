import { expect, test as base, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';

type MentionFixtures = {
  openSyntheticMentionFixture(page: Page, documentId?: string): Promise<void>;
};

const reserveLoopbackPort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a loopback port for the mention fixture.'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });

export interface SyntheticMentionWorkerLifecycle {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
  off(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
}

interface SyntheticMentionWorkerWaitOptions {
  fetchFn?: typeof fetch;
  pollIntervalMs?: number;
  sleepFn?: (milliseconds: number) => Promise<unknown>;
  timeoutMs?: number;
}

const isLashRealtimeHealth = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const health = value as Record<string, unknown>;
  if (!health.runtime || typeof health.runtime !== 'object' || Array.isArray(health.runtime)) {
    return false;
  }
  const runtime = health.runtime as Record<string, unknown>;
  return (
    health.ok === true &&
    health.service === 'lash-realtime' &&
    runtime.provider === 'cloudflare' &&
    runtime.coordination === 'durable-object-room' &&
    runtime.transport === 'websocket'
  );
};

export const createSyntheticMentionDocumentId = (port: number, nonce = randomUUID()) =>
  `mention-fixture-${port}-${nonce}`;

export const waitForSyntheticMentionWorker = async (
  worker: SyntheticMentionWorkerLifecycle,
  healthUrl: string,
  {
    fetchFn = fetch,
    pollIntervalMs = 250,
    sleepFn = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMs = 30_000,
  }: SyntheticMentionWorkerWaitOptions = {},
) => {
  let lastError = 'no valid health response';
  let rejectLifecycle: ((error: Error) => void) | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const lifecycleFailure = new Promise<never>((_, reject) => {
    rejectLifecycle = reject;
  });
  const handleError = (error: Error) => {
    rejectLifecycle?.(
      new Error(`Synthetic mention Worker startup error: ${error.message}`, { cause: error }),
    );
  };
  const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
    const outcome = code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`;
    rejectLifecycle?.(new Error(`Synthetic mention Worker exited before readiness (${outcome}).`));
  };

  worker.once('error', handleError);
  worker.once('exit', handleExit);

  const timeoutFailure = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Synthetic mention Worker did not become ready: ${lastError}`));
    }, timeoutMs);
  });

  try {
    if (worker.exitCode !== null || worker.signalCode !== null) {
      handleExit(worker.exitCode, worker.signalCode);
    }

    while (true) {
      const ready = await Promise.race([
        (async () => {
          try {
            const response = await fetchFn(healthUrl);
            if (!response.ok) {
              lastError = `${response.status} ${response.statusText}`;
              return false;
            }
            const payload = await response.json();
            if (!isLashRealtimeHealth(payload)) {
              lastError = `${response.status} returned a non-Lash health payload`;
              return false;
            }
            return true;
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            return false;
          }
        })(),
        lifecycleFailure,
        timeoutFailure,
      ]);
      if (ready) return;
      await Promise.race([sleepFn(pollIntervalMs), lifecycleFailure, timeoutFailure]);
    }
  } finally {
    worker.off('error', handleError);
    worker.off('exit', handleExit);
    if (timeout !== null) clearTimeout(timeout);
  }
};

const stopWorker = async (worker: ChildProcess | null) => {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  worker.kill('SIGTERM');
  const timeout = setTimeout(() => worker.kill('SIGKILL'), 5_000);
  await once(worker, 'exit').catch(() => undefined);
  clearTimeout(timeout);
};

/**
 * Explicit browser fixture for synthetic mention identities.
 *
 * Each test gets a private exact-loopback Worker. This is mechanics coverage,
 * not evidence of a real collaborator directory or configured production
 * collaboration.
 */
export const test = base.extend<MentionFixtures>({
  openSyntheticMentionFixture: async ({}, provideFixture) => {
    let worker: ChildProcess | null = null;
    try {
      await provideFixture(async (page, documentId) => {
        if (worker)
          throw new Error('The synthetic mention fixture may only be opened once per test.');
        const port = await reserveLoopbackPort();
        const fixtureDocumentId = documentId ?? createSyntheticMentionDocumentId(port);
        const socketBaseUrl = `ws://127.0.0.1:${port}`;
        worker = spawn(
          'pnpm',
          [
            'exec',
            'wrangler',
            'dev',
            '--config',
            'packages/realtime-worker/wrangler.jsonc',
            '--local',
            '--port',
            String(port),
            '--log-level',
            'error',
          ],
          {
            cwd: process.cwd(),
            env: { ...process.env, NO_COLOR: '1' },
            stdio: ['ignore', 'ignore', 'pipe'],
          },
        );
        worker.stderr?.on('data', (chunk) => process.stderr.write(chunk));
        await waitForSyntheticMentionWorker(worker, `http://127.0.0.1:${port}/api/realtime/health`);

        await page.addInitScript(
          ({ fixtureDocumentId: initDocumentId, fixtureSocketBaseUrl }) => {
            window.localStorage.setItem('lash:realtime-enabled', 'true');
            window.localStorage.setItem('lash:realtime-url', fixtureSocketBaseUrl);
            window.localStorage.setItem('lash:actor-id', 'mention-fixture-owner');
            (
              window as Window & {
                __lashMentionFixture?: {
                  version: 1;
                  kind: 'synthetic-mention-identities';
                  documentId: string;
                };
              }
            ).__lashMentionFixture = {
              version: 1,
              kind: 'synthetic-mention-identities',
              documentId: initDocumentId,
            };
          },
          {
            fixtureDocumentId,
            fixtureSocketBaseUrl: socketBaseUrl,
          },
        );
        await page.goto(`/doc/${encodeURIComponent(fixtureDocumentId)}?realtime=on`);
        await page.waitForFunction(() =>
          Boolean((window as Window & { __lashEditor?: unknown }).__lashEditor),
        );
        await expect(page.getByTestId('synthetic-mention-fixture')).toBeVisible();
      });
    } finally {
      await stopWorker(worker);
    }
  },
});

export { expect };
