# HANDOFF.md - Lash

## Current State

- Branch: `codex/fix/bead-0-restore-lash-gate`
- Last bead: Bead 0 - Restore Lash release gate and process scaffolding.
- Current state: Bead 0 complete; ready for M2 planning/implementation.
- Product decision: Riddle is optional/deferred. Do not implement Lash-Riddle integration until Riddle stabilizes as its own product.

## Recent Work

- Fixed image upload completion so a late upload result does not overwrite a user-selected image width.
- Added a unit regression test for in-flight image resize preservation.
- Added missing process scaffolding files required by the project rules.

## Validation To Run

- `pnpm run lint` - pass.
- `pnpm run typecheck` - pass.
- `pnpm run test:unit` - pass, 42 passed, 12 todo/skipped.
- `pnpm run test:e2e` - pass, 27 passed, 48 skipped.
- `pnpm run build` - pass.
- `pnpm exec prettier --check ...new/process/source files...` - pass.
- `pnpm run format` - fails on 80 pre-existing unrelated files; no broad formatting sweep applied.

## Open Items

- GitHub remote and required branch protection are UNCONFIRMED/missing locally.
- Next implementation bead after Bead 0 should start M2: append-only history log + ops shape (`lash-c2`).
