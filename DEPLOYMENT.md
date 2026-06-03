# DEPLOYMENT.md - Lash

## Runtime

- Package manager: `pnpm@8.10.0`
- Web app: `apps/web` via Next.js 14.
- Production build command: `pnpm run build`
- Static edge build command: `pnpm run build:static`
- E2E command: `pnpm run test:e2e`

## Local Service Rules

- Do not run long-lived dev servers manually in this repo.
- Playwright owns the local web server lifecycle during `pnpm run test:e2e`.
- For local manual use, run `make serve`. It starts the production build in the background at `http://127.0.0.1:3000` after checking the port and writing `.lash-web.pid` / `.lash-web.log`.
- Use `make status` to verify the local server and `make stop` when finished.
- Check port `3000` before introducing or changing a local web server binding. Set `PORT=3001 make serve` if `3000` is occupied.
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
- Bead 27 introduces arbitrary `/doc/[id]` routes for local/Next runtime use. The current static Cloudflare Pages export does not provide a durable arbitrary-route backend; Bead 28 must choose the Cloudflare Worker/Durable Object or fallback runtime path before these document routes are treated as production deployable. Verified result: `pnpm run build:static` currently fails because `/doc/[id]` is missing `generateStaticParams()` under `output: export`.

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
