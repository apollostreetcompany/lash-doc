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

- Account-provider proof uses the repository-pinned Supabase CLI `2.110.0`, never an ambient/global CLI. Lash's isolated local stack binds API/Auth `55321`, Postgres `55322`, Studio `55323`, Mailpit `55324`, SMTP `55325`, and shadow database `55320`; check all six ports before `make supabase-start`. The unrelated local Supabase project on `54320`-`54324` is outside Lash scope and must not be stopped or reconfigured.
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

## Deploy Assumptions

- Public test deployment target: Cloudflare Pages project `lash`.
- Current Bead 38 compiler boundaries are repaired and green: `pnpm run typecheck:product` checks exactly 77 shipped web/package roots plus the realtime Worker; `pnpm run typecheck:harness` checks all 121 E2E/evidence TypeScript files plus `playwright.config.ts`; and the combined `pnpm run typecheck` passes. The unit suite remains an executed behavior gate, not a strict unit-source compiler claim, until `PROD-TSC-UNIT-01` closes. Dynamic build/Render deployability is now locally confirmed: `pnpm run build` passes and `make verify-render` proves `/` plus dynamic `/doc/render-smoke` on the exact `next start -H 0.0.0.0 -p $PORT` runtime. No Render service or public dynamic deployment exists yet. `ignoreBuildErrors` remains forbidden.
- Immediate disposable public-preview path: after the tailnet owner enables Funnel at `https://login.tailscale.com/f/funnel?node=nSgDcAyKkZ11CNTRL`, run `tailscale funnel --bg --yes 3000`, inspect `tailscale funnel status`, and verify the emitted HTTPS `/doc/lash-live-test` route. Funnel exposes an unauthenticated public URL and must use disposable content only; the Mac and local Lash service must stay awake. It exposes the single-user browser-local product but does not create cross-browser collaboration. Roll back with `tailscale funnel reset`.
- Public test URL: `https://lash-9xx.pages.dev/`.
- Static export output is `apps/web/out`. The static build includes a browser-local writing workspace at `/?doc=<id>`, its `/documents/` catalog, and a fallback page. Arbitrary `/doc/<id>`, account, public document, and API routes need the dynamic server. The published Pages site is an earlier static release.
- Deploy command: `make deploy-cloudflare`.
- Public smoke/performance verification command: `make verify-cloudflare URL=https://lash-9xx.pages.dev/`.
- The dynamic Render Blueprint in `render.yaml` defines `lash-doc-web` on Node 22. It installs the frozen pnpm lockfile and runs `pnpm run build:ci`, which keeps the shipped-product compiler gate and uses the hosted build entry point. The service starts with `pnpm --filter @lash/web exec next start -H 0.0.0.0 -p $PORT`.
- The migrated lockfile audit reports zero Next.js advisories and zero high or critical production advisories. One moderate finding remains in TipTap 2.26.2. Its upstream fix requires TipTap 3.30.4 or later. Account-backed activation requires the deployment matrix and its associated review and clean-browser evidence.
- Public Read and Comment activation requires a verified trusted proxy, matched Worker and web configuration, scoped room allowlists, and a staged rollback check. The local named-editor simulation leaves these public access phases closed.
- Public comment authoring/list/moderation also remain local-only until the additive Worker schema and exact BFF/UI are independently reviewed, owner soft-hide moderation is browser-proven, and one real verified-account magic-link -> post -> reload -> cutoff canary passes. The public page never receives an account principal: a dedicated 10-minute HttpOnly/SameSite=Strict CSRF session cookie plus in-memory proof binds create to the current verified account and room, while the Worker rechecks policy/cutoff at commit.
- Dynamic Render preflight command: `make verify-render`; it runs the production dynamic build and verifies `/` plus `/doc/render-smoke` through `next start` on `0.0.0.0:$PORT`.
- GitHub remote is `https://github.com/apollostreetcompany/lash-doc.git`.
- Default branch is `main`.
- Branch protection is configured on `main` with strict required `build-and-test`, admin enforcement, and no force-push/delete.
- GitHub Actions CI uses Node 22 because current Wrangler releases require Node 22+.
- GitHub Actions CI exposes separate shipped-product and Playwright/evidence typecheck steps, then runs unit behavior, browser E2E, and the product build. Browser E2E uses `pnpm run test:e2e:ci`, which rebuilds `apps/web` with `NEXT_PUBLIC_LASH_TEST_HOOKS=true` and serializes Playwright with `--workers=1` to avoid realtime Worker port contention and shared-runner performance jitter.
- Latest protected `main` CI is green on integrated Beads 23-36 commit `1b85b26682505d5a8e10e6051c4f4464b612898c` via run `26914289177`; it passed lint, typecheck, unit tests, serialized E2E, and build.
- Latest Bead 36 PR CI was green on PR #28 run `26913934385`; PR #28 then merged the complete Beads 23-36 stack to `main`.
- Container/runtime binding assumptions are not applicable to the Cloudflare Pages test site because it serves static assets at the edge. The existing local `next start` path remains unchanged.
- Bead 28 chooses Cloudflare Durable Objects as the realtime room runtime. The app now has a deploy-shaped `lash-realtime` Worker with `/api/realtime/health`, `/api/realtime/rooms/:id/health`, and `/api/realtime/rooms/:id/socket` endpoints.
- J13 F2 adds Wrangler migration tag `v2` and the `LASH_DOCUMENT_CLAIM` / `LashDocumentClaim` SQLite Durable Object. That coordinator serializes account/local-document promotion across room-key rotation; it does not replace `LASH_REALTIME_ROOM` as content/owner authority. Dry-run must show both bindings before any v2 web caller is enabled. The old signed direct-room promotion route is intentionally cut off, so rollout order is Worker v2 first, then the v2 Next caller, with no v2-to-v1 fallback.
- Bead 30 introduced signed realtime session grants. The Bead 41 candidate supersedes its browser exchange with strict `POST /api/realtime/rooms/:id/session` JSON `{ "actorId": "...", "inviteToken": null | "..." }` and protocol version 2. Bearer invite credentials are never accepted in a session URL; legacy `GET` remains only for token-free, exact-loopback owner development. Local development uses public non-production fallback secrets only on loopback hosts.
- Bead 31 persists realtime document CRDT state in the per-document Durable Object using SQLite-backed storage. Each accepted Yjs update is appended before broadcast, snapshots compact hydration state periodically, new sockets hydrate from the latest snapshot plus later updates, and restore appends a new head update instead of deleting history.
- Bead 32 makes realtime opt-in for unconfigured local browser sessions so normal large-document typing does not pay collaboration runtime overhead. Online typing Playwright coverage opts in explicitly before opening document pages.
- Bead 33 carries presence on the existing realtime room socket: clients send room-scoped `awareness-update` messages, the Durable Object sends same-room `awareness-state` peer lists, and persisted client updates return `sync-ack` messages for saved/syncing UI.
- Bead 34 added a browser-local invite fixture and signed token shape. Bead 41 removes that issuer/list/revocation UI from normal builds and retains it only behind an explicit test-hook, exact-loopback, authorized-and-hydrated owner fixture. Incoming normal-build invite fragments never mount a local document as shared content; terminal decisions clear the room credential and remove only the invite fragment field. Durable server-side issuance, revocation, active-session cutoff, audit, and canonical title/body hydration remain follow-up work.
- Bead 35 stores document chat thread metadata and suggestion resolution records in document-scoped localStorage for local-only sessions, and mirrors them into per-record Y.Map entries in the existing realtime Y.Doc when realtime is enabled. No new deploy secret, binding, database, or service is required; Durable Object persistence captures these metadata updates through the same append-only Yjs update log and snapshot path as document content.
- Bead 36 adds web UI and local test configurability: collaboration Ready/share, sync feedback, retry reconnect, and the `lash:realtime-url` localStorage override. Its post-subreview hardening also changes the realtime access split without adding a deploy secret, binding, database, or route: WebSocket joins require `doc.read`, while persisted/broadcast `yjs-update` messages require `doc.edit` inside the Durable Object.
- Bead 41 fails closed when the web runtime cannot prove an authoritative invite issuer. A configured realtime URL means only that transport is configured; it does not enable normal-build invite issuance, title/body hydration claims, durable revocation, or an `Access granted` state. Non-loopback configured invite exchange returns terminal HTTP 503 `{ "ok": false, "error": "invite-authority-unavailable", "retryable": false }`, even when signing secrets exist. Remote document resources are not created until session authorization succeeds, and the UI does not mount until a protocol-v2 `room-hydration-complete` frame follows all replayed updates. Session POSTs and socket-open/hydration each have a five-second attempt boundary; every reconnect re-enters hydration, unacknowledged Yjs bytes remain queued until a persistence ack, and protocol/auth/scope terminal outcomes do not auto-retry. Production collaboration remains closed until the deployed completion gate in `docs/reviews/bead-41-collaboration-truth-architecture.md` passes.
- INF-02 historical deployment receipt: Cloudflare Worker `lash-realtime` deployed to `https://lash-realtime.ryan-borker.workers.dev` as version `06150817-80d3-4c52-b86d-cbfd2ac92f4f` on 2026-06-24. That receipt predates the protocol-v2 candidate: public `GET /api/realtime/health` returned `ok: true`; unauthenticated legacy `GET /api/realtime/rooms/inf-02/session?actorId=public-check` returned `403 invalid`; `wrangler secret list` returned `[]`. It is not evidence that the current branch is deployed or that production document sessions work.
- The historical INF-01 `make verify-render` run on 2026-06-24 verified the dynamic `/doc/[id]` route. On 2026-11-18 the local Render CLI v2.6.1 token was expired, `RENDER_API_KEY` was absent, and the expected `lash-doc-web.onrender.com` hostname returned HTTP 404. Service inventory requires refreshed authentication. Configure the new service through the Render Dashboard Blueprint flow, the current Render CLI, or the Render API after the release gates pass.
- The existing Cloudflare Pages public test site remains the static host for the last static-export deployment. The Beads 23-36 merged `main` build includes Bead 27 `/doc/[id]` Next routes, which are now covered by the Render dynamic runtime Blueprint/preflight; Cloudflare Pages static export remains unsuitable for arbitrary dynamic document routes.

