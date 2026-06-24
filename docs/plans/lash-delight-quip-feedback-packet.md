# Lash Delight Quip Feedback Packet

## Header

Goal: Move Lash toward a delightful, Quip-like collaborative writing experience that is realistic to ship and to use daily for idea writing.

Baseline commit: `358be3a` on branch `main`.

Target worktree: `/Users/borker/dev/lash-doc-delight-sprint`.

Working branch: `codex/ux/delightful-writing-sprint`.

Receipt path: `/tmp/lash-ux-sprint.md`.

Validation command: `python3 /Users/borker/dev/skill-library-vetted/skills/release-feedback-reactor/scripts/validate_feedback_packet.py docs/plans/lash-delight-quip-feedback-packet.md`.

Out of scope: Riddle integration, native DOCX editing, and replacing the TipTap/Yjs collaboration architecture.

## Raw Artifacts

- Quip reference, fresh product shell: https://quip.com/blog/new-faster-smarter-quip
- Quip reference, document highlights and inline formatting: https://quip.com/blog/multicolored-highlights
- Quip reference, document outline: https://quip.com/blog/document-outlines
- Quip reference, document plus conversation and tables: https://www.softwareadvice.co.uk/software/35270/quipcms
- Quip reference, integrated spreadsheets and mobile editing: https://quip.com/blog/spreadsheets
- Local Quip design reference: `QUIP_DESIGN_NOTES.md:1`
- Lash visual capture script: `scripts/visual-snap.mjs:1`
- Lash capture path: `artifacts/ux-sprint/lash/baseline/`
- Quip raw capture path: `artifacts/ux-sprint/raw/quip/`
- Review report path: `artifacts/ux-sprint/reports/`

## Feedback Intake

| ID | Feedback | User outcome |
| --- | --- | --- |
| VIS-01 | Establish a durable visual comparison set for Lash against Quip across desktop, tablet, mobile, focus mode, chat, and table states. | We can discuss product quality from evidence rather than memory. |
| CAN-01 | The main editor should feel like a calm writing surface first, with document chrome supporting writing instead of competing with it. | A writer can open Lash and immediately start drafting without scanning many panels. |
| OUT-01 | Outline navigation should be available without making the document feel boxed in or crowded. | A writer can jump around long idea docs without losing the page. |
| COM-01 | Conversation, comments, and suggestions should feel attached to the document, not like a separate admin panel. | Collaborators can understand where feedback belongs and act without context switching. |
| FMT-01 | Formatting, table, status, and dropdown controls should be quick and familiar while staying quiet during plain writing. | A writer can add structure when needed without living in a toolbar. |
| MOB-01 | Mobile and tablet writing should preserve the core writing flow, not collapse into cramped desktop chrome. | A writer can review, comment, and make small edits away from a laptop. |
| INF-01 | Dynamic `/doc/[id]` routes need a production-shaped web runtime before the product can be shared seriously. | Shared document links resolve reliably outside local development. |
| INF-02 | Cloudflare realtime infrastructure needs deploy and health receipts using the current Worker/Durable Object architecture. | Collaborative sessions can be tested against a deployed realtime service. |
| ROU-01 | Insight routing should surface Persephone, Hermes, and Garden writing places in a fail-loud, availability-aware way. | A writer can send notes to the right memory, agent, or action-list destination without silent misrouting. |
| TRK-01 | The canonical feature/test tracker and summary must reflect the current story count and new product-readiness work. | Product status remains auditable after the sprint. |

## Feature And Owner Map

| ID | Owner | Feature area | Evidence |
| --- | --- | --- | --- |
| VIS-01 | Product QA | Visual comparison workflow | `QUIP_DESIGN_NOTES.md:1`, `scripts/visual-snap.mjs:1`, `artifacts/ux-sprint/lash/baseline/` |
| CAN-01 | Editor Core Agent | Editor shell and document canvas | `apps/web/components/editor/EditorWorkspace.tsx:1`, `apps/web/app/globals.css:1` |
| OUT-01 | Editor Core Agent | Outline panel and navigation | `apps/web/components/editor/panels/OutlinePanel.tsx:1`, https://quip.com/blog/document-outlines |
| COM-01 | Doc Chat Agent | Chat panel, suggestions, right rail | `apps/web/components/editor/panels/ChatPanel.tsx:1`, `apps/web/e2e/doc-chat/chat-durable.spec.ts:1` |
| FMT-01 | Tables & Media Agent | Toolbar, markdown, tables, status cells | `apps/web/components/editor/panels/EditorToolbar.tsx:1`, `apps/web/components/editor/panels/TableCellPanel.tsx:1`, https://quip.com/blog/multicolored-highlights |
| MOB-01 | QA Agent | Responsive shell and mobile writing | `apps/web/e2e/mobile/mobile-editor.spec.ts:1`, `scripts/visual-snap.mjs:1` |
| INF-01 | DevOps Agent | Dynamic web hosting | `DEPLOYMENT.md:1`, `Makefile:1`, `apps/web/app/doc/[id]/page.tsx:1` |
| INF-02 | DevOps Agent | Cloudflare realtime runtime | `packages/realtime-worker/src/index.ts:1`, `packages/realtime-worker/wrangler.jsonc:1`, `Makefile:1` |
| ROU-01 | Insight Router Agent | Writing-place routing | `packages/insight-router/src/index.ts:1`, `packages/testing/unit/insight-router/router.test.ts:1` |
| TRK-01 | Product QA | Canonical tracker | `FEATURE_AUDIT/STORIES.csv:1`, `FEATURE_AUDIT/STORIES_SUMMARY.md:1` |

