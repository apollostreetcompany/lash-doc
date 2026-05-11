# Lash — Release Notes (M0 + partial M1)

Snapshot taken at consolidation of the M0 + M1 parallel-build session.

## Status at HEAD

- Branch: `main`
- Latest commit: see `git log --oneline -1`
- All gates on `main`:
  - `pnpm lint` — 0 errors
  - `pnpm typecheck` — 0 errors
  - `pnpm test:unit` — 41 passed, 12 todo, 0 failures
  - `pnpm test:e2e` — 23 passed, 1 failed (autosave-indicator — see Known Issues), 51 skipped
  - `pnpm --filter @lash/web build` — production build green

## What landed in this session

### M0 (Hygiene + Contracts + Scaffolds) — DONE, merged to `main`

Twelve proconsult-fix iterations ([5373b71] → [77bcb4c]) converged on zero P0/P1
across three independent review scopes (correctness, architecture, infra/governance).

- **A1 — Lint clean.** 43 errors → 0. Added `argsIgnorePattern: '^_'`,
  `ignoreRestSiblings: true`, spec-files-allow-`any`.
- **A2 — Image NodeView fix.** `addNodeView` was using positional cast on a
  props object; refactored to `(props: NodeViewRendererProps)` + split the
  upload manager into `insert` (direct-dispatch, paste/drop) and
  `insertIntoTransaction` (CM-tr-mutation, commands), with a deferred
  `startUploadIfPlaceholderAlive` guard against editor-destroy + placeholder-undo.
- **A3 — Outline caret-on-collapse.** Skip past nested headings via
  `target.contentTo`; fall back to `target.from + 1` for last-heading edge.
- **A4 — Step 06 close.** All 3 table specs (`select-open-close`, `copy-out`,
  `paste-in`) green.
- **A5 — Governance.** `.gitignore` excludes test-results / output / session
  files. `CODEOWNERS` with documentation-not-enforcement banner. PR template
  with skip/todo `[allow-skip:]` escape. CI guard with `grep_no_match_ok` helper
  + base SHA preflight + `fetch-depth: 0`.
- **A6 — Fixture infra.** `loadFixture()` + `RegisteredButMissingFixtureError`
  + ENOENT-only swallow + repo-root marker-file ascent.
- **A7 — `@lash/types` contracts (8 frozen shapes):** EditorOp (with
  `pm_step` escape hatch + `assoc` mapping bias), HistoryEntry (REQUIRED
  parentSha + audit + schemaVersion), Anchor (occurrence + nodeId/nodePath),
  AuthorshipInterval (sourceEntryId/sourceOpIndex), ShareToken (jti +
  redactionPolicyVersion + separate RevocationRecord), MentionResolveResult
  (visible/anonymized discriminated union), EditPatch (citation union +
  allowGlobal-requires-out-of-band-confirm), DiffJSON (discriminated span
  union with entryId/opIndex/actorType/intent/redacted). Plus
  `canonicalize` + `hashCanonical` with locked test vectors.
- **A8 — 12 typed package scaffolds.** `collab-service`, `history`,
  `authorship`, `mentions`, `share`, `ai`, `doc-chat`, `tables-media`,
  `observability`, `storage`, `infra-scripts`, **`rbac`**. tsconfig paths wired.
- **A9 — Proconsult-fix loop.** 12 iterations across correctness +
  architecture + infra scopes, all returning "no P0/P1 issues found" at end.

### M1 lanes — partial, mostly merged

- **B0 — Schema/slot split.** Done. ✅ Merged. (`packages/editor-core/src/schema/`
  split into `index.ts` + `base.ts` + slots for `chips`, `mentions`, `suggest`,
  `ai`. `apps/web/components/editor/panels/` with 10 panel components, 5 stable
  + 5 placeholders for future lanes.)
- **B2 — Checklists.** Done. ✅ Merged. (proconsult-clean. `checklist-toggle`
  + `checklist-nesting` e2e specs green with strict DOM structure assertions.
  No editor-core changes needed — TaskList wiring in `base.ts` was correct.)
- **B4 — Focus mode UI + a11y.** Done. ✅ Merged. (proconsult-clean.
  `focus-mode-ui` + `focus-mode-a11y` green. Added Cmd/Ctrl+Shift+F keymap
  with IME + repeat guards; TableCellPanel now hidden in focus mode.)
