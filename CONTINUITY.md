# CONTINUITY.md - Lash

## Goal (incl. success criteria)

Complete Beads 23-36: close the public-test regressions for title, @mentions, and sidebar, then implement the true responsive online typing track through document identity, realtime runtime, CRDT binding, actor/access boundaries, durable persistence, large-doc performance, presence/sync state, invite/access UX, durable comments/suggestions, and collaboration delight. Riddle is optional/deferred; no Lash-Riddle code integration until Riddle stabilizes as its own product.

Success criteria:

- Every scoped bead has fail-first test evidence before implementation.
- Every scoped bead passes its targeted tests plus appropriate lint, typecheck, unit, build, e2e, and deployment gates for its risk class.
- True online typing is proven by real two-client browser tests, not local-only mocks.
- `subreview` and a fresh-eyes review pass over the completed scoped bead set.
- Riddle remains planning-only in Lash.

## Constraints/Assumptions

- No direct commits to `main`; release cleanup completed through protected PR flow.
- GitHub remote is `https://github.com/apollostreetcompany/lash-doc.git`.
- Default branch is `main`.
- Branch protection on `main` requires strict `build-and-test`, enforces admins, and disallows force-push/delete.
- Riddle integration is planning-only; do not touch `/Users/borker/dev/riddle`.
- Cloudflare Pages hosts the current static public test site; future realtime infra should prefer Cloudflare Workers/Durable Objects first, then Render only if Cloudflare is insufficient.

## Key Decisions