## Evidence Matrix

| ID | Evidence binding |
| --- | --- |
| VIS-01 | Compare `artifacts/ux-sprint/lash/baseline/desktop-1440.png` with Quip references from https://quip.com/blog/new-faster-smarter-quip and https://www.softwareadvice.co.uk/software/35270/quipcms. |
| CAN-01 | Inspect `apps/web/components/editor/EditorWorkspace.tsx:1`, `apps/web/app/globals.css:1`, and the baseline screenshot `artifacts/ux-sprint/lash/baseline/desktop-1440.png`. |
| OUT-01 | Inspect `apps/web/components/editor/panels/OutlinePanel.tsx:1` against the Quip outline reference at https://quip.com/blog/document-outlines. |
| COM-01 | Inspect `apps/web/components/editor/panels/ChatPanel.tsx:1` and `artifacts/ux-sprint/lash/baseline/desktop-1440-chat.png` against https://www.softwareadvice.co.uk/software/35270/quipcms. |
| FMT-01 | Inspect `apps/web/components/editor/panels/EditorToolbar.tsx:1`, `apps/web/components/editor/panels/TableCellPanel.tsx:1`, and `artifacts/ux-sprint/lash/baseline/desktop-1440-table.png` against https://quip.com/blog/multicolored-highlights and https://quip.com/blog/spreadsheets. |
| MOB-01 | Inspect `artifacts/ux-sprint/lash/baseline/mobile-375.png`, `artifacts/ux-sprint/lash/baseline/tablet-1024.png`, and `apps/web/e2e/mobile/mobile-editor.spec.ts:1`. |
| INF-01 | Inspect `DEPLOYMENT.md:1`, `Makefile:1`, `apps/web/app/doc/[id]/page.tsx:1`, and Render deployment receipts under `artifacts/ux-sprint/reports/inf-01-render.log`. |
| INF-02 | Inspect `packages/realtime-worker/src/index.ts:1`, `packages/realtime-worker/wrangler.jsonc:1`, and Cloudflare receipts under `artifacts/ux-sprint/reports/inf-02-cloudflare.log`. |
| ROU-01 | Inspect `packages/insight-router/src/index.ts:1`, `packages/testing/unit/insight-router/router.test.ts:1`, and `artifacts/ux-sprint/reports/rou-01-unit.log`. |
| TRK-01 | Inspect `FEATURE_AUDIT/STORIES.csv:1`, `FEATURE_AUDIT/STORIES_SUMMARY.md:1`, and `artifacts/ux-sprint/reports/trk-01-validate.log`. |

## Acceptance Tests And Proofs

