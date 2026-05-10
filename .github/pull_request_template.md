# Lane

<!-- Which plan.md lane is this PR? e.g. `M0/A4`, `M2/C2`, `M3/D3`. -->

## What changed

<!-- 1–2 sentences. -->

## Acceptance test IDs covered

<!-- e.g. `chip-autoconvert`, `chip-hover`, `chip-revert` — see ACCEPTANCE_GATES.md -->

## Validation gates

- [ ] `pnpm run lint` exits 0
- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm run test:unit` 0 failures
- [ ] `pnpm run test:e2e` 0 failures on changed area
- [ ] `pnpm run build` green
- [ ] No fresh `test.skip(true, ...)` or `test.todo(...)` for the lane's acceptance IDs ([ACCEPTANCE_GATES.md](../ACCEPTANCE_GATES.md))
  - CI enforces this. To intentionally add a stub (e.g. waiting on an upstream lane), include a token like `[allow-skip: <short reason>]` in the PR body so the guard passes.

## Contracts touched

<!-- If this PR adds/changes anything in @lash/types, link the consumers updated in this PR. -->

## Notes for reviewers

<!-- Anything subtle, anything to NOT do, anything that should land in a follow-up. -->
