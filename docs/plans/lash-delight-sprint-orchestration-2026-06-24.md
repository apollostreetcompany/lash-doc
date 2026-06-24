# Lash Delight Sprint — Orchestration Handoff

**Date:** 2026-06-24 · **Branch:** `codex/ux/delightful-writing-sprint` · **Baseline:** `main` @ `358be3a`
**Worktree:** `/Users/borker/dev/lash-doc-delight-sprint`
**Sources (read-only inputs):**
- Packet: `docs/plans/lash-delight-quip-feedback-packet.md` (validated)
- Execution plan: `docs/plans/lash-delight-sprint-2026-06-24.md`
- Critique: `docs/reviews/lash-delight-sprint-plan-critique-2026-06-24.md`

This document is the dispatch contract for the six beads. The execution plan is the authoritative
detail; this handoff resolves the open coordination questions, fixes the lane graph, and packages
each bead for a fresh subagent. **No product code is changed by the orchestrator.**

---

## Coordination decisions (resolved before dispatch)

These were the critique's "questions that change implementation order." Resolved against the repo at `358be3a`:

| # | Question | Resolution (verified) | Effect on lanes |
| --- | --- | --- | --- |
| C1 | Does a "send to writing place" UI host exist? | **No.** `file_search` for `insight-router\|WritingPlace\|availabilityFor\|places` across `apps/web` → **0 matches**. No current host. | ROU-01 **lib+tests are parallel-safe**. Any UI host is net-new; it must NOT be created inside a Bead-2 file while Bead 2 is in flight. See Collision Register. |
| C2 | Does the outline frame need product code? | **No** for the baseline frame. `visual-snap.mjs` has no outline capture today; the sidebar outline renders by default at desktop-1440. VIS-01 adds a capture of the **already-rendered** outline (script-only edit). | VIS-01 **stays code-free and first.** A distinct *collapsed-heading* variant needing a `data-testid` hook is **Bead 2** product code → its frame is a Bead-2 postfix artifact, not a VIS-01 blocker. |
| C3 | Can postfix screenshots run as written? | **No** as written — Bead 2's snapshot step had no server/build. Fixed in the Bead 2 packet: it must start its **own** hook-enabled server (`NEXT_PUBLIC_LASH_TEST_HOOKS=true`); the Playwright `webServer` runs hooks-off and cannot be reused. | Bead 2 validation amended (see packet). |
| C4 | Will creds be confirmed this sprint? | **Assume NO** (UNCONFIRMED). | INF-01/INF-02 deliver design + manifest + local/dry-run receipt and **HALT** at the remote step. No parallel-lane *urgency* — they can land any time after Bead 1. |

---

## Execution graph

```
WAVE 0 (solo, first, no product code)
  ┌─ Bead 1 · VIS-01 baseline ────────────────┐
  │  screenshots + visual-snap outline capture │  blocks Bead 2
  └───────────────┬────────────────────────────┘
                  ▼
WAVE 1 (parallel — three independent owners)
  ┌─ Bead 2 · Product Delight ─────┐   ┌─ Bead 3 · ROU-01 ───────────┐   ┌─ Bead 4 · INF-02 (gated) ───┐
  │  CAN/OUT/COM/FMT/MOB           │   │  router lib + unit tests     │   │  realtime verify + dry-run   │
  │  design role · UI + CSS + e2e  │   │  (UI host gated — see C1)    │   │  owns DEPLOYMENT.md+Makefile │
  └───────────────┬────────────────┘   └──────────────┬───────────────┘   └──────────────┬──────────────┘
                  │                                    │                                  │ (sections realtime parts first)
                  │                                    │                                  ▼
                  │                                    │                  ┌─ Bead 5 · INF-01 (gated) ───┐
                  │                                    │                  │  render.yaml + verify-render │
                  │                                    │                  │  APPENDS DEPLOYMENT.md+Make  │
                  │                                    │                  └──────────────┬──────────────┘
                  └────────────────┬───────────────────┴─────────────────────────────────┘
                                   ▼
WAVE 2 (last — records every bead's outcome)
  ┌─ Bead 6 · TRK-01 tracker freshness ─────────────────────────────────┐
  │  reconcile 192→201 + add sprint rows; CSV-parse asserting validator  │
  └──────────────────────────────────────────────────────────────────────┘
```