| ID | Required proof |
| --- | --- |
| VIS-01 | Run `NEXT_PUBLIC_LASH_TEST_HOOKS=true pnpm --filter @lash/web build`, then run `node scripts/visual-snap.mjs`; store screenshot evidence in `artifacts/ux-sprint/lash/baseline/` and write a visual proof receipt in `artifacts/ux-sprint/reports/vis-01-visual-proof.md`. |
| CAN-01 | Add or update Playwright visual/click-through proof for the desktop writing surface; store screenshot evidence in `artifacts/ux-sprint/lash/postfix/desktop-1440.png` and run `pnpm run test:e2e -- --project=chromium apps/web/e2e/performance/typing-latency.spec.ts`, logging to `artifacts/ux-sprint/reports/can-01-e2e.log`. |
| OUT-01 | Add or update outline behavior coverage, capture screenshot evidence in `artifacts/ux-sprint/lash/postfix/desktop-1440-outline.png`, and run `pnpm run test:e2e -- --project=chromium apps/web/e2e/sidebar/sidebar-regression.spec.ts`, logging to `artifacts/ux-sprint/reports/out-01-e2e.log`. |
| COM-01 | Add or update chat/comment click-through proof, capture screenshot evidence in `artifacts/ux-sprint/lash/postfix/desktop-1440-chat.png`, and run `pnpm run test:e2e -- --project=chromium apps/web/e2e/doc-chat/chat-durable.spec.ts`, logging to `artifacts/ux-sprint/reports/com-01-e2e.log`. |
| FMT-01 | Add or update table/status interaction proof, capture screenshot evidence in `artifacts/ux-sprint/lash/postfix/desktop-1440-table.png`, and run `pnpm run test:e2e -- --project=chromium apps/web/e2e/performance/large-doc-typing.spec.ts`, logging to `artifacts/ux-sprint/reports/fmt-01-e2e.log`. |
| MOB-01 | Capture mobile/tablet screenshot evidence in `artifacts/ux-sprint/lash/postfix/mobile-375.png` and `artifacts/ux-sprint/lash/postfix/tablet-1024.png`; run `pnpm run test:e2e -- --project=chromium apps/web/e2e/mobile/mobile-editor.spec.ts`, logging to `artifacts/ux-sprint/reports/mob-01-e2e.log`. |
| INF-01 | Add a Render deployment path and run `make verify-render`, storing output in `artifacts/ux-sprint/reports/inf-01-render.log`. |
| INF-02 | Run `make verify-realtime-runtime` and the Cloudflare deploy or dry-run path, storing output in `artifacts/ux-sprint/reports/inf-02-cloudflare.log`. |
| ROU-01 | Run insight-router unit coverage with output in `artifacts/ux-sprint/reports/rou-01-unit.log`; verify availability and fail-loud behavior for Persephone, Hermes, and Garden writing places. |
| TRK-01 | Validate canonical story counts and summary consistency with a node script or checked command, storing output in `artifacts/ux-sprint/reports/trk-01-validate.log`. |

## Bead Contracts

### Bead VIS-01 Evidence Baseline

Feedback IDs: VIS-01.

Owned files: `docs/plans/lash-delight-quip-feedback-packet.md`, `artifacts/ux-sprint/lash/baseline/`, `artifacts/ux-sprint/raw/quip/`, `artifacts/ux-sprint/reports/vis-01-visual-proof.md`.

Out of scope: Product code changes.

Acceptance: Screenshots exist for each Lash viewport produced by `node scripts/visual-snap.mjs`, Quip source URLs are recorded, and visual proof notes map each Lash screenshot to a Quip reference.

Risk: Low.

Review: Product QA review checks that each screenshot has a named reference and concrete gap notes.

### Bead CAN-OUT-COM-FMT-MOB Product Delight

Feedback IDs: CAN-01, OUT-01, COM-01, FMT-01, MOB-01.

Owned files: `apps/web/components/editor/EditorWorkspace.tsx`, `apps/web/components/editor/panels/OutlinePanel.tsx`, `apps/web/components/editor/panels/ChatPanel.tsx`, `apps/web/components/editor/panels/EditorToolbar.tsx`, `apps/web/components/editor/panels/TableCellPanel.tsx`, `apps/web/app/globals.css`, focused Playwright specs under `apps/web/e2e/`.

Out of scope: Realtime protocol changes, storage schema changes, and broad component rewrites unrelated to visual or interaction evidence.

Acceptance: Post-fix screenshot evidence exists for desktop, chat, table, tablet, and mobile states; targeted Playwright checks pass; typing performance remains within project SLO.

Risk: Medium.

Review: UI review checks visual comparison receipts, interaction clarity, accessibility names, and regressions against existing acceptance specs.

### Bead INF-01 Dynamic Web Runtime

Feedback IDs: INF-01.

Owned files: `render.yaml` or deployment scripts, `DEPLOYMENT.md`, `Makefile`, and deployment receipts under `artifacts/ux-sprint/reports/`.

Out of scope: Changing the app's document data model or replacing Cloudflare realtime.

Acceptance: `make verify-render` or equivalent deploy preflight proves a dynamic route can be served by a production-shaped runtime, and `DEPLOYMENT.md` records start command, environment assumptions, health check, and rollback path.

Risk: High.

Review: DevOps review checks route health, port binding, secrets handling, rollback, and CI fit.

### Bead INF-02 Cloudflare Realtime Provisioning

Feedback IDs: INF-02.

Owned files: `packages/realtime-worker/wrangler.jsonc`, `DEPLOYMENT.md`, `Makefile`, and receipts under `artifacts/ux-sprint/reports/`.

Out of scope: New persistence semantics or policy model changes.

Acceptance: Realtime runtime verification passes locally and production deploy or dry-run receipts show Worker/Durable Object configuration, health endpoint result, and rollback command.

Risk: High.

Review: DevOps review checks Worker bindings, secrets, local-vs-production auth behavior, and health output.

