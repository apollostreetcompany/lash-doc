# DEPLOYMENT.md - Lash

## Runtime

- Package manager: `pnpm@8.10.0`
- Web app: `apps/web` via Next.js 14.
- Production build command: `pnpm run build`
- E2E command: `pnpm run test:e2e`

## Local Service Rules

- Do not run long-lived dev servers manually in this repo.
- Playwright owns the local web server lifecycle during `pnpm run test:e2e`.
- Check port `3000` before introducing or changing a local web server binding.

## Deploy Assumptions

- No deployment target is configured in this checkout.
- GitHub remote and required checks are UNCONFIRMED locally.
- Container/runtime binding assumptions are not yet applicable; record them here before the first deploy-affecting bead.

## Rollback

- No production deployment exists from this checkout.
- For future deploy-affecting beads, record the health check URL, smoke URL, and rollback command/path in `handoff/beads.jsonl`.
