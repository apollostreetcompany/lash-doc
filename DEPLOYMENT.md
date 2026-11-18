# DEPLOYMENT.md - Lash

## Runtime

- Package manager: `pnpm@8.10.0`
- Web app: `apps/web` runs on Next.js 16.4.6 and React 19.3.1 with Node 22. The dynamic and static build scripts explicitly select webpack.
- Inter and JetBrains Mono are bundled from pinned Fontsource packages. The build preloads Latin variable fonts and includes the remaining Unicode subsets. Their notices are served at `/licenses/inter.txt` and `/licenses/jetbrains-mono.txt`.
- Production build command: `pnpm run build`; it runs the strict shipped-product gate before `next build`.
- Static preview build command: `pnpm run build:static`; it runs the same shipped-product gate before exporting the browser-local writing preview.
- Shipped-product typecheck: `pnpm run typecheck:product`; it checks the web and package product sources and the realtime Worker project.
- Playwright/evidence typecheck: `pnpm run typecheck:harness`; it checks the browser harness under its strict no-emit project.
- Combined compiler gate: `pnpm run typecheck` (or `make typecheck`); it runs product and harness gates in order.
- Unit behavior gate: `pnpm run test:unit`. Unit test source is not yet a strict-type-clean project; `PROD-TSC-UNIT-01` tracks the 112 current diagnostics separately, so a green unit run must not be described as a unit-source typecheck.
- Realtime Worker: `packages/realtime-worker`, Cloudflare Worker `lash-realtime`.
- Realtime authority runtime: Cloudflare Durable Objects class `LashRealtimeRoom`, binding `LASH_REALTIME_ROOM`, plus the additive stable promotion coordinator class `LashDocumentClaim`, binding `LASH_DOCUMENT_CLAIM`; room sockets use WebSocket transport.
- Local E2E command: `pnpm run test:e2e`
- CI E2E command: `pnpm run test:e2e:ci`

## Local development

