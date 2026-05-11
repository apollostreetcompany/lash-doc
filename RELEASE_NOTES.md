# Lash — Release Notes (M0 + M1 complete)

## Status at HEAD

- Branch: `main`
- Latest commit: `1faddb8` (Merge M1/B1 chips)
- All gates on `main`:
  - `pnpm lint` — 0 errors
  - `pnpm typecheck` — 0 errors
  - `pnpm test:unit` — 41 passed, 12 todo, 0 failures
  - `pnpm test:e2e` — **27 passed, 48 skipped (M2–M4 stubs), 0 failures**
  - `pnpm --filter @lash/web build` — production build green

## What landed in this session

### M0 (Hygiene + Contracts + Scaffolds) — DONE, merged

Twelve proconsult-fix iterations (5373b71 → 77bcb4c) converged on zero P0/P1
across three independent review scopes (correctness, architecture,
infra/governance).

- **A1** Lint clean (43 → 0).
- **A2** Image NodeView fix + CM-tr-mutation refactor + deferred-upload guard.
- **A3** Outline caret-on-collapse with last-heading edge case.
- **A4** Step 06 close (3 table specs green).
- **A5** `.gitignore` + `CODEOWNERS` (banner) + PR template + CI guard
  (`grep_no_match_ok` + base SHA preflight + `fetch-depth: 0`).
- **A6** Fixture loader (`loadFixture`, `RegisteredButMissingFixtureError`,
  marker-file ascent).
- **A7** `@lash/types` (8 frozen shapes + `canonicalize` + `hashCanonical`
  with locked test vectors).
- **A8** 12 typed package scaffolds (`collab-service`, `history`, `authorship`,
  `mentions`, `share`, `ai`, `doc-chat`, `tables-media`, `observability`,
  `storage`, `infra-scripts`, **`rbac`**).
- **A9** Twelve proconsult-fix iterations to zero P0/P1.

### M1 lanes — ALL DONE, merged

- **B0 — Schema/slot split.** `editor-core/src/schema/` split into
  `index.ts` + `base.ts` + 4 feature slots. `apps/web/components/editor/`
  refactored into 10 panel components (5 stable + 5 placeholder slots for
  M2-M4). proconsult-clean. ✅
- **B1 — Chips (basic).** `LashChip` Node with paste-rule auto-convert
  of internal-doc URLs, NodeView with hover popover, Cmd/Ctrl+K revert to
  plain link. Mock `resolveDocChip` wired in EditorWorkspace. 3 e2e specs
  green (`chip-autoconvert`, `chip-hover`, `chip-revert`). ✅
- **B2 — Checklists.** `checklist-toggle` + `checklist-nesting` specs green
  with strict DOM-structure assertions. TaskList wiring in `base.ts` was
  already correct; no editor-core changes needed. proconsult-clean. ✅
- **B3 — Autosave.** `useAutosave` hook (`apps/web/lib/autosave.ts`) +
  `AutosaveIndicator` panel. 500 ms-after-idle debounced flush, status
  state machine (idle/pending/saving/saved/error), last-saved hover. 6
  unit tests (autosave-latency under fake timers) + 1 e2e
  (autosave-indicator) green. ✅
- **B4 — Focus mode UI + a11y.** `focus-mode-ui` + `focus-mode-a11y` green.
  `Cmd/Ctrl+Shift+F` keymap with IME composition + repeat guards.
  TableCellPanel hidden in focus mode per agents.md A.4 ("toolbars hide").
  2 proconsult iterations to zero P0/P1. ✅
- **B5 — Stabilization.** All 10 pre-existing e2e failures from M0 §Open
  green: 3 outline (selector + intent-set fix), 2 markdown, 1 focus-mode
  (CSS `[hidden]` override), 4 image (`.ProseMirror` retarget + DnD
  sequence + handleDrop items fallback + valid base64). proconsult-clean. ✅

## Phase 0 gate status (per agents.md)

Phase 0 = rich text + outline + markdown + images + tables + checklists +
autosave + focus mode + basic chips.

