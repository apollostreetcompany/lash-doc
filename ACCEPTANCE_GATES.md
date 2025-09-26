# ACCEPTANCE_GATES

Each acceptance scenario from `agents.md` is mapped to a concrete test stub. Harness indicates the runner (Playwright e2e or Vitest unit).

## A.1 — Headings & Collapse

- `outline-collapse-basic` → `apps/web/e2e/outline/outline-collapse-basic.spec.ts` (Playwright e2e)
- `outline-persist` → `apps/web/e2e/outline/outline-persist.spec.ts` (Playwright e2e)
- `outline-caret-move` → `apps/web/e2e/outline/outline-caret-move.spec.ts` (Playwright e2e)

## A.2 — Markdown Hotkeys

- `md-h2-shorthand` → `apps/web/e2e/markdown/md-h2-shorthand.spec.ts` (Playwright e2e)
- `md-bold-italic-hotkeys` → `apps/web/e2e/markdown/md-bold-italic-hotkeys.spec.ts` (Playwright e2e)

## A.3 — Markdown Import/Export

- `md-roundtrip-basic` → `apps/web/e2e/markdown/md-roundtrip-basic.spec.ts` (Playwright e2e)
- `md-table-import` → `apps/web/e2e/markdown/md-table-import.spec.ts` (Playwright e2e)

## A.4 — Focus Mode

- `focus-mode-ui` → `apps/web/e2e/focus-mode/focus-mode-ui.spec.ts` (Playwright e2e)
- `focus-mode-a11y` → `apps/web/e2e/focus-mode/focus-mode-a11y.spec.ts` (Playwright e2e)

## B.1 — Table Cell Types

- `table-status-cycle-kb` → `apps/web/e2e/tables/table-status-cycle-kb.spec.ts` (Playwright e2e)
- `table-select-open-close` → `apps/web/e2e/tables/table-select-open-close.spec.ts` (Playwright e2e)

## B.2 — Keyboard Navigation

- `table-tab-nav` → `apps/web/e2e/tables/table-tab-nav.spec.ts` (Playwright e2e)
- `table-enter-newline` → `apps/web/e2e/tables/table-enter-newline.spec.ts` (Playwright e2e)

## B.3 — Copy/Paste Interop

- `table-copy-out` → `apps/web/e2e/tables/table-copy-out.spec.ts` (Playwright e2e)
- `table-paste-in` → `apps/web/e2e/tables/table-paste-in.spec.ts` (Playwright e2e)

## B.4 — Large Table Performance

- `table-perf-100x20` → `apps/web/e2e/tables/table-perf-100x20.spec.ts` (Playwright e2e)

## B.5 — Images

- `image-clipboard` → `apps/web/e2e/media/image-clipboard.spec.ts` (Playwright e2e)
- `image-dnd` → `apps/web/e2e/media/image-dnd.spec.ts` (Playwright e2e)
- `image-resize` → `apps/web/e2e/media/image-resize.spec.ts` (Playwright e2e)
- `image-retry` → `apps/web/e2e/media/image-retry.spec.ts` (Playwright e2e)

## B.6 — Checklists

- `checklist-toggle` → `apps/web/e2e/checklists/checklist-toggle.spec.ts` (Playwright e2e)
- `checklist-nesting` → `apps/web/e2e/checklists/checklist-nesting.spec.ts` (Playwright e2e)

## C.1 — Doc Links → Chips

- `chip-autoconvert` → `apps/web/e2e/chips/chip-autoconvert.spec.ts` (Playwright e2e)
- `chip-hover` → `apps/web/e2e/chips/chip-hover.spec.ts` (Playwright e2e)
- `chip-revert` → `apps/web/e2e/chips/chip-revert.spec.ts` (Playwright e2e)

## C.2 — @Mentions

