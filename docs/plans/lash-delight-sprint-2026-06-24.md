# Lash Delight Sprint: Execution Plan

**Date:** 2026-06-24
**Source packet:** `docs/plans/lash-delight-quip-feedback-packet.md` (validated)
**Worktree:** `/Users/borker/dev/lash-doc-delight-sprint`
**Branch:** `codex/ux/delightful-writing-sprint`
**Baseline:** `main` @ `358be3a`
**Feedback IDs covered:** VIS-01, CAN-01, OUT-01, COM-01, FMT-01, MOB-01, INF-01, INF-02, ROU-01, TRK-01

## Goal

Move Lash toward a delightful, Quip-like collaborative writing surface that is realistic to ship and to daily-drive for idea writing. This plan sequences the validated feedback packet into executable beads with explicit dependencies, validation commands, expected artifacts, and stop conditions — and states frankly which work is visual polish, which is collaborative reliability, and which is deployment readiness still gated on unconfirmed credentials.

## The frank product-readiness gap

The ten feedback IDs are not equal in risk or in what they unblock. They fall on three axes:

```
                 LOW RISK / SHIP-SAFE                    HIGH RISK / GATED
 Visual polish   ├─ VIS-01  baseline evidence            │
 (in-repo,       ├─ CAN/OUT/COM/FMT/MOB  shell polish    │
  reversible)    └─ TRK-01  tracker freshness            │
 ────────────────────────────────────────────────────────────────────────
 Collaborative   │                       ROU-01  fail-loud routing (lib already solid;
 reliability     │                               gap is UI wiring + tests)
                 │                       INF-02  realtime deploy receipts (infra exists;
                 │                               gap is a *deployed* run + creds)
 ────────────────────────────────────────────────────────────────────────
 Deployment      │                                        INF-01  dynamic-route hosting
 readiness       │                                                (ARCHITECTURAL BLOCKER)
```

- **Visual polish (VIS-01, CAN-01, OUT-01, COM-01, FMT-01, MOB-01, TRK-01)** — This is the bulk of the "delight" and is genuinely shippable. The shell is already well-structured (CSS-grid `AppShell` driven by data-attributes, layout tokens in `globals.css`, existing responsive breakpoints, focus mode). These beads are evidence-driven, in-repo, and reversible. Low-to-medium risk.
- **Collaborative reliability (ROU-01, INF-02)** — Partly already done. The insight-router is *already* fail-loud and idempotent (see Background); the real ROU-01 work is surfacing availability into the UI and closing test gaps. INF-02's Worker/Durable Object runtime exists and verifies locally; the gap is a *deployed-or-dry-run* receipt, which needs Cloudflare secrets.
- **Deployment readiness (INF-01)** — This is the one true blocker to "share Lash seriously." Today the documented deploy path is **Cloudflare Pages static export** (`apps/web/out`), and `/doc/[id]` is a **dynamic, client-only route with no `generateStaticParams`** — static export cannot serve it (`DEPLOYMENT.md:63` admits this). INF-01 is therefore an *architecture decision* (introduce a production-shaped dynamic runtime, e.g. Render) plus credentials that are currently **UNCONFIRMED**. Treat INF-01 as the readiness gate; everything else can land without it.

**Bottom line:** Lash can be made to *feel* shippable (visual axis) and can prove realtime works locally, but it is **not yet seriously shareable** until INF-01's dynamic-hosting question is decided and Render/Cloudflare credentials are confirmed.

## Background (seam map, from code inspection)

_Line refs are as of `358be3a`; class/token/attribute **names** are the stable anchors — line numbers may drift after edits._

