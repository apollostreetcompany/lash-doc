# INF-02 Cloudflare Realtime Proof

Date: 2026-06-24

Scope: Cloudflare Worker/Durable Object realtime runtime deployment receipts.

## Result

- Worker: `lash-realtime`
- URL: `https://lash-realtime.ryan-borker.workers.dev`
- Version: `06150817-80d3-4c52-b86d-cbfd2ac92f4f`
- Durable Object binding: `LASH_REALTIME_ROOM` -> `LashRealtimeRoom`
- Current secret names: none (`wrangler secret list` returned `[]`)

## Validation

- `pnpm exec wrangler --version` reported `4.97.0`.
- `pnpm exec wrangler whoami` authenticated as `ryan.borker@gmail.com` with Workers write permissions.
- `pnpm --filter @lash/realtime-worker types` passed.
- `pnpm --filter @lash/realtime-worker typecheck` passed.
- `make realtime-dry-run` passed and bundled the Worker with the Durable Object binding.
- `make verify-realtime-runtime` passed locally: health, unauthenticated 403, session grant, room health, and WebSocket ping/pong.
- `make deploy-realtime-cloudflare` passed after fixing the Makefile script invocation from `pnpm --filter ... deploy` to `pnpm --filter ... run deploy`.
- Public health passed: `GET /api/realtime/health` returned `{"ok":true,...}`.
- Public session minting without an invite stayed locked: `GET /api/realtime/rooms/inf-02/session?actorId=public-check` returned `403 {"ok":false,"error":"forbidden","reason":"invalid"}`.

## Important Limitation

This provisions the Cloudflare realtime runtime, not end-to-end production collaboration. Because no production Worker secrets are set and the current web invite signer is still a local/static bridge, production document sessions intentionally remain closed until the dynamic web runtime owns shared `LASH_REALTIME_SESSION_SECRET` and `LASH_REALTIME_INVITE_SECRET` values.

## Evidence Logs

- `artifacts/ux-sprint/reports/inf-02-types.log`
- `artifacts/ux-sprint/reports/inf-02-typecheck.log`
- `artifacts/ux-sprint/reports/inf-02-dry-run.log`
- `artifacts/ux-sprint/reports/inf-02-local-runtime.log`
- `artifacts/ux-sprint/reports/inf-02-deploy.log`
- `artifacts/ux-sprint/reports/inf-02-public-health.log`
- `artifacts/ux-sprint/reports/inf-02-public-session-deny.log`
- `artifacts/ux-sprint/reports/inf-02-secret-list.log`