- `mention-suggest` → `apps/web/e2e/mentions/mention-suggest.spec.ts` (Playwright e2e)
- `mention-insert` → `apps/web/e2e/mentions/mention-insert.spec.ts` (Playwright e2e)
- `mention-privacy` → `apps/web/e2e/mentions/mention-privacy.spec.ts` (Playwright e2e)

## C.3 — Natural Dates

- `mention-date-parse` → `packages/testing/unit/mentions/mention-date-parse.test.ts` (Vitest unit)
- `mention-date-locale` → `packages/testing/unit/mentions/mention-date-locale.test.ts` (Vitest unit)

## C.4 — Privacy

- `mention-rbac-hide` → `apps/web/e2e/mentions/mention-rbac-hide.spec.ts` (Playwright e2e)
- `mention-anonymized` → `apps/web/e2e/mentions/mention-anonymized.spec.ts` (Playwright e2e)

## D.1 — Suggest Mode

- `suggest-visuals` → `apps/web/e2e/suggest-mode/suggest-visuals.spec.ts` (Playwright e2e)
- `suggest-accept` → `apps/web/e2e/suggest-mode/suggest-accept.spec.ts` (Playwright e2e)
- `suggest-reject` → `apps/web/e2e/suggest-mode/suggest-reject.spec.ts` (Playwright e2e)

## D.2 — Version Timeline

- `history-open` → `apps/web/e2e/history/history-open.spec.ts` (Playwright e2e)
- `history-diff` → `apps/web/e2e/history/history-diff.spec.ts` (Playwright e2e)
- `history-restore` → `apps/web/e2e/history/history-restore.spec.ts` (Playwright e2e)

## D.3 — Filtered Diffs

- `diff-filter-author` → `apps/web/e2e/diff/diff-filter-author.spec.ts` (Playwright e2e)
- `diff-filter-time` → `apps/web/e2e/diff/diff-filter-time.spec.ts` (Playwright e2e)
- `diff-share-link` → `apps/web/e2e/diff/diff-share-link.spec.ts` (Playwright e2e)

## D.4 — Diff Determinism

- `diff-deterministic` → `packages/testing/unit/diff/diff-deterministic.test.ts` (Vitest unit)

## E.1 — Authorship Gutter

- `blame-gutter` → `apps/web/e2e/authorship/blame-gutter.spec.ts` (Playwright e2e)
- `blame-hover` → `apps/web/e2e/authorship/blame-hover.spec.ts` (Playwright e2e)
- `blame-filter` → `apps/web/e2e/authorship/blame-filter.spec.ts` (Playwright e2e)

## E.2 — Attribution Mapping

- `blame-interval-map` → `packages/testing/unit/authorship/blame-interval-map.test.ts` (Vitest unit)
- `blame-property` → `packages/testing/unit/authorship/blame-property.test.ts` (Vitest unit)

## F.1 — Anchored Threads

- `chat-anchor-map` → `apps/web/e2e/doc-chat/chat-anchor-map.spec.ts` (Playwright e2e)
- `chat-orphan` → `apps/web/e2e/doc-chat/chat-orphan.spec.ts` (Playwright e2e)

## F.2 — History-Scoped View

- `chat-history-context` → `apps/web/e2e/doc-chat/chat-history-context.spec.ts` (Playwright e2e)
- `chat-current-context` → `apps/web/e2e/doc-chat/chat-current-context.spec.ts` (Playwright e2e)

## F.3 — Thread Filters

- `chat-filter-author` → `apps/web/e2e/doc-chat/chat-filter-author.spec.ts` (Playwright e2e)
- `chat-filter-ai` → `apps/web/e2e/doc-chat/chat-filter-ai.spec.ts` (Playwright e2e)

## G.1 — Share Scopes

- `share-comment-scope` → `apps/web/e2e/share/share-comment-scope.spec.ts` (Playwright e2e)
- `share-suggest-scope` → `apps/web/e2e/share/share-suggest-scope.spec.ts` (Playwright e2e)
- `share-edit-scope` → `apps/web/e2e/share/share-edit-scope.spec.ts` (Playwright e2e)