| Acceptance area | Status |
|---|---|
| A.1 Headings & Collapse | ✅ 3/3 |
| A.2 Markdown Hotkeys | ✅ unit-tested (`schema-validity`) |
| A.3 Markdown Import/Export | ✅ 2/2 |
| A.4 Focus Mode | ✅ 2/2 |
| B.1 Table Cell Types | ✅ 2/2 |
| B.2 Keyboard Navigation | ✅ 2/2 |
| B.3 Copy/Paste Interop | ✅ 2/2 |
| B.4 Large Table Perf | 🟡 skipped (M5/F4) |
| B.5 Images | ✅ 4/4 |
| B.6 Checklists | ✅ 2/2 |
| C.1 Doc Links → Chips | ✅ 3/3 |
| H.1 Autosave | ✅ 1 unit + 1 e2e |

**Phase 0 ROLLOUT GATE — PASS** (with B.4 large-table-perf scoped to M5).

## Repo state

### Branches on `main`'s history

```
1faddb8 Merge M1/B1: chips
683b051 M1/B3 v2: replace partial autosave files
5e2799b M1/B1: chips
9ea21ec docs: M0 + M1 consolidation release notes
aa019fc fix(e2e): image-resize editor-ready wait
0e14459 Merge M1/B2: checklists
12f2227 M1/B4: keyboard handler hardening
897d5f4 chore: gitignore worktrees
44b5c25 M1/B4 v2: keymap + hide TableCellPanel
26df789 M1/B2: checklists specs
4df5975 M1/B4 v1: focus-mode-ui spec
0c052bb M1/B5: stabilization
d08946c M1/B0 polish: barrel exports
440096e M1/B0: schema/slot split
77bcb4c M0/A9 iter-12 …
```

### Lane branches (safe to delete; preserved for audit trail)

- `m0/hygiene-and-contracts` — merged
- `m1/b0-schema-slot-split` — merged
- `m1/b1-chips` — merged (via 1faddb8)
- `m1/b1-chips-leaked` — superseded by `m1/b1-chips`
- `m1/b2-checklists` — merged
- `m1/b3-autosave` — merged (files pulled via checkout into 683b051)
- `m1/b4-focus-mode` — merged
- `m1/b5-stabilization` — merged

### Agent worktrees

`.claude/worktrees/agent-*` — three worktrees from this session. Gitignored.
Safe to `git worktree remove`.

## Next steps (post-consolidation)

In priority order:

1. **proconsult retrospectively for B1 + B3.** The two agent-driven lanes
   were merged without the per-lane proconsult-merge cycle that the other
   lanes received. They're test-passing but their architecture hasn't been
   independently reviewed. Spawn:
   - `lash-m1-b1-chips` proconsult on `packages/editor-core/src/extensions/chip.ts`
     + chip schema + 3 chip specs.
   - `lash-m1-b3-autosave` proconsult on `apps/web/lib/autosave.ts` +
     `AutosaveIndicator.tsx` + autosave-indicator e2e + autosave-latency unit.
2. **Begin M2 lanes.** Per plan.md DAG: **C2** is the hub (history ops shape).
   It must commit before C1/C3/C4/C5 fork. C2 + C1 + offline (C6) own the
   `apps/realtime-gateway` service — needs scaffolding.
3. **Repo governance follow-ups (tracked under lash-a5):**
   - Configure git remote + branch protection on `main`.
   - Bind `CODEOWNERS` to real GitHub teams.
   - Untrack any test-results artifacts that creep back in.

## Known small follow-ups

- `pnpm-lock.yaml` updated for the new `packages/rbac` workspace entry.
- Chip extension stores `href` as a private attr alongside `refId`. D2 (chips
  advanced) may want to derive `href` from `refId` instead.
- B1 → image-resize fix propagation: the chip agent noted main has the
  one-line fix at `aa019fc` that hadn't been on its branch base. Resolved
  by main's merge order — no action needed.
- The image-resize editor-ready wait was added to fix a parallel-run flake;
  consider adding the same to other image specs for robustness (P2).
- IME composition guard for autosave (`ime-autosave` test ID) is a B3 →
  M5/F2 dependency; not implemented yet — current hook fires on every
  transaction including IME-in-progress.

## Cleanup checklist for next session

```bash
git worktree list
git worktree remove .claude/worktrees/agent-a3c141edd3fce9a88
git worktree remove .claude/worktrees/agent-a80c931312432b4d2
git worktree remove .claude/worktrees/agent-a1f4ecfca4d56b221

git branch -d m0/hygiene-and-contracts m1/b0-schema-slot-split \
              m1/b1-chips m1/b1-chips-leaked m1/b2-checklists \
              m1/b3-autosave m1/b4-focus-mode m1/b5-stabilization
```
