#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.LASH_REALTIME_PORT ?? '8787');
const roomId = process.env.LASH_REALTIME_ROOM ?? 'bead-28-health';
const baseUrl = `http://127.0.0.1:${port}`;
const workerConfig = path.join(repoRoot, 'packages/realtime-worker/wrangler.jsonc');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const assertPortFree = () => {
  const result = spawnSync('lsof', ['-n', '-P', `-iTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  if (result.status === 0) {
    throw new Error(
      `Port ${port} is already in use. Stop that service or set LASH_REALTIME_PORT.\\n${result.stdout}`,
    );
  }
};

const waitForHealth = async () => {
  const deadline = Date.now() + 30_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/realtime/health`);
      if (response.ok) {
        return response.json();
      }
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Realtime health check did not become ready: ${lastError}`);
};

const requestSessionToken = async () => {
  const response = await fetch(
    `${baseUrl}/api/realtime/rooms/${roomId}/session?actorId=verify-runtime`,
  );
  if (!response.ok) {
    throw new Error(`Realtime session grant failed: ${response.status} ${response.statusText}`);
  }
  const body = await response.json();
  if (!body?.ok || typeof body.accessToken !== 'string') {
    throw new Error('Realtime session grant did not return an access token');
  }
  return body.accessToken;
};

const verifyDeniedWithoutToken = async () => {
  const response = await fetch(`${baseUrl}/api/realtime/rooms/${roomId}/health`);
  if (response.status !== 403) {
    throw new Error(`Room health without token should be denied, got ${response.status}`);
  }
  return response.json();
};

const verifyRoomHealth = async (accessToken) => {
  const response = await fetch(
    `${baseUrl}/api/realtime/rooms/${roomId}/health?accessToken=${encodeURIComponent(accessToken)}`,
  );
  if (!response.ok) {
    throw new Error(`Room health failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

const verifyWebSocket = async (accessToken) =>
  new Promise((resolve, reject) => {
    const url = `${baseUrl.replace('http:', 'ws:')}/api/realtime/rooms/${roomId}/socket?accessToken=${encodeURIComponent(accessToken)}`;
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out waiting for realtime WebSocket pong'));
    }, 10_000);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'ping', requestId: 'verify-realtime-runtime' }));
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === 'pong' && message.requestId === 'verify-realtime-runtime') {
        clearTimeout(timeout);
        socket.close(1000, 'verified');
        resolve(message);
      }
    });

    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Realtime WebSocket connection failed'));
    });
  });

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
  [
    'exec',
    'wrangler',
    'dev',
    '--config',
    workerConfig,
    '--local',
    '--port',
    String(port),
    '--log-level',
    'error',
  ],
  {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

try {
  const serviceHealth = await waitForHealth();
  const deniedWithoutToken = await verifyDeniedWithoutToken();
  const accessToken = await requestSessionToken();
  const roomHealth = await verifyRoomHealth(accessToken);
  const socketResult = await verifyWebSocket(accessToken);
  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        deniedWithoutToken,
        serviceHealth,
        roomHealth,
        socketResult,
      },
      null,
      2,
    ),
  );
} finally {
  await stopProcess(child);
}
