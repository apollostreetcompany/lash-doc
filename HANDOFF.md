# HANDOFF.md - Lash

## Current State

- Branch: `codex/feat/bead-4-authorship-blame`
- Last bead: Bead 0 - Restore Lash release gate and process scaffolding.
- Last bead: Bead 1 - Local MVP run path.
- Last bead: Bead 2 - Append-only history log and deterministic replay/diff foundation.
- Last bead: Bead 3 - Web history timeline, diff, and restore UI.
- Last bead: Bead 4 - Authorship interval-map foundation.
- Current state: Ready for blame gutter UI wiring.
- Local MVP remains available at `http://127.0.0.1:3000` in tmux session `lash-doc-web`.
- Product decision: Riddle is optional/deferred. Do not implement Lash-Riddle integration until Riddle stabilizes as its own product.

## Recent Work

- Fixed image upload completion so a late upload result does not overwrite a user-selected image width.
- Added a unit regression test for in-flight image resize preservation.
- Added missing process scaffolding files required by the project rules.
- Added local production-server scripts and Makefile targets for `make serve`, `make status`, and `make stop`.
- Implemented M2 history foundation: append-only in-memory history store, deterministic replay/load/restore, deterministic text diff, and unit coverage.
- Wired local history into the web editor: timeline, deterministic inserted/deleted diff spans, restore button, and real history e2e coverage.
- Implemented authorship interval map with insertion/delete/replacement mapping, dominant author per line, and deterministic property-style interval invariants.

## Validation To Run

- `pnpm run lint` - pass.
- `pnpm run typecheck` - pass.
- `pnpm run test:unit` - pass, 42 passed, 12 todo/skipped.
- `pnpm run test:e2e` - pass, 27 passed, 48 skipped.
- `pnpm run build` - pass.
- `pnpm exec prettier --check ...new/process/source files...` - pass.
- `pnpm run format` - fails on 80 pre-existing unrelated files; no broad formatting sweep applied.
- `sh -n scripts/lash-web-start.sh scripts/lash-web-stop.sh scripts/lash-web-status.sh` - pass.
- `make serve` - pass, app running at `http://127.0.0.1:3000`.
- `make status` - pass.
- `curl -fsS http://127.0.0.1:3000/` - pass.
- `pnpm playwright test apps/web/e2e/smoke/home.spec.ts apps/web/e2e/autosave/autosave-indicator.spec.ts --workers=1` - pass, 2 passed.
- `pnpm vitest run packages/testing/unit/history/history-store.test.ts packages/testing/unit/diff/diff-deterministic.test.ts` - pass, 6 passed.
- `pnpm run lint` - pass after Bead 2.
- `pnpm run typecheck` - pass after Bead 2.
- `pnpm run test:unit` - pass, 48 passed, 11 todo/skipped.
- `pnpm run build` - pass after stopping the local server and clearing generated `.next`.
- `pnpm run test:e2e` - pass, 27 passed, 48 skipped.
- `pnpm --filter @lash/web build && pnpm playwright test apps/web/e2e/history/history-open.spec.ts apps/web/e2e/history/history-diff.spec.ts apps/web/e2e/history/history-restore.spec.ts --workers=1` - pass, 3 passed.
- `pnpm run test:e2e` - pass after Bead 3, 30 passed, 45 skipped.
- `pnpm vitest run packages/testing/unit/authorship/blame-interval-map.test.ts packages/testing/unit/authorship/blame-property.test.ts` - pass, 4 passed.
- `pnpm run lint` - pass after Bead 4.
- `pnpm run typecheck` - pass after Bead 4.
- `pnpm run test:unit` - pass, 52 passed, 9 todo/skipped.
- `pnpm run build` - pass after Bead 4.

## Open Items

- GitHub branch protection is UNCONFIRMED.
- Next implementation bead should wire blame gutter UI and history filter-by-author.
- Use `make stop` to stop the local Lash server.
