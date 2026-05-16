# CONTINUITY.md - Lash

## Goal (incl. success criteria)

Ship Lash v1 as the full collaborative editor spec in `agents.md`, with all acceptance gates passing. Riddle is optional/deferred; no Lash-Riddle code integration until Riddle stabilizes as its own product.

## Constraints/Assumptions

- No direct commits to `main`; current branch `codex/test/bead-15-qa-ime-unit-gates`.
- Riddle integration is planning-only; do not touch `/Users/borker/dev/riddle`.
- Current v1 path resumes from M2 after the Phase 0 gate is restored.
- GitHub remote is `https://github.com/apollostreetcompany/lash-doc.git`; branch protection remains UNCONFIRMED.

## Key Decisions

1. Riddle remains optional and independent for now; Lash v1 should not depend on it.
2. Future Riddle integration, if requested, should enter through Lash's stable operation/history contracts rather than special-case mutation.
3. Bead 0 restores the Lash gate and missing process scaffolding before M2 work resumes.
4. Local history recording now waits for a 900 ms idle window so a normal typing session does not fragment into multiple history versions under load.
5. Doc Chat starts as local in-memory product behavior: anchors, orphaning, context, and filters are validated before server/RBAC persistence lands.
6. Share/RBAC starts with local signed links, capability decisions, audit events, and redaction placeholders before server persistence/API enforcement lands.
7. Mentions/date chips start with local providers and deterministic natural-date parsing; visibility decisions route through `@lash/rbac`, hidden entities render anonymized, and no Riddle integration is introduced.
8. Offline queue/presence starts with a local deterministic collab room: edits queue while offline, replay on reconnect into the semantic op pipeline, and presence state resumes without introducing a websocket runtime yet.
9. Large table performance is guarded with scroll containment, fixed/min column sizing, and a 100x20 browser perf spec for insert, scroll, selection, and commit responsiveness.
10. Screen-reader acceptance starts with semantic landmarks and accessible names for document headings, outline navigation, diff announcements, and chat threads; this remains local UI coverage, not a Riddle integration point.
11. AI editor starts as a deterministic local `EditPatch` flow: generated patches are validated, staged for accept/reject, applied through append-only history with `intent: ai`, labeled in diffs, and cited by document ranges.
12. Cross-browser acceptance is now project-scoped in Playwright: the full Chromium suite runs once, and Chrome, Edge-UA Chromium, Firefox, WebKit/Safari, and iPad WebKit each run a focused editor smoke gate.
13. IME autosave is guarded by an explicit composition gate: transactions during composition do not schedule saves until `compositionend`, and only the final composed snapshot is persisted.

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
- [x] Bead 9 - Mentions, RBAC-hidden suggestions, and natural-date chips.
- [x] Bead 10 - Offline queue, reconnect merge, and presence resume.
- [x] Bead 11 - Large table 100x20 performance gate.
- [x] Bead 12 - Screen-reader headings, diff announcements, and thread navigation.
- [x] Bead 13 - AI patch validation, accept/reject flow, labeling, and citations.
- [x] Bead 14 - Cross-browser Playwright project gates.
- [x] Bead 15 - QA convergence, selection stability, and IME autosave unit gates.

### Now

- Lash MVP with local history, blame gutter, filtered diffs, suggest-mode, Doc Chat anchors, share/RBAC/redaction, mention/date-chip behavior, local offline queue/presence, large-table perf coverage, screen-reader accessibility gates, local AI patch flow, cross-browser e2e gates, and QA/IME unit gates is running at `http://127.0.0.1:3000`.

### Next

- Release readiness pass: confirm branch protection/CI status, review deployment docs, and prepare merge/release notes.

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
- `packages/mentions/src/index.ts`
- `packages/testing/unit/mentions/mention-date-parse.test.ts`
- `packages/testing/unit/mentions/mention-date-locale.test.ts`
- `apps/web/components/editor/panels/MentionPanel.tsx`
- `apps/web/e2e/mentions/mention-suggest.spec.ts`
- `apps/web/e2e/mentions/mention-insert.spec.ts`
- `apps/web/e2e/mentions/mention-rbac-hide.spec.ts`
- `apps/web/e2e/mentions/mention-anonymized.spec.ts`
- `apps/web/e2e/mentions/mention-privacy.spec.ts`
- `packages/collab-service/src/index.ts`
- `packages/testing/unit/collab-service/offline-room.test.ts`
- `apps/web/components/editor/panels/OfflinePanel.tsx`
- `apps/web/e2e/offline/offline-queue.spec.ts`
- `apps/web/e2e/offline/offline-merge.spec.ts`
- `apps/web/e2e/offline/presence-resume.spec.ts`
- `apps/web/e2e/tables/table-perf-100x20.spec.ts`
- `apps/web/components/editor/panels/HistoryPanel.tsx`
- `apps/web/components/editor/panels/ChatPanel.tsx`
- `apps/web/components/editor/panels/OutlinePanel.tsx`
- `apps/web/e2e/a11y/sr-headings.spec.ts`
- `apps/web/e2e/a11y/sr-diff-announce.spec.ts`
- `apps/web/e2e/a11y/sr-thread-nav.spec.ts`
- `packages/ai/src/index.ts`
- `packages/testing/unit/ai/ai-scope-selection.test.ts`
- `packages/testing/unit/ai/ai-invalid-reject.test.ts`
- `packages/testing/unit/ai/ai-fallback.test.ts`
- `apps/web/components/editor/panels/AIPanel.tsx`
- `apps/web/e2e/ai/ai-patch-apply.spec.ts`
- `apps/web/e2e/ai/ai-labeling.spec.ts`
- `apps/web/e2e/ai/ai-rationale.spec.ts`
- `apps/web/e2e/ai/ai-chat-citation.spec.ts`
- `apps/web/e2e/ai/ai-citation-jump.spec.ts`
- `apps/web/e2e/ai/ai-scope-global-confirm.spec.ts`
- `playwright.config.ts`
- `apps/web/e2e/cross-browser/helpers.ts`
- `apps/web/e2e/cross-browser/cb-chrome.spec.ts`
- `apps/web/e2e/cross-browser/cb-edge.spec.ts`
- `apps/web/e2e/cross-browser/cb-firefox.spec.ts`
- `apps/web/e2e/cross-browser/cb-safari.spec.ts`
- `apps/web/e2e/cross-browser/cb-ipad.spec.ts`
- `apps/web/lib/autosave.ts`
- `packages/testing/unit/qa/multi-client-converge.test.ts`
- `packages/testing/unit/qa/selection-stability.test.ts`
- `packages/testing/unit/ime/ime-autosave.test.ts`
- `packages/testing/unit/ime/ime-composition.test.ts`
