# HANDOFF.md - Lash

## Current State

- Branch: `codex/fix/bead-0-restore-lash-gate`
- Last bead: Bead 0 - Restore Lash release gate and process scaffolding.
- Last bead: Bead 1 - Local MVP run path.
- Current state: Lash MVP is running locally at `http://127.0.0.1:3000` in tmux session `lash-doc-web`.
- Product decision: Riddle is optional/deferred. Do not implement Lash-Riddle integration until Riddle stabilizes as its own product.

## Recent Work

- Fixed image upload completion so a late upload result does not overwrite a user-selected image width.
- Added a unit regression test for in-flight image resize preservation.
- Added missing process scaffolding files required by the project rules.
- Added local production-server scripts and Makefile targets for `make serve`, `make status`, and `make stop`.

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

## Open Items

- GitHub remote and required branch protection are UNCONFIRMED/missing locally.
- Next implementation bead after the local MVP run path should start M2: append-only history log + ops shape (`lash-c2`).
- Use `make stop` to stop the local Lash server.
