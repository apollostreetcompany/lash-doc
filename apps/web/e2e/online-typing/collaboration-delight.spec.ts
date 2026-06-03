import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

type LashTestWindow = Window & {
  __lashEditor?: unknown;
  __lashRealtime?: {
    disconnectForTest: () => void;
    reconnectForTest: () => void;
    getSnapshot: () => { syncState: string };
  };
};

const REALTIME_PORT = 8788;
const REALTIME_INSPECTOR_PORT = 9230;
const REALTIME_HEALTH_URL = `http://127.0.0.1:${REALTIME_PORT}/api/realtime/health`;

let realtimeWorker: ChildProcess | null = null;

const assertRealtimePortFree = () => {
  const result = spawnSync('lsof', ['-n', '-P', `-iTCP:${REALTIME_PORT}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  if (result.status === 0) {
    throw new Error(`Realtime test port ${REALTIME_PORT} is already in use:\n${result.stdout}`);
  }
};

const waitForRealtimeWorker = async () => {
  const deadline = Date.now() + 30_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(REALTIME_HEALTH_URL);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Realtime worker did not become ready: ${lastError}`);
};

const startRealtimeWorker = async () => {
  assertRealtimePortFree();
  realtimeWorker = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--config',
      'packages/realtime-worker/wrangler.jsonc',
      '--local',
      '--port',
      String(REALTIME_PORT),
      '--inspector-port',
      String(REALTIME_INSPECTOR_PORT),
      '--log-level',
      'error',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  realtimeWorker.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  await waitForRealtimeWorker();
};

const stopRealtimeWorker = async () => {
  const worker = realtimeWorker;
  realtimeWorker = null;
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  worker.kill('SIGTERM');
  const timeout = setTimeout(() => worker.kill('SIGKILL'), 5_000);
  await once(worker, 'exit').catch(() => undefined);
  clearTimeout(timeout);
};

const enableLocalRealtime = (context: BrowserContext, actorId: string) =>
  context.addInitScript(
    ({ nextActorId, realtimeUrl }) => {
      window.localStorage.setItem('lash:realtime-enabled', 'true');
      window.localStorage.setItem('lash:realtime-url', realtimeUrl);
      window.localStorage.setItem('lash:actor-id', nextActorId);
    },
    { nextActorId: actorId, realtimeUrl: `ws://127.0.0.1:${REALTIME_PORT}` },
  );

const waitForEditor = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as LashTestWindow).__lashEditor));
  await expect(page.locator('.ProseMirror')).toBeVisible();
};

const realtimeSnapshot = (page: Page) =>
  page.evaluate(() => {
    const api = (window as LashTestWindow).__lashRealtime;
    if (!api) throw new Error('Realtime test API unavailable');
    return api.getSnapshot();
  });

test.describe.configure({ mode: 'serial' });

test.describe('collaboration delight', () => {
  test.beforeAll(startRealtimeWorker);
  test.afterAll(stopRealtimeWorker);

  test('first-run collaboration state can open invite flow', async ({ browser }) => {
    const context = await browser.newContext();
    await enableLocalRealtime(context, 'delight-owner');
    const page = await context.newPage();
    await page.goto(`/doc/bead-36-first-run-${Date.now()}`);
    await waitForEditor(page);

    await expect(page.getByTestId('collaboration-empty-state')).toContainText('Ready');
    await page.getByTestId('collaboration-share-shortcut').click();
    await expect(page.getByTestId('share-panel')).toBeVisible();
    await expect(page.getByTestId('invite-email-input')).toBeVisible();

    await context.close();
  });

  test('reconnect feedback includes a retry action', async ({ browser }) => {
    const context = await browser.newContext();
    await enableLocalRealtime(context, 'delight-retry');
    const page = await context.newPage();
    await page.goto(`/doc/bead-36-retry-${Date.now()}`);
    await waitForEditor(page);
    await expect.poll(() => realtimeSnapshot(page)).toMatchObject({ syncState: 'saved' });

    await page.evaluate(() => {
      const api = (window as LashTestWindow).__lashRealtime;
      if (!api) throw new Error('Realtime test API unavailable');
      api.disconnectForTest();
    });
    await expect(page.getByTestId('sync-feedback')).toContainText('Reconnecting');
    await expect(page.getByTestId('sync-retry-button')).toBeVisible();

    await page.getByTestId('sync-retry-button').click();
    await expect.poll(() => realtimeSnapshot(page)).toMatchObject({ syncState: 'saved' });
    await expect(page.getByTestId('sync-feedback')).toContainText('Saved');

    await context.close();
  });
});