Run `make dev-collab` for a two-writer workspace. It starts the web app and Worker
on loopback and uses a local account provider and Mailpit inbox. The launcher
generates and retains per-checkout keys and document state outside the repository.
The default web, Worker, Auth and inbox ports are 3000, 8787, 55321 and 55324.
Ctrl-C stops its application processes. To stop its Compose provider while
preserving local volumes, run `node scripts/dev-collab.mjs --stop-provider`.
The [two-profile walkthrough](README.md#try-collaboration-with-two-writers) exercises the normal user path.

For browser-local writing, run `pnpm --filter @lash/web dev`. For the last production
build, `make serve` starts a tracked local server. Use `make status` and `make stop`
for that server. Serialize builds and servers that share a checkout's Next output.
`pnpm run test:e2e` runs its own server when no external base URL is set.

### Account and public-access configuration

- Account-provider proof uses the repository-pinned Supabase CLI `2.110.0`, never an ambient/global CLI. Lash's isolated local stack binds API/Auth `55321`, Postgres `55322`, Studio `55323`, Mailpit `55324`, SMTP `55325`, and shadow database `55320`; check all six ports before `make supabase-start`.
- A source-matched account build/runtime needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, exact `LASH_SITE_ORIGIN`, and a server-only `LASH_ACCOUNT_PRINCIPAL_HMAC_KEY` of at least 32 UTF-8 bytes. Do not persist or print provider keys. `make supabase-start` emits only allowlisted service URLs, and `make verify-account-auth` checks Auth/Mailpit health before running the one-test, capture-disabled `playwright.account.config.ts` journey.
- Local editor pages do not auto-connect to the default realtime Worker merely because they are on localhost. Enable local realtime with `NEXT_PUBLIC_LASH_REALTIME_URL`, `?realtime=on`, or `localStorage.setItem('lash:realtime-enabled', 'true')`; use `localStorage.setItem('lash:realtime-url', 'ws://127.0.0.1:<port>')` to point one browser context at a non-default local Worker. Browser storage/query opt-ins are honored only on exact loopback hosts in development or explicitly test-tagged builds, and the override URL itself must use `ws:` or `wss:` with a loopback hostname. Deployed hostnames ignore those local overrides. `?realtime=off` always forces local-only editing, including when `NEXT_PUBLIC_LASH_REALTIME_URL` is configured.
- Account-backed owner reopen and local-to-account promotion require a build with `NEXT_PUBLIC_LASH_REALTIME_URL` configured. In that build, a route without an invite remains behind the checking surface until the owner-session lookup resolves; an unowned route then mounts verified local content once, while an owned route mounts only the hydrated Durable Object projection. Do not build account acceptance without the configured public socket origin and then infer owner persistence from local-only behavior.
- Signed-out public-document proof additionally requires the server-only web flag `LASH_PUBLIC_DOCUMENT_ACCESS_ENABLED=true`, dedicated matching `LASH_WORKER_PUBLIC_CONTROL_SECRET_CURRENT` values in Next and the Worker, `LASH_PUBLIC_RATE_KEY_SECRET` of at least 32 UTF-8 bytes, and `LASH_TRUSTED_CLIENT_ADDRESS_HEADER` set exactly to `x-forwarded-for` or `cf-connecting-ip`. The configured platform or a root-controlled local reverse proxy must overwrite that header with one canonical bare IPv4 or IPv6 address; comma-separated forwarding chains, ports, whitespace, and browser-supplied values fail closed.
- Worker public-session issuance is independently closed unless `LASH_PUBLIC_DOCUMENT_ACCESS_PHASE=enabled` and `LASH_PUBLIC_READ_ROOM_ALLOWLIST` is a bounded, duplicate-free comma-separated list of exact canonical room IDs. This phase is separate from the existing owner-promotion `LASH_SHARE_PHASE`; enabling account ownership must never implicitly enable public recipients.
- Typed public-comment proof is a third independently closed boundary. Next requires exact `LASH_PUBLIC_COMMENT_ACCESS_ENABLED=true` and `LASH_WORKER_PUBLIC_COMMENT_SECRET_CURRENT` of at least 32 UTF-8 bytes in addition to the existing site origin, Worker HTTP origin, account-principal key, trusted-address header, and public rate-key secret. The Worker requires exact `LASH_PUBLIC_COMMENT_ACCESS_PHASE=enabled`, its own matching current secret plus optional previous secret, and `LASH_PUBLIC_COMMENT_ROOM_ALLOWLIST`; every comment room must also be present in the public-read allowlist. Owner soft-hide moderation remains available through the existing owner-management phase and control secret even when public-comment creation is disabled.

### Named editors

The web server and Worker both require `LASH_NAMED_EDIT_PHASE=enabled`.
The Worker also requires `LASH_SHARE_PHASE=enabled`. The web runtime uses
`LASH_NAMED_EDIT_KEY`, a dedicated stable base64url key of at least 32 decoded
bytes, for invitation identity and email protection. Retain it across deploys.
Use `LASH_SITE_ORIGIN` for the exact HTTPS origin, configure account sign-in
redirects for that origin, and set the matching control secret in both services.
`NEXT_PUBLIC_LASH_REALTIME_URL` is a build-time setting. The Worker and web
service must target the same room deployment.

The owner copies a link for a named recipient. Redemption requires the matching
verified account. Run the account and named-editor suites with two separate
browser profiles on a staging instance before enabling the route for users.
Keep public read and comment rollout independent. The Worker refuses public
delivery for documents containing recipient-sensitive references.

## Hosting

For account-backed collaboration, deploy the dynamic web service defined in
`render.yaml` with its matching Worker and account provider. The web process
binds to `0.0.0.0:$PORT`. Run `make verify-render` to exercise the same start
command on a new document and the home route. Verify the deployed candidate
with two signed-in browsers, including reload, revocation and room restart.

Cloudflare Pages serves the browser-local preview. The Documents catalog lives
at `/documents/` and local document links use `/?doc=<id>`. Account and shared
room operations require the dynamic service. See [release notes](RELEASE_NOTES.md)
for the supported writing and review journeys.

## Realtime Worker Preflight

1. Generate and inspect binding/runtime types after config changes: `pnpm --filter @lash/realtime-worker types`. The generated `Env` must include both `LASH_REALTIME_ROOM` and `LASH_DOCUMENT_CLAIM`.
2. Confirm `wrangler.jsonc` retains migration tag `v1` for `LashRealtimeRoom` and additive tag `v2` for `LashDocumentClaim`; never rewrite or reuse a deployed migration tag.
3. Typecheck the Worker: `pnpm --filter @lash/realtime-worker typecheck`.
4. Set the production session signing secret before publishing: `npx wrangler secret put LASH_REALTIME_SESSION_SECRET --config packages/realtime-worker/wrangler.jsonc`.
5. A production invite signing secret remains necessary for any future authoritative issuer: `npx wrangler secret put LASH_REALTIME_INVITE_SECRET --config packages/realtime-worker/wrangler.jsonc`. It is not sufficient to open the Bead 41 legacy token route. Use the named account invitation flow described above for production editor access.
6. Account promotion additionally requires the current Worker control secret and an explicit closed-by-default `LASH_SHARE_PHASE`; never print either value. Initial Worker v2 deployment stays closed while the new binding, migration, health, and negative v1/v2 routes are checked.
7. Validate deploy shape without publishing: `make realtime-dry-run`. The output must list both Durable Object bindings.
8. Verify local token issuance, denied unauthenticated access, room health, WebSocket upgrade, signed v1 promotion cutoff, and signed v2 claim promotion before activation.
9. Roll out Worker v2 first. Only after its binding/migration and v1 cutoff are verified may the matching v2 Next caller be enabled. There is no v2-to-v1 fallback.
10. Verify the deployed web and Worker revisions together before enabling collaboration on a shared document.
11. Rollback before any v2 claim is activated may return to the preceding compatible Worker. After a `LashDocumentClaim` alias exists, disable the web promotion path first, set the Worker share phase closed/frozen, preserve every claim/room row, and roll back only to a Worker version that includes the v2 class, binding, and schema. Never select a pre-v2 Worker or delete the claim Durable Object to force rollback.
12. Public-document rollout is Worker first and closed by default: configure the dedicated current/previous public-control secrets, leave `LASH_PUBLIC_DOCUMENT_ACCESS_PHASE` closed, verify denial, then enable only an exact `LASH_PUBLIC_READ_ROOM_ALLOWLIST` canary. Configure the matching Next secret and trusted rate-key settings, keep `LASH_PUBLIC_DOCUMENT_ACCESS_ENABLED` closed until the Worker canary is healthy, and only then run a clean signed-out browser journey.
13. Public-document rollback disables the Next public-access flag first, then the Worker public-access phase. Change every allowlisted canary document to `restricted` to increment its cutoff and close protocol-v4 sockets, verify no active public-v4 sockets, and wait past the 60-second unused-ticket lifetime. Preserve public policy, ticket, rate, audit, and Yjs rows; never downgrade or delete the additive room schema.
14. Public-comment rollout is also Worker first: deploy the additive comment/rate/audit/moderation schema and routes with `LASH_PUBLIC_COMMENT_ACCESS_PHASE` closed; configure current/previous comment secrets; verify disabled and wrong-room denial; then enable only one disposable room that is already in the public-read allowlist. Deploy Next with `LASH_PUBLIC_COMMENT_ACCESS_ENABLED` still closed, verify the exact same-origin/CSRF negatives, then enable the one-room BFF canary and run the real account/browser post, reload, owner hide, and policy cutoff journey.
15. Rotate the public-comment service secret Worker first (`CURRENT=new`, `PREVIOUS=old`), then Next (`CURRENT=new`), and remove the Worker previous value only after the 60-second assertion lifetime has elapsed across every Next instance. Next never loads or signs with the previous secret.
16. Public-comment rollback disables Next authoring first, then closes the Worker comment phase and removes the comment allowlist. If abuse or uncertainty exists, set affected documents to Read or Restricted through owner Settings. Preserve comment, moderation-receipt, rate, and audit rows; never drop the additive tables or fall back to a writable protocol-v4 socket.

## Realtime Worker Health

- Service health: `GET /api/realtime/health`.
- Room session grant candidate: `POST /api/realtime/rooms/<doc-id>/session` with exact JSON keys `actorId` and `inviteToken`, `Content-Type: application/json`, and a 16 KiB request limit. Token-free `GET .../session?actorId=<actor-id>` exists only for exact-loopback fallback development. A successful local response and signed grant both declare `protocolVersion: 2`. Configured non-loopback invite requests fail terminally with `invite-authority-unavailable`; production Comment/Suggest/Edit issuance is not available.
- Room health: `GET /api/realtime/rooms/<doc-id>/health?accessToken=<token>`; requires `doc.read`; includes `persistence.updates`, `persistence.snapshotSequence`, and `persistence.hydrationUpdates`.
- Room socket: `GET /api/realtime/rooms/<doc-id>/socket?accessToken=<token>&protocolVersion=2` with `Upgrade: websocket`; requires `doc.read`. URL-free WebSocket session transport remains an explicit production hardening item.
- Room restore: `POST /api/realtime/rooms/<doc-id>/restore?accessToken=<token>` with body `{ "update": "<base64-yjs-update>" }`; requires `doc.edit`; appends a new restore update and broadcasts it to connected peers.
- Room socket protocol v2: the Worker attaches the protocol version and `hydrated: false`, emits `room-ready`, replays persisted `yjs-update` frames, emits `room-hydration-complete`, and only then marks the socket hydrated and includes it in presence, persistence, or broadcast. Legacy, malformed, pre-hydration, and non-OPEN hibernated sockets are excluded. A current hibernated attachment additionally requires normalized nonempty actor/room IDs, unique capabilities including `doc.read`, and scope-consistent edit capability. Post-hydration `yjs-update` messages require `doc.edit`, may include `updateId`, and receive `sync-ack` after persistence; read-only sockets receive `scope_mismatch` before persistence or broadcast. `awareness-update` messages carry label/color/selection and receive room-scoped `awareness-state` lists.
- CORS preflight: handled routes return 204 and the exact allow-header list `authorization, cache-control, content-type`; requested header values and bearer-shaped strings are not reflected.
- Local verification command: `pnpm run verify:realtime`.

## Cloudflare Pages Preflight

1. Stop local `next start` before building: `make stop`.
2. Verify auth: `npx wrangler whoami`.
3. Build static assets: `pnpm run build:static`.
4. Deploy: `make deploy-cloudflare CLOUDFLARE_PAGES_PROJECT=lash`.
5. Verify public URL: `make verify-cloudflare URL=https://lash-9xx.pages.dev/`.

## Public Performance Gate

- Public verification runs `apps/web/e2e/smoke/home.spec.ts` and `apps/web/e2e/performance/typing-latency.spec.ts` with `PLAYWRIGHT_BASE_URL`.
- Essay typing threshold: p95 browser event processing < 8 ms, max event processing < 50 ms, full essay typed < 5 s, zero long tasks, and no character loss.
- Local large-document typing gate: `apps/web/e2e/performance/large-doc-typing.spec.ts` seeds 10k-word and 50k-word docs through test hooks and enforces p95 event work < 8 ms plus max event work < 50 ms. Check the final text after saving and reopening.

## Rollback

- Health check: `curl -fsSI https://lash-9xx.pages.dev/`
- Smoke URL: `https://lash-9xx.pages.dev/`
- Cloudflare Pages rollback path: Cloudflare dashboard -> Workers & Pages -> `lash` -> Deployments -> promote a prior successful deployment.
- CLI deployment inspection: `npx wrangler pages deployment list --project-name lash --environment production`
- CLI fallback: redeploy a known-good checkout with `make deploy-cloudflare`.
- Realtime Worker rollback path: disable the v2 web caller first and close/freeze new Worker promotion. Inspect versions with `pnpm exec wrangler versions list --config packages/realtime-worker/wrangler.jsonc`, then select only a version that retains every activated Durable Object class/migration. After any claim alias exists, do not roll back to a pre-`LashDocumentClaim` version; preserve all alias, owner, projection, audit, and Yjs rows.
- Render rollback path: use Render Dashboard -> `lash-doc-web` -> Deploys -> Roll back to the previous successful deploy, or trigger a known-good commit after the service is created from `render.yaml`.
- For future deploy-affecting beads, record the health check URL, smoke URL, and rollback command/path in `handoff/beads.jsonl`.
