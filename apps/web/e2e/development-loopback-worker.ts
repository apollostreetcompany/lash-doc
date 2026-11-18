import { test as base, type Page, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

export interface DevelopmentLoopbackWorker {
  port: number;
  httpBaseUrl: string;
  socketBaseUrl: string;
}

const reserveLoopbackPort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a loopback port for the realtime fixture.'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });

export interface DevelopmentLoopbackWorkerLifecycle {
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

interface DevelopmentLoopbackWorkerWaitOptions {
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

export const waitForDevelopmentLoopbackWorker = async (
  worker: DevelopmentLoopbackWorkerLifecycle,
  healthUrl: string,
  {
    fetchFn = fetch,
    pollIntervalMs = 250,
    sleepFn = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMs = 30_000,
  }: DevelopmentLoopbackWorkerWaitOptions = {},
) => {
  let lastError = 'no valid health response';
  let rejectLifecycle: ((error: Error) => void) | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const lifecycleFailure = new Promise<never>((_, reject) => {
    rejectLifecycle = reject;
  });
  const handleError = (error: Error) => {
    rejectLifecycle?.(
      new Error(`Development loopback Worker startup error: ${error.message}`, { cause: error }),
    );
  };
  const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
    const outcome = code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`;
    rejectLifecycle?.(
      new Error(`Development loopback Worker exited before readiness (${outcome}).`),
    );
  };

  worker.once('error', handleError);
  worker.once('exit', handleExit);

  const timeoutFailure = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Development loopback Worker did not become ready: ${lastError}`));
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
  if (!worker || worker.pid === undefined || worker.exitCode !== null || worker.signalCode !== null)
    return;
  worker.kill('SIGTERM');
  const timeout = setTimeout(() => worker.kill('SIGKILL'), 5_000);
  await once(worker, 'exit').catch(() => undefined);
  clearTimeout(timeout);
};

async function withDevelopmentLoopbackWorker(
  persistPath: string,
  provideWorker: (worker: DevelopmentLoopbackWorker) => Promise<void>,
) {
  const port = await reserveLoopbackPort();
  const httpBaseUrl = `http://127.0.0.1:${port}`;
  const socketBaseUrl = `ws://127.0.0.1:${port}`;
  const worker = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--config',
      'packages/realtime-worker/wrangler.jsonc',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      '0',
      '--persist-to',
      persistPath,
      '--show-interactive-dev-session=false',
      '--log-level',
      'error',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  worker.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  try {
    await waitForDevelopmentLoopbackWorker(worker, `${httpBaseUrl}/api/realtime/health`);
    await provideWorker({ port, httpBaseUrl, socketBaseUrl });
  } finally {
    await stopWorker(worker);
  }
}

export const test = base.extend<{ developmentLoopbackWorker: DevelopmentLoopbackWorker }>({
  developmentLoopbackWorker: async ({}, provideWorker, testInfo) =>
    withDevelopmentLoopbackWorker(testInfo.outputPath('wrangler-state'), provideWorker),
});

export const enableDevelopmentLoopback = (
  target: Page | BrowserContext,
  worker: DevelopmentLoopbackWorker,
  actorId?: string,
) =>
  target.addInitScript(
    ({ socketBaseUrl, actor }) => {
      window.localStorage.setItem('lash:realtime-enabled', 'true');
      window.localStorage.setItem('lash:realtime-url', socketBaseUrl);
      if (actor) window.localStorage.setItem('lash:actor-id', actor);
    },
    { socketBaseUrl: worker.socketBaseUrl, actor: actorId },
  );
