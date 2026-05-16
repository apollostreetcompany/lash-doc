# DEPLOYMENT.md - Lash

## Runtime

- Package manager: `pnpm@8.10.0`
- Web app: `apps/web` via Next.js 14.
- Production build command: `pnpm run build`
- E2E command: `pnpm run test:e2e`

## Local Service Rules

- Do not run long-lived dev servers manually in this repo.
- Playwright owns the local web server lifecycle during `pnpm run test:e2e`.
- For local manual use, run `make serve`. It starts the production build in the background at `http://127.0.0.1:3000` after checking the port and writing `.lash-web.pid` / `.lash-web.log`.
- Use `make status` to verify the local server and `make stop` when finished.
- Check port `3000` before introducing or changing a local web server binding. Set `PORT=3001 make serve` if `3000` is occupied.
- Stop the local server before running `pnpm run build` or `pnpm run test:e2e`; `next build` rewrites `apps/web/.next` and can conflict with a running `next start`.

## Deploy Assumptions

- No deployment target is configured in this checkout.
- GitHub remote is `https://github.com/apollostreetcompany/lash-doc.git`.
- Default branch is `main`.
- Branch protection is configured on `main` with strict required `build-and-test`, admin enforcement, and no force-push/delete.
- Audited main CI is green on release-audit commit `c6ee96e796602834d6795e84d404bf962486ad40` via run `25955266966`; latest protected `main` CI should be checked in GitHub Actions for future changes.
- Container/runtime binding assumptions are not yet applicable; record them here before the first deploy-affecting bead.

## Rollback

- No production deployment exists from this checkout.
- For future deploy-affecting beads, record the health check URL, smoke URL, and rollback command/path in `handoff/beads.jsonl`.
