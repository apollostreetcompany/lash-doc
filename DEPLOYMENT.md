# DEPLOYMENT.md - Lash

## Runtime

- Package manager: `pnpm@8.10.0`
- Web app: `apps/web` via Next.js 14.
- Production build command: `pnpm run build`
- Static edge build command: `pnpm run build:static`
- Realtime Worker: `packages/realtime-worker`, Cloudflare Worker `lash-realtime`.
- Realtime room runtime: Cloudflare Durable Objects class `LashRealtimeRoom`, binding `LASH_REALTIME_ROOM`, WebSocket transport.
- Local E2E command: `pnpm run test:e2e`
- CI E2E command: `pnpm run test:e2e:ci`

## Local Service Rules

- Do not run long-lived dev servers manually in this repo.
- Playwright owns the local web server lifecycle during `pnpm run test:e2e`.
- For local manual use, run `make serve`. It starts the production build in the background at `http://127.0.0.1:3000` after checking the port and writing `.lash-web.pid` / `.lash-web.log`.
- Use `make status` to verify the local server and `make stop` when finished.
- Check port `3000` before introducing or changing a local web server binding. Set `PORT=3001 make serve` if `3000` is occupied.
- Check port `8787` before starting the realtime Worker. Use `LASH_REALTIME_PORT=8788 make verify-realtime-runtime` or `make realtime-dev` if `8787` is occupied.
- Stop the local server before running `pnpm run build` or `pnpm run test:e2e`; `next build` rewrites `apps/web/.next` and can conflict with a running `next start`.
- Local editor pages do not auto-connect to the default realtime Worker merely because they are on localhost. Enable local realtime with `NEXT_PUBLIC_LASH_REALTIME_URL`, `?realtime=on`, or `localStorage.setItem('lash:realtime-enabled', 'true')`; use `localStorage.setItem('lash:realtime-url', 'ws://127.0.0.1:<port>')` to point one browser context at a non-default local Worker; use `?realtime=off` to force local-only editing.

## Deploy Assumptions