**Parallel:** Bead 2 ∥ Bead 3 ∥ Bead 4 (after Bead 1). **Serial:** Bead 1 → {2,3,4}; Bead 4 → Bead 5 (shared files); {1,2,3,4,5} → Bead 6.

---

## Shared-file / collision register

| File(s) | Claimed by | Rule |
| --- | --- | --- |
| `DEPLOYMENT.md`, `Makefile` | Bead 4 (INF-02) **and** Bead 5 (INF-01) | **Serialize.** INF-02 lands its realtime section + targets first; INF-01 *appends* the web-runtime section + new `verify-render` target. Best run by **one DevOps owner** (Bead 4 then steer into Bead 5) to avoid cross-agent merge. |
| `apps/web/components/editor/**`, `apps/web/app/globals.css` | Bead 2 (exclusive) | ROU-01 must **not** create its UI host here while Bead 2 is live. If the only sensible host is a Bead-2 file → ROU-01 UI wiring serializes **after** Bead 2; otherwise ROU-01 uses a new file or falls to its stop condition. |
| `scripts/visual-snap.mjs` | Bead 1 (edits) → Bead 2 (read-only) | Only VIS-01 edits the script (outline capture). Bead 2 **runs** it but must not modify it. |
| `artifacts/ux-sprint/reports/**` | All beads (distinct filenames) | No collision — each bead writes its own receipt name (see table at end). |
| `FEATURE_AUDIT/*`, `CONTINUITY.md`, `handoff/beads.jsonl` | Bead 6 (exclusive) | Bead 6 runs last; no other bead writes these. |

---

## Subagent packets

> Every brief starts: *"Read `docs/plans/lash-delight-sprint-2026-06-24.md` (your bead) and this handoff with read_file first. Work only your bead's owned files. Write receipts under `artifacts/ux-sprint/reports/`. Honor the global stop conditions."*

### Bead 1 — VIS-01 Evidence Baseline  ·  role: `engineer`  ·  Wave 0
- **Goal:** durable before-set of Lash screenshots mapped 1:1 to Quip references.
- **Owned files:** `artifacts/ux-sprint/lash/baseline/`, `artifacts/ux-sprint/raw/quip/`, `artifacts/ux-sprint/reports/vis-01-visual-proof.md`, `scripts/visual-snap.mjs` (outline capture step only).
- **In scope:** add `desktop-1440-outline` capture of the **default-rendered** sidebar outline over a long, mid-scrolled doc; capture all script viewports/states; write the comparison receipt.
- **Out of scope:** any product code; any outline state needing a `data-testid`/interaction hook (→ Bead 2).
- **Validation (exact):**
  ```bash
  NEXT_PUBLIC_LASH_TEST_HOOKS=true pnpm --filter @lash/web build
  NEXT_PUBLIC_LASH_TEST_HOOKS=true bash scripts/lash-web-start.sh
  node scripts/visual-snap.mjs http://localhost:3000 artifacts/ux-sprint/lash/baseline
  ```
- **Expected outputs:** `baseline/{desktop-1440,tablet-1024,tablet-large-768,mobile-375,focus-mode-1440,desktop-1440-chat,desktop-1440-table,desktop-1440-outline}.png` + `entrance-*.png`; `vis-01-visual-proof.md` (per-frame Quip URL + gap note + severity).
- **Depends on:** nothing. **Blocks:** Bead 2.
- **Stop condition:** if Quip refs can't live in-repo (Open Q3), keep them as URLs + notes; do not block.