1. Riddle remains optional and independent for now; Lash v1 should not depend on it.
2. Future Riddle integration, if requested, should enter through Lash's stable operation/history contracts rather than special-case mutation.
3. Bead 0 restores the Lash gate and missing process scaffolding before M2 work resumes.
4. Local history recording now waits for a 900 ms idle window so a normal typing session does not fragment into multiple history versions under load.
5. Doc Chat starts as local in-memory product behavior: anchors, orphaning, context, and filters are validated before server/RBAC persistence lands.
6. Share/RBAC starts with local signed links, capability decisions, audit events, and redaction placeholders before server persistence/API enforcement lands.
7. Mentions/date chips start with local providers and deterministic natural-date parsing; visibility decisions route through `@lash/rbac`, hidden entities render anonymized, and no Riddle integration is introduced.
8. Offline queue/presence starts with a local deterministic collab room: edits queue while offline, replay on reconnect into the semantic op pipeline, and presence state resumes without introducing a websocket runtime yet.
9. Large table performance is guarded with scroll containment, fixed/min column sizing, and a 100x20 browser perf spec for insert, scroll, selection, and commit responsiveness.
10. Screen-reader acceptance starts with semantic landmarks and accessible names for document headings, outline navigation, diff announcements, and chat threads; this remains local UI coverage, not a Riddle integration point.
11. AI editor starts as a deterministic local `EditPatch` flow: generated patches are validated, staged for accept/reject, applied through append-only history with `intent: ai`, labeled in diffs, and cited by document ranges.
12. Cross-browser acceptance is now project-scoped in Playwright: the full Chromium suite runs once, and Chrome, Edge-UA Chromium, Firefox, WebKit/Safari, and iPad WebKit each run a focused editor smoke gate.
13. IME autosave is guarded by an explicit composition gate: transactions during composition do not schedule saves until `compositionend`, and only the final composed snapshot is persisted.
14. CI's skip/todo guard must fetch PR branch refs with ancestry and compute an explicit merge base; shallow endpoint-SHA fetches can make `BASE_SHA...HEAD_SHA` fail even when the PR branch contains the base.
15. Programmatic table perf selections should avoid forced scroll when the caller already controls viewport position, and table-cell panel state should be deduplicated so selection and transaction events do not trigger duplicate React renders for identical cell attrs.
16. Default-branch protection now requires strict `build-and-test`; release work should keep PR branches green before merge.
17. Large-table perf tests should assert synchronous dispatch budgets separately from animation-frame settling so CI worker contention does not masquerade as operation latency.
18. Local history recording debounce is 1800 ms after loaded full-suite runs showed 900 ms could still split a normal typed phrase into multiple history entries.
19. Decision 18 supersedes the 900 ms value in Decision 4; keep the 1800 ms debounce until a measured browser run supports lowering it.
20. Bead 20 closes the release with a post-merge audit artifact instead of adding product code; Riddle stays out of implementation.
21. Lash v1 is complete for the current local product objective after the release-audit cleanup merged and protected `main` CI passed.
22. Post-v1 mobile hardening landed through the six-agent PR stack in dependency order: foundation (#6), touch targets (#9), hover-on-touch (#10), drawer/editor UX (#5), print (#8), and mobile e2e coverage (#7). Final protected `main` CI passed on `7f03a7e`.
23. Bead 22 will publish Lash as a public test site on Cloudflare Pages using a static export path, because the current app is a client-side Next.js editor and edge-hosted static assets are the fastest low-risk deployment path. "No lag" is measured against the existing typing SLO: p95 per-character browser work under 8 ms while typing an essay.
24. Cloudflare Pages public verification passed on `https://lash-9xx.pages.dev/`: smoke loaded, 585-character essay typed in 1026 ms, p95 event work was 0.8 ms, max event work was 6.8 ms, and no long tasks were observed.
25. PR #12 CI stabilization keeps React outline publication off plain selection-only transactions, but uses the editor-core outline plugin metadata helper so collapse/expand transactions still refresh the outline panel and persistence state.
26. CI performance assertions distinguish product latency from runner scheduling jitter: typing keeps the p95 < 8 ms and zero-long-task gates, while large-table SLO enforcement stays on synchronous dispatch with looser frame-settle smoke bounds.
27. Bead 22 is merged and deployed from `main`: PR #12 squash-merged as `3f19bc3`, protected main CI run `26026635724` passed, Cloudflare redeploy produced preview `https://cad5a3ac.lash-9xx.pages.dev`, and production verification passed on `https://lash-9xx.pages.dev/` with 585 characters typed in 985 ms, p95 event work 0.8 ms, max event work 7.4 ms, and zero long tasks.
28. User-reported public-test regressions are tracked in `REGRESSIONS.md` and should be handled as Beads 23-25: title, @mentions, and sidebar. Each bead must first reproduce the failure with a failing test before implementation.
29. Bead 23 fixes the title regression with a local document-title metadata path under `lash:title:demo-document`; this is intentionally a bridge until Bead 27 replaces hardcoded document identity with real `/doc/[id]` routing and persisted metadata.
30. Bead 24 makes mentions real editor content by adding an inline atom `mention` node to the editor schema and replacing typed `@query` text with user/date mention chips on suggestion selection; the side-panel chip list remains as secondary activity evidence.
31. Bead 25 fixes the sidebar regression by keeping an explicit outline entry available while the desktop sidebar is collapsed and by exposing the mobile drawer close control for the tested close/focus-restore path; it does not change sidebar routing, permissions, or Riddle integration.
32. Bead 26 is an intentional red entry gate for true online typing: two-client browser tests now prove remote visibility, same-doc convergence, and reload durability are absent, while docs/comments now distinguish local collaboration-shaped scaffolds from implemented realtime backend behavior.
33. Bead 27 introduces real local document identity with `/doc/[id]` routing, a local document registry, per-doc title metadata, per-doc outline/history/panel IDs, and document create/open controls. It deliberately does not add realtime sync or durable document-body persistence; static export is known to fail for arbitrary doc routes until a web dynamic-route hosting strategy is chosen.
34. Bead 28 chooses Cloudflare Workers plus Durable Objects for realtime document rooms. The `lash-realtime` Worker exposes service/room health endpoints and a hibernatable WebSocket room socket; local verification runs through Wrangler on port `8787`, and deploy-shape verification uses `wrangler deploy --dry-run`. This does not yet bind TipTap/Yjs or durable document persistence.
35. Bead 29 binds the editor to Yjs-backed TipTap collaboration and the Bead 28 room socket. Same-doc remote visibility and concurrent typing convergence now pass through a local Wrangler realtime Worker; reload durability remains intentionally red for Bead 31 persistence.
36. Bead 30 introduces a signed actor grant boundary for realtime rooms. Browsers request a short-lived session token from `/api/realtime/rooms/:id/session`, room health requires `doc.read`, room sockets require `doc.edit`, and the Worker passes trusted actor context into the Durable Object. This is a local/session-token bridge only; real identity, roles, invites, and persistence remain later beads.
37. Bead 31 should persist document CRDT state inside the per-document Cloudflare Durable Object using SQLite-backed storage: append every accepted Yjs update before broadcast, compact periodically into a snapshot, hydrate new sockets from the latest snapshot plus later updates, and implement restore by appending a new head update rather than deleting historical rows.
38. Bead 31 implements Durable Object CRDT persistence with an append-only `yjs_updates` table, cumulative `yjs_snapshots`, socket hydration from snapshot plus tail updates, `POST /api/realtime/rooms/:id/restore` as an edit-scoped append-only restore hook, and persistence metadata in room health. Full online typing now passes unauthorized access, remote visibility, convergence, reload durability, and snapshot compaction.
39. Bead 32 keeps local realtime explicit opt-in unless `NEXT_PUBLIC_LASH_REALTIME_URL` is configured: local documents use plain TipTap without the Collaboration extension by default, while online typing tests opt in through `lash:realtime-enabled` or `?realtime=on`.
40. Bead 32 adds 10k/50k-word browser typing gates and removes the measured hot paths from normal local editing: outline publication is deferred for body-text transactions, offscreen document blocks use `content-visibility`, and the release gate enforces p95/max per-input event work under the typing SLO while logging residual rendering long tasks for future virtualization work.
41. Bead 33 adds room-scoped awareness on the existing realtime socket instead of a second presence transport: clients send `awareness-update`, the Durable Object rebroadcasts same-room peer state only, and accepted Yjs updates receive `sync-ack` messages so the browser can show saved/syncing/reconnecting state.
42. Bead 33 keeps presence identity as the signed local actor ID from Bead 30; real profile names, avatars, invite roles, and access UX remain Bead 34 work.
43. Bead 34 closes the realtime session default-grant hole for production-shaped environments: when `LASH_REALTIME_SESSION_SECRET` is configured, `/api/realtime/rooms/:id/session` now requires a valid signed invite token and maps its scope to a short-lived session grant instead of minting read+edit for any actor/room.
44. Bead 34 invite UX is intentionally a local/static bridge until durable invite management lands: invite links use `#invite=<token>`, browser localStorage stores collaborator rows and same-browser revocations, the URL hash is stripped after validation, and the realtime provider forwards the invite token when realtime is enabled. DO-backed invite issuance, global revocation, and audit remain open.
45. Bead 34 enforces `view`/`comment`/`edit` UX boundaries in the browser and preserves the original scope on realtime grants. Fine-grained server-side distinction between comment/suggest/edit over opaque Yjs updates remains out of scope until durable comments/suggestions and policy-aware mutation validation exist.
46. Decisions 43-45 supersede the Bead 34 future-work portion of Decision 42; profile names/avatars and server-durable invite management remain future work, but invite/access UX itself is now implemented locally.
47. Bead 35 persists document chat threads, replies, resolve/reopen status, and suggestion accept/reject resolution records. Local-only docs use document-scoped localStorage; realtime docs mirror each thread/resolution as separate Y.Map keys inside the existing Y.Doc so Bead 31 Durable Object update persistence hydrates them with the document. This does not add a separate comments API, global moderation/audit store, or server-side fine-grained comment/suggest authorization.
48. Bead 36 adds a compact collaboration delight layer without changing realtime protocol or persistence: the presence strip now shows a Ready empty state with an invite shortcut, a live sync feedback chip, and a reconnect retry action. Local tests can override the realtime socket URL with `localStorage['lash:realtime-url']` so parallel online specs can use separate Wrangler ports.
49. Post-subreview Bead 36 hardening changes the realtime access split: room sockets now require `doc.read` so view invitees can hydrate, accepted `yjs-update` messages require `doc.edit` inside the Durable Object before persistence/broadcast, and the browser provider avoids sending local Yjs updates for read-only session grants. Local-only documents no longer show Ready/Invite collaboration chrome, and visible sync state is not duplicated with the screen-reader live region.
50. Fresh-eyes Bead 36 hardening restricts the no-secret realtime development fallback to loopback hosts only. A Worker without `LASH_REALTIME_SESSION_SECRET` now denies `/session` minting on non-local hosts instead of silently using the local development secret; local `127.0.0.1`/`localhost` verification remains supported.
51. CI now runs on Node 22 and uses `pnpm run test:e2e:ci`, which rebuilds the web app with Lash test hooks and runs Playwright with one worker. Wrangler 4.97 requires Node 22+, and the realtime/performance browser suite needs serialized execution on shared CI runners to avoid Worker port contention and scheduling noise that masks product latency.

## State

### Done

- [x] M0/M1 Phase 0 feature work merged per `RELEASE_NOTES.md`.
- [x] Bead 0 - Restore Lash release gate and process scaffolding.
- [x] Bead 1 - Local MVP run path (`make serve`, `make status`, `make stop`).
- [x] Bead 2 - Append-only history log and deterministic replay/diff foundation.
- [x] Bead 3 - Web history timeline, diff, and restore UI.
- [x] Bead 4 - Authorship interval-map foundation.
- [x] Bead 5 - Blame gutter UI and history filter-by-author.
- [x] Bead 6 - Filtered diffs and local suggest-mode accept/reject.
- [x] Bead 7 - Doc Chat anchored threads, context, and filters.
- [x] Bead 8 - Share links, RBAC decisions, audit, and redaction.
- [x] Bead 9 - Mentions, RBAC-hidden suggestions, and natural-date chips.
- [x] Bead 10 - Offline queue, reconnect merge, and presence resume.
- [x] Bead 11 - Large table 100x20 performance gate.
- [x] Bead 12 - Screen-reader headings, diff announcements, and thread navigation.
- [x] Bead 13 - AI patch validation, accept/reject flow, labeling, and citations.
- [x] Bead 14 - Cross-browser Playwright project gates.
- [x] Bead 15 - QA convergence, selection stability, and IME autosave unit gates.
- [x] Bead 16 - Release readiness docs and CI skip/todo guard hardening.
- [x] Bead 17 - Table selection performance stabilization.
- [x] Bead 18 - Branch protection finalization and release ledger update.
- [x] Bead 19 - CI-stable table perf and suggest history debounce.
- [x] Bead 20 - Final release audit and stale ledger cleanup.
- [x] PR #1 merged into `main` as `7bf032debe1931d068f009ee735b95bd5c43b5c1`.
- [x] Main push CI passed: run `25955018685`, workflow `CI`, `build-and-test`.
- [x] PR #2 merged into `main` as `c6ee96e796602834d6795e84d404bf962486ad40`.
- [x] Audited main push CI passed: run `25955266966`, workflow `CI`, `build-and-test`.
- [x] Bead 21 - Post-v1 mobile hardening PR integration and final main validation.
- [x] PR #6 merged into `main` as `f0cd99810bbdc3604b7172419722715f4d7b9cee`.
- [x] PR #9 merged into `main` as `87d913ea9ff3c42c2774410100e2596df08c3617`.
- [x] PR #10 merged into `main` as `5f9cc21278c229e4bfbb5634212e3969828876e0`.
- [x] PR #5 merged into `main` as `b04688792822f2f5e0e01723d8156a9e4fe438ad`.
- [x] PR #8 merged into `main` as `d23b57ae502ec88703f9e9c8757e1fa4112f6986`.
- [x] PR #7 merged into `main` as `7f03a7ee736adf7ac24971657dcbad45e7d90786`.
- [x] Final post-mobile-hardening main push CI passed: run `26022768022`, workflow `CI`, `build-and-test`.
- [x] Bead 22 - Cloudflare Pages public test deploy and essay typing performance gate.
- [x] Cloudflare Pages project `lash` deployed at `https://lash-9xx.pages.dev/`.
- [x] Public smoke/performance verification passed with `make verify-cloudflare URL=https://lash-9xx.pages.dev/`.
- [x] PR #12 merged into `main` as `3f19bc361c3071d9e3f7425bfd064193cd8b83a9`.
- [x] Final post-deploy main push CI passed: run `26026635724`, workflow `CI`, `build-and-test`.
- [x] Final Cloudflare production redeploy from merged `main` passed public smoke/performance verification.
- [x] Bead 23 - Fix title regression with fail-first Playwright coverage, editable title UI, topbar mirroring, reload persistence, and mobile non-overlap guard.
- [x] Bead 24 - Fix @mention regression with fail-first real-editor coverage, inline user/date mention nodes, and existing RBAC/privacy mention e2e preserved.
- [x] Bead 25 - Fix sidebar regression with fail-first desktop/mobile coverage, collapsed outline access, heading jump focus, and mobile close/focus restore.
- [x] Bead 26 - Online Typing Entry Gate with intentional red two-client browser tests and realtime-overclaim docs cleanup.
- [x] Bead 27 - Real Document Identity with `/doc/[id]` routing, local document registry, title isolation, create/open controls, and per-doc outline state.
- [x] Bead 28 - Realtime Runtime Decision + Skeleton with Cloudflare Durable Object rooms, health endpoints, local Wrangler WebSocket verification, and deploy dry-run.
- [x] Bead 29 - CRDT Editor Binding with TipTap Collaboration, Yjs room provider, Worker update relay, and two-client convergence.
- [x] Bead 30 - Actor Identity + Access Boundary with signed realtime session grants, token-gated room reads/sockets, and unauthorized room denial coverage.
- [x] Bead 31 - Durable Persistence, Snapshots, Restore with SQLite-backed Yjs update logs, cumulative snapshots, reload hydration, and append-only restore hook.
- [x] Bead 32 - Large-Doc Typing Performance with 10k/50k-word browser gates, explicit local realtime opt-in, deferred outline scans, and offscreen block containment.
- [x] Bead 33 - Presence, Remote Cursors, Sync State with room-scoped awareness, collaborator chips, cursor markers, sync acknowledgements, and reconnect/saved UI.
- [x] Bead 34 - Invite + Access UX with hash invite links, collaborator list, expiry/revoke UI, invited edit/comment access gates, and signed invite-token realtime session exchange.
- [x] Bead 35 - Durable Comments/Suggestions with persisted/synced chat threads, replies, resolve/reopen status, and suggestion accept/reject resolution records.
- [x] Bead 36 - Collaboration Delight Layer with first-run Ready/share state, sync feedback, and reconnect retry action.

### Now

- PR #28 remote CI verification after Node 22 / serialized E2E hardening.

### Next

- PR stack CI/merge readiness, then release review closeout.

## Open Questions

- UNCONFIRMED: Whether retrospective review for M1/B1 and M1/B3 is still required before later post-v1 work.
- UNCONFIRMED: Production web hosting strategy for arbitrary `/doc/[id]` Next routes; current static Pages export remains blocked on this branch.

## Working Set

- `AGENTS.md`
- `CONTINUITY.md`
- `HANDOFF.md`
- `MISTAKES.md`
- `DEPLOYMENT.md`
- `REGRESSIONS.md`
- `RELEASE_NOTES.md`
- `handoff/beads.jsonl`
- `handoff/beads.schema.json`
- `handoff/release-audit-2026-05-16.md`
- `.github/workflows/ci.yml`
- `Makefile`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test:unit`
- `pnpm run test:e2e`
- `pnpm run build`
- `make serve`
- `make status`
- GitHub PR #1: `https://github.com/apollostreetcompany/lash-doc/pull/1`
- GitHub PR #2: `https://github.com/apollostreetcompany/lash-doc/pull/2`
- Audited main CI run: `https://github.com/apollostreetcompany/lash-doc/actions/runs/25955266966`
- GitHub PR #5: `https://github.com/apollostreetcompany/lash-doc/pull/5`
- GitHub PR #6: `https://github.com/apollostreetcompany/lash-doc/pull/6`
- GitHub PR #7: `https://github.com/apollostreetcompany/lash-doc/pull/7`
- GitHub PR #8: `https://github.com/apollostreetcompany/lash-doc/pull/8`
- GitHub PR #9: `https://github.com/apollostreetcompany/lash-doc/pull/9`
- GitHub PR #10: `https://github.com/apollostreetcompany/lash-doc/pull/10`
- Post-mobile-hardening main CI run: `https://github.com/apollostreetcompany/lash-doc/actions/runs/26022768022`
- Cloudflare Pages project: `lash`
- Cloudflare Pages public test URL: `https://lash-9xx.pages.dev/`
- `pnpm run build:static`
- `make deploy-cloudflare`
- `make verify-cloudflare URL=https://lash-9xx.pages.dev/`
- `make realtime-dry-run`
- `make verify-realtime-runtime`
- `make deploy-realtime-cloudflare`
- `apps/web/e2e/performance/typing-latency.spec.ts`
- `apps/web/e2e/title/title-edit.spec.ts`
- `apps/web/e2e/mentions/mention-real-editor.spec.ts`
- `apps/web/e2e/sidebar/sidebar-regression.spec.ts`
- `apps/web/e2e/online-typing/online-typing-entry-gate.spec.ts`
- `apps/web/e2e/online-typing/collaboration-delight.spec.ts`
- `apps/web/e2e/share/invite-access.spec.ts`
- `apps/web/e2e/doc-chat/chat-durable.spec.ts`
- `apps/web/e2e/suggest-mode/suggest-durable.spec.ts`
- `apps/web/e2e/performance/large-doc-typing.spec.ts`
- `apps/web/e2e/document-identity/document-identity.spec.ts`
- `apps/web/app/doc/[id]/page.tsx`
- `apps/web/lib/documentRegistry.ts`
- `apps/web/lib/realtimeCollaboration.ts`
- `apps/web/lib/inviteAccess.ts`
- `apps/web/components/editor/EditorWorkspace.tsx`
- `apps/web/components/editor/panels/MentionPanel.tsx`
- `apps/web/components/editor/panels/OfflinePanel.tsx`
- `apps/web/components/shell/Sidebar.tsx`
- `packages/collab-service/src/index.ts`
- `packages/realtime-worker/src/index.ts`
- `packages/realtime-worker/src/access.ts`
- `packages/realtime-worker/src/persistence.ts`
- `packages/realtime-worker/src/room.ts`
- `packages/realtime-worker/src/routing.ts`
- `packages/realtime-worker/wrangler.jsonc`
- `packages/testing/unit/realtime-runtime/realtime-access-boundary.test.ts`
- `packages/testing/unit/realtime-runtime/realtime-persistence.test.ts`
- `packages/testing/unit/realtime-runtime/realtime-runtime-skeleton.test.ts`
- `scripts/verify-realtime-runtime.mjs`
- `packages/editor-core/src/schema/mentions.ts`
- GitHub PR #15: `https://github.com/apollostreetcompany/lash-doc/pull/15`
- GitHub PR #16: `https://github.com/apollostreetcompany/lash-doc/pull/16`
- GitHub PR #17: `https://github.com/apollostreetcompany/lash-doc/pull/17`
- GitHub PR #18: `https://github.com/apollostreetcompany/lash-doc/pull/18` (expected red until Beads 29-31)
- GitHub PR #19: `https://github.com/apollostreetcompany/lash-doc/pull/19` (expected red until Beads 29-31; stacked on PR #18)
- GitHub PR #20: `https://github.com/apollostreetcompany/lash-doc/pull/20` (expected red until Beads 29-31; stacked on PR #19)
- GitHub PR #21: `https://github.com/apollostreetcompany/lash-doc/pull/21` (reload durability expected-red until Bead 31; stacked on PR #20)
- GitHub PR #22: `https://github.com/apollostreetcompany/lash-doc/pull/22` (reload durability expected-red until Bead 31; stacked on PR #21)
- GitHub PR #23: `https://github.com/apollostreetcompany/lash-doc/pull/23` (stacked on PR #22)
- GitHub PR #24: `https://github.com/apollostreetcompany/lash-doc/pull/24` (stacked on PR #23)
- GitHub PR #25: `https://github.com/apollostreetcompany/lash-doc/pull/25` (stacked on PR #24)
- GitHub PR #26: `https://github.com/apollostreetcompany/lash-doc/pull/26` (stacked on PR #25)
- GitHub PR #27: `https://github.com/apollostreetcompany/lash-doc/pull/27` (stacked on PR #26)
- GitHub PR #28: `https://github.com/apollostreetcompany/lash-doc/pull/28` (stacked on PR #27)
- GitHub PR #12: `https://github.com/apollostreetcompany/lash-doc/pull/12`
- Post-deploy main CI run: `https://github.com/apollostreetcompany/lash-doc/actions/runs/26026635724`
- Final Cloudflare deployment preview: `https://cad5a3ac.lash-9xx.pages.dev`