### Editor shell — CAN/OUT/COM/FMT/MOB (all polish-on-existing, no rewrites)
- `EditorWorkspace.tsx:343-352` owns shell state (`isFocusMode`, `sidebarCollapsed`, `railOpen`, `activeTab`, `mobileSidebarOpen`, `mobileRailOpen`, `activeTableCell`). Mobile drawer scroll-lock is JS `position:fixed` at `:534-554`. Canvas chrome classes `.lash-doc-wrap/-paper/-header`, `.lash-editor-content[-wrapper]` at `:1666-1780`.
- `AppShell.tsx:73-82` is a CSS-grid wrapper driven by data-attrs (`data-focus-mode`, `data-rail-open`, `data-sidebar-collapsed`, `data-mobile-drawer`, `data-rail-mobile`, `data-entrance`); canvas `.lash-canvas:86`; rail renders only when `rail && railOpen:89`; canvas gets `inert` while a drawer is open `:64-71`.
- `OutlinePanel.tsx:22-73` is a pure render layer (`.lash-outline-panel`, `.outline-entry`, `data-level`, `data-collapsed`); visibility is parent/CSS-controlled. Mounted via `Sidebar.tsx`→`SidebarOutline:85-175`, omitted when `hideOutline` (focus mode).
- `ChatPanel.tsx:350` (`.lash-chat-panel`) mounts inside `RightRail` tab content; visibility is filter-driven (`all|author|ai`) `:365-390`. Note: `open?` prop exists `:16-23` but is unused — a latent seam for COM-01.
- `EditorToolbar.tsx:63` (`.lash-toolbar-bar`) uses HTML `hidden`+`data-hidden` (hidden in focus mode); buttons `.lash-icon-btn`, `data-active`, `aria-pressed`.
- `TableCellPanel.tsx:29` (`.lash-table-panel`, `data-cell-type`); mounts above editor only when a table cell is active and not focus mode (`EditorWorkspace.tsx:1723-1730`).
- `RightRail.tsx:92-148` renders all sections as siblings; tab click scroll-jumps to `[data-section-id]`; IntersectionObserver drives the active chip `:62-88`.
- `globals.css` — layout tokens `:121-129` (`--sidebar-w-expanded/-collapsed`, `--rail-w`, `--topbar-h`, `--toolbar-h`, `--content-max-w`, `--canvas-pad-x/-y`). Shell grid `.lash-app:232-273`; focus-mode grid `:254-263`. Responsive: `1279px` `:663-671`/`:2887-2891`; `1023px` `:2893-2924`; `767px` mobile drawers `:2927-3051`; print `:3930-3999`.

### Insight router — ROU-01 (already fail-loud + idempotent)
- `packages/insight-router/src/index.ts` — `InsightRouter` API `register/unregister/has/resolve/places/availabilityFor/route/history` (`:195-298`). Persephone/Hermes/Garden are external `WritingPlace` adapters with client contracts `PersephoneClient/HermesClient/GardenClient` (`:393-427`); **without a client they return `{ok:false, code:'unconfigured'}` via `unconfiguredWrite` (`:429-490`) — already fail-loud, no silent fallback**. Unknown→`rejected`, invalid payload→`invalid`, thrown→`failed` caught (`:242-291`). Idempotent on `(payload.id, placeId)`, repeat returns prior success `idempotent:true` (`:172,260-267`).
- Test gaps (`router.test.ts:25-201` already covers the happy + fail paths): no coverage for duplicate `register` throwing, `unregister/has/resolve/places`, failed-write non-idempotency, or failure audit detail. The packet's UI-availability requirement has **no current UI integration point** — that file is "selected after inspection."

### Deployment + realtime — INF-01 / INF-02
- `Makefile:5` targets include `verify-realtime-runtime` (`:42-43`, runs `pnpm run verify:realtime`), `realtime-dry-run`, `deploy-realtime-cloudflare`, `deploy-cloudflare`, `verify-cloudflare`. **No `verify-render` target. No `render.yaml` anywhere in repo.**
- `DEPLOYMENT.md:30-44,63` documents **static** Cloudflare Pages (`apps/web/out`); explicitly notes `/doc/[id]` stays a local Next-runtime route "until deployment moves off static export or gets a dynamic-route strategy."
- `apps/web/app/doc/[id]/page.tsx:1-24` — dynamic route, `EditorWorkspace` imported `ssr:false`, **no `generateStaticParams`/`runtime`/`dynamic` export** → incompatible with static export.
- `scripts/verify-realtime-runtime.mjs` — boots `wrangler dev --local`, asserts `/api/realtime/health`, unauth room health `403`, token issue, authorized health, WS `ping→pong`. `packages/realtime-worker/src/index.ts:89-95` health returns `{ok,runtime,service:'lash-realtime'}`; DO binding `LASH_REALTIME_ROOM`→`LashRealtimeRoom` (`wrangler.jsonc:3-24`).