### Bead 2 — Product Delight (CAN-01/OUT-01/COM-01/FMT-01/MOB-01)  ·  role: `design`  ·  Wave 1
- **Goal:** calm writing surface — quiet chrome, reachable outline, attached conversation, quiet formatting, mobile/tablet that preserves writing flow. No rewrites, no perf regressions.
- **Owned files:** `apps/web/components/editor/EditorWorkspace.tsx`, `panels/OutlinePanel.tsx`, `panels/ChatPanel.tsx`, `panels/EditorToolbar.tsx`, `panels/TableCellPanel.tsx`, `apps/web/app/globals.css`, focused specs under `apps/web/e2e/` incl. **new** `apps/web/e2e/mobile/mobile-editor.spec.ts`.
- **In scope:** preserve existing data-attribute/CSS-token patterns; each feedback ID gets a proof that exercises the **actual UX claim** (click-through/assertion), not just the perf guard; create `mobile-editor.spec.ts` (mismatch #1).
- **Out of scope:** realtime-protocol/storage-schema changes; broad rewrites; editing `scripts/visual-snap.mjs` (Bead 1 owns it); creating a ROU-01 UI host.
- **Validation (exact):**
  ```bash
  pnpm run test:e2e -- --project=chromium apps/web/e2e/performance/typing-latency.spec.ts   # CAN-01 GUARD -> can-01-e2e.log
  pnpm run test:e2e -- --project=chromium apps/web/e2e/sidebar/sidebar-regression.spec.ts    # OUT-01      -> out-01-e2e.log
  pnpm run test:e2e -- --project=chromium apps/web/e2e/doc-chat/chat-durable.spec.ts         # COM-01      -> com-01-e2e.log
  pnpm run test:e2e -- --project=chromium apps/web/e2e/performance/large-doc-typing.spec.ts  # FMT-01 GUARD-> fmt-01-e2e.log
  pnpm run test:e2e -- --project=chromium apps/web/e2e/mobile/mobile-editor.spec.ts          # MOB-01 NEW  -> mob-01-e2e.log
  # postfix screenshots need a DEDICATED hook-enabled server (cannot reuse the e2e webServer, hooks off):
  NEXT_PUBLIC_LASH_TEST_HOOKS=true pnpm --filter @lash/web build
  NEXT_PUBLIC_LASH_TEST_HOOKS=true bash scripts/lash-web-start.sh
  node scripts/visual-snap.mjs http://localhost:3000 artifacts/ux-sprint/lash/postfix
  ```
- **Expected outputs:** `postfix/{desktop-1440,desktop-1440-outline,desktop-1440-chat,desktop-1440-table,tablet-1024,mobile-375}.png`; logs `can/out/com/fmt/mob-01-e2e.log`.
- **Depends on:** Bead 1 (baseline). **Blocks:** Bead 6 (records outcome); possibly ROU-01 UI host.
- **Stop condition:** any perf SLO regression → revert the offending change; never weaken the spec. `typing-latency`/`large-doc-typing` are guards — keep them, but the per-ID delight proof must be a feature-level assertion.
- **Note:** MOB-01 project pin is the engineer's call (`cb-mobile-safari`/`cb-ipad` exist); chromium is the floor, not the ceiling.

### Bead 3 — ROU-01 Writing-Place Routing  ·  role: `engineer`  ·  Wave 1
- **Goal:** UI/integration can query availability and route once; unconfigured Persephone/Hermes/Garden fail loud (lib already does this — close test gaps + surface availability).
- **STEP 0 (decide & record before any UI edit):** verified there is **no current UI host** (C1). Choose: (a) clean **new** non-Bead-2 file → proceed parallel; (b) only sensible host is a Bead-2 file → **serialize UI wiring after Bead 2**, coordinate via orchestrator; (c) no sensible host → ship lib tests + documented integration hook (stop condition). Record the choice in the receipt before touching UI code.
- **Owned files:** `packages/insight-router/src/index.ts`, `packages/testing/unit/insight-router/router.test.ts`, + one UI integration file **selected after inspection** (subject to STEP 0).
- **In scope:** new unit tests for the named gaps — duplicate `register` throws, failed-write non-idempotency, `unregister/has/resolve/places`, failure-audit detail; availability surfacing if a clean host exists.
- **Out of scope:** real Persephone/Hermes/Garden clients (placeholders that fail loud are the target); modifying Bead-2 files while Bead 2 is live.
- **Validation (exact):**
  ```bash
  pnpm vitest run packages/testing/unit/insight-router/router.test.ts | tee artifacts/ux-sprint/reports/rou-01-unit.log
  ```
- **Expected outputs:** `rou-01-unit.log`; STEP 0 decision recorded.
- **Depends on:** Bead 1 (start gate) for lib/tests; UI host may depend on Bead 2. **Blocks:** Bead 6.
- **Stop condition:** no sensible UI host → ship lib tests + documented hook, record the gap; do not force a UI change.

### Bead 4 — INF-02 Cloudflare Realtime Provisioning  ·  role: `engineer` (DevOps)  ·  Wave 1  ·  **credential-gated**
- **Goal:** deploy-or-dry-run receipt proving the existing Worker/Durable Object realtime runtime is configured, healthy, rollback-documented.
- **Owned files:** `packages/realtime-worker/wrangler.jsonc`, `DEPLOYMENT.md`, `Makefile`, receipts. **Lands the realtime sections of `DEPLOYMENT.md`/`Makefile` FIRST** (before Bead 5 appends).
- **In scope:** local verify + dry-run; record bindings, DO config, health result, rollback command; secrets handling in `DEPLOYMENT.md`.
- **Out of scope:** new persistence/policy semantics; the web-runtime section of `DEPLOYMENT.md`/`Makefile` (that's Bead 5).
- **Validation (exact):**
  ```bash
  make verify-realtime-runtime 2>&1 | tee artifacts/ux-sprint/reports/inf-02-cloudflare.log
  make realtime-dry-run       2>&1 | tee -a artifacts/ux-sprint/reports/inf-02-cloudflare.log   # if no prod secrets
  # with secrets only: make deploy-realtime-cloudflare && make verify-cloudflare URL=<deployed>
  ```
- **Expected outputs:** `inf-02-cloudflare.log`.
- **Depends on:** Bead 1 (start gate). **Blocks:** Bead 5 (shared files), Bead 6.
- **Stop condition (HALT — never fabricate):** Cloudflare prod secrets UNCONFIRMED → stop at local verify + dry-run, record "production deploy blocked on credentials."

### Bead 5 — INF-01 Dynamic Web Runtime  ·  role: `pair` (DevOps)  ·  after Bead 4  ·  **credential-gated**
- **Goal:** prove `/doc/[id]` can be served by a production-shaped runtime; document start command, env, health check, rollback; resolve the static-export vs dynamic-runtime tension at `DEPLOYMENT.md:63`.
- **Owned files:** `render.yaml` (**new**), `DEPLOYMENT.md`, `Makefile` (**new** `verify-render` target — mismatch #3), receipts. **Appends** to `DEPLOYMENT.md`/`Makefile` after Bead 4 has sectioned them.
- **In scope:** net-new deploy manifest + `verify-render` target; local production-runtime preflight (`pnpm --filter @lash/web build && next start`, hit `/doc/<id>`).
- **Out of scope:** document data model changes; replacing Cloudflare realtime; editing the realtime sections Bead 4 owns.
- **Validation (exact):**
  ```bash
  make verify-render 2>&1 | tee artifacts/ux-sprint/reports/inf-01-render.log
  ```
- **Expected outputs:** `inf-01-render.log`, `render.yaml`, new `verify-render` target.
- **Depends on:** Bead 4 (shared-file serialization). **Blocks:** Bead 6.
- **Stop condition (HALT — never fabricate):** Render creds UNCONFIRMED → deliver `render.yaml` + `verify-render` + **local** preflight, record "remote Render deploy blocked on credentials." Design is unblocked; only the remote receipt is gated.

### Bead 6 — TRK-01 Canonical Tracker Freshness  ·  role: `engineer`  ·  Wave 2 (last)
- **Goal:** tracker reflects new sprint stories and reconciles the 192→201 drift; summary count matches the CSV.
- **Owned files:** `FEATURE_AUDIT/STORIES.csv`, `FEATURE_AUDIT/STORIES_SUMMARY.md`, `CONTINUITY.md`, `handoff/beads.jsonl`.
- **In scope:** add sprint rows (existing column schema/status values) or a clearly scoped supplement; fix the summary count; reflect the sprint in `CONTINUITY.md` and `beads.jsonl`.
- **Out of scope:** rewriting the prior 201-story inventory.
- **Validation (exact — must CSV-parse honoring quoted newlines AND assert equality):** use the node validator in the execution plan's Bead 6 block (counts records with a quote-aware scan, compares to the summary's stated count, `exit 1` on mismatch), `tee` to `artifacts/ux-sprint/reports/trk-01-validate.log`.
- **Expected outputs:** `trk-01-validate.log` showing `OK: tracker counts consistent`.
- **Depends on:** Beads 1–5 substantially complete (records their outcomes). **Blocks:** nothing.
- **Stop condition:** add rows/supplement only; do not rewrite the inventory.

---

## Dispatch sequence (orchestrator runbook)

1. **Dispatch Bead 1** (`engineer`), wait, verify baseline frames incl. `desktop-1440-outline.png` exist + receipt written. Update this handoff's checklist.
2. **Fan out Wave 1 concurrently** (`detach:true`): Bead 2 (`design`), Bead 3 (`engineer`), Bead 4 (`engineer`/DevOps). Each brief names its siblings and the Collision Register rules.
3. When **Bead 4** finishes, **dispatch Bead 5** (or steer the same DevOps agent) — it appends to the now-sectioned `DEPLOYMENT.md`/`Makefile`.
4. **Bead 3 STEP 0 gate:** when the ROU-01 owner reports its host decision, if the host is a Bead-2 file, hold the UI wiring until Bead 2 is verified, then release it.
5. After Beads 1–5 verified, **dispatch Bead 6** (`engineer`) to record outcomes; confirm the validator prints `OK`.
6. **Final rollup** to the user: per-bead status, any HALTs (expected: INF-01/INF-02 remote steps), deferred items, follow-ups.

**Parallel-dispatch sibling warning (include verbatim in each Wave 1 brief):** *"Two other agents are working concurrently — [name siblings + their modules]. Do not modify files outside your owned set; if you find the natural change lands in a sibling's files, stop and report to the orchestrator rather than pushing through."*

---

## Global stop conditions (canonical — referenced by ID, not restated per bead)

1. **Credentials (HALT, never fabricate):** INF-01 (Render) + INF-02 (Cloudflare prod) remote deploys are gated on UNCONFIRMED creds → deliver local/dry-run receipt + manifest, record the block. A faked deploy receipt is a hard sprint failure.
2. **Perf SLO:** any typing-latency / large-doc regression in Bead 2 → revert, never weaken the spec.
3. **Scope fences:** no Riddle / native DOCX / TipTap-Yjs replacement; no realtime-protocol or storage-schema changes; no real Persephone/Hermes/Garden clients.
4. **Mismatches resolved in-bead (not worked around):** create `mobile-editor.spec.ts` (Bead 2), add outline capture to `visual-snap.mjs` (Bead 1), add `render.yaml` + `verify-render` (Bead 5).

---

## Receipt index (all under `artifacts/ux-sprint/reports/`)

| Bead | Receipt(s) | Status |
| --- | --- | --- |
| 1 · VIS-01 | `vis-01-visual-proof.md` + `lash/baseline/*.png` | [ ] |
| 2 · Delight | `can/out/com/fmt/mob-01-e2e.log` + `lash/postfix/*.png` | [ ] |
| 3 · ROU-01 | `rou-01-unit.log` | [ ] |
| 4 · INF-02 | `inf-02-cloudflare.log` | [ ] |
| 5 · INF-01 | `inf-01-render.log` + `render.yaml` | [ ] |
| 6 · TRK-01 | `trk-01-validate.log` | [ ] |
