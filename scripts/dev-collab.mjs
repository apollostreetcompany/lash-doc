import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const host = '127.0.0.1';

function configuredPort(service, fallback) {
  const variable = `LASH_DEV_COLLAB_${service}_PORT`;
  const value = process.env[variable] ?? String(fallback);
  if (!/^\d+$/u.test(value) || Number(value) < 1024 || Number(value) > 65535) {
    throw new Error(`${variable} must be a port between 1024 and 65535.`);
  }
  return Number(value);
}

function execute(command, args, env = process.env, inherit = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed. Check the local setup.`);
  return result.stdout?.trim();
}

function requireLocalDocker() {
  const endpoint = execute('docker', [
    'context',
    'inspect',
    '--format',
    '{{.Endpoints.docker.Host}}',
  ]);
  if (
    !endpoint.startsWith('unix://') ||
    (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://'))
  ) {
    throw new Error('Dev collaboration requires a local Docker socket.');
  }
  const version = execute('docker', ['version', '--format', '{{.Server.Version}}']);
  if (!(Number(version.split('.')[0]) >= 28)) {
    throw new Error('Docker Engine 28 or newer is required for private port publishing.');
  }
}

function requirePrivatePublishers(label, expectedPorts) {
  const ids = execute('docker', ['ps', '-q', '--filter', `label=${label}`])
    .split(/\s+/u)
    .filter(Boolean);
  const ports = ids.flatMap((id) => {
    const output = execute('docker', [
      'inspect',
      '--format',
      '{{json .NetworkSettings.Ports}}',
      id,
    ]);
    return Object.values(JSON.parse(output) ?? {}).flatMap((mappings) => mappings ?? []);
  });
  if (
    ports.some((port) => ![host, '::1'].includes(port.HostIp)) ||
    expectedPorts.some(
      (port) => !ports.some(({ HostIp, HostPort }) => HostIp === host && Number(HostPort) === port),
    )
  ) {
    throw new Error('Auth and Mailpit must use the requested loopback-only Docker ports.');
  }
}

function requirePortFree(port) {
  return new Promise((resolveCheck, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(new Error(`Local port ${port} is already in use or unavailable.`)),
    );
    server.listen(port, host, () => server.close(resolveCheck));
  });
}

function readKeys(state, project, canCreate) {
  const path = join(state, 'keys.json');
  const names = [
    'database',
    'issuer',
    'account',
    'document',
    'control',
    'session',
    'invite',
    'namedEdit',
  ];
  if (canCreate && !existsSync(path)) {
    const volumes = project
      ? execute('docker', [
          'volume',
          'ls',
          '-q',
          '--filter',
          `label=com.docker.compose.project=${project}`,
        ])
      : '';
    if (volumes || existsSync(join(state, 'worker'))) {
      throw new Error('The local key file is missing. Restore it with the existing local data.');
    }
    const keys = Object.fromEntries(names.map((name) => [name, randomBytes(48).toString('hex')]));
    const temporary = `${path}.${randomBytes(12).toString('hex')}`;
    writeFileSync(temporary, JSON.stringify(keys), { flag: 'wx', mode: 0o600 });
    try {
      linkSync(temporary, path);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    } finally {
      unlinkSync(temporary);
    }
  }
  const identity = lstatSync(path);
  if (!identity.isFile() || (identity.mode & 0o077) !== 0 || identity.uid !== process.getuid()) {
    throw new Error('The local collaboration key file must be private and owned by this user.');
  }
  const keys = JSON.parse(readFileSync(path, 'utf8'));
  if (!names.every((name) => /^[a-f0-9]{96}$/u.test(keys[name]))) {
    throw new Error(
      'The local collaboration key file is invalid. Preserve it with its local state.',
    );
  }
  return keys;
}

function publicAuthToken(secret, issuer) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: issuer, role: 'anon', iat: now, exp: now + 86400 })}`;
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

async function waitForStatus(url, expected, stopSignal) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (stopSignal?.aborted) return;
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(2000) });
      await response.body?.cancel();
      if (response.status === expected) return;
    } catch {
      // The service may still be starting.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url} to return HTTP ${expected}.`);
}