### Visual tooling + tracker — VIS-01 / TRK-01
- `scripts/visual-snap.mjs` needs a **running server** (default `http://localhost:3000`, no auto-start) and test hooks `window.__lashEditor`/`__lashInsertTable`, exposed only when non-prod or `NEXT_PUBLIC_LASH_TEST_HOOKS=true` (`EditorWorkspace.tsx:900-918`). Captures: `desktop-1440`, `tablet-1024`, `tablet-large-768`, `mobile-375`, `entrance-*`, `focus-mode-1440`, `desktop-1440-chat`, `desktop-1440-table`. Default outdir is `visual-snapshots` (override via argv).
- `FEATURE_AUDIT/STORIES.csv` has **201 rows** (202 lines w/ header); columns `id,cluster,cluster_name,feature,user_story,expected_behaviour,evidence,impl_status,phase,test_status,errors,fix_status,retest_status,notes`. `FEATURE_AUDIT/STORIES_SUMMARY.md:3` says **192** — already stale/inconsistent before this sprint.

### ⚠️ Three confirmed packet/repo mismatches (must be resolved in-bead, not silently)
1. **MOB-01 acceptance command targets a non-existent spec.** The packet runs `apps/web/e2e/mobile/mobile-editor.spec.ts`; only `apps/web/e2e/mobile/drawer-scroll-lock.spec.ts` exists. → MOB-01 must **create** `mobile-editor.spec.ts` (preferred, matches the packet's "add or update" language) or the runner fails outright.
2. **OUT-01 expects `desktop-1440-outline.png`, which `visual-snap.mjs` never captures.** → VIS-01/OUT-01 must add an outline-state capture step to `visual-snap.mjs` (it owns no product code, so this script edit belongs to VIS-01's scope) or OUT-01 produces the frame via its Playwright spec.
3. **INF-01 references `make verify-render` and `render.yaml`, neither of which exists.** → INF-01 is net-new infra (target + manifest + deploy doc), not a tweak. Risk: High, and credential-gated.

## Approach

Execute as six beads. Bead 1 (VIS-01) runs first and alone — it is the before-evidence everything else compares against, and touches no product code. Beads 3–5 (ROU-01, INF-02, INF-01) are independent of the UI bead and of each other and may run in parallel by a separate owner; INF-01/INF-02 are credential-gated and may **stop** rather than fail (see Stop Conditions). Bead 2 (Product Delight) is the largest and depends on the VIS-01 baseline. Bead 6 (TRK-01) runs last because it records the row-level outcome of every other bead.

```
  ┌─ Bead 1: VIS-01 baseline ──┐
  │   (no product code)        │
  └───────────┬────────────────┘
              ▼
  ┌─ Bead 1: VIS-01 baseline ──┐
  │   (no product code)        │
  └───────────┬────────────────┘
              ▼
  ┌─ Bead 2: Product Delight ──────────────┐      parallel lane (separate owner):
  │   CAN/OUT/COM/FMT/MOB                   │      ┌─ Bead 3: ROU-01 (router + UI wire)
  │   postfix screenshots + e2e proofs      │      │     ⚠ UI host may land in Bead 2 files
  └───────────┬─────────────────────────────┘      │     → decide host first (see bead)
              │                                     ├─ Bead 4: INF-02 (realtime receipts) *gated
              │                                     └─ Bead 5: INF-01 (dynamic hosting)  *gated
              │                                           ⚠ Beads 4 & 5 BOTH touch
              │                                             DEPLOYMENT.md + Makefile →
              │                                             serialize 4-before-5 on those files
              ├──────────────────────────────┐                 │
              ▼                               ▼                 ▼
  ┌─ Bead 6: TRK-01 tracker freshness ◄───────────────────────────────┐
  │   reconcile 192→201 + add sprint stories (records every bead's outcome)
  └────────────────────────────────────────────────────────────────────┘
```

All work happens on `codex/ux/delightful-writing-sprint`. Receipts land under `artifacts/ux-sprint/reports/`. Honor the packet's out-of-scope: no Riddle, no native DOCX, no replacing TipTap/Yjs, no realtime-protocol or storage-schema changes.

## Work Items

### Bead 1 — VIS-01: Evidence Baseline
**Axis:** Visual polish · **Risk:** Low · **Order:** 1st (blocks Bead 2) · **No product code.**
**Goal:** A durable before-set of Lash screenshots mapped one-to-one to Quip references, so all later beads argue from evidence.
**Owned files:** `artifacts/ux-sprint/lash/baseline/`, `artifacts/ux-sprint/raw/quip/`, `artifacts/ux-sprint/reports/vis-01-visual-proof.md`, `scripts/visual-snap.mjs` (only to add the missing outline capture — see mismatch #2).
**Done when:**
- A baseline screenshot exists for every viewport/state the script emits, plus a new `desktop-1440-outline.png` capture step added to `visual-snap.mjs`.
- `vis-01-visual-proof.md` maps each Lash screenshot to a named Quip URL with a concrete gap note + severity.

**Define "outline state" (so VIS-01 stays code-free):** capture the **already-rendered** sidebar outline (`Sidebar.tsx`→`SidebarOutline`, `.lash-outline-panel`) over a long, multi-heading seeded doc at desktop-1440, scrolled mid-document so the outline's active-section tracking is visible. This needs **no product-code hook** — the outline renders by default. If reviewers later want a *distinct collapsed-heading* outline variant that requires a `data-testid`/interaction hook, that hook is **product code and belongs to Bead 2**, and that variant frame is produced in Bead 2's postfix set — it does not block VIS-01.
**Validation (exact):**
```bash
NEXT_PUBLIC_LASH_TEST_HOOKS=true pnpm --filter @lash/web build
NEXT_PUBLIC_LASH_TEST_HOOKS=true bash scripts/lash-web-start.sh   # server must be up; script does not auto-start
node scripts/visual-snap.mjs http://localhost:3000 artifacts/ux-sprint/lash/baseline
```
Write receipt: `artifacts/ux-sprint/reports/vis-01-visual-proof.md`.
**Expected artifacts:** `artifacts/ux-sprint/lash/baseline/{desktop-1440,tablet-1024,tablet-large-768,mobile-375,focus-mode-1440,desktop-1440-chat,desktop-1440-table,desktop-1440-outline}.png` + `entrance-*.png`.
**Stop condition:** If Quip reference screenshots may not be stored in-repo (Open Question #3), keep Quip refs as URLs + local comparison notes only; do not block.

### Bead 2 — Product Delight: CAN-01, OUT-01, COM-01, FMT-01, MOB-01
**Axis:** Visual polish · **Risk:** Medium · **Order:** 2nd (after Bead 1).
**Goal:** Make the editor feel like a calm writing surface — quiet chrome, reachable outline, attached conversation, familiar-but-quiet formatting, and mobile/tablet that preserves the writing flow — without rewrites or perf regressions.
**Owned files:** `apps/web/components/editor/EditorWorkspace.tsx`, `panels/OutlinePanel.tsx`, `panels/ChatPanel.tsx`, `panels/EditorToolbar.tsx`, `panels/TableCellPanel.tsx`, `apps/web/app/globals.css`, focused specs under `apps/web/e2e/` (incl. **new** `apps/web/e2e/mobile/mobile-editor.spec.ts`).
**Done when:**
- Postfix screenshots captured for desktop, outline, chat, table, tablet, mobile under `artifacts/ux-sprint/lash/postfix/`.
- Each feedback ID has a proof that exercises the *actual UX claim* (click-through / assertion), **not just a regression guard**. Two of the packet-named specs (`typing-latency`, `large-doc-typing`) are **perf guards** that pass regardless of delight changes — keep them as the no-regression gate, but add/extend feature-level assertions (e.g. outline jump moves the caret; chat thread anchors to its target; toolbar stays quiet during plain typing) so the proof matches the feedback, per the packet's "add or update proof" intent.
- `mobile-editor.spec.ts` is created (mismatch #1) covering review/comment/small-edit flow on a mobile viewport.
- Changes preserve existing data-attribute/CSS-token patterns (no new layout system).
**Validation (exact):**
```bash
# e2e proofs (packet pins --project=chromium; perf specs are GUARDS, not feature proof)
pnpm run test:e2e -- --project=chromium apps/web/e2e/performance/typing-latency.spec.ts      # CAN-01 guard -> can-01-e2e.log
pnpm run test:e2e -- --project=chromium apps/web/e2e/sidebar/sidebar-regression.spec.ts       # OUT-01      -> out-01-e2e.log
pnpm run test:e2e -- --project=chromium apps/web/e2e/doc-chat/chat-durable.spec.ts            # COM-01      -> com-01-e2e.log
pnpm run test:e2e -- --project=chromium apps/web/e2e/performance/large-doc-typing.spec.ts     # FMT-01 guard-> fmt-01-e2e.log
pnpm run test:e2e -- --project=chromium apps/web/e2e/mobile/mobile-editor.spec.ts             # MOB-01      -> mob-01-e2e.log (NEW spec)
# MOB-01 recommended additional real-mobile signal (engineer picks the project; cb-mobile-safari/cb-ipad exist):
#   pnpm run test:e2e -- --project=cb-mobile-safari apps/web/e2e/mobile/mobile-editor.spec.ts

# postfix screenshots REQUIRE a hook-enabled server (visual-snap hard-waits on window.__lashEditor):
NEXT_PUBLIC_LASH_TEST_HOOKS=true pnpm --filter @lash/web build
NEXT_PUBLIC_LASH_TEST_HOOKS=true bash scripts/lash-web-start.sh
node scripts/visual-snap.mjs http://localhost:3000 artifacts/ux-sprint/lash/postfix
```
_Note: the Playwright `webServer` runs a production `next start` with hooks **off**, so the snapshot step needs its own hook-enabled server (above) — it cannot reuse the e2e server._
**Expected artifacts:** `artifacts/ux-sprint/lash/postfix/{desktop-1440,desktop-1440-outline,desktop-1440-chat,desktop-1440-table,tablet-1024,mobile-375}.png`; logs `can-01-e2e.log`, `out-01-e2e.log`, `com-01-e2e.log`, `fmt-01-e2e.log`, `mob-01-e2e.log`.
**Stop condition:** If any perf spec regresses past SLO, stop and revert the offending change — perf gate is non-negotiable. Do not weaken the spec to pass.

### Bead 3 — ROU-01: Writing-Place Routing (fail-loud, availability-aware)
**Axis:** Collaborative reliability · **Risk:** Medium (lib is low; the **UI integration point is the unknown**) · **Order:** parallel lane, after Bead 1.
**Goal:** Let UI/integration code query destination availability and route once, with unconfigured Persephone/Hermes/Garden failing loud — building on the router, which already does this at the library level.
**STEP 0 (decide before coding — gates the parallel-lane assumption):** Inspect whether a "send to writing place" UI surface exists today. There is **no current host** (Background). (a) If the natural host is in Bead 2's owned files (`EditorWorkspace.tsx` / a panel), this bead is **no longer parallel** — sequence its UI change **after Bead 2** or coordinate ownership to avoid a collision. (b) If a clean non-Bead-2 host exists, proceed in parallel. (c) If none is sensible, fall to the stop condition (lib tests + documented hook). Record the decision in the receipt before touching UI code.
**Owned files:** `packages/insight-router/src/index.ts`, `packages/testing/unit/insight-router/router.test.ts`, plus one UI integration file **selected after inspecting how the workspace would surface a "send to writing place" action** (do not guess the file in advance).
**Done when:**
- A UI/integration path calls `availabilityFor`/`places` and renders availability; unconfigured adapters surface their `unconfigured` failure visibly (no silent drop).
- New unit tests close the named gaps: duplicate `register` throws, failed-write non-idempotency, `unregister/has/resolve`, failure audit detail.
- No duplicate writes, no secrets in logs, actionable error messages.
**Validation (exact):**
```bash
pnpm vitest run packages/testing/unit/insight-router/router.test.ts | tee artifacts/ux-sprint/reports/rou-01-unit.log
```
**Expected artifacts:** `artifacts/ux-sprint/reports/rou-01-unit.log`.
**Stop condition:** Out of scope to implement real Persephone/Hermes/Garden clients — placeholders that fail loud are the target. If no sensible UI host exists, ship the lib tests + a documented integration hook and record the gap rather than forcing a UI change.

### Bead 4 — INF-02: Cloudflare Realtime Provisioning *(credential-gated)*
**Axis:** Collaborative reliability · **Risk:** High · **Order:** parallel lane; **lands on `DEPLOYMENT.md`+`Makefile` before INF-01** (shared-file serialization).
**Goal:** Produce a deploy-or-dry-run receipt proving the existing Worker/Durable Object realtime runtime is configured, healthy, and rollback-documented.
**Owned files:** `packages/realtime-worker/wrangler.jsonc`, `DEPLOYMENT.md`, `Makefile`, receipts under `artifacts/ux-sprint/reports/`.
**Done when:**
- `make verify-realtime-runtime` passes locally.
- A production deploy **or** `make realtime-dry-run` receipt shows Worker bindings, DO config, health result, and a rollback command; `DEPLOYMENT.md` records secrets handling + rollback.
**Validation (exact):**
```bash
make verify-realtime-runtime 2>&1 | tee artifacts/ux-sprint/reports/inf-02-cloudflare.log
make realtime-dry-run       2>&1 | tee -a artifacts/ux-sprint/reports/inf-02-cloudflare.log   # if no prod secrets
# with secrets: make deploy-realtime-cloudflare && make verify-cloudflare URL=<deployed>
```
**Expected artifacts:** `artifacts/ux-sprint/reports/inf-02-cloudflare.log`.
**Stop condition (HALT, do not fake):** If Cloudflare production secrets are UNCONFIRMED (Open Question #2), stop at the **local verify + dry-run** receipt and record "production deploy blocked on credentials." Never invent a deploy receipt.

### Bead 5 — INF-01: Dynamic Web Runtime *(architecture decision + credential-gated)*
**Axis:** Deployment readiness · **Risk:** High (the readiness blocker) · **Order:** parallel lane, but **edits `DEPLOYMENT.md`+`Makefile` after INF-02** to avoid a collision (both beads own those two files — INF-02 sections the realtime parts first, INF-01 appends the web-runtime section + the new `verify-render` target).
**Goal:** Prove a `/doc/[id]` dynamic route can be served by a production-shaped runtime, and document start command, env, health check, and rollback.
**Owned files:** `render.yaml` (**new**) or equivalent deploy script, `DEPLOYMENT.md`, `Makefile` (**new** `verify-render` target — mismatch #3), receipts under `artifacts/ux-sprint/reports/`.
**Done when:**
- `make verify-render` (new) proves a dynamic route serves under a production-shaped runtime (e.g. `next start` on Render, reusing `scripts/lash-web-start.sh` shape).
- `DEPLOYMENT.md` records start command, env assumptions, health check, rollback — and resolves the static-export vs dynamic-runtime tension it currently flags at `:63`.
**Validation (exact):**
```bash
make verify-render 2>&1 | tee artifacts/ux-sprint/reports/inf-01-render.log
```
**Expected artifacts:** `artifacts/ux-sprint/reports/inf-01-render.log`, `render.yaml`, new `verify-render` Makefile target.
**Stop condition (HALT, do not fake):** If Render account/project credentials are UNCONFIRMED (Open Question #1), deliver `render.yaml` + the `verify-render` target + a **local** production-runtime preflight (`pnpm --filter @lash/web build && next start`, hit `/doc/<id>`), and record "remote Render deploy blocked on credentials." This bead's *design* (runtime strategy) is unblocked; only the remote receipt is gated.

### Bead 6 — TRK-01: Canonical Tracker Freshness
**Axis:** Visual polish (auditability) · **Risk:** Low · **Order:** last (records every other bead's outcome).
**Goal:** Tracker reflects the new sprint stories and reconciles the existing 192→201 drift, with summary counts matching the CSV.
**Owned files:** `FEATURE_AUDIT/STORIES.csv`, `FEATURE_AUDIT/STORIES_SUMMARY.md`, `CONTINUITY.md`, `handoff/beads.jsonl`.
**Done when:**
- Sprint stories (one per feedback ID, or a clearly scoped audit supplement) are added with the existing column schema and status values.
- `STORIES_SUMMARY.md` count matches `STORIES.csv` row count (fixing the pre-existing 192 vs 201 inconsistency).
- `CONTINUITY.md` and `handoff/beads.jsonl` reflect the sprint.
**Validation (exact — must *assert*, and must CSV-parse so quoted newlines don't over-count):**
```bash
node -e '
const fs=require("fs");
const s=fs.readFileSync("FEATURE_AUDIT/STORIES.csv","utf8");
// count records honoring quoted fields (a newline inside "..." is not a row break)
let rows=0,q=false;
for(const c of s){ if(c===String.fromCharCode(34)){q=!q;} else if(c==="\n"&&!q){rows++;} }
if(s.length && s[s.length-1]!=="\n") rows++;   // count an unterminated final line
const dataRows=rows-1;                          // minus header
const sum=fs.readFileSync("FEATURE_AUDIT/STORIES_SUMMARY.md","utf8");
const m=sum.match(/(\d+)\s+stories/i);
const stated=m?Number(m[1]):NaN;
console.log("csv_data_rows",dataRows,"summary_states",stated);
if(dataRows!==stated){console.error("MISMATCH: summary count != CSV rows");process.exit(1);}
console.log("OK: tracker counts consistent");
' | tee artifacts/ux-sprint/reports/trk-01-validate.log
```
_(The `c===34` quote check uses the char code; adjust the regex if the summary phrases the count differently than "N stories".)_
**Expected artifacts:** `artifacts/ux-sprint/reports/trk-01-validate.log`.
**Stop condition:** Out of scope to rewrite the prior 201-story inventory; add rows or a supplement only.

## Receipt index (all under `artifacts/ux-sprint/reports/`; exact commands live in each bead)

| Bead | Receipt(s) |
| --- | --- |
| VIS-01 | `vis-01-visual-proof.md` + `lash/baseline/*.png` |
| Product Delight | `can/out/com/fmt/mob-01-e2e.log` + `lash/postfix/*.png` |
| ROU-01 | `rou-01-unit.log` |
| INF-02 | `inf-02-cloudflare.log` |
| INF-01 | `inf-01-render.log` + `render.yaml` |
| TRK-01 | `trk-01-validate.log` |

## Global stop conditions

1. **Credentials (HALT, never fabricate receipts):** INF-01 (Render) and INF-02 (Cloudflare prod) remote deploys are gated on UNCONFIRMED credentials. Deliver the local/dry-run receipt + the deploy manifest and explicitly record the block. A faked deploy receipt is a hard failure of this sprint.
2. **Perf SLO:** Any typing-latency or large-doc regression in Bead 2 → revert, do not weaken the spec.
3. **Scope fences:** No Riddle/DOCX/TipTap-Yjs replacement; no realtime-protocol or storage-schema changes; no real Persephone/Hermes/Garden clients.
4. **Packet/repo mismatches are resolved in-bead, not worked around silently:** create `mobile-editor.spec.ts` (MOB-01), add the outline capture to `visual-snap.mjs` (OUT-01/VIS-01), add `render.yaml`+`verify-render` (INF-01).

## Open questions (carried from packet)

The two credential questions are the canonical gates referenced by Global stop condition 1 and the INF bead stop conditions — not restated per-bead beyond a pointer:

1. **UNCONFIRMED:** Render account/project credentials → gates INF-01 *remote* receipt only (design + local preflight proceed).
2. **UNCONFIRMED:** Cloudflare production secrets → gates INF-02 *production* deploy only (local verify + dry-run proceed).
3. **UNCONFIRMED:** Whether Quip reference screenshots may live in-repo or must stay URL-referenced → affects VIS-01 artifact storage only.

None block *starting* any bead; each caps a specific bead at its local/dry-run deliverable.

## References

- Source packet: `docs/plans/lash-delight-quip-feedback-packet.md`
- Quip design notes: `QUIP_DESIGN_NOTES.md:1`
- Quip references: <https://quip.com/blog/new-faster-smarter-quip>, <https://quip.com/blog/document-outlines>, <https://quip.com/blog/multicolored-highlights>, <https://quip.com/blog/spreadsheets>, <https://www.softwareadvice.co.uk/software/35270/quipcms>
- Prior architecture review: `docs/reviews/bead-34-invite-access-architecture-review.md`
- Deploy doc (static-export limitation): `DEPLOYMENT.md:63`
