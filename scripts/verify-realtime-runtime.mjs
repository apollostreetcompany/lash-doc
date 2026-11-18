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
  const sessionUrl = new URL(`${baseUrl}/api/realtime/rooms/${roomId}/session`);
  if (sessionUrl.search) {
    throw new Error('Realtime session URL must not contain query parameters');
  }
  const response = await fetch(sessionUrl, {
    method: 'POST',
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      actorId: 'verify-runtime',
      inviteToken: null,
    }),
  });
  if (!response.ok) {
    throw new Error(`Realtime session grant failed: ${response.status} ${response.statusText}`);
  }
  const body = await response.json();
  if (
    !body?.ok ||
    typeof body.accessToken !== 'string' ||
    body.protocolVersion !== 2 ||
    body.grant?.protocolVersion !== 2 ||
    body.grant?.documentId !== roomId
  ) {
    throw new Error('Realtime session grant did not return a protocol-v2 document-bound token');
  }
  return {
    accessToken: body.accessToken,
    receipt: {
      actorId: body.grant.actorId,
      capabilities: body.grant.capabilities,
      documentId: body.grant.documentId,
      protocolVersion: body.protocolVersion,
    },
  };
};

const verifyInviteBearingGetDenied = async () => {
  const sentinel = 'verify-invite-bearer-must-not-reflect';
  const url = new URL(`${baseUrl}/api/realtime/rooms/${roomId}/session`);
  url.searchParams.set('actorId', 'legacy-invitee');
  url.searchParams.set('inviteToken', sentinel);
  const response = await fetch(url);
  const text = await response.text();
  if (response.status !== 405 || text.includes(sentinel)) {
    throw new Error('Invite-bearing GET must be terminal and must not reflect the bearer');
  }
  return JSON.parse(text);
};

const verifyLoopbackGetCompatibility = async () => {
  const url = new URL(`${baseUrl}/api/realtime/rooms/${roomId}/session`);
  url.searchParams.set('actorId', 'verify-legacy-loopback');
  if (url.searchParams.has('inviteToken')) {
    throw new Error('Loopback compatibility URL unexpectedly contains an invite bearer');
  }
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body?.ok || body.protocolVersion !== 2) {
    throw new Error(`Loopback no-token GET compatibility failed: ${response.status}`);
  }
  return {
    actorId: body.grant?.actorId,
    protocolVersion: body.protocolVersion,
  };
};

const verifyDeniedWithoutToken = async () => {
  const response = await fetch(`${baseUrl}/api/realtime/rooms/${roomId}/health`);
  if (response.status !== 403) {
    throw new Error(`Room health without token should be denied, got ${response.status}`);
  }
  return response.json();
};

const verifyRoomHealth = async (accessToken) => {
  const response = await fetch(`${baseUrl}/api/realtime/rooms/${roomId}/health`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Room health failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

const verifyWebSocket = async (accessToken) =>
  new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl.replace('http:', 'ws:')}/api/realtime/rooms/${roomId}/socket`);
    url.searchParams.set('accessToken', accessToken);
    url.searchParams.set('protocolVersion', '2');
    if (url.searchParams.has('inviteToken')) {
      reject(new Error('Realtime WebSocket URL must not contain an invite bearer'));
      return;
    }
    const socket = new WebSocket(url);
    let hydrationUpdates = 0;
    let phase = 'connecting';
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out during realtime WebSocket ${phase}`));
    }, 10_000);

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === 'room-ready') {
        if (phase !== 'connecting' || message.roomId !== roomId || message.protocolVersion !== 2) {
          clearTimeout(timeout);
          reject(new Error('Invalid room-ready hydration start'));
          return;
        }
        phase = 'hydrating';
        return;
      }
      if (message.type === 'yjs-update' && message.source === 'hydrate') {
        if (phase !== 'hydrating' || message.roomId !== roomId) {
          clearTimeout(timeout);
          reject(new Error('Hydration update arrived outside the hydration window'));
          return;
        }
        hydrationUpdates += 1;
        return;
      }
      if (message.type === 'room-hydration-complete') {
        if (
          phase !== 'hydrating' ||
          message.roomId !== roomId ||
          message.protocolVersion !== 2 ||
          message.persistedUpdates !== hydrationUpdates
        ) {
          clearTimeout(timeout);
          reject(new Error('Invalid room hydration completion'));
          return;
        }
        phase = 'ready';
        socket.send(JSON.stringify({ type: 'ping', requestId: 'verify-realtime-runtime' }));
        return;
      }
      if (message.type === 'pong' && message.requestId === 'verify-realtime-runtime') {
        if (phase !== 'ready') {
          clearTimeout(timeout);
          reject(new Error('Realtime pong arrived before hydration completion'));
          return;
        }
        clearTimeout(timeout);
        socket.close(1000, 'verified');
        resolve({ ...message, hydrationUpdates });
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
  const inviteBearingGetDenied = await verifyInviteBearingGetDenied();
  const loopbackGetCompatibility = await verifyLoopbackGetCompatibility();
  const session = await requestSessionToken();
  const roomHealth = await verifyRoomHealth(session.accessToken);
  const socketResult = await verifyWebSocket(session.accessToken);
  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        deniedWithoutToken,
        inviteBearingGetDenied,
        loopbackGetCompatibility,
        session: session.receipt,
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
