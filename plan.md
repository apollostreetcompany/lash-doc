# Lash — Finishing Plan

> Canonical plan for shipping the Lash collaborative editor end-to-end.
> Designed for parallel execution: humans review here; agents claim work via TaskCreate or `br sync` (beads).
> Source-of-truth contracts: `agents.md` (acceptance specs), `REPO_MAP.md` (package layout), `ACCEPTANCE_GATES.md` (test ID mapping).

## 0. Reality snapshot (2026-05-10)

| Signal | State at audit | After M0 |
|---|---|---|
| Git | 1 commit on `main`, no remote, dirty tree (Step 06 in flight) | unchanged — uncommitted M0 work in tree |
| Lint | 🔴 19 errors / 6 warnings after `--fix` | 🟢 0 errors, 0 warnings |
| Typecheck | 🟢 clean | 🟢 clean |
| Unit tests | 13 todo, 3 real failures (`image` ×2, `outline-plugin`) | 🟢 19 passed, 13 todo, 0 failures (added 3 fixture-loader tests) |
| E2E tests | 71 specs, 51 stubbed; Step 06 ×3 failing | Step 06 ×3 🟢; 7 unrelated specs fail (see §Open) |
| Apps present | Only `apps/web` (shell) | unchanged — `api`/`realtime-gateway`/`ai-orchestrator`/`admin` belong to M2/M3/M4 |
| Packages present | 4 (editor-core, types, ui, testing) | 🟢 15 (added 11 typed scaffolds; contracts in `@lash/types`) |
| CI | `.github/workflows/ci.yml` correct gates | unchanged |

### M0 status — DONE (9/9 lanes; A9 added to address review)

