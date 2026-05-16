# CONTINUITY.md - Lash

## Goal (incl. success criteria)

Ship Lash v1 as the full collaborative editor spec in `agents.md`, with all acceptance gates passing. Riddle is optional/deferred; no Lash-Riddle code integration until Riddle stabilizes as its own product.

## Constraints/Assumptions

- No direct commits to `main`; current branch `codex/fix/bead-0-restore-lash-gate`.
- Riddle integration is planning-only; do not touch `/Users/borker/dev/riddle`.
- Current v1 path resumes from M2 after the Phase 0 gate is restored.
- GitHub remote/branch protection are still UNCONFIRMED/missing locally.

## Key Decisions

1. Riddle remains optional and independent for now; Lash v1 should not depend on it.
2. Future Riddle integration, if requested, should enter through Lash's stable operation/history contracts rather than special-case mutation.
3. Bead 0 restores the Lash gate and missing process scaffolding before M2 work resumes.

## State

### Done

- [x] M0/M1 Phase 0 feature work merged per `RELEASE_NOTES.md`.
- [x] Fixed image upload completion so in-flight uploads preserve user-selected width.
- [x] Added unit coverage for in-flight image resize preservation.
- [x] Re-ran the Lash gate: lint, typecheck, unit, e2e, targeted format, and build are passing.
- [x] Bead 0 - Restore Lash release gate and process scaffolding.

### Now

- Ready for M2 planning/implementation.

### Next

- Begin M2 hub: append-only history log + ops shape (`lash-c2`) after process gate is complete.

## Open Questions

- UNCONFIRMED: GitHub remote and branch protection setup.
- UNCONFIRMED: Whether retrospective review for M1/B1 and M1/B3 is still required before M2.
- Repo-wide `pnpm run format` currently fails on 80 pre-existing files outside this bead; targeted source/new process files pass Prettier check, and legacy Markdown was kept minimally edited to avoid unrelated churn.

## Working Set

- `packages/editor-core/src/extensions/image.ts`
- `packages/testing/unit/editor/image-extension.test.ts`
- `apps/web/e2e/media/image-resize.spec.ts`
- `plan.md`
- `RELEASE_NOTES.md`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test:unit`
- `pnpm run test:e2e`
- `pnpm run build`
