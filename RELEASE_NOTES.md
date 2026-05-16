# Lash v1 Release Notes

## 2026-05-16 v1

Lash v1 covers the full local collaborative editor gate stack in `agents.md`. Riddle remains optional and deferred; this release does not add Lash-Riddle integration code.

## Product Scope

- Rich editor basics: outline collapse/persistence, Markdown import/export and hotkeys, images, checklists, tables, focus mode, autosave, and internal doc-link chips.
- History and change review: append-only history log, deterministic replay/diff, restore, filtered diffs, local suggest-mode accept/reject, and line-level authorship/blame.
- Collaboration surfaces: selection-anchored Doc Chat, history/current context switching, orphan handling, author/AI filters, local offline queue replay, reconnect merge, and presence resume.
- Sharing and references: local signed share links, comment/suggest/edit capability decisions, expiry/audit events, redaction placeholders, RBAC-filtered users/groups, anonymized hidden mentions, and deterministic natural-date chips.
- Quality and accessibility: large-table 100x20 performance gate, named outline navigation, screen-reader diff announcements, keyboard-navigable chat threads, browser compatibility gates, convergence/selection-stability tests, and IME-safe autosave.
- AI editor: deterministic local `EditPatch` validation, scoped/global patch rules, safe fallback suggestions, rationale, accept/reject, append-only AI-authored history entries, labels, and citations.

## Final Validation

- `pnpm run lint` - pass.
- `pnpm run typecheck` - pass.
- `pnpm run test:unit` - pass, 73 passed.
- `pnpm run test:e2e` - pass, 75 passed.
- `pnpm run build` - pass.
- `make serve` / `make status` - pass, local app available at `http://127.0.0.1:3000`.
- Main CI `build-and-test` - pass on audited release-audit commit `c6ee96e796602834d6795e84d404bf962486ad40`.
- Mechanical acceptance audit - 86 `agents.md` Test IDs, 98 unit/e2e files, no missing IDs.
- Skip/todo audit - no acceptance `test.todo`, `test.skip`, `describe.skip`, `TODO acceptance`, or `.only(` matches in unit/e2e files.

## Release Readiness

- Repository: `https://github.com/apollostreetcompany/lash-doc`.
- Default branch: `main`.
- Product release merge: PR #1, merged at `2026-05-16T06:25:59Z`.
- Final release-audit merge: PR #2, merged at `2026-05-16T06:42:19Z`.
- Audited release-audit commit: `c6ee96e796602834d6795e84d404bf962486ad40`.
- CI workflow: `build-and-test` runs install, skip/todo guard, lint, typecheck, unit tests, Playwright browser install, e2e tests, and build.
- Branch protection: configured on `main` with strict required `build-and-test`, admin enforcement, and no force-push/delete.
- Deployment target: none configured. See `DEPLOYMENT.md` for local run/deploy assumptions.

## Notes

- The implementation is intentionally local-first for v1: history, share/RBAC, Doc Chat, mentions, offline/presence, and AI patch flow are product-valid local contracts with tests, not production multi-tenant services yet.
- Future Riddle work should integrate through stable Lash operation/history contracts after Riddle has its own product shape and Zed integration.