async function launchApplications(webArgs, webEnv, workerArgs, origins) {
  const children = [];
  const health = new AbortController();
  let stop;
  const stopped = new Promise((done) => {
    stop = done;
  });
  const shutdownSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of shutdownSignals) process.once(signal, stop);
  const start = (label, args, env) => {
    const child = spawn('pnpm', args, { cwd: root, env, detached: true, stdio: 'inherit' });
    children.push(child);
    child.once('error', () => stop(new Error(`${label} could not start.`)));
    child.once('exit', (code) => stop(new Error(`${label} exited (${code ?? 'signal'}).`)));
  };
  const signalChildren = (signal) => {
    for (const child of children) {
      if (!child.pid) continue;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  };
  try {
    start('Realtime Worker', workerArgs, {
      ...process.env,
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'true',
      WRANGLER_SEND_METRICS: 'false',
    });
    start('Lash web', webArgs, webEnv);
    const ready = Promise.all([
      waitForStatus(`${origins.web}/api/account/session`, 401, health.signal),
      waitForStatus(`${origins.worker}/api/realtime/health`, 200, health.signal),
    ]).then(() => {
      if (!health.signal.aborted) console.log(`Lash is ready at ${origins.web}`);
      return stopped;
    });
    const result = await Promise.race([stopped, ready]);
    if (result instanceof Error) throw result;
  } finally {
    health.abort();
    signalChildren('SIGTERM');
    await delay(2000);
    signalChildren('SIGKILL');
    for (const signal of shutdownSignals) process.removeListener(signal, stop);
  }
}

