import { defineConfig, devices } from '@playwright/test';

const externalBaseURL = process.env.LASH_STATIC_PREVIEW_URL;
const localPort = 4173;
const localBaseURL = `http://127.0.0.1:${localPort}`;

// Chromium loads several Next chunks at once. Keep connections open and queue those requests.
const serveStaticExport = `python3 - <<'PYTHON'
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class StaticPreviewServer(ThreadingHTTPServer):
    request_queue_size = 128

class StaticPreviewHandler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

handler = partial(StaticPreviewHandler, directory='apps/web/out')
with StaticPreviewServer(('127.0.0.1', ${localPort}), handler) as server:
    server.serve_forever()
PYTHON`;

export default defineConfig({
  testDir: './apps/web/e2e',
  testMatch: '**/static-preview.journey.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: externalBaseURL || localBaseURL,
    trace: 'retain-on-failure',
  },
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: serveStaticExport,
          url: localBaseURL,
          reuseExistingServer: false,
        },
      }),
});