### Bead ROU-01 Writing Place Routing

Feedback IDs: ROU-01.

Owned files: `packages/insight-router/src/index.ts`, `packages/testing/unit/insight-router/router.test.ts`, any UI integration file selected after code inspection.

Out of scope: Implementing real Persephone, Hermes, or Garden clients.

Acceptance: UI or integration code can query destination availability, unconfigured adapters fail loud, configured adapters route once, and unit output is stored in `artifacts/ux-sprint/reports/rou-01-unit.log`.

Risk: Medium.

Review: Code review checks no silent fallback, no duplicate writes, actionable error messages, and no secrets in logs.

### Bead TRK-01 Canonical Tracker Freshness

Feedback IDs: TRK-01.

Owned files: `FEATURE_AUDIT/STORIES.csv`, `FEATURE_AUDIT/STORIES_SUMMARY.md`, `CONTINUITY.md`, `handoff/beads.jsonl`.

Out of scope: Rewriting the prior 201-story inventory.

Acceptance: Tracker includes the new sprint stories or a clearly scoped audit supplement, summary counts match CSV, and validation output is stored in `artifacts/ux-sprint/reports/trk-01-validate.log`.

Risk: Low.

Review: Product QA review checks row counts, status fields, and consistency with `CONTINUITY.md`.

## Subagent Prompt Packets

### Product Visual Review Subagent

Owned files: `artifacts/ux-sprint/lash/baseline/`, `artifacts/ux-sprint/raw/quip/`, `artifacts/ux-sprint/reports/vis-01-visual-proof.md`.

In scope: VIS-01 and visual review notes for CAN-01, OUT-01, COM-01, FMT-01, MOB-01.

Out of scope: Editing product code.

Required tools and constraints: Use screenshots and Quip source URLs; report exact screenshot filenames and gap severity.

Acceptance tests and expected outputs: A written screenshot-by-screenshot receipt in `artifacts/ux-sprint/reports/vis-01-visual-proof.md`.

Report must include: changes made, test commands/results, assumptions/risks, and follow-up recommendations.

### Product Engineer Subagent

Owned files: Editor workspace, outline, chat, toolbar, table panel, global CSS, and focused Playwright specs listed in the Product Delight bead.

In scope: CAN-01, OUT-01, COM-01, FMT-01, MOB-01.

Out of scope: Infrastructure provisioning and realtime protocol changes.

Required tools and constraints: Preserve existing patterns, keep writing-first interactions, and retain performance gates.

Acceptance tests and expected outputs: Post-fix screenshots and targeted Playwright logs under `artifacts/ux-sprint/reports/`.

Report must include: changes made, test commands/results, assumptions/risks, and follow-up recommendations.

### DevOps Subagent

Owned files: `DEPLOYMENT.md`, `Makefile`, `render.yaml` or equivalent deployment script, `packages/realtime-worker/wrangler.jsonc`, deployment receipts.

In scope: INF-01 and INF-02.

Out of scope: Product UI changes.

Required tools and constraints: Do not expose secrets; document health checks and rollback path.

Acceptance tests and expected outputs: `make verify-render` output, Cloudflare runtime verification, and deployment receipts.

Report must include: changes made, test commands/results, assumptions/risks, and follow-up recommendations.

### Router QA Subagent

Owned files: `packages/insight-router/src/index.ts`, `packages/testing/unit/insight-router/router.test.ts`, selected UI integration files after inspection.

In scope: ROU-01.

Out of scope: Real external clients for Persephone, Hermes, or Garden.

Required tools and constraints: Keep fail-loud behavior, audit trail, and idempotency.

Acceptance tests and expected outputs: Unit log in `artifacts/ux-sprint/reports/rou-01-unit.log`.

Report must include: changes made, test commands/results, assumptions/risks, and follow-up recommendations.

## Review Gates

- VIS-01: visual proof review with screenshot evidence and Quip URLs.
- CAN-01, OUT-01, COM-01, FMT-01, MOB-01: UI review, accessibility scan where relevant, targeted Playwright checks, and typing-performance guard.
- INF-01, INF-02: DevOps review, health check, rollback path, and secret-safety check.
- ROU-01: code review for fail-loud routing, no silent fallback, idempotency, and auditability.
- TRK-01: tracker consistency review against `FEATURE_AUDIT/STORIES.csv` and `FEATURE_AUDIT/STORIES_SUMMARY.md`.

## Open Questions

- UNCONFIRMED: Render account/project credentials available in this environment.
- UNCONFIRMED: Cloudflare secrets for production realtime deployment available in this environment.
- UNCONFIRMED: Whether all Quip reference screenshots may be stored in-repo or should remain URL-referenced with local comparison notes only.
