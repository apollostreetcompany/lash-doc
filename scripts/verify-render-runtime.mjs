#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? '3100');
const baseUrl = `http://127.0.0.1:${port}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const assertPortFree = () => {
  const result = spawnSync('lsof', ['-n', '-P', `-iTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  if (result.status === 0) {
    throw new Error(`Port ${port} is already in use. Stop that service or set RENDER_VERIFY_PORT.`);
  }
};

const waitForOk = async (pathname) => {
  const deadline = Date.now() + 45_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'manual' });
      if (response.ok) {
        return {
          pathname,
          status: response.status,
          contentType: response.headers.get('content-type'),
        };
      }
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`${pathname} did not become ready: ${lastError}`);
};

const stopProcess = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
  await once(child, 'exit').catch(() => undefined);
  clearTimeout(timeout);
};

assertPortFree();

const child = spawn(
  'pnpm',
  ['--filter', '@lash/web', 'exec', 'next', 'start', '-H', '0.0.0.0', '-p', String(port)],
  {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let startupLog = '';
child.stdout.on('data', (chunk) => {
  startupLog += String(chunk);
});
child.stderr.on('data', (chunk) => {
  startupLog += String(chunk);
});

try {
  const home = await waitForOk('/');
  const dynamicDoc = await waitForOk('/doc/render-smoke');
  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        command: `pnpm --filter @lash/web exec next start -H 0.0.0.0 -p ${port}`,
        checks: [home, dynamicDoc],
      },
      null,
      2,
    ),
  );
} catch (error) {
  process.stderr.write(startupLog);
  throw error;
} finally {
  await stopProcess(child);
}