- Public test deployment target: Cloudflare Pages project `lash`.
- Public test URL: `https://lash-9xx.pages.dev/`.
- Static export output: `apps/web/out`, produced by `LASH_STATIC_EXPORT=1 next build` via `pnpm run build:static`.
- Deploy command: `make deploy-cloudflare`.
- Public smoke/performance verification command: `make verify-cloudflare URL=https://lash-9xx.pages.dev/`.
- GitHub remote is `https://github.com/apollostreetcompany/lash-doc.git`.
- Default branch is `main`.
- Branch protection is configured on `main` with strict required `build-and-test`, admin enforcement, and no force-push/delete.
- GitHub Actions CI uses Node 22 because current Wrangler releases require Node 22+.
- GitHub Actions CI runs browser E2E through `pnpm run test:e2e:ci`, which rebuilds `apps/web` with `NEXT_PUBLIC_LASH_TEST_HOOKS=true` and serializes Playwright with `--workers=1` to avoid realtime Worker port contention and shared-runner performance jitter.
- Latest protected `main` CI is green on integrated Beads 23-36 commit `1b85b26682505d5a8e10e6051c4f4464b612898c` via run `26914289177`; it passed lint, typecheck, unit tests, serialized E2E, and build.
- Latest Bead 36 PR CI was green on PR #28 run `26913934385`; PR #28 then merged the complete Beads 23-36 stack to `main`.
- Container/runtime binding assumptions are not applicable to the Cloudflare Pages test site because it serves static assets at the edge. The existing local `next start` path remains unchanged.
- Bead 28 chooses Cloudflare Durable Objects as the realtime room runtime. The app now has a deploy-shaped `lash-realtime` Worker with `/api/realtime/health`, `/api/realtime/rooms/:id/health`, and `/api/realtime/rooms/:id/socket` endpoints. Verified result: `pnpm --filter @lash/realtime-worker run deploy:dry-run` bundles successfully with Durable Object binding `LASH_REALTIME_ROOM`.
- Bead 30 gates realtime room access with signed session grants. Browsers first request `GET /api/realtime/rooms/:id/session?actorId=<actor>` and then pass the returned `accessToken` to room health/socket requests. Local development uses a non-production fallback secret only on loopback hosts; production must set `LASH_REALTIME_SESSION_SECRET` before publishing the Worker.
- Bead 31 persists realtime document CRDT state in the per-document Durable Object using SQLite-backed storage. Each accepted Yjs update is appended before broadcast, snapshots compact hydration state periodically, new sockets hydrate from the latest snapshot plus later updates, and restore appends a new head update instead of deleting history.
- Bead 32 makes realtime opt-in for unconfigured local browser sessions so normal large-document typing does not pay collaboration runtime overhead. Online typing Playwright coverage opts in explicitly before opening document pages.
- Bead 33 carries presence on the existing realtime room socket: clients send room-scoped `awareness-update` messages, the Durable Object sends same-room `awareness-state` peer lists, and persisted client updates return `sync-ack` messages for saved/syncing UI.
- Bead 34 adds invite/access UX and signed invite-token exchange. Local/static Lash invite links use `#invite=<token>` and local browser storage for collaborator rows/revocation; the browser strips the hash after validation and forwards the invite token to realtime session exchange when realtime is enabled. In non-local Worker deployments, `/session` denies requests without a valid signed invite token instead of minting a default edit grant. Durable DO-backed invite issuance, global revocation, and audit remain follow-up work.
- Bead 35 stores document chat thread metadata and suggestion resolution records in document-scoped localStorage for local-only sessions, and mirrors them into per-record Y.Map entries in the existing realtime Y.Doc when realtime is enabled. No new deploy secret, binding, database, or service is required; Durable Object persistence captures these metadata updates through the same append-only Yjs update log and snapshot path as document content.
- Bead 36 adds web UI and local test configurability: collaboration Ready/share, sync feedback, retry reconnect, and the `lash:realtime-url` localStorage override. Its post-subreview hardening also changes the realtime access split without adding a deploy secret, binding, database, or route: WebSocket joins require `doc.read`, while persisted/broadcast `yjs-update` messages require `doc.edit` inside the Durable Object.
- INF-02 realtime deployment receipt: Cloudflare Worker `lash-realtime` deployed to `https://lash-realtime.ryan-borker.workers.dev` as version `06150817-80d3-4c52-b86d-cbfd2ac92f4f` on 2026-06-24. Public `GET /api/realtime/health` returned `ok: true`; unauthenticated `GET /api/realtime/rooms/inf-02/session?actorId=public-check` returned `403 invalid`; `wrangler secret list` returned `[]`. Production document sessions intentionally remain closed until `LASH_REALTIME_SESSION_SECRET` and `LASH_REALTIME_INVITE_SECRET` are set and matched by the dynamic web runtime.
- The existing Cloudflare Pages public test site remains the static host for the last static-export deployment. The Beads 23-36 merged `main` build includes Bead 27 `/doc/[id]` Next routes, which are still local/Next-runtime routes until the web app deployment path is moved off static export or given an explicit dynamic route strategy; `pnpm run build:static` is expected to fail for that reason.

## Realtime Worker Preflight

1. Generate binding/runtime types after config changes: `pnpm --filter @lash/realtime-worker types`.
2. Typecheck the Worker: `pnpm --filter @lash/realtime-worker typecheck`.
3. Set the production session signing secret before publishing: `npx wrangler secret put LASH_REALTIME_SESSION_SECRET --config packages/realtime-worker/wrangler.jsonc`.
4. Set a production invite signing secret before accepting server-issued invite links: `npx wrangler secret put LASH_REALTIME_INVITE_SECRET --config packages/realtime-worker/wrangler.jsonc`. If omitted, the Worker falls back to `LASH_REALTIME_SESSION_SECRET` for invite verification.
5. Validate deploy shape without publishing: `make realtime-dry-run`.
6. Verify local token issuance, denied unauthenticated access, room health, and WebSocket upgrade: `make verify-realtime-runtime`.
7. Deploy the realtime Worker when ready: `make deploy-realtime-cloudflare`.

## Realtime Worker Health