## G.2 — Expiry & Audit

- `share-expiry` → `apps/web/e2e/share/share-expiry.spec.ts` (Playwright e2e)
- `share-audit` → `apps/web/e2e/share/share-audit.spec.ts` (Playwright e2e)

## G.3 — Redaction

- `history-redact` → `apps/web/e2e/privacy/history-redact.spec.ts` (Playwright e2e)
- `chat-redact` → `apps/web/e2e/privacy/chat-redact.spec.ts` (Playwright e2e)

## H.1 — Autosave

- `autosave-indicator` → `apps/web/e2e/autosave/autosave-indicator.spec.ts` (Playwright e2e)
- `autosave-latency` → `packages/testing/unit/autosave/autosave-latency.test.ts` (Vitest unit)

## H.2 — Offline Edits

- `offline-queue` → `apps/web/e2e/offline/offline-queue.spec.ts` (Playwright e2e)
- `offline-merge` → `apps/web/e2e/offline/offline-merge.spec.ts` (Playwright e2e)
- `presence-resume` → `apps/web/e2e/offline/presence-resume.spec.ts` (Playwright e2e)

## H.3 — Multi-Client Consistency

- `multi-client-converge` → `packages/testing/unit/qa/multi-client-converge.test.ts` (Vitest unit)
- `selection-stability` → `packages/testing/unit/qa/selection-stability.test.ts` (Vitest unit)

## I.1 — AI Patch Flow

- `ai-patch-apply` → `apps/web/e2e/ai/ai-patch-apply.spec.ts` (Playwright e2e)
- `ai-labeling` → `apps/web/e2e/ai/ai-labeling.spec.ts` (Playwright e2e)
- `ai-rationale` → `apps/web/e2e/ai/ai-rationale.spec.ts` (Playwright e2e)

## I.2 — AI Guardrails

- `ai-invalid-reject` → `packages/testing/unit/ai/ai-invalid-reject.test.ts` (Vitest unit)
- `ai-fallback` → `packages/testing/unit/ai/ai-fallback.test.ts` (Vitest unit)

## I.3 — AI Selection Scope

- `ai-scope-selection` → `packages/testing/unit/ai/ai-scope-selection.test.ts` (Vitest unit)
- `ai-scope-global-confirm` → `apps/web/e2e/ai/ai-scope-global-confirm.spec.ts` (Playwright e2e)

## I.4 — AI Chat Citations

- `ai-chat-citation` → `apps/web/e2e/ai/ai-chat-citation.spec.ts` (Playwright e2e)
- `ai-citation-jump` → `apps/web/e2e/ai/ai-citation-jump.spec.ts` (Playwright e2e)

## J.1 — Cross-Browser

- `cb-chrome` → `apps/web/e2e/cross-browser/cb-chrome.spec.ts` (Playwright e2e)
- `cb-safari` → `apps/web/e2e/cross-browser/cb-safari.spec.ts` (Playwright e2e)
- `cb-firefox` → `apps/web/e2e/cross-browser/cb-firefox.spec.ts` (Playwright e2e)
- `cb-edge` → `apps/web/e2e/cross-browser/cb-edge.spec.ts` (Playwright e2e)
- `cb-ipad` → `apps/web/e2e/cross-browser/cb-ipad.spec.ts` (Playwright e2e)

## J.2 — IME

- `ime-composition` → `packages/testing/unit/ime/ime-composition.test.ts` (Vitest unit)
- `ime-autosave` → `packages/testing/unit/ime/ime-autosave.test.ts` (Vitest unit)

## J.3 — Screen Readers

- `sr-headings` → `apps/web/e2e/a11y/sr-headings.spec.ts` (Playwright e2e)
- `sr-diff-announce` → `apps/web/e2e/a11y/sr-diff-announce.spec.ts` (Playwright e2e)
- `sr-thread-nav` → `apps/web/e2e/a11y/sr-thread-nav.spec.ts` (Playwright e2e)
