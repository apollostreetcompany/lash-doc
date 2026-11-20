import { test as base, type Page, type BrowserContext } from '@playwright/test';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

export interface DevelopmentLoopbackWorker {
  port: number;
  httpBaseUrl: string;
  socketBaseUrl: string;
}

const loopbackHost = '127.0.0.1';

const getWranglerReadyPort = (message: unknown): number | undefined => {
  if (typeof message !== 'string') return;
  try {
    const ready = JSON.parse(message);
    if (
      ready?.event === 'DEV_SERVER_READY' &&
      ready.ip === loopbackHost &&
      Number.isInteger(ready.port) &&
      ready.port > 0 &&
      ready.port <= 65535
    ) {
      return ready.port;
    }
  } catch {
    // Ignore other IPC messages while waiting for Wrangler's bound loopback endpoint.
  }
};

export interface DevelopmentLoopbackWorkerLifecycle {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
  off(event: 'message', listener: (message: unknown) => void): unknown;
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
  {
    fetchFn = fetch,
    pollIntervalMs = 250,
    sleepFn = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMs = 30_000,
  }: DevelopmentLoopbackWorkerWaitOptions = {},
): Promise<DevelopmentLoopbackWorker> => {
  let lastError = 'no Wrangler loopback readiness message';
  let resolvePort: (port: number) => void;
  const boundPort = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });
  const handleMessage = (message: unknown) => {
    const port = getWranglerReadyPort(message);
    if (port !== undefined) resolvePort(port);
  };
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

  worker.on('message', handleMessage);
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

    const port = await Promise.race([boundPort, lifecycleFailure, timeoutFailure]);
    const httpBaseUrl = `http://${loopbackHost}:${port}`;
    const socketBaseUrl = `ws://${loopbackHost}:${port}`;
    const healthUrl = `${httpBaseUrl}/api/realtime/health`;
    lastError = 'no valid health response';

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
      if (ready) return { port, httpBaseUrl, socketBaseUrl };
      await Promise.race([sleepFn(pollIntervalMs), lifecycleFailure, timeoutFailure]);
    }
  } finally {
    worker.off('message', handleMessage);
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
  // Fork Wrangler's CLI entry directly so we own the process and receive DEV_SERVER_READY.
  const worker = fork(
    require.resolve('wrangler'),
    [
      'dev',
      '--config',
      'packages/realtime-worker/wrangler.jsonc',
      '--local',
      '--ip',
      loopbackHost,
      '--port',
      '0',
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
      execArgv: ['--no-warnings', '--experimental-vm-modules'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  worker.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  try {
    await provideWorker(await waitForDevelopmentLoopbackWorker(worker));
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
