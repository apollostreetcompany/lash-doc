# HANDOFF.md - Lash

## Current State

- Default branch: `main`.
- Current local branch: `main`.
- Product release commit on `main`: `7bf032debe1931d068f009ee735b95bd5c43b5c1` (`Release Lash v1 collaborative editor gates`).
- Final release-audit commit on `main`: `c6ee96e796602834d6795e84d404bf962486ad40`.
- PR #1 is merged: `https://github.com/apollostreetcompany/lash-doc/pull/1`.
- PR #2 is merged: `https://github.com/apollostreetcompany/lash-doc/pull/2`.
- Final main push CI is green: run `25955266966`, workflow `CI`, job `build-and-test`.
- Branch protection on `main` is configured with strict required `build-and-test`, admin enforcement, and no force-push/delete.
- Local product server is running at `http://127.0.0.1:3000` in tmux session `lash-doc-web`.
- Product decision: Riddle is optional/deferred. Do not implement Lash-Riddle integration until Riddle stabilizes as its own product and default Zed integration.

## Completed Beads

- Bead 0 - Restore Lash release gate and process scaffolding.
- Bead 1 - Local MVP run path.
- Bead 2 - Append-only history log and deterministic replay/diff foundation.
- Bead 3 - Web history timeline, diff, and restore UI.
- Bead 4 - Authorship interval-map foundation.
- Bead 5 - Blame gutter UI and history filter-by-author.
- Bead 6 - Filtered diffs and local suggest-mode accept/reject.
- Bead 7 - Doc Chat anchored threads, context, and filters.
- Bead 8 - Share links, RBAC decisions, audit, and redaction.
- Bead 9 - Mentions, RBAC-hidden suggestions, and natural-date chips.
- Bead 10 - Offline queue, reconnect merge, and presence resume.
- Bead 11 - Large table 100x20 performance gate.
- Bead 12 - Screen-reader headings, diff announcements, and thread navigation.
- Bead 13 - AI patch validation, accept/reject flow, labeling, and citations.
- Bead 14 - Cross-browser Playwright project gates.
- Bead 15 - QA convergence, selection stability, and IME autosave unit gates.
- Bead 16 - Release readiness docs and CI skip/todo guard hardening.
- Bead 17 - Table selection performance stabilization.
- Bead 18 - Branch protection finalization and release ledger update.
- Bead 19 - CI-stable table perf and suggest history debounce.
- Bead 20 - Final release audit and stale ledger cleanup.

## Release Evidence

- `pnpm run lint` - pass.
- `pnpm run typecheck` - pass.
- `pnpm run test:unit` - pass, 73 passed.
- `pnpm run test:e2e` - pass, 75 passed.
- `pnpm run build` - pass.
- `make serve` / `make status` - pass, local app available at `http://127.0.0.1:3000`.
- Main CI `build-and-test` - pass on `c6ee96e796602834d6795e84d404bf962486ad40`.
- Acceptance coverage audit - 86 `agents.md` Test IDs, 98 unit/e2e files, no missing IDs.
- Skip/todo audit - no `test.todo`, `test.skip`, `describe.skip`, `TODO acceptance`, or `.only(` matches in `apps/web/e2e` or `packages/testing/unit`.
- Riddle audit - only planning/docs references; no Lash-Riddle runtime integration code.

## Operational Notes

- Use `make status` to verify the local server.
- Use `make stop` before `pnpm run build` or `pnpm run test:e2e`.
- Use `make serve` to restart the local production server.
- No production deployment target exists from this checkout.

## Open Items

- None blocking the current v1 objective.
- Future production deployment and future Riddle integration are separate post-v1 workstreams.