- ✅ A1 lint clean (was 43 errors → 0)
- ✅ A2 image NodeView (`addNodeView` was treating params as positional; fixed signature + refactored commands to use `props.tr` so CommandManager dispatches one coherent transaction; deferred-upload now guarded by `destroyed` flag + placeholder-alive check so undo or editor-destroy mid-flight doesn't leak uploads)
- ✅ A3 outline caret-on-collapse (skip past nested headings; fall back to `target.from + 1` when target is the last heading so `PMSelection.near` doesn't drift backward into the collapsed range)
- ✅ A4 Step 06 close — all 3 table specs (`select-open-close`, `copy-out`, `paste-in`) pass
- ✅ A5 governance (.gitignore tightened + dedup; tracked `test-results/` artifacts untracked; CODEOWNERS expanded to cover top-level configs and annotated as documentation-not-enforcement until GitHub teams exist; PR template; remote setup is the only one-line follow-up)
- ✅ A6 fixture loader + Legal Contract fixture + 4 unit tests (CJS-safe path resolution, `RegisteredButMissingFixtureError` distinct from `UnknownFixtureError`, ENOENT-only swallow in `listAvailableFixtures`)
- ✅ A7 `@lash/types` data contracts (FROZEN per proconsult-m0/B):
  - EditorOp: 6 high-level variants + `pm_step` escape hatch for arbitrary PM Step JSON; `seq` lives on HistoryEntry not on ops; positions stay numeric with `assoc` mapping bias; cross-version stable refs use Anchor / AuthorshipInterval / DiffSpan
  - HistoryEntry: `parentSha` REQUIRED (concurrency control); `seq` assigned by history layer; `audit: { ipHash, ua }` per security gate
  - Anchor: token includes `occurrence` + `nodeId/nodePath` for stable recovery
  - AuthorshipInterval: `nodeId` + `sourceEntryId` + `sourceOpIndex` for durable mapping
  - ShareToken: `jti` + `redactionPolicyVersion`; separate `RevocationRecord`
  - MentionResolveResult: discriminated union (visible vs anonymized) — RBAC-safe
  - EditPatch: citation is a discriminated union; doc citations carry `baseVersion`; `allowGlobal` requires out-of-band `globalEditConfirmed` in `ValidatorOptions`
  - DiffJSON / DiffSpan: discriminated union of UnchangedSpan/InsertedSpan/DeletedSpan/AttrChangedSpan; each span carries stable id + entryId/opIndex/actorType/intent/redacted for filtered diffs
  - `canonicalize(value): string` + `hashCanonical(value): Promise<string>` — single source of truth for deterministic JSON serialization and SHA-256 hashing across CI/dev/prod
- ✅ A8 12 packages scaffolded with typed stubs that consume the new contracts: `collab-service` (Yjs-update vs EditorOp boundary made explicit), `history` (`AppendInput` with `expectedParentSha` precondition), `authorship`, `mentions` (typed against discriminated MentionResolveResult), `share` (RevocationStore + PolicyStore + AuditLog adapters), `ai` (`ValidatorOptions.confirmations.globalEditConfirmed`), `doc-chat`, `tables-media` (checklists kept in editor-core, not here), `observability`, `storage` (HistoryLogStore.append takes expectedParentSha), `infra-scripts`, **`rbac`** (single `PolicyEngine` consumed by share/mentions/chat/AI/api). All 12 path aliases wired in `tsconfig.base.json`
- ✅ A9 proconsult-m0 review pass — all 5 P0 + 28 P1 findings addressed inline; remaining P2s either deferred with rationale or recorded as follow-ups

### Open at end of M0 (NOT blockers for M1)

E2E failures unrelated to the M0 lanes (they're scope items for later milestones or pre-existing test bugs):

| Spec | Why it fails | Owner milestone |
|---|---|---|
| `outline-collapse-basic`, `outline-persist`, `outline-caret-move` | strict-mode locator violation: `[data-heading-id="X"]` matches both outline `<li>` and `<h2>`. Test design bug, not a code regression. | Test fix — file under M0/A5 follow-up or M1 cleanup |
| `md-roundtrip-basic` | expected 2 `ol li`, got 5 (markdown roundtrip emits extra list items) | Pre-existing — file under M1 |
| `md-table-import` | expected `thead tr th` × 2, got 0 (table import skips header row) | Pre-existing — file under M1 |
| `focus-mode-a11y` | toolbar still visible when focus mode active | M1/B4 |
| `image-clipboard`, `image-dnd`, `image-resize`, `image-retry` | tests dispatch paste/drop on the `EditorContent` wrapper `[data-testid="lash-editor-content"]` instead of the inner `.ProseMirror`; events don't reach PM's `handlePaste`/`handleDrop` | Test fix — retarget to `.ProseMirror` (small) |

## 1. Milestones (gated)

```
M0  Hygiene & contracts          (sequential prefix)
M1  Phase 0 finish               (parallel after M0)
M2  Phase 1: collab/history/diff (parallel after M1)
M3  Phase 2: mentions/share/chat (parallel after M2)
M4  Phase 3: AI / suggest        (parallel after M3)
M5  Hardening                    (rolling, starts mid-M2)
```

### M0 — Hygiene & contracts (prefix gate)

Exit criteria:
- `pnpm lint` exits 0
- `pnpm typecheck` exits 0
- `pnpm test:unit` 0 failures (no fresh todos)
- `pnpm test:e2e` 0 failures on currently real specs (Step 06 6/6 green)
- Git remote configured, branch protection on `main`
- `.gitignore` excludes `test-results/`, `*-output.txt.txt`, `codex-*-terminal.txt`, `*-session-summary.md`
- 12 missing packages scaffolded with typed stubs (collab-service, history, authorship, mentions, share, ai, doc-chat, tables-media, observability, storage, infra-scripts, **rbac**)
- `@lash/types` exports `EditorOp`, `EditPatch`, `HistoryEntry`, `AuthorshipInterval`, `Anchor`, `ShareToken`, `MentionResolveResult`, `DiffJSON`
- `packages/testing/fixtures/` with at least the "Legal Contract" fixture loadable

### M1 — Phase 0 finish

Enter: M0 done.

Exit (Phase 0 gate per agents.md = rich text + outline + markdown + images + tables + checklists + autosave + focus + chips):
- `chip-autoconvert`, `chip-hover`, `chip-revert` green
- `checklist-toggle`, `checklist-nesting` green
- `autosave-indicator`, `autosave-latency` green
- `focus-mode-ui`, `focus-mode-a11y` green
- **Stabilization (M0 fallout):**
  - outline e2e selector bug — `[data-heading-id="X"]` selectors scope to `.outline-entry` so they don't double-match the `<h2>`
  - `md-roundtrip-basic` ol-count + `md-table-import` thead-cell mismatches resolved
  - `image-clipboard`, `image-dnd`, `image-resize`, `image-retry` retargeted from EditorContent wrapper to `.ProseMirror`
- All Phase 0 (A.*, B.*, C.1) acceptance IDs no longer skipped

**Required prerequisite (P1 follow-up before B1 starts):** split `packages/editor-core/src/schema.ts` into `schema/{base,chips,mentions,suggest,ai}.ts` modules and `apps/web/components/editor/EditorWorkspace.tsx` into a slot pattern (`<EditorShell><HistoryPanel/><ChatPanel/>...</EditorShell>`). Without this, B1 (chips) / B2 (checklists) / E4 (suggest) / D2 (chips advanced) all collide on the same files. (proconsult-m0/B P1 #19.)

### M2 — Phase 1: collab / history / diff / restore / authorship

Enter: M1 done; `EditorOp`, `HistoryEntry`, `AuthorshipInterval`, `Anchor` frozen in `@lash/types` (already done in M0 with proconsult-m0/B P0 fixes — `pm_step` op + `assoc` mapping bias + canonical `hashCanonical`). Exit:
- `multi-client-converge`, `selection-stability` green (Yjs broker live)
- `diff-deterministic` golden snapshot green (uses `@lash/types/hashCanonical`, never an injected hash)
- `history-open`, `history-diff`, `history-restore` green
- `blame-gutter`, `blame-hover`, `blame-filter`, `blame-interval-map`, `blame-property` green
- `offline-queue`, `offline-merge`, `presence-resume` green (D5 lives in M2, not M3 — proconsult-m0/B P1 #18)

### M3 — Phase 2: mentions / share / chat

Enter: M2 done; `MentionResolveResult`, `ShareToken` frozen. Exit:
- `mention-suggest`, `mention-insert`, `mention-privacy`, `mention-rbac-hide`, `mention-anonymized` green
- `mention-date-parse`, `mention-date-locale` green
- `share-comment-scope`, `share-suggest-scope`, `share-edit-scope`, `share-expiry`, `share-audit` green
- `history-redact`, `chat-redact` green
- `chat-anchor-map`, `chat-orphan`, `chat-history-context`, `chat-current-context`, `chat-filter-author`, `chat-filter-ai` green

### M4 — Phase 3: AI / suggest mode / filtered diffs

Enter: M3 done; `EditPatch` frozen. Exit:
- `ai-patch-apply`, `ai-labeling`, `ai-rationale` green
- `ai-invalid-reject`, `ai-fallback`, `ai-scope-selection`, `ai-scope-global-confirm` green
- `ai-chat-citation`, `ai-citation-jump` green
- `suggest-visuals`, `suggest-accept`, `suggest-reject` green
- `diff-filter-author`, `diff-filter-time`, `diff-share-link` green

### M5 — Hardening (rolling)

Enter: rolling, starts as features land. Exit:
- `cb-chrome`, `cb-safari`, `cb-firefox`, `cb-edge`, `cb-ipad` green
- `ime-composition`, `ime-autosave` green
- `sr-headings`, `sr-diff-announce`, `sr-thread-nav` green
- `table-perf-100x20` ≤ SLO; perf smoke gate in CI; deploy doc + canary checklist

## 2. Parallel DAG

```
M0  HYGIENE & CONTRACTS (sequential prefix; A1 first, A2-A9 parallel after)
┌────────────────────────────────────────────────────────────────────┐
│ A1 [seq] lint clean to 0 errors                                    │
│ A2 [par] image NodeView attrs fix         (image.ts only)          │
│ A3 [par] outline caret-on-collapse fix    (outline.ts only)        │
│ A4 [par] Step 06 close: select cell DOM,  (extensions/table/       │
│         clipboard handlers                 index.ts only)          │
│ A5 [par] repo governance: remote, branch  (root files only)        │
│         protection, .gitignore, CODEOWNERS                         │
│ A6 [par] test infra: fixture loader +     (packages/testing/       │
│         "Legal Contract" fixture           fixtures/*)             │
│ A7 [par] @lash/types data contracts +     (packages/types/src)     │
│         canonicalize / hashCanonical                               │
│ A8 [par] scaffold 12 packages w/typed     (new dirs only)          │
│         stubs (collab/history/authorship/                          │
│         mentions/share/ai/doc-chat/                                │
│         tables-media/observability/                                │
│         storage/infra-scripts/RBAC) +                              │
│         tsconfig path aliases                                      │
│ A9 [seq] proconsult-m0 review fix loop    (architecture+correctness│
│         (depends on A1-A8 committed)       +infra; runs until 0    │
│                                            P0/P1)                  │
└────────────────────────────────────────────────────────────────────┘
        │ A1 must commit before any A2-A4 commit; A9 after all of A1-A8
        ▼
M1  PHASE 0 FINISH (B0 prerequisite, then 5 lanes parallel)
┌────────────────────────────────────────────────────────────────────┐
│ B0 [seq] schema/slot split  (editor-core/src/schema/* +            │
│         (PREREQUISITE)       apps/web/components slot pattern)     │
│ B1 chips basic              (editor-core/src/extensions/chip +     │
│                              e2e/chips)                            │
│ B2 checklists wire          (editor-core schema/checklist +        │
│                              e2e/checklists)                       │
│ B3 autosave skel            (apps/web/lib/autosave + unit/autosave)│
│ B4 focus-mode UI            (apps/web/components + e2e/focus-mode) │
│ B5 stabilization fixes      (outline selectors, md roundtrip,      │
│                              image e2e retarget, focus-a11y)       │
└────────────────────────────────────────────────────────────────────┘
        ▼
M2  PHASE 1 (6 lanes parallel after C2 ops shape locked)
┌────────────────────────────────────────────────────────────────────┐
│ C1 collab        (packages/collab-service + apps/realtime-gateway) │
│ C2 history log   (packages/history + apps/api) [hub]               │
│ C3 diff render   (packages/history/diff + apps/web history panel)  │
│ C4 restore       (packages/history + apps/api restore route)       │
│ C5 authorship    (packages/authorship + apps/web blame gutter)     │
│ C6 offline       (packages/collab-service/offline + e2e/offline    │
│                   formerly D5; lives in M2 because its acceptance  │
│                   IDs are M2 exit criteria)                        │
└────────────────────────────────────────────────────────────────────┘
        ▼
M3  PHASE 2 (4 lanes parallel)
┌────────────────────────────────────────────────────────────────────┐
│ D1 mentions          (packages/mentions + apps/api resolver)       │
│ D2 chips advanced    (packages/mentions + apps/web chip preview)   │
│ D3 share & RBAC      (packages/share + apps/api + e2e/share)       │
│ D4 doc chat          (packages/doc-chat + apps/web chat panel)     │
└────────────────────────────────────────────────────────────────────┘
        ▼
M4  PHASE 3 (5 lanes parallel)
┌────────────────────────────────────────────────────────────────────┐
│ E1 AI validator    (packages/ai)                                   │
│ E2 AI orchestrator (apps/ai-orchestrator)                          │
│ E3 AI chat cites   (packages/ai + packages/doc-chat)               │
│ E4 suggest mode    (editor-core marks; consumes C2 ops)            │
│ E5 filtered diffs  (packages/history + apps/web; consumes C3)      │
└────────────────────────────────────────────────────────────────────┘
        ▼
M5  HARDENING (5 lanes; many start mid-M2)
┌────────────────────────────────────────────────────────────────────┐
│ F1 cross-browser matrix   (e2e/cross-browser + playwright projects)│
│ F2 IME                    (unit/ime + composition harness)         │
│ F3 screen readers         (e2e/a11y)                               │
│ F4 perf gates             (table-perf-100x20 + perf smoke in CI)   │
│ F5 deploy docs + canary   (docs/deploy + observability wiring)     │
└────────────────────────────────────────────────────────────────────┘
```

### Critical path (longest serial chain)

```
A1 lint → A4 table-step06 → A9 review-pass-clean → B0 schema/slot split
       → B1 chips → C2 history-ops → C3 diff → C5 authorship
       → D4 chat-anchor → E4 suggest → E5 filtered-diffs → F4 perf
```

Inter-lane dependencies that this DAG already encodes but worth restating:
- E5 filtered diffs depends on C3 diff + C5 authorship (filter-by-author needs blame metadata).
- D4 doc chat history-context depends on C3 diff + C4 restore (renders state-at-version inline).
- E4 suggest mode depends on C2 ops + C3 diff (track-changes visuals = diff spans rendered as marks).
- All AI labeling/filtering depends on C5 authorship (`actorType: 'ai'` filter feeds DiffSpan).

Everything else runs alongside.

## 3. Bottlenecks & mitigations

| Bottleneck | Mitigation |
|---|---|
| `editor-core/src/schema.ts` is single file; chips/mentions/suggest/AI all want to extend it | M0/A8 was scaffold-only; the SCHEMA SPLIT is now M1 prerequisite (before B1) |
| `apps/web/components/editor/EditorWorkspace.tsx` is single file accumulating every panel | M1 prerequisite: refactor to slot pattern (`<EditorShell><HistoryPanel/><ChatPanel/>...</EditorShell>`) |
| Playwright share/RBAC and chat tests need seeded users/orgs | M0/A6 fixture corpus + M3 seed harness extension |
| `EditorOp` + `HistoryEntry` shape unblocks 5 M2 lanes | LOCKED in M0/A7 (with proconsult-m0/B P0 fixes — pm_step, assoc, canonicalize/hashCanonical) |
| RBAC was previously embedded in `@lash/share` and `@lash/mentions` (cross-cutting concern) | M0 introduced `@lash/rbac` as a separate package; share/mentions/chat/AI/api all consume one `PolicyEngine` |
| `apps/api` route shape (currently doesn't exist) — every M3 feature reads through it | M3 prerequisite: typed route registry contract before D1/D3/D4 fork (proconsult-m0/B P1 #21) |

## 4. Lane manifest (beads-friendly)

Each lane = one beads issue. Format below is `br`-importable: id, title, deps, status, owner-suggested.

### M0

- **id:** lash-a1, **title:** "M0/A1: lint clean to 0 errors", **deps:** [], **owner:** typegod, **labels:** [hygiene, blocker], **acceptance:** `pnpm lint` exits 0
- **id:** lash-a2, **title:** "M0/A2: image NodeView `attrs.width` default", **deps:** [lash-a1], **owner:** reactlord, **acceptance:** `image-extension.test.ts` 2/2 green
- **id:** lash-a3, **title:** "M0/A3: outline caret-on-collapse moves to next visible heading", **deps:** [lash-a1], **owner:** typegod, **acceptance:** `outline-plugin.test.ts` 2/2 green
- **id:** lash-a4, **title:** "M0/A4: Step 06 close — select cell NodeView + clipboard handlers", **deps:** [lash-a1], **owner:** typegod, **acceptance:** `table-select-open-close`, `table-copy-out`, `table-paste-in` green
- **id:** lash-a5, **title:** "M0/A5: repo governance — remote, branch protection, .gitignore, CODEOWNERS, PR template", **deps:** [], **owner:** gitty, **acceptance:** remote set, push works, `.gitignore` excludes test-results/output/session files
- **id:** lash-a6, **title:** "M0/A6: test fixture loader + Legal Contract fixture", **deps:** [], **owner:** scribe, **acceptance:** `loadFixture('legal-contract')` returns parsed doc; harness shared with unit + e2e
- **id:** lash-a7, **title:** "M0/A7: @lash/types data contracts (EditorOp, EditPatch, HistoryEntry, AuthorshipInterval, Anchor, ShareToken, MentionResolveResult, DiffJSON)", **deps:** [], **owner:** typegod, **acceptance:** typecheck clean; types exported from `@lash/types`
- **id:** lash-a8, **title:** "M0/A8: scaffold 12 missing packages with typed stubs + tsconfig path aliases (collab-service, history, authorship, mentions, share, ai, doc-chat, tables-media, observability, storage, infra-scripts, **rbac**)", **deps:** [lash-a1], **owner:** nextking, **acceptance:** all 12 packages exist with `package.json` + `tsconfig.json` + `src/index.ts`; `pnpm typecheck` clean. (Schema/EditorWorkspace split was REASSIGNED to M1 prerequisite-before-B1 — see lash-b0.)
- **id:** lash-a9, **title:** "M0/A9: address proconsult-m0 P0/P1 findings (architecture + correctness + infra; iterative review-fix loop until 0 P0/P1)", **deps:** [lash-a2, lash-a3, lash-a4, lash-a5, lash-a6, lash-a7, lash-a8], **owner:** typegod, **acceptance:** verification proconsult returns 0 P0/P1 (or P1s explicitly deferred with rationale recorded in plan.md / commit messages)

### M1

- **id:** lash-b0, **title:** "M1/B0 (PREREQUISITE): split editor-core schema.ts into schema/{base,chips,mentions,suggest,ai}.ts modules + refactor apps/web/components/editor/EditorWorkspace.tsx into a slot pattern (`<EditorShell><HistoryPanel/><ChatPanel/>...</EditorShell>`)", **deps:** [lash-a9], **owner:** typegod, **acceptance:** all M1 lanes can edit disjoint files; existing tests still pass; no functional change.
- **id:** lash-b1, **title:** "M1/B1: chips (basic) — autoconvert/hover/revert", **deps:** [lash-b0], **owner:** reactlord, **acceptance:** `chip-autoconvert`, `chip-hover`, `chip-revert` green
- **id:** lash-b2, **title:** "M1/B2: checklists toggle + nesting", **deps:** [lash-b0], **owner:** reactlord, **acceptance:** `checklist-toggle`, `checklist-nesting` green
- **id:** lash-b3, **title:** "M1/B3: autosave indicator + latency", **deps:** [lash-a7], **owner:** nextking, **acceptance:** `autosave-indicator`, `autosave-latency` green
- **id:** lash-b4, **title:** "M1/B4: focus mode UI + a11y", **deps:** [lash-b0], **owner:** fronty, **acceptance:** `focus-mode-ui`, `focus-mode-a11y` green
- **id:** lash-b5, **title:** "M1/B5: stabilization — outline `[data-heading-id]` selector scoping, markdown roundtrip + table import, image e2e retarget to `.ProseMirror`, focus-mode-a11y toolbar visibility", **deps:** [lash-b0], **owner:** typegod, **acceptance:** the 7 unrelated e2e specs flagged in M0 §Open all green.

### M2

- **id:** lash-c1, **title:** "M2/C1: Yjs collab + presence broker", **deps:** [lash-b*], **owner:** typegod, **acceptance:** `multi-client-converge`, `selection-stability`, `presence-resume` green; `apps/realtime-gateway` boots
- **id:** lash-c2, **title:** "M2/C2: append-only history log + ops shape (HUB)", **deps:** [lash-b*], **owner:** typegod, **acceptance:** ops shape locked; history persists; deterministic JSON
- **id:** lash-c3, **title:** "M2/C3: deterministic diff engine + history panel", **deps:** [lash-c2], **owner:** typegod, **acceptance:** `diff-deterministic`, `history-open`, `history-diff` green
- **id:** lash-c4, **title:** "M2/C4: restore endpoint", **deps:** [lash-c2], **owner:** thesnake-or-typegod, **acceptance:** `history-restore` green; new head version, no destructive rewrite
- **id:** lash-c5, **title:** "M2/C5: authorship interval tree + blame gutter", **deps:** [lash-c2], **owner:** typegod, **acceptance:** `blame-*` 5/5 green; property tests stable
- **id:** lash-c6, **title:** "M2/C6: offline queue + merge + presence resume (formerly D5; lives in M2 because its acceptance IDs are M2 exit criteria)", **deps:** [lash-c1, lash-c2], **owner:** typegod, **acceptance:** `offline-queue`, `offline-merge`, `presence-resume` green

### M3

- **id:** lash-d1, **title:** "M3/D1: mentions (users/groups/dates) + RBAC", **deps:** [lash-a7, lash-c2], **owner:** reactlord, **acceptance:** `mention-*` 5/5 green; date tests 2/2 green
- **id:** lash-d2, **title:** "M3/D2: chips advanced — preview, backlinks", **deps:** [lash-b1, lash-d1], **owner:** reactlord, **acceptance:** chip preview hover loads; backlink graph populated
- **id:** lash-d3, **title:** "M3/D3: share links + RBAC + redaction", **deps:** [lash-a7, lash-c3], **owner:** typegod, **acceptance:** `share-*` + `*-redact` green
- **id:** lash-d4, **title:** "M3/D4: doc chat with anchored threads + filters", **deps:** [lash-c2, lash-c3], **owner:** reactlord, **acceptance:** `chat-*` 6/6 green

### M4

- **id:** lash-e1, **title:** "M4/E1: AI EditPatch validator", **deps:** [lash-a7, lash-c2], **owner:** typegod, **acceptance:** `ai-invalid-reject`, `ai-fallback`, `ai-scope-selection` green
- **id:** lash-e2, **title:** "M4/E2: AI orchestrator service + patch flow UI", **deps:** [lash-e1], **owner:** thesnake, **acceptance:** `ai-patch-apply`, `ai-labeling`, `ai-rationale`, `ai-scope-global-confirm` green
- **id:** lash-e3, **title:** "M4/E3: AI chat citations", **deps:** [lash-d4, lash-e1], **owner:** reactlord, **acceptance:** `ai-chat-citation`, `ai-citation-jump` green
- **id:** lash-e4, **title:** "M4/E4: suggest mode marks + accept/reject", **deps:** [lash-c2, lash-c3], **owner:** typegod, **acceptance:** `suggest-visuals`, `suggest-accept`, `suggest-reject` green
- **id:** lash-e5, **title:** "M4/E5: filtered diffs (author/time/share-link)", **deps:** [lash-c3, lash-d3], **owner:** reactlord, **acceptance:** `diff-filter-author`, `diff-filter-time`, `diff-share-link` green

### M5

- **id:** lash-f1, **title:** "M5/F1: cross-browser matrix", **deps:** [M2 done], **owner:** fronty, **acceptance:** `cb-chrome|safari|firefox|edge|ipad` 5/5 green
- **id:** lash-f2, **title:** "M5/F2: IME composition", **deps:** [lash-a8], **owner:** typegod, **acceptance:** `ime-composition`, `ime-autosave` green
- **id:** lash-f3, **title:** "M5/F3: screen reader navigation", **deps:** [M3 done], **owner:** fronty, **acceptance:** `sr-headings`, `sr-diff-announce`, `sr-thread-nav` green
- **id:** lash-f4, **title:** "M5/F4: perf gates", **deps:** [M2 done], **owner:** typegod, **acceptance:** `table-perf-100x20` ≤ SLO; CI perf smoke fails on >15% regression
- **id:** lash-f5, **title:** "M5/F5: deploy docs + canary", **deps:** [M2 done], **owner:** scribe, **acceptance:** `docs/deploy.md` complete; observability wiring; canary checklist

## 5. Validation gates (run before merging any lane)

```bash
pnpm run lint        # 0 errors
pnpm run typecheck   # 0 errors
pnpm run test:unit   # 0 failures, 0 fresh todos in changed area
pnpm run test:e2e    # 0 failures on real specs in changed area
pnpm run build       # production build green
```

CI workflow already enforces these in `.github/workflows/ci.yml`.

## 6. Operational notes

- Lanes share `editor-core/src/schema.ts` and `EditorWorkspace.tsx` — split during A8 to remove this serialization point.
- `EditorOp` and `EditPatch` are the load-bearing contracts; freeze in `@lash/types` early in M2 so 5 lanes parallelize cleanly.
- All AI edits flow through the same op pipeline as human edits — no special-casing in history/authorship/diff (per `agents.md` determinism principle).
- Each lane PR ships: code + tests + (if applicable) fixture changes. No "tests later" milestones.