async function main() {
  const [, , option, ...rest] = process.argv;
  if (rest.length || (option && option !== '--stop-provider'))
    throw new Error('Usage: node scripts/dev-collab.mjs [--stop-provider]');
  const webPort = configuredPort('WEB', 3000);
  const workerPort = configuredPort('WORKER', 8787);
  const authPort = configuredPort('AUTH', 55321);
  const mailPort = configuredPort('MAILPIT', 55324);
  if (new Set([webPort, workerPort, authPort, mailPort]).size !== 4)
    throw new Error('Use different local ports for each service.');
  const webOrigin = `http://${host}:${webPort}`;
  const workerOrigin = `http://${host}:${workerPort}`;
  const authOrigin = `http://${host}:${authPort}`;
  const mailOrigin = `http://${host}:${mailPort}`;
  const external = process.env.LASH_DEV_COLLAB_SUPABASE_WORKDIR;
  const workdir = external ? realpathSync(external) : null;
  const stateRoot = resolve(
    process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'),
    'lash-dev-collab',
  );
  const profile = createHash('sha256')
    .update(JSON.stringify([root, stateRoot, webPort, workerPort, authPort, mailPort, workdir]))
    .digest('hex')
    .slice(0, 16);
  const project = `lash-dev-${profile}`;
  const state = join(stateRoot, profile);

  if (option && workdir) throw new Error('Use the Supabase CLI to stop its own project.');
  if (!option) await Promise.all([requirePortFree(webPort), requirePortFree(workerPort)]);
  requireLocalDocker();
  if (!option) mkdirSync(state, { recursive: true, mode: 0o700 });
  const identity = lstatSync(state);
  if (
    !identity.isDirectory() ||
    (identity.mode & 0o077) !== 0 ||
    identity.uid !== process.getuid()
  ) {
    throw new Error(
      'The local collaboration state directory must be private and owned by this user.',
    );
  }
  const keys = readKeys(state, workdir ? null : project, !option);

  let publishableKey;
  if (workdir) {
    requirePrivatePublishers(`com.supabase.cli.workdir=${workdir}`, [authPort, mailPort]);
    const status = JSON.parse(
      execute('pnpm', [
        '--filter',
        '@lash/web',
        'exec',
        'supabase',
        'status',
        '--workdir',
        workdir,
        '-o',
        'json',
      ]),
    );
    if (
      status.API_URL !== authOrigin ||
      status.MAILPIT_URL !== mailOrigin ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/u.test(status.PUBLISHABLE_KEY ?? '')
    ) {
      throw new Error('The running Supabase project does not match the configured local ports.');
    }
    publishableKey = status.PUBLISHABLE_KEY;
  } else {
    const args = [
      'compose',
      '--project-name',
      project,
      '--env-file',
      '/dev/null',
      '--file',
      'scripts/dev-collab.compose.yml',
    ];
    const env = {
      ...process.env,
      LASH_DEV_DB_PASSWORD: keys.database,
      LASH_DEV_AUTH_JWT_SECRET: keys.issuer,
      LASH_DEV_AUTH_PORT: String(authPort),
      LASH_DEV_MAILPIT_PORT: String(mailPort),
      LASH_DEV_AUTH_ORIGIN: authOrigin,
      LASH_DEV_WEB_ORIGIN: webOrigin,
    };
    if (option) {
      execute('docker', [...args, 'stop'], env, true);
      return;
    }
    execute(
      'docker',
      [...args, 'up', '--detach', '--no-recreate', '--wait', '--wait-timeout', '150'],
      env,
      true,
    );
    requirePrivatePublishers(`com.docker.compose.project=${project}`, [authPort, mailPort]);
    publishableKey = publicAuthToken(keys.issuer, `${authOrigin}/auth/v1`);
  }
  await Promise.all([
    waitForStatus(`${authOrigin}/auth/v1/health`, 200),
    waitForStatus(`${mailOrigin}/api/v1/info`, 200),
  ]);

  const workerFile = join(state, 'worker.env');
  const workerEnv = {
    LASH_WORKER_CONTROL_SECRET_CURRENT: keys.control,
    LASH_REALTIME_SESSION_SECRET: keys.session,
    LASH_REALTIME_INVITE_SECRET: keys.invite,
    LASH_SHARE_PHASE: 'enabled',
    LASH_NAMED_EDIT_PHASE: 'enabled',
    LASH_NAMED_COMMENT_PHASE: 'enabled',
  };
  writeFileSync(
    workerFile,
    Object.entries(workerEnv)
      .map(([name, value]) => `${name}=${value}\n`)
      .join(''),
    { mode: 0o600 },
  );
  const webEnv = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    LASH_DEV_COLLAB: '1',
    LASH_STATIC_EXPORT: '0',
    NEXT_PUBLIC_LASH_TEST_HOOKS: 'false',
    NEXT_PUBLIC_SUPABASE_URL: authOrigin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    NEXT_PUBLIC_LASH_REALTIME_URL: `ws://${host}:${workerPort}`,
    LASH_REALTIME_WORKER_HTTP_URL: workerOrigin,
    LASH_SITE_ORIGIN: webOrigin,
    LASH_ACCOUNT_PRINCIPAL_HMAC_KEY: keys.account,
    LASH_DOCUMENT_ID_DERIVATION_KEYS: `v1:${Buffer.from(keys.document, 'hex').toString('base64url')}`,
    LASH_WORKER_CONTROL_SECRET_CURRENT: keys.control,
    LASH_NAMED_EDIT_PHASE: 'enabled',
    LASH_NAMED_COMMENT_PHASE: 'enabled',
    LASH_NAMED_EDIT_KEY: Buffer.from(keys.namedEdit, 'hex').toString('base64url'),
    LASH_PUBLIC_DOCUMENT_ACCESS_ENABLED: 'false',
    LASH_PUBLIC_COMMENT_ACCESS_ENABLED: 'false',
  };
  console.log(`Lash: ${webOrigin}\nMailpit: ${mailOrigin}\nLocal state: ${state}`);
  await launchApplications(
    ['--filter', '@lash/web', 'dev', '--hostname', host, '--port', String(webPort)],
    webEnv,
    [
      'exec',
      'wrangler',
      'dev',
      '--config',
      'packages/realtime-worker/wrangler.jsonc',
      '--local',
      '--ip',
      host,
      '--port',
      String(workerPort),
      '--env-file',
      workerFile,
      '--persist-to',
      join(state, 'worker'),
      '--show-interactive-dev-session=false',
    ],
    { web: webOrigin, worker: workerOrigin },
  );
}

main().catch((error) => {
  console.error(
    error instanceof SyntaxError ? 'Local configuration could not be parsed.' : error.message,
  );
  process.exitCode = 1;
});
