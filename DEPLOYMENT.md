# DEPLOYMENT.md - Lash

## Runtime

- Package manager: `pnpm@8.10.0`
- Web app: `apps/web` via Next.js 14.
- Production build command: `pnpm run build`
- Static edge build command: `pnpm run build:static`
- Realtime Worker: `packages/realtime-worker`, Cloudflare Worker `lash-realtime`.
- Realtime room runtime: Cloudflare Durable Objects class `LashRealtimeRoom`, binding `LASH_REALTIME_ROOM`, WebSocket transport.
- E2E command: `pnpm run test:e2e`

## Local Service Rules

- Do not run long-lived dev servers manually in this repo.
- Playwright owns the local web server lifecycle during `pnpm run test:e2e`.
- For local manual use, run `make serve`. It starts the production build in the background at `http://127.0.0.1:3000` after checking the port and writing `.lash-web.pid` / `.lash-web.log`.
- Use `make status` to verify the local server and `make stop` when finished.
- Check port `3000` before introducing or changing a local web server binding. Set `PORT=3001 make serve` if `3000` is occupied.
- Check port `8787` before starting the realtime Worker. Use `LASH_REALTIME_PORT=8788 make verify-realtime-runtime` or `make realtime-dev` if `8787` is occupied.
- Stop the local server before running `pnpm run build` or `pnpm run test:e2e`; `next build` rewrites `apps/web/.next` and can conflict with a running `next start`.

## Deploy Assumptions

- Public test deployment target: Cloudflare Pages project `lash`.
- Public test URL: `https://lash-9xx.pages.dev/`.
- Static export output: `apps/web/out`, produced by `LASH_STATIC_EXPORT=1 next build` via `pnpm run build:static`.
- Deploy command: `make deploy-cloudflare`.
- Public smoke/performance verification command: `make verify-cloudflare URL=https://lash-9xx.pages.dev/`.
- GitHub remote is `https://github.com/apollostreetcompany/lash-doc.git`.
- Default branch is `main`.
- Branch protection is configured on `main` with strict required `build-and-test`, admin enforcement, and no force-push/delete.
- Latest protected `main` CI is green on deploy commit `3f19bc361c3071d9e3f7425bfd064193cd8b83a9` via run `26026635724`; check GitHub Actions for future changes.
- Container/runtime binding assumptions are not applicable to the Cloudflare Pages test site because it serves static assets at the edge. The existing local `next start` path remains unchanged.
- Bead 28 chooses Cloudflare Durable Objects as the realtime room runtime. The app now has a deploy-shaped `lash-realtime` Worker with `/api/realtime/health`, `/api/realtime/rooms/:id/health`, and `/api/realtime/rooms/:id/socket` endpoints. Verified result: `pnpm --filter @lash/realtime-worker deploy:dry-run` bundles successfully with Durable Object binding `LASH_REALTIME_ROOM`.
- Bead 30 gates realtime room access with signed session grants. Browsers first request `GET /api/realtime/rooms/:id/session?actorId=<actor>` and then pass the returned `accessToken` to room health/socket requests. Local development uses a non-production fallback secret; production must set `LASH_REALTIME_SESSION_SECRET` before publishing the Worker.
- The existing Cloudflare Pages public test site remains the static web host for the merged `main` build. The Bead 27 `/doc/[id]` Next routes are still local/Next-runtime routes until the web app deployment path is moved off static export or given an explicit dynamic route strategy; `pnpm run build:static` is expected to fail on this branch for that reason.

## Realtime Worker Preflight

1. Generate binding/runtime types after config changes: `pnpm --filter @lash/realtime-worker types`.
2. Typecheck the Worker: `pnpm --filter @lash/realtime-worker typecheck`.
3. Set the production signing secret before publishing: `npx wrangler secret put LASH_REALTIME_SESSION_SECRET --config packages/realtime-worker/wrangler.jsonc`.
4. Validate deploy shape without publishing: `make realtime-dry-run`.
5. Verify local token issuance, denied unauthenticated access, room health, and WebSocket upgrade: `make verify-realtime-runtime`.
6. Deploy the realtime Worker when ready: `make deploy-realtime-cloudflare`.

## Realtime Worker Health

- Service health: `GET /api/realtime/health`.
- Room session grant: `GET /api/realtime/rooms/<doc-id>/session?actorId=<actor-id>`.
- Room health: `GET /api/realtime/rooms/<doc-id>/health?accessToken=<token>`; requires `doc.read`.
- Room socket: `GET /api/realtime/rooms/<doc-id>/socket?accessToken=<token>` with `Upgrade: websocket`; requires `doc.edit`.
- Local verification command: `pnpm run verify:realtime`.
- Latest local verification: service health passed on `http://127.0.0.1:8787`, unauthenticated room health returned `403`, room `bead-28-health` reported actor `verify-runtime` and `protocolVersion: 1`, and authorized WebSocket ping returned `pong` with one active connection.

## Cloudflare Pages Preflight

1. Stop local `next start` before building: `make stop`.
2. Verify auth: `npx wrangler whoami`.
3. Build static assets: `pnpm run build:static`.
4. Deploy: `make deploy-cloudflare CLOUDFLARE_PAGES_PROJECT=lash`.
5. Verify public URL: `make verify-cloudflare URL=https://lash-9xx.pages.dev/`.

## Public Performance Gate

- Public verification runs `apps/web/e2e/smoke/home.spec.ts` and `apps/web/e2e/performance/typing-latency.spec.ts` with `PLAYWRIGHT_BASE_URL`.
- Essay typing threshold: p95 browser event processing < 8 ms, max event processing < 50 ms, full essay typed < 5 s, zero long tasks, and no character loss.
- Latest public verification on `https://lash-9xx.pages.dev/`: 585 characters typed in 985 ms, p95 event work 0.8 ms, max event work 7.4 ms, zero long tasks.
- Latest merged-main Cloudflare deployment preview: `https://cad5a3ac.lash-9xx.pages.dev`.

## Rollback

- Health check: `curl -fsSI https://lash-9xx.pages.dev/`
- Smoke URL: `https://lash-9xx.pages.dev/`
- Cloudflare Pages rollback path: Cloudflare dashboard -> Workers & Pages -> `lash` -> Deployments -> promote a prior successful deployment.
- CLI deployment inspection: `npx wrangler pages deployment list --project-name lash --environment production`
- CLI fallback: redeploy a known-good checkout with `make deploy-cloudflare`.
- For future deploy-affecting beads, record the health check URL, smoke URL, and rollback command/path in `handoff/beads.jsonl`.