- **B5 — Stabilization.** Done. ✅ Merged. (proconsult-clean. All 10
  pre-existing e2e failures from M0 §Open now green: 3 outline selectors,
  2 markdown, 1 focus-mode, 4 image. Plus an underlying outline-plugin fix
  for `collapsedIntent` set surviving page-reload + setContent.)

## In-flight at wrap-up

These two lanes had their agents spawned in worktrees but they accidentally
wrote to the main repo working tree instead of their isolated worktrees.
Their work was partially captured during the consolidation:

- **B1 — Chips (basic) — INCOMPLETE.** The agent's WIP is preserved on branch
  `m1/b1-chips-leaked` (commit `5189fec`). It builds a `chip.ts` extension +
  paste rule, hover preview NodeView, Cmd/Ctrl+K revert, 3 e2e specs.
  **NOT MERGED** because the WIP has a build-time TS error
  (`packages/editor-core/src/extensions/chip.ts:83:8 — Property 'setMeta'
  does not exist on type 'never'`) and was not reviewed via proconsult.
  Next step: fix the type error, add proconsult-B1, merge.
- **B3 — Autosave indicator + latency — PARTIAL.** The B3 agent's
  implementation files (`apps/web/lib/autosave.ts`, autosave-latency unit
  test, AutosaveIndicator panel) were swept into the B4 merge via
  `git add -A`. Unit tests pass (35 → 41 with the 6 new autosave-latency
  vectors). The `autosave-indicator` e2e spec **FAILS** — the indicator
  text doesn't surface within 500 ms of idle; root cause is likely a
  wiring gap between `useAutosave` and the editor's transaction events
  in the live Next build, not visible to typecheck/lint. NOT proconsult-reviewed.
  Next step: debug the wiring + write proconsult-B3.

## Known issues at HEAD

- **`autosave-indicator` e2e FAILS** (B3 partial above). All other tests
  pass; the failure is contained to one spec. Marked as B3 follow-up.
- **`m1/b1-chips-leaked` branch is build-broken**, intentionally left
  unmerged for B1 follow-up.

## Repo state

- **Branches:**
  - `main` — has M0 + B0 + B2 + B4 + B5 + the B3 implementation files
    (sans working e2e) + image-resize flake fix.
  - `m1/b1-chips-leaked` — B1 WIP (build-broken).
  - `m0/hygiene-and-contracts`, `m1/b0-schema-slot-split`, `m1/b2-checklists`,
    `m1/b4-focus-mode`, `m1/b5-stabilization` — historical lane branches,
    safe to delete.

- **Agent worktrees** (`.claude/worktrees/agent-*/`) — gitignored and not
  tracked. They contain isolated copies of M1 work; safe to delete after
  merging via `git worktree prune`.

## Next steps (post-consolidation)

In rough priority order:

1. **Finish B1 chips.** Fix the `setMeta` type error in `chip.ts:83`, write
   proconsult-B1, address findings, merge.
2. **Finish B3 autosave.** Debug why the e2e indicator doesn't appear (likely
   the autosave-indicator panel isn't subscribing to editor transactions in
   the live render; check `useEffect` deps + Editor ref stability). Then
   proconsult-B3, merge.
3. **Phase 0 gate verification.** With B1 done, run full Phase 0 acceptance
   per agents.md (rich text + outline + markdown + images + tables +
   checklists + autosave + focus + chips). Document on `plan.md`.
4. **Begin M2 lanes** (per plan.md DAG): C2 is the hub (history ops shape) —
   it must commit before C1/C3/C4/C5 fork. C2 + C1 + offline (C6) own the
   apps/realtime-gateway service, which doesn't exist yet — needs scaffolding.
5. **Repo governance follow-ups:**
   - Add a git remote + branch protection (currently local-only, tracked under
     lash-a5).
   - Bind CODEOWNERS to real GitHub teams.
   - Untrack `test-results/.last-run.json` artifacts on a fresh local CI run.

## Cleanup checklist (run before next session)

```bash
git worktree list                              # see worktrees
git worktree remove .claude/worktrees/agent-*  # if agents are done
git branch -d m0/hygiene-and-contracts m1/b0-schema-slot-split \
              m1/b2-checklists m1/b4-focus-mode m1/b5-stabilization
# Keep m1/b1-chips-leaked until B1 lane resumes.
```
