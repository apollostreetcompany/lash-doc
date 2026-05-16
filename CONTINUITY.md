# CONTINUITY.md - Lash

## Goal (incl. success criteria)

Ship Lash v1 as the full collaborative editor spec in `agents.md`, with all acceptance gates passing. Riddle is optional/deferred; no Lash-Riddle code integration until Riddle stabilizes as its own product.

## Constraints/Assumptions

- No direct commits to `main`; current branch `codex/feat/bead-8-share-rbac-redaction`.
- Riddle integration is planning-only; do not touch `/Users/borker/dev/riddle`.
- Current v1 path resumes from M2 after the Phase 0 gate is restored.
- GitHub remote is `https://github.com/apollostreetcompany/lash-doc.git`; branch protection remains UNCONFIRMED.

## Key Decisions

1. Riddle remains optional and independent for now; Lash v1 should not depend on it.
2. Future Riddle integration, if requested, should enter through Lash's stable operation/history contracts rather than special-case mutation.
3. Bead 0 restores the Lash gate and missing process scaffolding before M2 work resumes.
4. Local history recording now waits for a 500 ms idle window so a normal typing session does not fragment into multiple history versions under load.
5. Doc Chat starts as local in-memory product behavior: anchors, orphaning, context, and filters are validated before server/RBAC persistence lands.
6. Share/RBAC starts with local signed links, capability decisions, audit events, and redaction placeholders before server persistence/API enforcement lands.

## State

### Done

- [x] M0/M1 Phase 0 feature work merged per `RELEASE_NOTES.md`.
- [x] Fixed image upload completion so in-flight uploads preserve user-selected width.
- [x] Added unit coverage for in-flight image resize preservation.
- [x] Re-ran the Lash gate: lint, typecheck, unit, e2e, targeted format, and build are passing.
- [x] Bead 0 - Restore Lash release gate and process scaffolding.
- [x] Bead 1 - Local MVP run path (`make serve`, `make status`, `make stop`).
- [x] Verified live local editor typing/autosave against `http://127.0.0.1:3000`.
- [x] Bead 2 - Append-only history log and deterministic replay/diff foundation.
- [x] Bead 3 - Web history timeline, diff, and restore UI.
- [x] Bead 4 - Authorship interval-map foundation.
- [x] Bead 5 - Blame gutter UI and history filter-by-author.
- [x] Bead 6 - Filtered diffs and local suggest-mode accept/reject.
- [x] Bead 7 - Doc Chat anchored threads, context, and filters.
- [x] Bead 8 - Share links, RBAC decisions, audit, and redaction.

### Now

- Lash MVP with local history, blame gutter, filtered diffs, suggest-mode, Doc Chat anchors, and share/RBAC/redaction is running at `http://127.0.0.1:3000`; ready for mentions/date chips.

### Next

- Continue toward M3 with mention privacy/date chips.
- Continue toward M4 with AI patch flow after doc chat/share contracts are stable.

## Open Questions

- UNCONFIRMED: GitHub branch protection setup.
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
- `make serve`
- `make status`
- `make stop`
- `pnpm playwright test apps/web/e2e/smoke/home.spec.ts apps/web/e2e/autosave/autosave-indicator.spec.ts --workers=1`
- `packages/history/src/index.ts`
- `packages/testing/unit/history/history-store.test.ts`
- `packages/testing/unit/diff/diff-deterministic.test.ts`
- `apps/web/components/editor/panels/HistoryPanel.tsx`
- `apps/web/e2e/history/history-open.spec.ts`
- `apps/web/e2e/history/history-diff.spec.ts`
- `apps/web/e2e/history/history-restore.spec.ts`
- `packages/authorship/src/index.ts`
- `packages/testing/unit/authorship/blame-interval-map.test.ts`
- `packages/testing/unit/authorship/blame-property.test.ts`
- `apps/web/e2e/authorship/blame-gutter.spec.ts`
- `apps/web/e2e/authorship/blame-hover.spec.ts`
- `apps/web/e2e/authorship/blame-filter.spec.ts`
- `apps/web/e2e/diff/diff-filter-author.spec.ts`
- `apps/web/e2e/diff/diff-filter-time.spec.ts`
- `apps/web/e2e/diff/diff-share-link.spec.ts`
- `apps/web/e2e/suggest-mode/suggest-visuals.spec.ts`
- `apps/web/e2e/suggest-mode/suggest-accept.spec.ts`
- `apps/web/e2e/suggest-mode/suggest-reject.spec.ts`
- `packages/doc-chat/src/index.ts`
- `packages/testing/unit/doc-chat/thread-store.test.ts`
- `apps/web/components/editor/panels/ChatPanel.tsx`
- `apps/web/e2e/doc-chat/chat-anchor-map.spec.ts`
- `apps/web/e2e/doc-chat/chat-current-context.spec.ts`
- `apps/web/e2e/doc-chat/chat-history-context.spec.ts`
- `apps/web/e2e/doc-chat/chat-orphan.spec.ts`
- `apps/web/e2e/doc-chat/chat-filter-author.spec.ts`
- `apps/web/e2e/doc-chat/chat-filter-ai.spec.ts`
- `packages/share/src/index.ts`
- `packages/rbac/src/index.ts`
- `packages/testing/unit/share/share-rbac.test.ts`
- `apps/web/components/editor/panels/SharePanel.tsx`
- `apps/web/e2e/share/share-comment-scope.spec.ts`
- `apps/web/e2e/share/share-suggest-scope.spec.ts`
- `apps/web/e2e/share/share-edit-scope.spec.ts`
- `apps/web/e2e/share/share-expiry.spec.ts`
- `apps/web/e2e/share/share-audit.spec.ts`
- `apps/web/e2e/privacy/history-redact.spec.ts`
- `apps/web/e2e/privacy/chat-redact.spec.ts`