- Service health: `GET /api/realtime/health`.
- Room session grant: `GET /api/realtime/rooms/<doc-id>/session?actorId=<actor-id>`. Local fallback mints a default edit grant only when `LASH_REALTIME_SESSION_SECRET` is absent and the request host is `127.0.0.1`, `localhost`, or loopback IPv6. Non-local hosts without the session secret deny session minting. Production requests must include `inviteToken=<signed-share-token>`; `view` maps to `doc.read`, while `comment`, `suggest`, and `edit` map to `doc.read` + `doc.edit` with the original invite scope preserved on the short-lived grant.
- Room health: `GET /api/realtime/rooms/<doc-id>/health?accessToken=<token>`; requires `doc.read`; includes `persistence.updates`, `persistence.snapshotSequence`, and `persistence.hydrationUpdates`.
- Room socket: `GET /api/realtime/rooms/<doc-id>/socket?accessToken=<token>` with `Upgrade: websocket`; requires `doc.read` so view invitees can hydrate room state.
- Room restore: `POST /api/realtime/rooms/<doc-id>/restore?accessToken=<token>` with body `{ "update": "<base64-yjs-update>" }`; requires `doc.edit`; appends a new restore update and broadcasts it to connected peers.
- Room socket protocol: `yjs-update` messages require the socket attachment to include `doc.edit`, can include `updateId`, and receive `sync-ack` after persistence; read-only sockets receive `scope_mismatch` before persistence or broadcast if they attempt a Yjs mutation. Document content, comment thread metadata, and suggestion resolution records all travel as Yjs updates. `awareness-update` messages carry label/color/selection and receive room-scoped `awareness-state` peer lists.
- Local verification command: `pnpm run verify:realtime`.
- Latest local verification: service health passed on `http://127.0.0.1:8787`, unauthenticated room health returned `403`, room `bead-28-health` reported actor `verify-runtime` and `protocolVersion: 1`, and authorized WebSocket ping returned `pong` with one active connection.
- Latest online realtime verification: `apps/web/e2e/online-typing` passes unauthorized denial, same-doc remote visibility, concurrent convergence, reload durability, snapshot compaction without deleting update history, room presence/cursor visibility, saved/reconnecting/recovered sync states, local-only collaboration chrome honesty, and view-invite realtime hydration without body edit access.

## Cloudflare Pages Preflight

1. Stop local `next start` before building: `make stop`.
2. Verify auth: `npx wrangler whoami`.
3. Build static assets: `pnpm run build:static`.
4. Deploy: `make deploy-cloudflare CLOUDFLARE_PAGES_PROJECT=lash`.
5. Verify public URL: `make verify-cloudflare URL=https://lash-9xx.pages.dev/`.

## Public Performance Gate

- Public verification runs `apps/web/e2e/smoke/home.spec.ts` and `apps/web/e2e/performance/typing-latency.spec.ts` with `PLAYWRIGHT_BASE_URL`.
- Essay typing threshold: p95 browser event processing < 8 ms, max event processing < 50 ms, full essay typed < 5 s, zero long tasks, and no character loss.
- Local large-document typing gate: `apps/web/e2e/performance/large-doc-typing.spec.ts` seeds 10k-word and 50k-word docs through test hooks and enforces p95 event work < 8 ms plus max event work < 50 ms. It logs long task counts for future document virtualization work.
- On GitHub-hosted CI only, the 50k-word Event Timing p95 budget is 16 ms to account for hosted-runner CPU scheduling. Local and product validation keep the 8 ms p95 budget, and the spec logs `p95BudgetMs` with each scenario.
- Latest public verification on `https://lash-9xx.pages.dev/`: 585 characters typed in 985 ms, p95 event work 0.8 ms, max event work 7.4 ms, zero long tasks.
- Latest merged-main Cloudflare deployment preview: `https://cad5a3ac.lash-9xx.pages.dev`.

## Rollback

- Health check: `curl -fsSI https://lash-9xx.pages.dev/`
- Smoke URL: `https://lash-9xx.pages.dev/`
- Cloudflare Pages rollback path: Cloudflare dashboard -> Workers & Pages -> `lash` -> Deployments -> promote a prior successful deployment.
- CLI deployment inspection: `npx wrangler pages deployment list --project-name lash --environment production`
- CLI fallback: redeploy a known-good checkout with `make deploy-cloudflare`.
- Realtime Worker rollback path: inspect versions with `pnpm exec wrangler versions list --config packages/realtime-worker/wrangler.jsonc`, then roll back with `pnpm exec wrangler rollback --config packages/realtime-worker/wrangler.jsonc <version-id>`.
- For future deploy-affecting beads, record the health check URL, smoke URL, and rollback command/path in `handoff/beads.jsonl`.
