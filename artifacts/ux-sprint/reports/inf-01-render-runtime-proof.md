# INF-01 Render Dynamic Runtime Proof

Date: 2026-06-24

Scope: production-shaped dynamic web runtime for arbitrary `/doc/[id]` routes.

## Result

- Added `render.yaml` Blueprint for a Node web service named `lash-doc-web`.
- Added `make verify-render`, backed by `scripts/verify-render-runtime.mjs`.
- Verified the app builds without `LASH_STATIC_EXPORT` and Next classifies `/doc/[id]` as dynamic server-rendered on demand.
- Verified `next start -H 0.0.0.0 -p $PORT` serves both `/` and `/doc/render-smoke`.

## Render Blueprint

- Runtime: Node
- Plan: free
- Region: Oregon
- Repo: `https://github.com/apollostreetcompany/lash-doc`
- Branch: `main`
- Build: `corepack enable && corepack prepare pnpm@8.10.0 --activate && pnpm install --frozen-lockfile && pnpm run build`
- Start: `pnpm --filter @lash/web exec next start -H 0.0.0.0 -p $PORT`
- Health check: `/`
- Env: `NODE_VERSION=22`, `NEXT_TELEMETRY_DISABLED=1`

## Validation

- `render --version` reported `2.6.1`.
- `render whoami` authenticated as Apollo Street Company.
- `render workspace current` returned Apollo Street Company's team workspace.
- Sanitized `render services list` summary found `serviceCount: 23` and `lashServices: []`.
- `render.yaml` parsed as one service.
- `pnpm exec eslint scripts/verify-render-runtime.mjs --max-warnings=0` passed.
- `node --check scripts/verify-render-runtime.mjs` passed.
- `make verify-render` passed.

## Live Service Status

No live Render service was created from this session. The installed Render CLI can inspect services and trigger deploys for existing services, but it does not expose a stable service-create or Blueprint-apply command here, and `RENDER_API_KEY` is not configured. The next live step is to apply `render.yaml` through the Render Dashboard or a configured Render API/MCP path.

## Important Limitation

The Blueprint intentionally does not set `NEXT_PUBLIC_LASH_REALTIME_URL` yet. Enabling it before the web runtime and Cloudflare Worker share production invite/session secrets would make realtime connection attempts fail for users. The Cloudflare Worker is deployed and healthy, but production document sessions remain closed until secrets and invite issuance are wired deliberately.

## Evidence Logs

- `artifacts/ux-sprint/reports/inf-01-render-preflight.log`
- `artifacts/ux-sprint/reports/inf-01-render-auth-inventory.log`
- `artifacts/ux-sprint/reports/inf-01-render-yaml-parse.log`
