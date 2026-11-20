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

## Hosting

The [public Documents page](https://lash-9xx.pages.dev/documents/) stores drafts
in the writer’s browser. A hosted collaborative trial uses the dynamic web
service in [render.yaml](render.yaml), a matching realtime Worker and a
dedicated Supabase Auth project. Choose the web and Worker HTTPS origins first.

### Configure the web service and Worker

| Where | Setting | Value |
| --- | --- | --- |
| Render | `LASH_SITE_ORIGIN` | Exact HTTPS origin that writers open. Forward its hostname and HTTPS scheme to Next. |
| Render | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Auth project URL and its publishable key. Keep the same project for returning writers. |
| Render | `NEXT_PUBLIC_LASH_REALTIME_URL`, `LASH_REALTIME_WORKER_HTTP_URL` | The same Worker origin, using `wss://` for the browser at build time and `https://` for server requests. Both omit paths. |
| Render | `LASH_ACCOUNT_PRINCIPAL_HMAC_KEY`, `LASH_NAMED_EDIT_KEY` | Separate, stable secrets. Use at least 32 UTF-8 bytes for the first and unpadded base64url encoding of at least 32 random bytes for the second. |
| Render | `LASH_DOCUMENT_ID_DERIVATION_KEYS` | Begin with `v1:<key>`, where the key is at least 32 random bytes encoded as unpadded base64url. This maps device IDs to account documents. Keep the ring across deploys. On rotation, put the new key first and retain the older versioned keys, up to four entries separated by commas. |
| Render and Worker | `LASH_WORKER_CONTROL_SECRET_CURRENT` | The same server-side secret on both services, at least 32 UTF-8 bytes. |
| Worker | `LASH_REALTIME_SESSION_SECRET` | A separate signing secret for room sessions. Store it in the Worker’s secrets. |

Use the hosting providers’ secret settings. The [local launcher](scripts/dev-collab.mjs)
shows which process consumes each value. Generate separate keys for staging.

### Deliver the sign-in link

In the trial’s Supabase Auth project, enable email sign-in and confirmation,
and set the Site URL to the exact web origin. Allow the callback on that same
origin at `/auth/confirm`. Lash generates new `next` and `state` values for
each sign-in. Verify both arrive in the delivered link.
Install both checked-in templates in the dashboard. Use
[Confirm signup](supabase/templates/confirmation.html) for a new account and
[Magic Link](supabase/templates/magic_link.html) for a returning account.
They preserve `RedirectTo` and append the token hash and `type=email` that
the Lash callback verifies. The writer opens the email in the browser where
they requested it. Configure SMTP for recipients outside the project team and
turn off mail-link tracking so the callback arrives intact.
[Email templates](https://supabase.com/docs/guides/auth/auth-email-templates) ·
[SMTP settings](https://supabase.com/docs/guides/auth/auth-smtp)

### Deploy and verify the two roles

1. Deploy the Worker at the reviewed Git revision with the sharing phases
   closed. Verify the room and document-claim bindings using the Worker
   preflight below. Then set `LASH_SHARE_PHASE=enabled` on the Worker and
   `LASH_NAMED_EDIT_PHASE=enabled` on both services. For a **Can comment**
   trial, also set `LASH_NAMED_COMMENT_PHASE=enabled` on both. Keep public
   read and public commenting disabled during a named-only trial.
2. Choose **Save only** after editing the Render environment. If the service
   is Blueprint-managed, turn off Blueprint Auto Sync for the fixed trial so
   it retains its deployment settings. Choose
   **Manual Deploy → Deploy a specific commit** in the dashboard and select
   the same revision as the Worker. This pins the web release and disables
   automatic deploys for the service. The build picks up the public socket
   URL. [Render deployment controls](https://render.com/docs/deploys#deploying-a-specific-commit) · [Blueprint sync](https://render.com/docs/infrastructure-as-code)
3. Visit the dynamic URL in a signed-out browser. `GET /api/account/session`
   should return `401` with `authenticated: false` and `no-store`. The root
   health check and local `make verify-render` establish that Next serves
   pages. Finish the account check with a first-time sign-in and a returning
   sign-in through delivered emails. Each should return to the intended draft.
4. In separate browser profiles, have the owner save a device draft to their
   account, copy an invitation for a named editor, exchange edits and reload.
   Redemption requires the matching verified account. Invite a
   **Can comment** reviewer, propose and accept a change, and confirm the
   reviewer cannot type directly in the body. Revoke access and verify the
   open recipient loses it. Check that the owner’s content and history survive
   reopening and a room restart. Use disposable trial documents.

The local launcher enables both named roles. Public delivery separately refuses
documents with recipient-sensitive references. The reviewer receives the current
title and body. Private reference chips, unsupported metadata and projections above 1 MiB make a document ineligible
for a reviewer session. To disable new reviewer access, close its web and
Worker phases and retain stored grants and feedback.

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
- Room session grant candidate: `POST /api/realtime/rooms/<doc-id>/session` with exact JSON keys `actorId` and `inviteToken`, `Content-Type: application/json`, and a 16 KiB request limit. Token-free `GET .../session?actorId=<actor-id>` exists only for exact-loopback fallback development. A successful local response and signed grant both declare `protocolVersion: 2`. Configured non-loopback invite requests fail terminally with `invite-authority-unavailable`; this legacy endpoint does not issue production role grants. Use named invitations for authenticated editors and reviewers.
- Room health: `GET /api/realtime/rooms/<doc-id>/health?accessToken=<token>`; requires `doc.read`; includes `persistence.updates`, `persistence.snapshotSequence`, and `persistence.hydrationUpdates`.
- Room socket: `GET /api/realtime/rooms/<doc-id>/socket?accessToken=<token>&protocolVersion=2` with `Upgrade: websocket`; requires `doc.read`. URL-free WebSocket session transport remains an explicit production hardening item.
- Room restore: `POST /api/realtime/rooms/<doc-id>/restore?accessToken=<token>` with body `{ "update": "<base64-yjs-update>" }`; requires `doc.edit`; appends a new restore update and broadcasts it to connected peers.
- Room socket protocol v2: the Worker attaches the protocol version and `hydrated: false`, emits `room-ready`, replays persisted `yjs-update` frames, emits `room-hydration-complete`, and only then marks the socket hydrated and includes it in presence, persistence, or broadcast. Legacy, malformed, pre-hydration, and non-OPEN hibernated sockets are excluded. A current hibernated attachment additionally requires normalized nonempty actor/room IDs, unique capabilities including `doc.read`, and scope-consistent edit capability. Post-hydration `yjs-update` messages require `doc.edit`, may include `updateId`, and receive `sync-ack` after persistence; read-only sockets receive `scope_mismatch` before persistence or broadcast. `awareness-update` messages carry label/color/selection and receive room-scoped `awareness-state` lists.
- CORS preflight: handled routes return 204 and the exact allow-header list `authorization, cache-control, content-type`; requested header values and bearer-shaped strings are not reflected.
- Local verification command: `pnpm run verify:realtime`.

## Cloudflare Pages Release

The protected `build-and-test` job builds the static export and checks the
ordinary Documents and Markdown handoff journeys. A successful push run on
`main` keeps one `lash-pages-<commit>-<attempt>` artifact for 14 days. The
artifact contains the site tarball. CI leaves publication to the operator.

Find the successful `CI` push run and attempt for the reviewed `main` commit.
Set `run_id`, `source_sha`, and `attempt` to its run ID, full commit SHA, and
attempt number. Set `archive_sha` to the SHA-256 recorded in the run summary.
Download and verify the matching archive before extracting it.

```sh
release_dir=$(mktemp -d)
archive="lash-pages-${source_sha}-${attempt}"
gh run download "$run_id" --name "$archive" --dir "$release_dir" &&
  printf '%s  %s\n' "$archive_sha" "$release_dir/$archive.tar.gz" | shasum -a 256 -c - &&
  mkdir "$release_dir/site" &&
  tar -xzf "$release_dir/$archive.tar.gz" -C "$release_dir/site"
```

With the existing Pages authorization, publish the extracted site to a branch
preview and run the browser checks at the returned `preview_url`.

```sh
pnpm exec wrangler whoami
pnpm exec wrangler pages deploy "$release_dir/site" --project-name lash \
  --branch "release-${source_sha}" --commit-hash "$source_sha"
LASH_STATIC_PREVIEW_URL="$preview_url" pnpm exec playwright test \
  --config=playwright.static-preview.config.ts --workers=1
```

Record the current successful production deployment ID for rollback. After the
preview passes, publish the same extracted directory to `main`, then repeat the
browser checks against the canonical origin and run its public performance gate.

```sh
pnpm exec wrangler pages deploy "$release_dir/site" --project-name lash \
  --branch main --commit-hash "$source_sha"
LASH_STATIC_PREVIEW_URL=https://lash-9xx.pages.dev pnpm exec playwright test \
  --config=playwright.static-preview.config.ts --workers=1
make verify-cloudflare URL=https://lash-9xx.pages.dev/
```

If the artifact is unavailable, use `NEXT_PUBLIC_LASH_TEST_HOOKS=false make deploy-cloudflare`
from an exact reviewed checkout. It builds locally, so stop the checkout’s owned
Next server first and satisfy the local disk check. Set `CLOUDFLARE_BRANCH` to
your preview branch and verify it before publishing to `main`.

## Public Performance Gate

- Public verification runs `apps/web/e2e/smoke/home.spec.ts` and `apps/web/e2e/performance/typing-latency.spec.ts` with `PLAYWRIGHT_BASE_URL`.
- Essay typing threshold: p95 browser event processing < 8 ms, max event processing < 50 ms, full essay typed < 5 s, zero long tasks, and no character loss.
- Local large-document typing gate: `apps/web/e2e/performance/large-doc-typing.spec.ts` seeds 10k-word and 50k-word docs through test hooks and enforces p95 event work < 8 ms plus max event work < 50 ms. Check the final text after saving and reopening.

## Rollback

- Health check: `curl -fsSI https://lash-9xx.pages.dev/`
- Smoke URL: `https://lash-9xx.pages.dev/`
- Cloudflare Pages rollback path: Cloudflare dashboard -> Workers & Pages -> `lash` -> Deployments. Open the actions menu for the recorded production deployment and select **Rollback to this deployment**.
- CLI deployment inspection: `npx wrangler pages deployment list --project-name lash --environment production`
- CLI fallback: redeploy a known-good checkout with `NEXT_PUBLIC_LASH_TEST_HOOKS=false make deploy-cloudflare`.
- Realtime Worker rollback path: disable the v2 web caller first and close/freeze new Worker promotion. Inspect versions with `pnpm exec wrangler versions list --config packages/realtime-worker/wrangler.jsonc`, then select only a version that retains every activated Durable Object class/migration. After any claim alias exists, do not roll back to a pre-`LashDocumentClaim` version; preserve all alias, owner, projection, audit, and Yjs rows.
- Render rollback path: use Render Dashboard -> `lash-doc-web` -> Deploys -> Roll back to the previous successful deploy, or trigger a known-good commit after the service is created from `render.yaml`.
- For future deploy-affecting beads, record the health check URL, smoke URL, and rollback command/path in `handoff/beads.jsonl`.