## Realtime Worker Preflight

1. Generate and inspect binding/runtime types after config changes: `pnpm --filter @lash/realtime-worker types`. The generated `Env` must include both `LASH_REALTIME_ROOM` and `LASH_DOCUMENT_CLAIM`.
2. Confirm `wrangler.jsonc` retains migration tag `v1` for `LashRealtimeRoom` and additive tag `v2` for `LashDocumentClaim`; never rewrite or reuse a deployed migration tag.
3. Typecheck the Worker: `pnpm --filter @lash/realtime-worker typecheck`.
4. Set the production session signing secret before publishing: `npx wrangler secret put LASH_REALTIME_SESSION_SECRET --config packages/realtime-worker/wrangler.jsonc`.
5. A production invite signing secret remains necessary for any future authoritative issuer: `npx wrangler secret put LASH_REALTIME_INVITE_SECRET --config packages/realtime-worker/wrangler.jsonc`. It is not sufficient to open the Bead 41 candidate; configured non-loopback invite exchange intentionally remains unavailable until durable revocation and active-session cutoff exist.
6. Account promotion additionally requires the current Worker control secret and an explicit closed-by-default `LASH_SHARE_PHASE`; never print either value. Initial Worker v2 deployment stays closed while the new binding, migration, health, and negative v1/v2 routes are checked.
7. Validate deploy shape without publishing: `make realtime-dry-run`. The output must list both Durable Object bindings.
8. Verify local token issuance, denied unauthenticated access, room health, WebSocket upgrade, signed v1 promotion cutoff, and signed v2 claim promotion before activation.
9. Roll out Worker v2 first. Only after its binding/migration and v1 cutoff are verified may the matching v2 Next caller be enabled. There is no v2-to-v1 fallback.
10. Do not deploy this candidate as production collaboration while the Next security upgrade and independent/deployed completion gates remain open.
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
- Latest candidate local verification: `LASH_REALTIME_PORT=8788 make verify-realtime-runtime` passed service health, unauthenticated denial, strict session exchange, protocol-v2 room health/hydration/ping, and listener cleanup. `make realtime-dry-run` also passed. No production deploy occurred.
- Latest candidate browser scope: invite Chromium passed 4/4 and an isolated authenticated synthetic-mention journey passed 1/1. The earlier full online realtime matrix predates this protocol retry and must be rerun before merge; it is not silently carried forward.

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
- Realtime Worker rollback path: disable the v2 web caller first and close/freeze new Worker promotion. Inspect versions with `pnpm exec wrangler versions list --config packages/realtime-worker/wrangler.jsonc`, then select only a version that retains every activated Durable Object class/migration. After any claim alias exists, do not roll back to a pre-`LashDocumentClaim` version; preserve all alias, owner, projection, audit, and Yjs rows.
- Render rollback path: use Render Dashboard -> `lash-doc-web` -> Deploys -> Roll back to the previous successful deploy, or trigger a known-good commit after the service is created from `render.yaml`.
- Tailscale Funnel rollback path: `tailscale funnel reset`, then confirm `tailscale funnel status` reports no serve configuration.
- For future deploy-affecting beads, record the health check URL, smoke URL, and rollback command/path in `handoff/beads.jsonl`.
